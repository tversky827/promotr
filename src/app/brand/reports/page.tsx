import type { Metadata } from 'next';

import { AreaChart, RankedBars } from '@/components/charts';
import { ExportsPanel, type ExportJobView } from '@/components/exports/panel';
import { DateRangePicker } from '@/components/ui/date-range';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
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
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageBrand } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import {
  countryName,
  formatCompact,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
  humanize,
} from '@/lib/format';
import { formatMicros } from '@/lib/money';
import { requestBrandExport } from '@/server/actions/campaigns';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function BrandReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { brand, user } = await pageBrand();
  const { range: rangeKey = '30d' } = await searchParams;
  const range = presetRange(rangeKey);
  const granularity = granularityFor(range);
  const scope = { brandId: brand.id };
  const csrfToken = await currentCsrfToken();

  const [metrics, series, countries, devices, sources, campaigns, jobs, freshAt] =
    await Promise.all([
      totals(scope, range).then(derive),
      timeSeries(scope, range, granularity),
      breakdown(scope, range, 'country', 8),
      breakdown(scope, range, 'deviceType', 5),
      breakdown(scope, range, 'utmSource', 8),
      prisma.campaign.findMany({
        where: { brandId: brand.id },
        select: { id: true, name: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.exportJob.findMany({
        where: { userId: user.id, scopeKind: 'brand' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      lastRollupAt(),
    ]);

  const filled = fillSeries(series, range, granularity);

  return (
    <>
      <PageHeader
        title="Reports"
        description={
          freshAt
            ? `Aggregated from your campaign traffic. Last computed ${formatRelative(freshAt)}.`
            : 'Aggregated from your campaign traffic.'
        }
        action={<DateRangePicker current={rangeKey} />}
      />

      <StatGrid columns={4} className="mb-6">
        <Stat label="Clicks" value={formatNumber(metrics.clicks)} hint={`${formatNumber(metrics.qualifiedClicks)} billable`} />
        <Stat label="Conversions" value={formatNumber(metrics.conversions)} hint={formatPercent(metrics.conversionRate)} />
        <Stat label="Spend" value={formatMicros(metrics.grossMicros)} hint={`${formatMicros(metrics.feeMicros)} platform fee`} />
        <Stat
          label="Revenue reported"
          value={formatMicros(metrics.revenueMicros)}
          hint={metrics.roas === null ? 'No spend yet' : `${metrics.roas.toFixed(2)}× return`}
        />
      </StatGrid>

      <Card className="mb-6">
        <CardHeader title="Traffic and spend" description={`${formatDate(range.from)} to ${formatDate(range.to)}`} />
        <AreaChart
          className="mt-4"
          data={filled.map((point) => ({
            label:
              granularity === 'hour'
                ? `${point.bucket.getUTCHours()}:00`
                : formatDate(point.bucket),
            value: point.clicks,
          }))}
          formatValue={(value) => formatCompact(value)}
          ariaLabel="Clicks over time"
          height={240}
        />
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Countries" description="Where your clicks came from" />
          <RankedBars
            className="mt-4"
            data={countries.map((row) => ({ label: countryName(row.label), value: row.clicks, share: row.share }))}
            formatValue={(value) => formatNumber(value)}
          />
        </Card>
        <Card>
          <CardHeader title="Devices" description="Device type of each click" />
          <RankedBars
            className="mt-4"
            data={devices.map((row) => ({ label: humanize(row.label), value: row.clicks, share: row.share }))}
            formatValue={(value) => formatNumber(value)}
          />
        </Card>
        <Card>
          <CardHeader title="Sources" description="utm_source on the tracking link" />
          <RankedBars
            className="mt-4"
            data={sources.map((row) => ({ label: row.label, value: row.clicks, share: row.share }))}
            formatValue={(value) => formatNumber(value)}
          />
        </Card>
      </div>

      <ExportsPanel
        csrfToken={csrfToken}
        action={requestBrandExport}
        campaigns={campaigns}
        jobs={jobs.map(
          (job): ExportJobView => ({
            id: job.id,
            kind: job.kind,
            status: job.status,
            rowCount: job.rowCount,
            fileUrl: job.fileUrl,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt.toISOString(),
            expiresAt: job.expiresAt?.toISOString() ?? null,
          }),
        )}
        kinds={[
          { value: 'clicks', label: 'Clicks' },
          { value: 'conversions', label: 'Conversions' },
          { value: 'earnings', label: 'Publisher earnings' },
          { value: 'creators', label: 'Publishers' },
          { value: 'spend', label: 'Spend' },
        ]}
        description="Every row we hold for your campaigns, including the eligibility decision on each click, so you can reconcile our billing against your own analytics."
      />
    </>
  );
}
