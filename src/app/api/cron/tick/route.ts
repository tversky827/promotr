import { timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env';
import { Worker } from '@/lib/jobs/worker';
import { reclaimStalledJobs } from '@/lib/jobs/queue';
import { logger } from '@/lib/observability/logger';

/**
 * Job runner for deployments without a long-lived process.
 *
 * The normal way to run background work is `npm run worker`, a process that
 * polls continuously. On a serverless platform there is nowhere to run one, so
 * this endpoint performs the same work for the duration of one request and a
 * platform scheduler (Vercel Cron, a Kubernetes CronJob, GitHub Actions) calls
 * it every minute.
 *
 * It is not a replacement for the worker under load: a request has a time limit,
 * and this drains what it can within it. DEPLOYMENT.md explains when each is
 * appropriate.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Leaves headroom under the platform's request limit. */
const BUDGET_MS = 45_000;

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  if (!env.cronSecret) {
    // Refusing is the safe default: an unprotected job runner is a way for
    // anyone to drive the queue and, through it, the payment provider.
    return Response.json(
      { error: 'CRON_SECRET is not configured, so this endpoint is disabled.' },
      { status: 503 },
    );
  }

  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const worker = new Worker();

  // Anything a crashed process left claimed comes back first, otherwise those
  // jobs wait for the stall timeout on every tick.
  const reclaimed = await reclaimStalledJobs().catch(() => 0);

  let processed = 0;
  let ticks = 0;
  while (Date.now() - startedAt < BUDGET_MS) {
    const count = await worker.tick();
    ticks += 1;
    processed += count;
    if (count === 0) break; // Queue is empty; nothing to wait for.
  }

  logger.info('cron.tick', {
    processed,
    ticks,
    reclaimed,
    durationMs: Date.now() - startedAt,
  });

  return Response.json(
    { processed, ticks, reclaimed, durationMs: Date.now() - startedAt },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Accepts the secret as a bearer token or, for schedulers that cannot set
 * headers, as a query parameter. Compared in constant time either way.
 */
function authorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const query = new URL(request.url).searchParams.get('secret');
  const provided = bearer ?? query;
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(env.cronSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}
