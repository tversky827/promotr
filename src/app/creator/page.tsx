import Link from 'next/link';
import type { Metadata } from 'next';

import { AreaChart, RankedBars } from '@/components/charts';
import { ButtonLink } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range';
import { Card, CardHeader, EmptyState, Badge } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableEmpty, TableWrap } from '@/components/ui/table';
import { balanceSummary } from '@/lib/billing/earnings';
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
  statusTone,
  humanize,
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

  const [balance, metrics, series, sources, topCampaigns, recentEarnings, freshAt, linkCount] =
    await Promise.all([
      balanceSummary(creator.id),
      totals({ creatorId: creator.id }, range).then(derive),
      timeSeries({ creatorId: creator.id }, range, granularity),
      breakdown({ creatorId: creator.id }, range, 'referrerHost', 6),
      topCampaignsFor(creator.id, range),
      prisma.earning.findMany({
        where: { creatorId: creator.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { campaign: { select: { name: true, slug: true } } },
      }),
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
        <div className="flex items-center gap-2">
          <DateRangePicker current={rangeKey} />
          <ButtonLink href="/campaigns" size="sm">
            Find campaigns
          </ButtonLink>
        </div>
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5">
            <CardHeader
              title="Your top campaigns"
              action={
                <Link href="/creator/earnings" className="text-sm text-primary hover:underline">
                  All earnings
                </Link>
              }
            />
          </div>
          <TableWrap className="border-t border-border">
            <Table>
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH align="right">Clicks</TH>
                  <TH align="right">Conv.</TH>
                  <TH align="right">Earned</TH>
                </TR>
              </THead>
              <TBody>
                {topCampaigns.length === 0 ? (
                  <TableEmpty colSpan={4} message="No campaign activity in this period yet." />
                ) : (
                  topCampaigns.map((campaign) => (
                    <TR key={campaign.campaignId}>
                      <TD>
                        <Link
                          href={`/campaigns/${campaign.slug}`}
                          className="font-medium text-fg hover:text-primary"
                        >
                          {campaign.name}
                        </Link>
                      </TD>
                      <TD align="right" numeric>
                        {formatNumber(campaign.clicks)}
                      </TD>
                      <TD align="right" numeric>
                        {formatNumber(campaign.conversions)}
                      </TD>
                      <TD align="right" numeric className="font-medium">
                        {formatMicros(campaign.netMicros)}
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
            <CardHeader
              title="Recent earnings"
              action={
                <Link href="/creator/earnings" className="text-sm text-primary hover:underline">
                  View ledger
                </Link>
              }
            />
          </div>
          <TableWrap className="border-t border-border">
            <Table>
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH>Status</TH>
                  <TH align="right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {recentEarnings.length === 0 ? (
                  <TableEmpty
                    colSpan={3}
                    message="Nothing yet. Grab a campaign link to get started."
                  />
                ) : (
                  recentEarnings.map((earning) => (
                    <TR key={earning.id}>
                      <TD>
                        <div className="font-medium text-fg">{earning.campaign.name}</div>
                        <div className="text-xs text-fg-subtle">
                          {humanize(earning.eventType)} · {formatRelative(earning.createdAt)}
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(earning.status)}>{humanize(earning.status)}</Badge>
                      </TD>
                      <TD align="right" numeric className="font-medium">
                        {formatMicros(earning.netMicros)}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      </div>

      {metrics.clicks === 0 && balance.lifetimeMicros === 0n ? (
        <EmptyState
          className="mt-6"
          title="You have not sent any traffic yet"
          description="Find a campaign that fits your audience, take your link, and share it. Earnings appear here as traffic arrives."
          action={<ButtonLink href="/campaigns">Browse campaigns</ButtonLink>}
        />
      ) : null}
    </>
  );
}

async function topCampaignsFor(creatorId: string, range: { from: Date; to: Date }) {
  const rows = await prisma.$queryRaw<
    Array<{
      campaign_id: string;
      name: string;
      slug: string;
      clicks: bigint;
      conversions: bigint;
      net: bigint;
    }>
  >`
    SELECT
      s."campaignId" AS campaign_id,
      c.name,
      c.slug,
      COALESCE(SUM(s."qualifiedClicks"), 0)::bigint AS clicks,
      COALESCE(SUM(s.conversions), 0)::bigint AS conversions,
      COALESCE(SUM(s."netMicros"), 0)::bigint AS net
    FROM "stat_hourly" s
    JOIN "campaigns" c ON c.id = s."campaignId"
    WHERE s."creatorId" = ${creatorId}::uuid
      AND s.bucket >= ${range.from} AND s.bucket < ${range.to}
    GROUP BY 1, 2, 3
    ORDER BY net DESC
    LIMIT 6
  `;

  return rows.map((row) => ({
    campaignId: row.campaign_id,
    name: row.name,
    slug: row.slug,
    clicks: Number(row.clicks),
    conversions: Number(row.conversions),
    netMicros: row.net,
  }));
}
