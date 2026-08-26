import Link from 'next/link';
import type { Metadata } from 'next';

import { ExportButton } from '@/components/creator/export-button';
import { Pagination } from '@/components/ui/pagination';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { balanceSummary } from '@/lib/billing/earnings';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageCreator } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, formatRelative, humanize, statusTone } from '@/lib/format';
import { formatMicros } from '@/lib/money';

import type { EarningStatus, Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Earnings' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 40;

/**
 * The earnings ledger.
 *
 * Every row is one billable event with its own status and, where relevant, the
 * reason for that status. This is what makes "every dollar is explainable" a
 * property of the product rather than a claim: a publisher can trace any amount
 * in their balance back to the click or conversion that produced it.
 */
export default async function CreatorEarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; campaign?: string }>;
}) {
  const { creator } = await pageCreator();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const csrfToken = await currentCsrfToken();

  const statusFilter = isEarningStatus(params.status) ? params.status : undefined;

  const where: Prisma.EarningWhereInput = {
    creatorId: creator.id,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(params.campaign ? { campaignId: params.campaign } : {}),
  };

  const [balance, earnings, total, statusCounts, campaigns] = await Promise.all([
    balanceSummary(creator.id),
    prisma.earning.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        campaign: { select: { name: true, slug: true } },
        conversion: { select: { externalId: true, revenueMicros: true } },
        payout: { select: { id: true, status: true, paidAt: true } },
      },
    }),
    prisma.earning.count({ where }),
    prisma.earning.groupBy({
      by: ['status'],
      where: { creatorId: creator.id },
      _count: true,
    }),
    prisma.earning
      .findMany({
        where: { creatorId: creator.id },
        distinct: ['campaignId'],
        select: { campaignId: true, campaign: { select: { name: true } } },
        take: 50,
      })
      .catch(() => []),
  ]);

  const counts = new Map(statusCounts.map((row) => [row.status, row._count]));

  return (
    <>
      <PageHeader
        title="Earnings"
        description="Every billable event, with its status and how it was calculated."
        action={<ExportButton kind="earnings" csrfToken={csrfToken} />}
      />

      <StatGrid columns={4} className="mb-6">
        <Stat
          label="Available"
          value={formatMicros(balance.availableMicros)}
          tone={balance.availableMicros > 0n ? 'success' : 'neutral'}
        />
        <Stat label="Pending" value={formatMicros(balance.pendingMicros)} />
        <Stat
          label="Under review"
          value={formatMicros(balance.underReviewMicros)}
          tone={balance.underReviewMicros > 0n ? 'warning' : 'neutral'}
        />
        <Stat label="Paid" value={formatMicros(balance.paidMicros)} />
      </StatGrid>

      <div className="scroll-x mb-4 flex gap-1.5">
        <StatusTab label="All" href="/creator/earnings" active={!statusFilter} />
        {(
          ['PENDING', 'APPROVED', 'AVAILABLE', 'PAID', 'UNDER_REVIEW', 'REJECTED', 'REVERSED'] as const
        ).map((status) => (
          <StatusTab
            key={status}
            label={humanize(status)}
            href={`/creator/earnings?status=${status}`}
            active={statusFilter === status}
            count={counts.get(status)}
          />
        ))}
      </div>

      {campaigns.length > 1 ? (
        <div className="scroll-x mb-4 flex gap-1.5">
          <StatusTab label="All campaigns" href="/creator/earnings" active={!params.campaign} />
          {campaigns.slice(0, 8).map((row) => (
            <StatusTab
              key={row.campaignId}
              label={row.campaign.name}
              href={`/creator/earnings?campaign=${row.campaignId}`}
              active={params.campaign === row.campaignId}
            />
          ))}
        </div>
      ) : null}

      {earnings.length === 0 ? (
        <EmptyState
          title={statusFilter ? `No ${humanize(statusFilter).toLowerCase()} earnings` : 'No earnings yet'}
          description={
            statusFilter
              ? 'Try a different status filter.'
              : 'Earnings appear here as qualified traffic and conversions come through your links.'
          }
        />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Campaign</TH>
                    <TH>Event</TH>
                    <TH>Status</TH>
                    <TH align="right">You earned</TH>
                  </TR>
                </THead>
                <TBody>
                  {earnings.map((earning) => (
                    <TR key={earning.id}>
                      <TD>
                        <div className="text-fg">{formatRelative(earning.createdAt)}</div>
                        <div className="text-2xs text-fg-subtle">
                          {formatDateTime(earning.createdAt)}
                        </div>
                      </TD>

                      <TD>
                        <Link
                          href={`/campaigns/${earning.campaign.slug}`}
                          className="font-medium text-fg hover:text-primary"
                        >
                          {earning.campaign.name}
                        </Link>
                      </TD>

                      <TD>
                        <div className="text-fg">{humanize(earning.eventType)}</div>
                        {earning.conversion ? (
                          <div className="text-2xs text-fg-subtle">
                            Order {earning.conversion.externalId}
                            {earning.conversion.revenueMicros > 0n
                              ? ` · ${formatMicros(earning.conversion.revenueMicros)} value`
                              : ''}
                          </div>
                        ) : null}
                        {earning.quantity > 1 ? (
                          <div className="text-2xs text-fg-subtle">×{earning.quantity}</div>
                        ) : null}
                      </TD>

                      <TD>
                        <Badge tone={statusTone(earning.status)}>{humanize(earning.status)}</Badge>
                        {/* The reason is what turns a rejection into something
                            a publisher can act on or dispute. */}
                        {earning.statusReason ? (
                          <div className="mt-1 max-w-xs text-2xs text-fg-subtle text-pretty">
                            {earning.statusReason}
                          </div>
                        ) : null}
                        {earning.status === 'APPROVED' && earning.availableAt ? (
                          <div className="mt-1 text-2xs text-fg-subtle">
                            Available {formatRelative(earning.availableAt)}
                          </div>
                        ) : null}
                        {earning.payout ? (
                          <div className="mt-1 text-2xs text-fg-subtle">
                            Payout {earning.payout.status.toLowerCase()}
                          </div>
                        ) : null}
                      </TD>

                      <TD align="right" numeric>
                        <div className="font-medium text-fg">{formatMicros(earning.netMicros)}</div>
                        {/* Brands are charged more than the publisher earns; showing
                            both makes the fee explicit rather than hidden. */}
                        <div className="text-2xs text-fg-subtle">
                          brand paid {formatMicros(earning.grossMicros)}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </Card>

          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
            total={total}
            perPage={PER_PAGE}
            className="mt-6"
          />
        </>
      )}

      <p className="mt-6 text-xs text-fg-subtle text-pretty">
        Disagree with a decision on any of these? Open a dispute from{' '}
        <Link href="/creator/disputes" className="text-primary hover:underline">
          your disputes page
        </Link>{' '}
        and an administrator will review it.
      </p>
    </>
  );
}

function StatusTab({
  label,
  href,
  active,
  count,
}: {
  label: string;
  href: string;
  active: boolean;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'whitespace-nowrap rounded-md bg-primary-soft px-3 py-1.5 text-sm font-medium text-primary'
          : 'whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg'
      }
    >
      {label}
      {count !== undefined && count > 0 ? (
        <span className="ml-1.5 text-xs text-fg-subtle tabular-nums">{count}</span>
      ) : null}
    </Link>
  );
}

function isEarningStatus(value: string | undefined): value is EarningStatus {
  return (
    value !== undefined &&
    ['PENDING', 'APPROVED', 'AVAILABLE', 'REJECTED', 'UNDER_REVIEW', 'REVERSED', 'PAID'].includes(
      value,
    )
  );
}
