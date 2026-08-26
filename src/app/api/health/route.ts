import { healthCheck } from '@/lib/db';
import { integrationStatus } from '@/lib/env';
import { kv } from '@/lib/redis';

/**
 * Liveness and readiness probe.
 *
 * Returns 200 when the application can serve traffic and 503 when it cannot.
 * Deliberately unauthenticated but deliberately terse: it reports whether
 * dependencies are reachable, never version numbers, hostnames or credentials.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const started = Date.now();
  const database = await healthCheck();

  let cache: { ok: boolean; distributed: boolean };
  try {
    await kv.set('health:probe', '1', 10);
    cache = { ok: true, distributed: kv.isDistributed };
  } catch {
    cache = { ok: false, distributed: kv.isDistributed };
  }

  const integrations = integrationStatus();
  // Only the database is load-bearing for readiness. A missing Stripe key means
  // payments are off, not that the app should be pulled from the load balancer.
  const healthy = database.ok;

  return Response.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks: {
        database: { ok: database.ok, latencyMs: database.latencyMs },
        cache,
      },
      integrations: Object.fromEntries(
        Object.entries(integrations).map(([name, value]) => [name, value.configured]),
      ),
      responseTimeMs: Date.now() - started,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
