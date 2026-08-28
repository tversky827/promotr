import Link from 'next/link';
import type { Metadata } from 'next';

import { AreaChart } from '@/components/charts';
import { DateRangePicker } from '@/components/ui/date-range';
import { Alert, Badge, Card, CardHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableEmpty, TableWrap } from '@/components/ui/table';
import {
  derive,
  fillSeries,
  granularityFor,
  presetRange,
  timeSeries,
  totals,
} from '@/lib/analytics/queries';
import { pageAdmin } from '@/lib/auth/guards';
import { accounts, balanceOf, verifyGlobalBalance } from '@/lib/billing/ledger';
import { prisma } from '@/lib/db';
import { formatDate, formatNumber, formatRelative, humanize } from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'Admin overview' };
export const dynamic = 'force-dynamic';

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await pageAdmin();
  const { range: rangeKey = '30d' } = await searchParams;

  const range = presetRange(rangeKey);
  const granularity = granularityFor(range);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const [
    metrics,
    series,
    counts,
    todayClicks,
    todayConversions,
    platformRevenue,
    pendingPayouts,
    queues,
    ledgerBalance,
    pendingCampaigns,
    recentFraud,
  ] = await Promise.all([
    totals({}, range).then(derive),
    timeSeries({}, range, granularity),
    platformCounts(),
    prisma.click.count({ where: { createdAt: { gte: dayStart } } }),
    prisma.conversion.count({ where: { createdAt: { gte: dayStart } } }),
    balanceOf(accounts.platformRevenue()),
    prisma.payout.aggregate({
      where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
      _sum: { amountMicros: true },
      _count: true,
    }),
    prisma.job.groupBy({ by: ['status'], _count: true }),
    verifyGlobalBalance(),
    prisma.campaign.findMany({
      where: { status: 'PENDING_REVIEW' },
      orderBy: { createdAt: 'asc' },
      take: 6,
      include: { brand: { select: { displayName: true, verification: true } } },
    }),
    prisma.fraudEvent.findMany({
      where: { resolution: null },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { creator: { select: { handle: true } } },
    }),
  ]);

  const filled = fillSeries(series, range, granularity);
  const deadJobs = queues.find((q) => q.status === 'DEAD')?._count ?? 0;

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Platform overview</h1>
          <p className="mt-1 text-md text-fg-muted">Marketplace health at a glance.</p>
        </div>
        <DateRangePicker current={rangeKey} />
      </div>

      {/* Ledger integrity is the single most important operational signal. */}
      {!ledgerBalance.balanced ? (
        <Alert tone="danger" className="mb-6" title="Ledger is out of balance">
          Global debits ({formatMicros(ledgerBalance.debits)}) do not equal credits (
          {formatMicros(ledgerBalance.credits)}). This indicates writes outside the posting API.
          Investigate before processing further payouts.
          <div className="mt-2">
            <Link href="/admin/system" className="underline">
              Open system health
            </Link>
          </div>
        </Alert>
      ) : null}

      {deadJobs > 0 ? (
        <Alert tone="warning" className="mb-6" title={`${deadJobs} job(s) in the dead-letter queue`}>
          These exhausted their retries. Inspect and re-queue them from{' '}
          <Link href="/admin/system" className="underline">
            system health
          </Link>
          .
        </Alert>
      ) : null}

      <StatGrid columns={4} className="mb-4">
        <Stat
          label="Platform revenue"
          value={formatMicros(platformRevenue, { showSubCent: false })}
          tone="primary"
          hint="Lifetime, from commissions"
        />
        <Stat
          label="Marketplace volume"
          value={formatMicros(metrics.grossMicros, { showSubCent: false })}
          hint="Brand spend in this period"
        />
        <Stat
          label="Pending payouts"
          value={formatMicros(pendingPayouts._sum.amountMicros ?? 0n, { showSubCent: false })}
          hint={`${pendingPayouts._count} awaiting`}
          tone={pendingPayouts._count > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label="Publisher liability"
          value={formatMicros(counts.publisherLiability, { showSubCent: false })}
          hint="Owed to publishers right now"
        />
      </StatGrid>

      <StatGrid columns={5} className="mb-6">
        <Stat label="Clicks today" value={formatNumber(todayClicks)} />
        <Stat label="Conversions today" value={formatNumber(todayConversions)} />
        <Stat label="Active campaigns" value={formatNumber(counts.activeCampaigns)} />
        <Stat label="Brands" value={formatNumber(counts.brands)} />
        <Stat label="Publishers" value={formatNumber(counts.creators)} />
      </StatGrid>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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
              formatValue={(v) => `$${v.toFixed(2)}`}
              ariaLabel="Marketplace volume over time"
              height={240}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Needs attention" />
          <ul className="mt-4 space-y-2.5">
            <AttentionRow
              href="/admin/campaigns?status=PENDING_REVIEW"
              label="Campaigns awaiting review"
              count={counts.pendingCampaigns}
            />
            <AttentionRow
              href="/admin/fraud"
              label="Unresolved fraud flags"
              count={counts.openFraud}
            />
            <AttentionRow
              href="/admin/disputes"
              label="Open disputes"
              count={counts.openDisputes}
            />
            <AttentionRow
              href="/admin/payouts?status=REQUESTED"
              label="Payouts awaiting approval"
              count={pendingPayouts._count}
            />
            <AttentionRow
              href="/admin/brands?verification=PENDING"
              label="Brands awaiting verification"
              count={counts.pendingBrands}
            />
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5">
            <CardHeader
              title="Campaigns in review"
              action={
                <Link href="/admin/campaigns?status=PENDING_REVIEW" className="text-sm text-primary hover:underline">
                  All
                </Link>
              }
            />
          </div>
          <TableWrap className="border-t border-border">
            <Table>
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH>Brand</TH>
                  <TH align="right">Waiting</TH>
                </TR>
              </THead>
              <TBody>
                {pendingCampaigns.length === 0 ? (
                  <TableEmpty colSpan={3} message="Nothing waiting for review." />
                ) : (
                  pendingCampaigns.map((campaign) => (
                    <TR key={campaign.id}>
                      <TD>
                        <Link
                          href={`/admin/campaigns/${campaign.id}`}
                          className="font-medium text-fg hover:text-primary"
                        >
                          {campaign.name}
                        </Link>
                        {campaign.moderationScore !== null ? (
                          <div className="mt-0.5">
                            <Badge
                              tone={
                                campaign.moderationScore >= 60
                                  ? 'danger'
                                  : campaign.moderationScore >= 30
                                    ? 'warning'
                                    : 'neutral'
                              }
                            >
                              Risk {campaign.moderationScore}
                            </Badge>
                          </div>
                        ) : null}
                      </TD>
                      <TD>
                        <div className="text-fg">{campaign.brand.displayName}</div>
                        <div className="text-2xs text-fg-subtle">
                          {humanize(campaign.brand.verification)}
                        </div>
                      </TD>
                      <TD align="right" className="text-fg-muted">
                        {formatRelative(campaign.createdAt)}
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
              title="Recent fraud flags"
              action={
                <Link href="/admin/fraud" className="text-sm text-primary hover:underline">
                  Console
                </Link>
              }
            />
          </div>
          <TableWrap className="border-t border-border">
            <Table>
              <THead>
                <TR>
                  <TH>Publisher</TH>
                  <TH>Band</TH>
                  <TH align="right">Score</TH>
                  <TH align="right">When</TH>
                </TR>
              </THead>
              <TBody>
                {recentFraud.length === 0 ? (
                  <TableEmpty colSpan={4} message="No unresolved flags." />
                ) : (
                  recentFraud.map((event) => (
                    <TR key={event.id}>
                      <TD>
                        <Link
                          href={`/admin/fraud?event=${event.id}`}
                          className="font-medium text-fg hover:text-primary"
                        >
                          {event.creator?.handle ?? 'Unknown'}
                        </Link>
                        <div className="text-2xs text-fg-subtle">{event.entityKind}</div>
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            event.band === 'HIGH'
                              ? 'danger'
                              : event.band === 'SUSPICIOUS'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {humanize(event.band)}
                        </Badge>
                      </TD>
                      <TD align="right" numeric>
                        {event.score}
                      </TD>
                      <TD align="right" className="text-fg-muted">
                        {formatRelative(event.createdAt)}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      </div>

      {/* The investigation tools. They are not daily work, so they are reached
          from here rather than sitting permanently in the sidebar. */}
      <Card className="mt-6">
        <CardHeader
          title="Tools"
          description="Everything else an operator needs, when a case sends them there."
        />
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {[
            { href: '/admin/clicks', label: 'Click log' },
            { href: '/admin/conversions', label: 'Conversion log' },
            { href: '/admin/users', label: 'Users' },
            { href: '/admin/reports', label: 'Reports' },
            { href: '/admin/system', label: 'System health' },
            { href: '/admin/audit', label: 'Audit log' },
          ].map((tool) => (
            <li key={tool.href}>
              <Link href={tool.href} className="text-sm text-primary hover:underline">
                {tool.label}
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <p className="mt-6 text-xs text-fg-subtle">
        Ledger status:{' '}
        <Badge tone={ledgerBalance.balanced ? 'success' : 'danger'}>
          {ledgerBalance.balanced ? 'Balanced' : 'Out of balance'}
        </Badge>
      </p>
    </>
  );
}

function AttentionRow({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-sunken"
      >
        <span className="text-sm text-fg-muted">{label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
            count > 0 ? 'bg-danger-soft text-danger' : 'bg-surface-sunken text-fg-subtle'
          }`}
        >
          {count}
        </span>
      </Link>
    </li>
  );
}

async function platformCounts() {
  const [
    brands,
    creators,
    activeCampaigns,
    pendingCampaigns,
    pendingBrands,
    openFraud,
    openDisputes,
    liability,
  ] = await Promise.all([
    prisma.brand.count(),
    prisma.creator.count(),
    prisma.campaign.count({ where: { status: 'ACTIVE' } }),
    prisma.campaign.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.brand.count({ where: { verification: 'PENDING' } }),
    prisma.fraudEvent.count({ where: { resolution: null, band: { in: ['SUSPICIOUS', 'HIGH'] } } }),
    prisma.dispute.count({ where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }),
    prisma.ledgerAccount.aggregate({
      where: { type: { in: ['PUBLISHER_PENDING', 'PUBLISHER_AVAILABLE'] } },
      _sum: { balanceMicros: true },
    }),
  ]);

  return {
    brands,
    creators,
    activeCampaigns,
    pendingCampaigns,
    pendingBrands,
    openFraud,
    openDisputes,
    publisherLiability: liability._sum.balanceMicros ?? 0n,
  };
}
