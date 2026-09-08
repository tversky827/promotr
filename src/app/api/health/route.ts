import { healthCheck } from '@/lib/db';
import { demoEnabled, demoReady } from '@/lib/demo/mode';
import { integrationStatus } from '@/lib/env';
import { kv } from '@/lib/redis';

/**
 * Liveness and readiness probe.
 *
 * Returns 200 when the application can serve traffic and 503 when it cannot.
 * Deliberately unauthenticated but deliberately terse: it reports whether
 * dependencies are reachable, never version numbers, hostnames or credentials.
 *
 * It also reports the two conditions the demo bar depends on. Whether a
 * deployment has DEMO_MODE on, and whether its database holds the demo
 * accounts, are the only reasons the switcher does not appear — and neither is
 * visible from the page itself, which leaves someone staring at a site that
 * looks finished and gives them nothing to go on. Both are configuration
 * states, not secrets.
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

  // demoReady() short-circuits without touching the database when the flag is
  // off, so this costs a normal deployment nothing.
  const demo = { enabled: demoEnabled, dataLoaded: database.ok ? await demoReady() : false };
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
      demo: {
        ...demo,
        // The switcher renders only when both are true; say which is missing.
        switcherVisible: demo.enabled && demo.dataLoaded,
        blockedBy: demo.enabled
          ? demo.dataLoaded
            ? null
            : 'Demo accounts are not in this database. The build loads them; check the build log for the seed step.'
          : 'DEMO_MODE is not set to true on this deployment. Set it and redeploy.',
      },
      responseTimeMs: Date.now() - started,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
