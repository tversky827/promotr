import type { Metadata } from 'next';

import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { brand } from '@/lib/brand';
import { healthCheck } from '@/lib/db';
import { prisma } from '@/lib/db';
import { formatRelative } from '@/lib/format';
import { kv } from '@/lib/redis';

export const metadata: Metadata = {
  title: 'System status',
  description: 'Live operational status of tracking, conversions, dashboards and payouts.',
  alternates: { canonical: '/status' },
};

export const dynamic = 'force-dynamic';

/**
 * Public status page.
 *
 * Every row is measured at request time against the running system — nothing
 * here is a hard-coded green tick. It deliberately reports capabilities rather
 * than infrastructure: a publisher needs to know whether their links still
 * redirect and whether payouts are moving, not which vendors we use. Naming
 * those would be free reconnaissance for anyone probing the platform.
 */
export default async function StatusPage() {
  const startedAt = Date.now();

  const [database, cacheOk, recentFailures, deadJobs, lastRollup, lastPayout] = await Promise.all([
    healthCheck(),
    kv
      .set('status:probe', '1', 10)
      .then(() => true)
      .catch(() => false),
    prisma.job.count({
      where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    }),
    prisma.job.count({ where: { status: 'DEAD' } }),
    prisma.statHourly
      .findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } })
      .catch(() => null),
    prisma.job
      .findFirst({
        where: { status: 'SUCCEEDED', type: { startsWith: 'payout' } },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      })
      .catch(() => null),
  ]);

  // The queue is the mechanism behind payouts, exports and rollups, so its
  // health is reported as the health of those, not as "the queue".
  const backgroundDegraded = deadJobs > 0 || recentFailures > 5;
  const rollupStale =
    lastRollup?.updatedAt !== undefined &&
    Date.now() - lastRollup.updatedAt.getTime() > 2 * 3_600_000;

  const rows: Array<{ name: string; description: string; state: State; detail?: string }> = [
    {
      name: 'Link redirects',
      description: 'Tracking links resolving and forwarding visitors.',
      state: database.ok ? 'operational' : 'down',
      detail: database.ok ? `${database.latencyMs}ms lookup` : 'Link lookups are failing',
    },
    {
      name: 'Conversion recording',
      description: 'The SDK, pixel, postback and REST endpoints accepting conversions.',
      state: database.ok ? 'operational' : 'down',
    },
    {
      name: 'Dashboards',
      description: 'Reporting figures for brands and publishers.',
      state: !database.ok ? 'down' : rollupStale ? 'degraded' : 'operational',
      detail: lastRollup
        ? `Figures last computed ${formatRelative(lastRollup.updatedAt)}`
        : 'No traffic aggregated yet',
    },
    {
      name: 'Payouts and exports',
      description: 'Withdrawals, scheduled work and CSV generation.',
      state: !database.ok ? 'down' : backgroundDegraded ? 'degraded' : 'operational',
      detail: lastPayout?.completedAt
        ? `Last payout processed ${formatRelative(lastPayout.completedAt)}`
        : undefined,
    },
    {
      name: 'Rate limiting',
      description: 'Abuse protection across the API and sign-in.',
      // The in-memory fallback still enforces limits, per process rather than
      // per cluster, so this is a reduced guarantee and not an outage.
      state: cacheOk ? 'operational' : 'degraded',
    },
  ];

  const worst = rows.reduce<State>(
    (acc, row) =>
      row.state === 'down' ? 'down' : row.state === 'degraded' && acc !== 'down' ? 'degraded' : acc,
    'operational',
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-fg text-balance">
          System status
        </h1>
        <p className="mt-3 text-md text-fg-muted text-pretty">
          Measured against the running system when you loaded this page — {Date.now() - startedAt}ms
          ago. Refresh for a new reading.
        </p>
      </header>

      <Card className="mt-8">
        <CardHeader
          title={
            worst === 'operational'
              ? 'All systems operational'
              : worst === 'degraded'
                ? 'Partially degraded'
                : 'Major outage'
          }
          description={
            worst === 'operational'
              ? 'Everything below responded normally.'
              : 'One or more capabilities are not performing as they should. Details below.'
          }
          action={<StateBadge state={worst} />}
        />
      </Card>

      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.name}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-md font-medium text-fg">{row.name}</p>
                  <p className="mt-0.5 text-sm text-fg-muted text-pretty">{row.description}</p>
                  {row.detail ? (
                    <p className="mt-1 text-xs text-fg-subtle">{row.detail}</p>
                  ) : null}
                </div>
                <StateBadge state={row.state} />
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm text-fg-muted text-pretty">
        Something broken that shows as operational here? Email{' '}
        <a href={`mailto:${brand.supportEmail}`} className="font-medium text-primary hover:underline">
          {brand.supportEmail}
        </a>{' '}
        — this page only knows what it can measure from inside.
      </p>
    </div>
  );
}

type State = 'operational' | 'degraded' | 'down';

function StateBadge({ state }: { state: State }) {
  if (state === 'operational') {
    return (
      <Badge tone="success" dot>
        Operational
      </Badge>
    );
  }
  if (state === 'degraded') {
    return (
      <Badge tone="warning" dot>
        Degraded
      </Badge>
    );
  }
  return (
    <Badge tone="danger" dot>
      Down
    </Badge>
  );
}
