import type { Metadata } from 'next';

import { AreaChart, RankedBars } from '@/components/charts';
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

  const [balance, metrics, series, sources, freshAt, linkCount] =
    await Promise.all([
      balanceSummary(creator.id),
      totals({ creatorId: creator.id }, range).then(derive),
      timeSeries({ creatorId: creator.id }, range, granularity),
      breakdown({ creatorId: creator.id }, range, 'referrerHost', 6),
      lastRollupAt(),
      prisma.trackingLink.count({ where: { creatorId: creator.id, active: true } }),
    ]);

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
      <StatGrid columns={4} className="mb-4">
        <Stat
          label="Available to withdraw"
          value={formatMicros(balance.availableMicros)}
          tone={balance.availableMicros > 0n ? 'success' : 'neutral'}
          hint={balance.availableMicros > 0n ? 'Ready now' : 'Nothing available yet'}
        />
        <Stat
          label="Pending"
          value={formatMicros(balance.pendingMicros)}
          hint="Clearing verification"
        />
        <Stat label="Paid to date" value={formatMicros(balance.paidMicros)} />
        <Stat
          label="Lifetime earnings"
          value={formatMicros(balance.lifetimeMicros)}
          hint={`${linkCount} active link${linkCount === 1 ? '' : 's'}`}
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

      <StatGrid columns={4} className="mb-6">
        <Stat label="Clicks" value={formatNumber(metrics.clicks)} />
        <Stat
          label="Qualified"
          value={formatNumber(metrics.qualifiedClicks)}
          hint={`${formatPercent(metrics.qualifiedRate)} of clicks`}
        />
        <Stat label="Conversions" value={formatNumber(metrics.conversions)} />
        <Stat
          label="EPC"
          value={formatUnitPrice(metrics.epcMicros)}
          hint="Earnings per click"
          tone="primary"
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Earnings over time"
            description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
          />
          <div className="mt-5">
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
