import Link from 'next/link';
import type { Metadata } from 'next';

import { AreaChart, Funnel, RankedBars } from '@/components/charts';
import { ButtonLink } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableEmpty, TableWrap } from '@/components/ui/table';
import {
  breakdown,
  derive,
  fillSeries,
  funnel,
  granularityFor,
  presetRange,
  timeSeries,
  topPublishers,
  totals,
} from '@/lib/analytics/queries';
import { lastRollupAt } from '@/lib/analytics/rollup';
import { pageBrand } from '@/lib/auth/guards';
import { accounts, balanceOf } from '@/lib/billing/ledger';
import { prisma } from '@/lib/db';
import {
  countryName,
  formatCompact,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
  humanize,
  statusTone,
} from '@/lib/format';
import { formatMicros, formatUnitPrice } from '@/lib/money';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

export default async function BrandDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { brand } = await pageBrand();
  const { range: rangeKey = '30d' } = await searchParams;

  const range = presetRange(rangeKey);
  const granularity = granularityFor(range);
  const scope = { brandId: brand.id };

  const [
    metrics,
    series,
    publishers,
    countries,
    stages,
    campaigns,
    depositBalance,
    freshAt,
    committed,
  ] = await Promise.all([
    totals(scope, range).then(derive),
    timeSeries(scope, range, granularity),
    topPublishers(scope, range, 6),
    breakdown(scope, range, 'country', 6),
    funnel(scope, range),
    prisma.campaign.findMany({
      where: { brandId: brand.id },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 8,
      include: { budget: true },
    }),
    balanceOf(accounts.brandDeposit(brand.id)),
    lastRollupAt(),
    prisma.campaignBudget.aggregate({
      where: { campaign: { brandId: brand.id } },
      _sum: { fundedMicros: true, reservedMicros: true, spentMicros: true },
    }),
  ]);

  const filled = fillSeries(series, range, granularity);
  const funded = committed._sum.fundedMicros ?? 0n;
  const reserved = committed._sum.reservedMicros ?? 0n;
  const spent = committed._sum.spentMicros ?? 0n;
  const campaignRemaining = funded - reserved - spent;

  const hasAnyCampaign = campaigns.length > 0;

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Overview</h1>
          <p className="mt-1 text-md text-fg-muted">
            {freshAt
              ? `Performance data updated ${formatRelative(freshAt)}.`
              : 'Performance data appears once your campaigns receive traffic.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker current={rangeKey} />
          <ButtonLink href="/brand/campaigns/new" size="sm">
            New campaign
          </ButtonLink>
        </div>
      </div>

      {!hasAnyCampaign ? (
        <EmptyState
          title="Create your first campaign"
          description="Set what you pay for, fund it, and publishers start sending traffic. Most brands have a campaign live in under five minutes."
          action={<ButtonLink href="/brand/campaigns/new">Create a campaign</ButtonLink>}
        />
      ) : (
        <>
          <StatGrid columns={4} className="mb-4">
            <Stat
              label="Spend"
              value={formatMicros(metrics.grossMicros, { showSubCent: false })}
              hint="Billable activity in this period"
            />
            <Stat
              label="Conversions"
              value={formatNumber(metrics.conversions)}
              hint={`${formatPercent(metrics.conversionRate)} of qualified clicks`}
            />
            <Stat
              label="Cost per acquisition"
              value={metrics.conversions > 0 ? formatUnitPrice(metrics.cpaMicros) : '—'}
              // A rising CPA is bad, so the colour mapping inverts.
              delta={undefined}
            />
            <Stat
              label="Return on ad spend"
              value={metrics.roas !== null ? `${metrics.roas.toFixed(2)}×` : '—'}
              tone={metrics.roas !== null && metrics.roas >= 1 ? 'success' : 'neutral'}
              hint={
                metrics.revenueMicros > 0n
                  ? `${formatMicros(metrics.revenueMicros, { showSubCent: false })} reported revenue`
                  : 'Report conversion values to see ROAS'
              }
            />
          </StatGrid>

          <StatGrid columns={4} className="mb-6">
            <Stat label="Clicks" value={formatNumber(metrics.clicks)} />
            <Stat
              label="Qualified clicks"
              value={formatNumber(metrics.qualifiedClicks)}
              hint={`${formatNumber(metrics.clicks - metrics.qualifiedClicks)} not billed`}
            />
            <Stat
              label="Effective CPC"
              value={metrics.qualifiedClicks > 0 ? formatUnitPrice(metrics.cpcMicros) : '—'}
            />
            <Stat
              label="Active publishers"
              value={formatNumber(publishers.length)}
              hint="Sending traffic in this period"
            />
          </StatGrid>

          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Spend and conversions"
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
                  formatValue={(v) => `$${v.toFixed(2)}`}
                  ariaLabel="Spend over time"
                  height={240}
                />
              </div>
            </Card>

            <Card>
              <CardHeader title="Budget position" />
              <dl className="mt-4 space-y-3">
                <Row label="Account balance" value={formatMicros(depositBalance, { showSubCent: false })} />
                <Row
                  label="In campaigns"
                  value={formatMicros(campaignRemaining, { showSubCent: false })}
                />
                <Row label="Committed" value={formatMicros(reserved, { showSubCent: false })} />
                <Row label="Settled spend" value={formatMicros(spent, { showSubCent: false })} />
              </dl>
              <div className="mt-4 border-t border-border pt-4">
                <ButtonLink href="/brand/billing" variant="secondary" size="sm" fullWidth className="justify-center">
                  Add funds
                </ButtonLink>
              </div>
              <p className="mt-3 text-2xs text-fg-subtle text-pretty">
                Committed funds back pending publisher earnings. They settle as spend once approved,
                or return to the campaign if the traffic is rejected.
              </p>
            </Card>
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Conversion funnel" />
              <div className="mt-5">
                <Funnel stages={stages} />
              </div>
            </Card>

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

            <Card padded={false}>
              <div className="p-5">
                <CardHeader
                  title="Top publishers"
                  action={
                    <Link href="/brand/publishers" className="text-sm text-primary hover:underline">
                      All
                    </Link>
                  }
                />
              </div>
              <TableWrap className="border-t border-border">
                <Table>
                  <THead>
                    <TR>
                      <TH>Publisher</TH>
                      <TH align="right">Conv.</TH>
                      <TH align="right">Spend</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {publishers.length === 0 ? (
                      <TableEmpty colSpan={3} message="No publisher activity yet." />
                    ) : (
                      publishers.map((publisher) => (
                        <TR key={publisher.creatorId}>
                          <TD>
                            <div className="truncate font-medium text-fg">
                              {publisher.displayName}
                            </div>
                            <div className="text-2xs text-fg-subtle">
                              {formatNumber(publisher.clicks)} clicks
                            </div>
                          </TD>
                          <TD align="right" numeric>
                            {formatNumber(publisher.conversions)}
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
          </div>

          <Card padded={false}>
            <div className="p-5">
              <CardHeader
                title="Campaigns"
                action={
                  <Link href="/brand/campaigns" className="text-sm text-primary hover:underline">
                    View all
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
                    <TH align="right">Budget left</TH>
                    <TH align="right">Spent</TH>
                  </TR>
                </THead>
                <TBody>
                  {campaigns.map((campaign) => {
                    const remaining = campaign.budget
                      ? campaign.budget.fundedMicros -
                        campaign.budget.reservedMicros -
                        campaign.budget.spentMicros
                      : 0n;
                    const low =
                      campaign.budget &&
                      campaign.budget.fundedMicros > 0n &&
                      remaining * 10_000n <=
                        campaign.budget.fundedMicros * BigInt(campaign.budget.lowBalanceBps);

                    return (
                      <TR key={campaign.id}>
                        <TD>
                          <Link
                            href={`/brand/campaigns/${campaign.id}`}
                            className="font-medium text-fg hover:text-primary"
                          >
                            {campaign.name}
                          </Link>
                          <div className="text-2xs text-fg-subtle">
                            {campaign.payoutModel} · {humanize(campaign.category)}
                          </div>
                        </TD>
                        <TD>
                          <Badge tone={statusTone(campaign.status)}>
                            {humanize(campaign.status)}
                          </Badge>
                        </TD>
                        <TD align="right" numeric>
                          <span className={low ? 'font-medium text-warning' : ''}>
                            {formatMicros(remaining, { showSubCent: false })}
                          </span>
                          {low ? (
                            <div className="text-2xs text-warning">Running low</div>
                          ) : null}
                        </TD>
                        <TD align="right" numeric>
                          {formatMicros(campaign.budget?.spentMicros ?? 0n, { showSubCent: false })}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        </>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-fg">{value}</dd>
    </div>
  );
}
