import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { claim, enqueue, markFailed, markSucceeded, reclaimStalledJobs } from '@/lib/jobs/queue';
import { handlerFor } from '@/lib/jobs/handlers';
import { logger } from '@/lib/observability/logger';
import { captureException } from '@/lib/observability/sentry';

/**
 * Background worker.
 *
 * Runs as a separate process (`npm run worker`). Multiple workers can run
 * concurrently and safely: job claiming uses FOR UPDATE SKIP LOCKED, so they
 * never contend for the same job.
 *
 * The worker also owns the recurring schedule. Rather than depending on an
 * external cron, it enqueues periodic jobs with deterministic idempotency keys
 * derived from the time bucket — so if three workers all try to schedule the
 * hourly rollup, exactly one job is created.
 */

export interface WorkerOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  queues?: string[];
  /** Set false in tests to run a fixed number of ticks. */
  scheduleRecurring?: boolean;
}

export class Worker {
  private readonly id = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  private running = false;
  private stopping = false;
  private activeJobs = 0;

  constructor(private readonly options: WorkerOptions = {}) {}

  get workerId(): string {
    return this.id;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;

    logger.info('worker.started', {
      workerId: this.id,
      concurrency: this.options.concurrency ?? env.workerConcurrency,
      queues: this.options.queues ?? ['all'],
    });

    // Recover anything a previously crashed worker left claimed.
    await reclaimStalledJobs().catch((error) =>
      logger.warn('worker.reclaim_failed', { error: (error as Error).message }),
    );

    while (!this.stopping) {
      try {
        const processed = await this.tick();
        if (processed === 0) {
          await sleep(this.options.pollIntervalMs ?? env.workerPollIntervalMs);
        }
      } catch (error) {
        // The loop itself must never die — a database blip should pause the
        // worker, not terminate it.
        captureException(error, { route: 'worker.loop' });
        await sleep(5000);
      }
    }

    // Let in-flight jobs finish before the process exits.
    while (this.activeJobs > 0) await sleep(100);
    this.running = false;
    logger.info('worker.stopped', { workerId: this.id });
  }

  /** One poll cycle. Returns the number of jobs processed. */
  async tick(): Promise<number> {
    if (this.options.scheduleRecurring !== false) {
      await this.scheduleRecurring();
    }

    const limit = this.options.concurrency ?? env.workerConcurrency;
    const jobs = await claim(this.id, limit, this.options.queues ?? []);
    if (jobs.length === 0) return 0;

    await Promise.all(jobs.map((job) => this.run(job)));
    return jobs.length;
  }

  private async run(job: Awaited<ReturnType<typeof claim>>[number]): Promise<void> {
    this.activeJobs += 1;
    const startedAt = Date.now();

    try {
      const handler = handlerFor(job.type);
      if (!handler) {
        // An unknown type is a deploy-ordering problem, not a transient fault.
        await markFailed(job, new Error(`No handler registered for job type "${job.type}"`));
        return;
      }

      await handler((job.payload ?? {}) as Record<string, unknown>, job);
      await markSucceeded(job.id);

      logger.debug('job.succeeded', {
        jobId: job.id,
        type: job.type,
        attempt: job.attempts,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const status = await markFailed(job, error);
      if (status === 'DEAD') {
        captureException(error, {
          route: `job.${job.type}`,
          extra: { jobId: job.id, attempts: job.attempts },
        });
      }
    } finally {
      this.activeJobs -= 1;
    }
  }

  /**
   * Enqueue recurring work. The idempotency key contains the time bucket, so
   * calling this every second still produces exactly one job per bucket.
   */
  private async scheduleRecurring(): Promise<void> {
    const now = new Date();
    const minuteBucket = `${now.toISOString().slice(0, 16)}`;
    const hourBucket = `${now.toISOString().slice(0, 13)}`;
    const dayBucket = `${now.toISOString().slice(0, 10)}`;
    const fiveMinuteBucket = `${now.toISOString().slice(0, 14)}${Math.floor(now.getUTCMinutes() / 5)}`;

    const schedule: Array<[Parameters<typeof enqueue>[0], string, Record<string, unknown>]> = [
      // Every minute: keep dashboards fresh and release matured earnings.
      ['analytics.rollup', `rollup:${minuteBucket}`, { hours: 2 }],
      ['earnings.release', `release:${minuteBucket}`, {}],
      // Every five minutes: budget alerts and campaign completion.
      ['budget.alert', `budget:${fiveMinuteBucket}`, {}],
      ['campaign.complete', `complete:${fiveMinuteBucket}`, {}],
      // Hourly: fraud scores, payout reconciliation, conversion auto-approval.
      ['fraud.recompute', `fraud:${hourBucket}`, {}],
      ['payout.reconcile', `payoutrecon:${hourBucket}`, {}],
      ['conversions.autoapprove', `autoapprove:${hourBucket}`, {}],
      ['partitions.ensure', `partitions:${hourBucket}`, {}],
      // Daily: ledger proof and data retention.
      ['ledger.reconcile', `ledgerrecon:${dayBucket}`, {}],
      ['retention.prune', `retention:${dayBucket}`, {}],
    ];

    for (const [type, key, payload] of schedule) {
      await enqueue(type, payload, { idempotencyKey: key }).catch(() => undefined);
    }
  }

  stop(): void {
    this.stopping = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Entry point used by `npm run worker`. */
export async function runWorker(options: WorkerOptions = {}): Promise<void> {
  const worker = new Worker(options);

  const shutdown = (signal: string) => {
    logger.info('worker.shutdown_signal', { signal });
    worker.stop();
    // Force exit if graceful shutdown stalls.
    setTimeout(() => process.exit(0), 30_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    captureException(reason, { route: 'worker.unhandledRejection' });
  });

  await worker.start();
  await prisma.$disconnect();
  process.exit(0);
}
