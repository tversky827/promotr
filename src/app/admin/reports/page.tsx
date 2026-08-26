import type { Metadata } from 'next';

import { AreaChart, BarChart, RankedBars } from '@/components/charts';
import { DateRangePicker } from '@/components/ui/date-range';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableEmpty, TableWrap } from '@/components/ui/table';
import {
  breakdown,
  derive,
  fillSeries,
  granularityFor,
  presetRange,
  timeSeries,
  topPublishers,
  totals,
} from '@/lib/analytics/queries';
import { pageAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import {
  countryName,
  formatCompact,
  formatDate,
  formatNumber,
  formatPercent,
} from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await pageAdmin();
  const { range: rangeKey = '30d' } = await searchParams;

  const range = presetRange(rangeKey);
  const granularity = granularityFor(range);

  const [metrics, series, publishers, countries, devices, brands] = await Promise.all([
    totals({}, range).then(derive),
    timeSeries({}, range, granularity),
    topPublishers({}, range, 10),
    breakdown({}, range, 'country', 8),
    breakdown({}, range, 'deviceType', 5),
    topBrands(range),
  ]);

  const filled = fillSeries(series, range, granularity);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Marketplace-wide performance."
        action={<DateRangePicker current={rangeKey} />}
      />

      <StatGrid columns={5} className="mb-6">
        <Stat label="Clicks" value={formatNumber(metrics.clicks)} />
        <Stat
          label="Qualified"
          value={formatNumber(metrics.qualifiedClicks)}
          hint={formatPercent(metrics.qualifiedRate)}
        />
        <Stat label="Conversions" value={formatNumber(metrics.conversions)} />
        <Stat
          label="Volume"
          value={formatMicros(metrics.grossMicros, { showSubCent: false })}
        />
        <Stat
          label="Platform revenue"
          value={formatMicros(metrics.feeMicros, { showSubCent: false })}
          tone="primary"
          hint={
            metrics.grossMicros > 0n
              ? `${formatPercent(Number((metrics.feeMicros * 10_000n) / metrics.grossMicros) / 100)} take rate`
              : undefined
          }
        />
      </StatGrid>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Marketplace volume"
            description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
          />
          <div className="mt-5">
            <AreaChart
              data={filled.map((point) => ({
                label:
                  granularity === 'hour'
                    ? `${point.bucket.getUTCHours()}:00`
                    : formatDate(point.bucket),
                value: Number(point.grossMicros) / 1_000_000,
              }))}
              formatValue={(v) => `$${v.toFixed(0)}`}
              ariaLabel="Marketplace volume over time"
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Conversions" />
          <div className="mt-5">
            <BarChart
              data={filled.map((point) => ({
                label:
                  granularity === 'hour'
                    ? `${point.bucket.getUTCHours()}:00`
                    : formatDate(point.bucket),
                value: point.conversions,
              }))}
              ariaLabel="Conversions over time"
            />
          </div>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Traffic by country" />
          <div className="mt-5">
            <RankedBars
              data={countries.map((c) => ({
                label: c.label === 'Unknown' ? 'Unknown' : countryName(c.label),
                value: c.clicks,
                share: c.share,
              }))}
              formatValue={formatCompact}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Traffic by device" />
          <div className="mt-5">
            <RankedBars
              data={devices.map((d) => ({ label: d.label, value: d.clicks, share: d.share }))}
              formatValue={formatCompact}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5">
            <CardHeader title="Top publishers" description="By marketplace volume" />
          </div>
          <TableWrap className="border-t border-border">
            <Table>
              <THead>
                <TR>
                  <TH>Publisher</TH>
                  <TH align="right">Clicks</TH>
                  <TH align="right">EPC</TH>
                  <TH align="right">Volume</TH>
                </TR>
              </THead>
              <TBody>
                {publishers.length === 0 ? (
                  <TableEmpty colSpan={4} message="No activity in this period." />
                ) : (
                  publishers.map((publisher) => (
                    <TR key={publisher.creatorId}>
                      <TD>
                        <div className="font-medium text-fg">{publisher.displayName}</div>
                        <div className="text-2xs text-fg-subtle">@{publisher.handle}</div>
                      </TD>
                      <TD align="right" numeric>
                        {formatNumber(publisher.clicks)}
                      </TD>
                      <TD align="right" numeric>
                        {formatMicros(publisher.epcMicros)}
                      </TD>
                      <TD align="right" numeric className="font-medium">
                        {formatMicros(publisher.grossMicros, { showSubCent: false })}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
        </Card>

        <Card padded={false}>
          <div className="p-5">
            <CardHeader title="Top brands" description="By spend" />
          </div>
          <TableWrap className="border-t border-border">
            <Table>
              <THead>
                <TR>
                  <TH>Brand</TH>
                  <TH align="right">Conversions</TH>
                  <TH align="right">Spend</TH>
                </TR>
              </THead>
              <TBody>
                {brands.length === 0 ? (
                  <TableEmpty colSpan={3} message="No spend in this period." />
                ) : (
                  brands.map((row) => (
                    <TR key={row.brandId}>
                      <TD className="font-medium text-fg">{row.name}</TD>
                      <TD align="right" numeric>
                        {formatNumber(row.conversions)}
                      </TD>
                      <TD align="right" numeric className="font-medium">
                        {formatMicros(row.grossMicros, { showSubCent: false })}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      </div>
    </>
  );
}

async function topBrands(range: { from: Date; to: Date }) {
  const rows = await prisma.$queryRaw<
    Array<{ brand_id: string; name: string; conversions: bigint; gross: bigint }>
  >`
    SELECT
      b.id AS brand_id,
      b."displayName" AS name,
      COALESCE(SUM(s.conversions), 0)::bigint AS conversions,
      COALESCE(SUM(s."grossMicros"), 0)::bigint AS gross
    FROM "stat_hourly" s
    JOIN "campaigns" c ON c.id = s."campaignId"
    JOIN "brands" b ON b.id = c."brandId"
    WHERE s.bucket >= ${range.from} AND s.bucket < ${range.to}
    GROUP BY 1, 2
    ORDER BY gross DESC
    LIMIT 10
  `;

  return rows.map((row) => ({
    brandId: row.brand_id,
    name: row.name,
    conversions: Number(row.conversions),
    grossMicros: row.gross,
  }));
}
