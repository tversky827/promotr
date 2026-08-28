import type { Metadata } from 'next';

import { AreaChart, RankedBars } from '@/components/charts';
import { ActivityFeed } from '@/components/creator/activity-feed';
import { LinksTable } from '@/components/creator/links-table';
import { ButtonLink } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range';
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { balanceSummary } from '@/lib/billing/earnings';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageCreator } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import {
  breakdown,
  derive,
  fillSeries,
  granularityFor,
  presetRange,
  timeSeries,
  totals,
} from '@/lib/analytics/queries';
import { lastRollupAt } from '@/lib/analytics/rollup';
import {
  formatCompact,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@/lib/format';
import { formatMicros, formatUnitPrice } from '@/lib/money';

export const metadata: Metadata = { title: 'Overview' };

/** Wide enough to cover any rollup bucket; stat_hourly starts at launch. */
const ALL_TIME = { from: new Date('2000-01-01T00:00:00Z'), to: new Date('2100-01-01T00:00:00Z') };
export const dynamic = 'force-dynamic';

export default async function CreatorDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { creator } = await pageCreator();
  const { range: rangeKey = '30d' } = await searchParams;

  const range = presetRange(rangeKey);
  const granularity = granularityFor(range);

  const csrfToken = await currentCsrfToken();

  const [balance, metrics, lifetime, series, sources, freshAt, linkCount] = await Promise.all([
    balanceSummary(creator.id),
    totals({ creatorId: creator.id }, range).then(derive),
    // The headline figures are lifetime, not "last 30 days": a publisher's
    // sense of the platform is what it has paid them in total, and a range
    // picker silently rewriting that number is how dashboards mislead.
    totals({ creatorId: creator.id }, ALL_TIME).then(derive),
    timeSeries({ creatorId: creator.id }, range, granularity),
    breakdown({ creatorId: creator.id }, range, 'referrerHost', 6),
    lastRollupAt(),
    prisma.trackingLink.count({ where: { creatorId: creator.id, active: true } }),
  ]);

  // Conversions per click, rather than per qualified click: it is the rate a
  // publisher can compare against what they see on their own analytics.
  const conversionRate =
    lifetime.clicks > 0 ? (lifetime.conversions / lifetime.clicks) * 100 : 0;

  const filled = fillSeries(series, range, granularity);

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Overview</h1>
          <p className="mt-1 text-md text-fg-muted">
            {freshAt ? (
              <>Performance data updated {formatRelative(freshAt)}.</>
            ) : (
              <>Performance data appears here once your links start receiving traffic.</>
            )}
          </p>
        </div>
        <DateRangePicker current={rangeKey} />
      </div>

      {/* Balance first: it is the number publishers open the dashboard for. */}
      <div className="card mb-4 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">
            Available to withdraw
          </p>
          <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-primary">
            {formatMicros(balance.availableMicros)}
          </p>
          <p className="mt-1.5 text-sm text-fg-muted">
            {formatMicros(balance.pendingMicros)} still clearing ·{' '}
            {formatMicros(balance.paidMicros)} paid out so far
          </p>
        </div>
        {balance.availableMicros > 0n ? (
          <ButtonLink href="/creator/earnings#withdraw" size="lg" className="shrink-0">
            Withdraw earnings
          </ButtonLink>
        ) : (
          // A withdraw button with nothing behind it is a promise the page
          // cannot keep. Say what has to happen first instead.
          <p className="max-w-xs shrink-0 text-sm text-fg-muted text-pretty sm:text-right">
            {balance.pendingMicros > 0n
              ? 'Nothing to withdraw yet — your pending earnings become available once their hold period ends.'
              : 'Nothing to withdraw yet. Earnings appear here as traffic through your links qualifies.'}
          </p>
        )}
      </div>

      <StatGrid columns={5} className="mb-4">
        <Stat label="Earnings" value={formatMicros(balance.lifetimeMicros)} hint="All time" />
        <Stat
          label="Pending"
          value={formatMicros(balance.pendingMicros)}
          hint="Clearing verification"
        />
        <Stat label="Clicks" value={formatNumber(lifetime.clicks)} hint="All time" />
        <Stat
          label="Campaigns promoted"
          value={formatNumber(linkCount)}
          hint={linkCount === 1 ? 'Active link' : 'Active links'}
        />
        <Stat
          label="Conversion rate"
          value={formatPercent(conversionRate)}
          hint={`${formatNumber(lifetime.conversions)} conversions`}
        />
      </StatGrid>

      {balance.underReviewMicros > 0n ? (
        <Card className="mb-4 border-warning/30 bg-warning-soft/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-fg">
                {formatMicros(balance.underReviewMicros)} is under review
              </p>
              <p className="mt-0.5 text-sm text-fg-muted text-pretty">
                Some traffic was flagged for manual review. These earnings are held, not removed —
                if the review clears them they become available as normal.
              </p>
            </div>
            <ButtonLink href="/creator/earnings?status=UNDER_REVIEW" size="sm" variant="secondary">
              See what was flagged
            </ButtonLink>
          </div>
        </Card>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader
            title="Earnings over time"
            description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
          />

          {/* Period figures live with the chart they describe. Repeating them
              as headline stats alongside the lifetime ones only invites the
              reader to mistake one for the other. */}
          <dl className="mt-4 grid grid-cols-2 gap-4 border-y border-border py-3 sm:grid-cols-4">
            <PeriodStat label="Clicks" value={formatNumber(metrics.clicks)} />
            <PeriodStat
              label="Qualified"
              value={formatNumber(metrics.qualifiedClicks)}
              hint={`${formatPercent(metrics.qualifiedRate)} of clicks`}
            />
            <PeriodStat label="Conversions" value={formatNumber(metrics.conversions)} />
            <PeriodStat
              label="Earnings per click"
              value={formatUnitPrice(metrics.epcMicros)}
              tone
            />
          </dl>
          <div className="mt-4">
            <AreaChart
              data={filled.map((point) => ({
                label:
                  granularity === 'hour'
                    ? `${point.bucket.getUTCHours()}:00`
                    : formatDate(point.bucket),
                value: Number(point.netMicros) / 1_000_000,
              }))}
              formatValue={(v) => `$${v.toFixed(2)}`}
              ariaLabel="Earnings over time"
              height={240}
            />
          </div>
        </Card>

        <div className="space-y-4">
          <ActivityFeed creatorId={creator.id} />

          <Card>
            <CardHeader title="Traffic sources" description="Where your clicks came from" />
            <div className="mt-5">
              <RankedBars
                data={sources.map((source) => ({
                  label: source.label,
                  value: source.clicks,
                  share: source.share,
                }))}
                formatValue={formatCompact}
                emptyMessage="No traffic yet in this period"
              />
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <LinksTable creatorId={creator.id} csrfToken={csrfToken} />
      </div>

      {metrics.clicks === 0 && balance.lifetimeMicros === 0n ? (
        <EmptyState
          className="mt-6"
          title="You have not sent any traffic yet"
          description="Find a campaign that fits your audience, take your link, and share it. Earnings appear here as traffic arrives."
          action={<ButtonLink href="/">Browse campaigns</ButtonLink>}
        />
      ) : null}
    </>
  );
}

function PeriodStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: boolean;
}) {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd
        className={`mt-0.5 text-lg font-semibold tabular-nums tracking-tight ${
          tone ? 'text-primary' : 'text-fg'
        }`}
      >
        {value}
      </dd>
      {hint ? <p className="text-2xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
