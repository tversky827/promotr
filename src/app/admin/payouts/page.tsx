import Link from 'next/link';
import type { Metadata } from 'next';

import { PayoutRowActions } from '@/components/admin/payout-actions';
import { Pagination } from '@/components/ui/pagination';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, formatNumber, humanize, statusTone } from '@/lib/format';
import { formatMicros } from '@/lib/money';
import { stripeConfigured } from '@/lib/stripe';

import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Payouts' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 30;

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  await pageAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const csrfToken = await currentCsrfToken();

  const where: Prisma.PayoutWhereInput = params.status
    ? { status: params.status as never }
    : {};

  const [payouts, total, counts, pendingSum, paidSum] = await Promise.all([
    prisma.payout.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        creator: {
          select: {
            id: true,
            handle: true,
            payoutHold: true,
            stripePayoutsEnabled: true,
            profile: { select: { displayName: true } },
          },
        },
        _count: { select: { earnings: true } },
      },
    }),
    prisma.payout.count({ where }),
    prisma.payout.groupBy({ by: ['status'], _count: true }),
    prisma.payout.aggregate({
      where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
      _sum: { amountMicros: true },
    }),
    prisma.payout.aggregate({ where: { status: 'PAID' }, _sum: { amountMicros: true } }),
  ]);

  const countMap = new Map(counts.map((row) => [row.status, row._count]));

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Every withdrawal request. Approving one queues a real transfer."
      />

      <StatGrid columns={4} className="mb-6">
        <Stat
          label="Awaiting approval"
          value={formatNumber(countMap.get('REQUESTED') ?? 0)}
          tone={(countMap.get('REQUESTED') ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label="In flight"
          value={formatMicros(pendingSum._sum.amountMicros ?? 0n, { showSubCent: false })}
          hint="Requested, approved or processing"
        />
        <Stat
          label="Paid to date"
          value={formatMicros(paidSum._sum.amountMicros ?? 0n, { showSubCent: false })}
        />
        <Stat
          label="Failed"
          value={formatNumber(countMap.get('FAILED') ?? 0)}
          tone={(countMap.get('FAILED') ?? 0) > 0 ? 'danger' : 'neutral'}
        />
      </StatGrid>

      {!stripeConfigured() ? (
        <Card className="mb-4 border-warning/30 bg-warning-soft/30">
          <p className="text-sm text-fg text-pretty">
            Payments are not configured on this deployment, so transfers cannot be executed. Payout
            requests still accumulate and publisher balances are safe.
          </p>
        </Card>
      ) : null}

      <div className="scroll-x mb-4 flex gap-1.5">
        <Tab href="/admin/payouts" label="All" active={!params.status} />
        {(['REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'ON_HOLD'] as const).map(
          (status) => (
            <Tab
              key={status}
              href={`/admin/payouts?status=${status}`}
              label={humanize(status)}
              active={params.status === status}
              count={countMap.get(status)}
            />
          ),
        )}
      </div>

      {payouts.length === 0 ? (
        <EmptyState title="No payouts match" description="Try a different filter." />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Publisher</TH>
                    <TH>Requested</TH>
                    <TH>Status</TH>
                    <TH align="right">Earnings</TH>
                    <TH align="right">Amount</TH>
                    <TH align="right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {payouts.map((payout) => (
                    <TR key={payout.id}>
                      <TD>
                        <Link
                          href={`/admin/creators/${payout.creator.id}`}
                          className="font-medium text-fg hover:text-primary"
                        >
                          {payout.creator.profile?.displayName ?? payout.creator.handle}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {payout.creator.payoutHold ? (
                            <Badge tone="warning">Hold</Badge>
                          ) : null}
                          {!payout.creator.stripePayoutsEnabled ? (
                            <Badge tone="danger">No payout account</Badge>
                          ) : null}
                        </div>
                      </TD>
                      <TD className="text-fg-muted">{formatDateTime(payout.requestedAt)}</TD>
                      <TD>
                        <Badge tone={statusTone(payout.status)}>{humanize(payout.status)}</Badge>
                        {payout.failureMessage ? (
                          <div className="mt-1 max-w-xs text-2xs text-danger text-pretty">
                            {payout.failureMessage}
                          </div>
                        ) : null}
                      </TD>
                      <TD align="right" numeric className="text-fg-muted">
                        {payout._count.earnings}
                      </TD>
                      <TD align="right" numeric className="font-medium">
                        {formatMicros(payout.amountMicros)}
                      </TD>
                      <TD align="right">
                        <PayoutRowActions
                          payoutId={payout.id}
                          status={payout.status}
                          csrfToken={csrfToken}
                          stripeConfigured={stripeConfigured()}
                        />
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
    </>
  );
}

function Tab({
  href,
  label,
  active,
  count,
}: {
  href: string;
  label: string;
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
      {count !== undefined ? (
        <span className="ml-1.5 text-xs tabular-nums text-fg-subtle">{count}</span>
      ) : null}
    </Link>
  );
}
