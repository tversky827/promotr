import Link from "next/link";
import type { Metadata } from "next";

import { AreaChart, Funnel, RankedBars } from "@/components/charts";
import { ExportsPanel } from "@/components/exports/panel";
import { currentCsrfToken } from "@/lib/auth/csrf";
import { requestBrandExport } from "@/server/actions/campaigns";
import { ButtonLink } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
} from "@/components/ui/primitives";
import { Stat, StatGrid } from "@/components/ui/stat";
import {
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableEmpty,
  TableWrap,
} from "@/components/ui/table";
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
} from "@/lib/analytics/queries";
import { lastRollupAt } from "@/lib/analytics/rollup";
import { presentationMode } from "@/lib/demo/presentation";
import { pageBrand } from "@/lib/auth/guards";
import { accounts, balanceOf } from "@/lib/billing/ledger";
import { prisma } from "@/lib/db";
import {
  countryName,
  formatCompact,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
  humanize,
  statusTone,
} from "@/lib/format";
import { formatMicros, formatUnitPrice } from "@/lib/money";

export const metadata: Metadata = { title: "Overview" };

/** Wide enough to cover any rollup bucket; stat_hourly starts at launch. */
const ALL_TIME = {
  from: new Date("2000-01-01T00:00:00Z"),
  to: new Date("2100-01-01T00:00:00Z"),
};
export const dynamic = "force-dynamic";

export default async function BrandDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { brand, user } = await pageBrand();
  const csrfToken = await currentCsrfToken();
  // Presentation mode drops the panels an audience would have to be told to
  // ignore. See src/lib/demo/presentation.ts.
  const presenting = await presentationMode();
  const { range: rangeKey = "30d" } = await searchParams;

  const range = presetRange(rangeKey);
  const granularity = granularityFor(range);
  const scope = { brandId: brand.id };

  const [
    metrics,
    lifetime,
    series,
    publishers,
    countries,
    stages,
    campaigns,
    depositBalance,
    freshAt,
    committed,
    exportJobs,
    activeCampaigns,
    promotingCreatorIds,
  ] = await Promise.all([
    totals(scope, range).then(derive),
    // The headline row is the account's whole history. A brand's sense of the
    // platform is what it has spent and earned in total, and a range picker
    // silently rewriting that number is how dashboards mislead.
    totals(scope, ALL_TIME).then(derive),
    timeSeries(scope, range, granularity),
    topPublishers(scope, range, 6),
    breakdown(scope, range, "country", 6),
    funnel(scope, range),
    prisma.campaign.findMany({
      where: { brandId: brand.id },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 8,
      include: { budget: true },
    }),
    balanceOf(accounts.brandDeposit(brand.id)),
    lastRollupAt(),
    prisma.campaignBudget.aggregate({
      where: { campaign: { brandId: brand.id } },
      _sum: { fundedMicros: true, reservedMicros: true, spentMicros: true },
    }),
    prisma.exportJob.findMany({
      where: { userId: user.id, scopeKind: "brand" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.campaign.count({ where: { brandId: brand.id, status: "ACTIVE" } }),
    // Publishers who have ever taken a link, and the audience behind them —
    // both counted from rows rather than estimated.
    prisma.trackingLink
      .findMany({
        where: { campaign: { brandId: brand.id } },
        distinct: ["creatorId"],
        select: { creatorId: true },
      })
      .then((rows) => rows.map((row) => row.creatorId)),
  ]);

  const reach = await prisma.socialAccount.aggregate({
    where: { creatorId: { in: promotingCreatorIds } },
    _sum: { followers: true },
  });

  const filled = fillSeries(series, range, granularity);
  const funded = committed._sum.fundedMicros ?? 0n;
  const reserved = committed._sum.reservedMicros ?? 0n;
  const spent = committed._sum.spentMicros ?? 0n;
  const campaignRemaining = funded - reserved - spent;

  const hasAnyCampaign = campaigns.length > 0;

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight text-fg text-balance sm:text-3xl">
            Turn creators into your performance marketing team.
          </h1>
          <p className="mt-1.5 text-md text-fg-muted">
            {freshAt
              ? `Performance data updated ${formatRelative(freshAt)}.`
              : "Performance data appears once your campaigns receive traffic."}
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
          action={
            <ButtonLink href="/brand/campaigns/new">
              Create a campaign
            </ButtonLink>
          }
        />
      ) : (
        <>
          {/* Lifetime, and labelled as such: these are the figures that say what
              the channel is worth, not what a fortnight of it looked like. */}
          <StatGrid columns={4} className="mb-3">
            <Stat
              label="Active campaigns"
              value={formatNumber(activeCampaigns)}
              hint="Accepting traffic now"
            />
            <Stat
              label="Creators promoting"
              value={formatNumber(promotingCreatorIds.length)}
              hint="Have taken a link"
            />
            <Stat
              label="Total reach"
              value={formatCompact(Number(reach._sum.followers ?? 0))}
              hint="Combined audience"
            />
            <Stat
              label="Clicks"
              value={formatNumber(lifetime.clicks)}
              hint="All time"
            />
          </StatGrid>

          <StatGrid columns={3} className="mb-6">
            <Stat
              label="Campaign spend"
              value={formatMicros(lifetime.grossMicros, { showSubCent: false })}
              hint={`${formatMicros(lifetime.netMicros, { showSubCent: false })} to creators, the rest platform fee`}
            />
            <Stat
              label="Revenue generated"
              value={formatMicros(lifetime.revenueMicros, {
                showSubCent: false,
              })}
              hint={`${formatNumber(lifetime.conversions)} conversions reported`}
            />
            <Stat
              label="Return on ad spend"
              value={
                lifetime.roas !== null ? `${lifetime.roas.toFixed(2)}×` : "—"
              }
              tone={
                lifetime.roas !== null && lifetime.roas >= 1
                  ? "success"
                  : "neutral"
              }
              hint="Revenue ÷ campaign spend"
            />
          </StatGrid>

          {/* This period, kept visually secondary to the lifetime row above. */}
          <div className="mb-6 rounded-lg border border-border bg-surface-sunken/40 px-4 py-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">
              {formatDate(range.from)} – {formatDate(range.to)}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-5">
              <PeriodStat
                label="Spend"
                value={formatMicros(metrics.grossMicros, {
                  showSubCent: false,
                })}
              />
              <PeriodStat label="Clicks" value={formatNumber(metrics.clicks)} />
              <PeriodStat
                label="Qualified"
                value={formatNumber(metrics.qualifiedClicks)}
                hint={`${formatNumber(metrics.clicks - metrics.qualifiedClicks)} not billed`}
              />
              <PeriodStat
                label="Conversions"
                value={formatNumber(metrics.conversions)}
                hint={`${formatPercent(metrics.conversionRate)} of qualified`}
              />
              <PeriodStat
                label="Cost per acquisition"
                value={
                  metrics.conversions > 0
                    ? formatUnitPrice(metrics.cpaMicros)
                    : "—"
                }
              />
            </dl>
          </div>

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
                      granularity === "hour"
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
                <Row
                  label="Account balance"
                  value={formatMicros(depositBalance, { showSubCent: false })}
                />
                <Row
                  label="In campaigns"
                  value={formatMicros(campaignRemaining, {
                    showSubCent: false,
                  })}
                />
                <Row
                  label="Committed"
                  value={formatMicros(reserved, { showSubCent: false })}
                />
                <Row
                  label="Settled spend"
                  value={formatMicros(spent, { showSubCent: false })}
                />
              </dl>
              <div className="mt-4 border-t border-border pt-4">
                <ButtonLink
                  href="/brand/billing"
                  variant="secondary"
                  size="sm"
                  fullWidth
                  className="justify-center"
                >
                  Add funds
                </ButtonLink>
              </div>
              <p className="mt-3 text-2xs text-fg-subtle text-pretty">
                Committed funds back pending publisher earnings. They settle as
                spend once approved, or return to the campaign if the traffic is
                rejected.
              </p>
            </Card>
          </div>

          <div
            className={
              presenting ? "mb-4 grid gap-4" : "mb-4 grid gap-4 lg:grid-cols-3"
            }
          >
            {presenting ? null : (
              <>
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
                        label:
                          c.label === "Unknown"
                            ? "Unknown"
                            : countryName(c.label),
                        value: c.clicks,
                        share: c.share,
                      }))}
                      formatValue={formatCompact}
                    />
                  </div>
                </Card>
              </>
            )}

            <Card padded={false}>
              <div className="p-5">
                <CardHeader
                  title="Top publishers"
                  action={
                    <Link
                      href="/brand/publishers"
                      className="text-sm text-primary hover:underline"
                    >
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
                      <TableEmpty
                        colSpan={3}
                        message="No publisher activity yet."
                      />
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
                            {formatMicros(publisher.grossMicros, {
                              showSubCent: false,
                            })}
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
                  <Link
                    href="/brand/campaigns"
                    className="text-sm text-primary hover:underline"
                  >
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
                        campaign.budget.fundedMicros *
                          BigInt(campaign.budget.lowBalanceBps);

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
                            {campaign.payoutModel} ·{" "}
                            {humanize(campaign.category)}
                          </div>
                        </TD>
                        <TD>
                          <Badge tone={statusTone(campaign.status)}>
                            {humanize(campaign.status)}
                          </Badge>
                        </TD>
                        <TD align="right" numeric>
                          <span
                            className={low ? "font-medium text-warning" : ""}
                          >
                            {formatMicros(remaining, { showSubCent: false })}
                          </span>
                          {low ? (
                            <div className="text-2xs text-warning">
                              Running low
                            </div>
                          ) : null}
                        </TD>
                        <TD align="right" numeric>
                          {formatMicros(campaign.budget?.spentMicros ?? 0n, {
                            showSubCent: false,
                          })}
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

      {/* Exports live with the numbers they export, rather than on a reports
          page that duplicated this one. */}
      <div className={presenting ? "hidden" : "mt-6"}>
        <ExportsPanel
          csrfToken={csrfToken}
          action={requestBrandExport}
          campaigns={campaigns.map((campaign) => ({
            id: campaign.id,
            name: campaign.name,
          }))}
          jobs={exportJobs.map((job) => ({
            id: job.id,
            kind: job.kind,
            status: job.status,
            rowCount: job.rowCount,
            fileUrl: job.fileUrl,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt.toISOString(),
            expiresAt: job.expiresAt?.toISOString() ?? null,
          }))}
          kinds={[
            { value: "clicks", label: "Clicks" },
            { value: "conversions", label: "Conversions" },
            { value: "earnings", label: "Publisher earnings" },
            { value: "creators", label: "Publishers" },
            { value: "spend", label: "Spend" },
          ]}
          title="Export data"
          description="Every row we hold for your campaigns, including the eligibility decision on each click, so you can reconcile our billing against your own analytics."
        />
      </div>
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

function PeriodStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-md font-semibold tabular-nums tracking-tight text-fg">
        {value}
      </dd>
      {hint ? <p className="text-2xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
