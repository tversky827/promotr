import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

import type { Job, JobStatus } from '@prisma/client';

/**
 * Durable job queue, backed by Postgres.
 *
 * Postgres rather than a dedicated broker because the jobs that matter here —
 * payouts, webhook deliveries, ledger maintenance — must be transactionally
 * consistent with the data that created them. Enqueuing inside the same
 * transaction as the business write means a job can never reference a row that
 * was rolled back, and there is no second system to get out of sync.
 *
 * `FOR UPDATE SKIP LOCKED` gives safe concurrent consumption across any number
 * of worker processes without a coordinator.
 *
 * Retries use exponential backoff. A job that exhausts its attempts becomes
 * DEAD rather than vanishing, so failures are inspectable in the admin console
 * — that is the dead-letter queue.
 */

export type JobType =
  | 'email.send'
  | 'webhook.dispatch'
  | 'webhook.retry'
  | 'analytics.rollup'
  | 'fraud.recompute'
  | 'export.generate'
  | 'payout.process'
  | 'payout.reconcile'
  | 'budget.alert'
  | 'earnings.release'
  | 'conversions.autoapprove'
  | 'campaign.moderate'
  | 'campaign.complete'
  | 'notify.creator.earning'
  | 'notify.generic'
  | 'retention.prune'
  | 'partitions.ensure'
  | 'ledger.reconcile'
  | 'domain.verify';

export interface EnqueueOptions {
  queue?: string;
  runAt?: Date;
  maxAttempts?: number;
  /** Guarantees a single instance of this logical job. */
  idempotencyKey?: string;
  /** Enqueue inside an existing transaction. */
  tx?: {
    job: { create: (args: { data: Record<string, unknown> }) => Promise<Job> };
    $queryRaw: typeof prisma.$queryRaw;
  };
}

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
): Promise<Job | null> {
  const data = {
    queue: options.queue ?? defaultQueueFor(type),
    type,
    payload: serialize(payload) as never,
    runAt: options.runAt ?? new Date(),
    maxAttempts: options.maxAttempts ?? 5,
    idempotencyKey: options.idempotencyKey ?? null,
  };

  // A duplicate idempotency key means the job already exists, which is the
  // point of the key. Suppressing it in the INSERT rather than catching the
  // constraint violation matters twice over: the client logs a Prisma error for
  // every caught violation, which is exactly the noise that hides a real one —
  // and inside a transaction a failed statement aborts the whole transaction,
  // so catching it there is not recoverable at all.
  if (options.idempotencyKey) {
    const client = options.tx ?? prisma;
    const [row] = await client.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "jobs" (id, queue, type, payload, "runAt", "maxAttempts", "idempotencyKey")
      VALUES (
        gen_random_uuid(),
        ${data.queue},
        ${data.type},
        ${data.payload as never}::jsonb,
        ${data.runAt},
        ${data.maxAttempts},
        ${options.idempotencyKey}
      )
      ON CONFLICT ("idempotencyKey") DO NOTHING
      RETURNING id
    `;

    if (!row) {
      logger.debug('job.duplicate_suppressed', { type, idempotencyKey: options.idempotencyKey });
      return null;
    }
    return (await prisma.job.findUnique({ where: { id: row.id } })) as Job;
  }

  try {
    if (options.tx) {
      return await options.tx.job.create({ data });
    }
    return await prisma.job.create({ data });
  } catch (error) {
    logger.error('job.enqueue_failed', { type, error: (error as Error).message });
    throw error;
  }
}

/**
 * Separate queues so a flood of one job type cannot starve another. The
 * `critical` queue carries anything touching money.
 */
function defaultQueueFor(type: JobType): string {
  if (type.startsWith('payout.') || type === 'ledger.reconcile') return 'critical';
  if (type.startsWith('webhook.')) return 'webhooks';
  if (type.startsWith('email.') || type.startsWith('notify.')) return 'notifications';
  if (type === 'export.generate' || type === 'analytics.rollup') return 'batch';
  return 'default';
}

/**
 * Claim up to `limit` runnable jobs for this worker. SKIP LOCKED means workers
 * never block one another or hand the same job to two consumers.
 */
export async function claim(
  workerId: string,
  limit: number,
  queues: string[] = [],
): Promise<Job[]> {
  const queueFilter = queues.length > 0 ? queues : null;

  const jobs = await prisma.$queryRaw<Job[]>`
    UPDATE "jobs"
    SET status = 'RUNNING',
        "lockedAt" = now(),
        "lockedBy" = ${workerId},
        attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "jobs"
      WHERE status = 'QUEUED'
        AND "runAt" <= now()
        AND (${queueFilter}::text[] IS NULL OR queue = ANY(${queueFilter}::text[]))
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING *
  `;

  return jobs;
}

export async function markSucceeded(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'SUCCEEDED', completedAt: new Date(), lastError: null },
  });
}

/**
 * Record a failure and schedule a retry, or bury the job when its attempts are
 * exhausted. Backoff is exponential with jitter: 30s, 2m, 8m, 32m, 2h.
 */
export async function markFailed(job: Job, error: unknown): Promise<JobStatus> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'DEAD', lastError: message.slice(0, 2000), completedAt: new Date() },
    });
    logger.error('job.dead', {
      jobId: job.id,
      type: job.type,
      attempts: job.attempts,
      error: message,
    });
    return 'DEAD';
  }

  const backoffMs = Math.min(4 ** job.attempts * 30_000, 2 * 60 * 60 * 1000);
  const jitter = Math.floor(Math.random() * Math.min(backoffMs * 0.2, 30_000));

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: 'QUEUED',
      runAt: new Date(Date.now() + backoffMs + jitter),
      lastError: message.slice(0, 2000),
      lockedAt: null,
      lockedBy: null,
    },
  });

  logger.warn('job.retry_scheduled', {
    jobId: job.id,
    type: job.type,
    attempt: job.attempts,
    retryInMs: backoffMs + jitter,
    error: message,
  });
  return 'QUEUED';
}

/**
 * Recover jobs whose worker died mid-run. Without this a crash would leave them
 * RUNNING forever.
 */
export async function reclaimStalledJobs(olderThanMs = 10 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.job.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
    data: { status: 'QUEUED', lockedAt: null, lockedBy: null },
  });
  if (result.count > 0) {
    logger.warn('job.reclaimed_stalled', { count: result.count });
  }
  return result.count;
}

/** Dead-letter inspection for the admin console. */
export async function deadLetterJobs(limit = 100) {
  return prisma.job.findMany({
    where: { status: 'DEAD' },
    orderBy: { completedAt: 'desc' },
    take: limit,
  });
}

export async function retryDeadJob(jobId: string): Promise<boolean> {
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: 'DEAD' },
    data: { status: 'QUEUED', attempts: 0, runAt: new Date(), lastError: null, completedAt: null },
  });
  return result.count > 0;
}

export async function queueStats(): Promise<
  Array<{ queue: string; status: JobStatus; count: number }>
> {
  const rows = await prisma.$queryRaw<Array<{ queue: string; status: JobStatus; count: bigint }>>`
    SELECT queue, status, COUNT(*)::bigint AS count
    FROM "jobs"
    GROUP BY queue, status
    ORDER BY queue, status
  `;
  return rows.map((r) => ({ queue: r.queue, status: r.status, count: Number(r.count) }));
}

/** Housekeeping: drop succeeded jobs older than a week. */
export async function pruneCompletedJobs(olderThanDays = 7): Promise<number> {
  const result = await prisma.job.deleteMany({
    where: {
      status: 'SUCCEEDED',
      completedAt: { lt: new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000) },
    },
  });
  return result.count;
}

function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serialize(v)]),
    );
  }
  return value;
}
