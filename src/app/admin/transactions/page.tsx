import type { Metadata } from 'next';

import { Pagination } from '@/components/ui/pagination';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { pageAdmin } from '@/lib/auth/guards';
import { verifyGlobalBalance } from '@/lib/billing/ledger';
import { prisma } from '@/lib/db';
import { formatDateTime, formatRelative, humanize } from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'Ledger' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 40;

/**
 * The ledger.
 *
 * Every transaction with its entries expanded, so an operator can see both
 * sides of each movement. This is the screen that proves the platform's money
 * is where it claims to be.
 */
export default async function AdminLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; kind?: string }>;
}) {
  await pageAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where = params.kind ? { kind: params.kind as never } : {};

  const [transactions, total, accounts, balance] = await Promise.all([
    prisma.ledgerTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        entries: { include: { account: true } },
      },
    }),
    prisma.ledgerTransaction.count({ where }),
    prisma.ledgerAccount.groupBy({
      by: ['type'],
      _sum: { balanceMicros: true },
      _count: true,
    }),
    verifyGlobalBalance(),
  ]);

  const byType = new Map(accounts.map((a) => [a.type, a._sum.balanceMicros ?? 0n]));

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every financial movement on the platform, double-entry, append-only."
        action={
          <Badge tone={balance.balanced ? 'success' : 'danger'}>
            {balance.balanced ? 'Balanced' : 'Out of balance'}
          </Badge>
        }
      />

      <StatGrid columns={5} className="mb-6">
        <Stat
          label="Brand deposits"
          value={formatMicros(byType.get('BRAND_DEPOSIT') ?? 0n, { showSubCent: false })}
          hint="Unallocated brand funds"
        />
        <Stat
          label="In campaigns"
          value={formatMicros(byType.get('CAMPAIGN_ESCROW') ?? 0n, { showSubCent: false })}
        />
        <Stat
          label="Publisher pending"
          value={formatMicros(byType.get('PUBLISHER_PENDING') ?? 0n, { showSubCent: false })}
        />
        <Stat
          label="Publisher available"
          value={formatMicros(byType.get('PUBLISHER_AVAILABLE') ?? 0n, { showSubCent: false })}
          tone="warning"
          hint="Withdrawable now"
        />
        <Stat
          label="Platform revenue"
          value={formatMicros(byType.get('PLATFORM_REVENUE') ?? 0n, { showSubCent: false })}
          tone="primary"
        />
      </StatGrid>

      <Card className="mb-4">
        <CardHeader
          title="Solvency"
          description="Total obligations against funds held. These must reconcile."
        />
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Owed to publishers</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">
              {formatMicros(
                (byType.get('PUBLISHER_PENDING') ?? 0n) + (byType.get('PUBLISHER_AVAILABLE') ?? 0n),
                { showSubCent: false },
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Held for brands</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">
              {formatMicros(
                (byType.get('BRAND_DEPOSIT') ?? 0n) + (byType.get('CAMPAIGN_ESCROW') ?? 0n),
                { showSubCent: false },
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">In transit</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">
              {formatMicros(byType.get('PAYOUT_CLEARING') ?? 0n, { showSubCent: false })}
            </dd>
          </div>
        </dl>
      </Card>

      {transactions.length === 0 ? (
        <EmptyState title="No transactions" description="Nothing has moved yet." />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Kind</TH>
                    <TH>Description</TH>
                    <TH>Entries</TH>
                  </TR>
                </THead>
                <TBody>
                  {transactions.map((transaction) => (
                    <TR key={transaction.id}>
                      <TD>
                        <div className="whitespace-nowrap text-fg">
                          {formatRelative(transaction.createdAt)}
                        </div>
                        <div className="whitespace-nowrap text-2xs text-fg-subtle">
                          {formatDateTime(transaction.createdAt)}
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={toneFor(transaction.kind)}>{humanize(transaction.kind)}</Badge>
                      </TD>
                      <TD>
                        <div className="max-w-sm text-sm text-fg text-pretty">
                          {transaction.description}
                        </div>
                        {transaction.reason ? (
                          <div className="mt-0.5 max-w-sm text-2xs text-fg-subtle text-pretty">
                            {transaction.reason}
                          </div>
                        ) : null}
                      </TD>
                      <TD>
                        <ul className="space-y-0.5">
                          {transaction.entries.map((entry) => (
                            <li key={entry.id} className="whitespace-nowrap font-mono text-2xs">
                              <span
                                className={
                                  entry.direction === 'DEBIT' ? 'text-danger' : 'text-success'
                                }
                              >
                                {entry.direction === 'DEBIT' ? 'DR' : 'CR'}
                              </span>{' '}
                              <span className="text-fg-muted">{entry.account.type}</span>{' '}
                              <span className="tabular-nums text-fg">
                                {formatMicros(entry.amountMicros)}
                              </span>
                            </li>
                          ))}
                        </ul>
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

function toneFor(kind: string) {
  if (kind.includes('REVERSAL') || kind === 'CHARGEBACK' || kind === 'REFUND') return 'danger';
  if (kind === 'MANUAL_ADJUSTMENT') return 'warning';
  if (kind === 'PLATFORM_FEE' || kind === 'EARNING_ACCRUAL') return 'primary';
  return 'neutral';
}
