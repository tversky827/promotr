import Link from 'next/link';
import type { Metadata } from 'next';

import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { pageBrand } from '@/lib/auth/guards';
import { accounts, balanceOf } from '@/lib/billing/ledger';
import { prisma } from '@/lib/db';
import { integrations } from '@/lib/env';
import { formatDateTime, formatRelative, humanize } from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

/**
 * Brand billing.
 *
 * Reads from the ledger, not from a summary column: the account balance shown
 * here is the balance of the brand's deposit account, derived from the same
 * entries that pay publishers. There is no second source of truth to drift.
 */
export default async function BrandBillingPage() {
  const { brand } = await pageBrand();

  const [balance, deposits, paymentMethods, budgets, spendToDate] = await Promise.all([
    balanceOf(accounts.brandDeposit(brand.id)),
    prisma.brandDeposit.findMany({
      where: { brandId: brand.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amountMicros: true,
        currency: true,
        status: true,
        refundedMicros: true,
        failureMessage: true,
        createdAt: true,
        campaign: { select: { id: true, name: true } },
      },
    }),
    prisma.brandPaymentMethod.findMany({
      where: { brandId: brand.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      // Only the display fields — the Stripe payment-method id stays server-side.
      select: { id: true, brandLabel: true, last4: true, expMonth: true, expYear: true, isDefault: true },
    }),
    prisma.campaignBudget.findMany({
      where: { campaign: { brandId: brand.id } },
      // Bounded: a brand with hundreds of campaigns should not have this page
      // render every budget row. The campaigns list is the complete view.
      take: 50,
      orderBy: { campaign: { createdAt: 'desc' } },
      select: {
        campaignId: true,
        fundedMicros: true,
        reservedMicros: true,
        spentMicros: true,
        campaign: { select: { name: true, status: true } },
      },
    }),
    prisma.earning.aggregate({
      where: { campaign: { brandId: brand.id }, status: { notIn: ['REJECTED', 'REVERSED'] } },
      _sum: { grossMicros: true },
    }),
  ]);

  const committed = budgets.reduce(
    (sum, budget) => sum + (budget.fundedMicros - budget.spentMicros),
    0n,
  );
  const settled = deposits
    .filter((deposit) => deposit.status === 'succeeded')
    .reduce((sum, deposit) => sum + deposit.amountMicros - deposit.refundedMicros, 0n);

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your account balance, the campaigns it is committed to, and every payment you have made."
      />

      {!integrations.stripe.configured ? (
        <Alert tone="warning" title="Payments are not configured" className="mb-6">
          This deployment has no payment provider configured, so new deposits cannot be taken.
          Existing balances and campaign budgets are unaffected. An administrator can configure it
          in the environment.
        </Alert>
      ) : null}

      <StatGrid columns={4} className="mb-6">
        <Stat
          label="Unallocated balance"
          value={formatMicros(balance)}
          hint="Available to fund campaigns"
        />
        <Stat
          label="Committed to campaigns"
          value={formatMicros(committed)}
          hint="Funded but not yet spent"
        />
        <Stat
          label="Spent to date"
          value={formatMicros(spendToDate._sum.grossMicros ?? 0n)}
          hint="Publisher payouts plus platform fee"
        />
        <Stat label="Deposited to date" value={formatMicros(settled)} hint="Net of refunds" />
      </StatGrid>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5">
            <CardHeader
              title="Campaign budgets"
              description="What each campaign is holding, most recent first. Unspent budget can be returned to your balance from the campaign's funding page."
            />
          </div>
          {budgets.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                title="No campaigns funded yet"
                description="Fund a campaign and its budget appears here."
              />
            </div>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Campaign</TH>
                    <TH align="right">Funded</TH>
                    <TH align="right">Spent</TH>
                    <TH align="right">Remaining</TH>
                  </TR>
                </THead>
                <TBody>
                  {budgets.map((budget) => (
                    <TR key={budget.campaignId}>
                      <TD>
                        <Link
                          href={`/brand/campaigns/${budget.campaignId}/funding`}
                          className="font-medium text-fg hover:text-primary"
                        >
                          {budget.campaign.name}
                        </Link>
                        <Badge tone="neutral" className="ml-2">
                          {humanize(budget.campaign.status)}
                        </Badge>
                      </TD>
                      <TD align="right">{formatMicros(budget.fundedMicros)}</TD>
                      <TD align="right">{formatMicros(budget.spentMicros)}</TD>
                      <TD align="right">
                        {formatMicros(budget.fundedMicros - budget.spentMicros - budget.reservedMicros)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card padded={false}>
          <div className="p-5">
            <CardHeader
              title="Payment methods"
              description="Cards are stored by our payment provider, never by us. We keep only the last four digits so you can tell them apart."
            />
          </div>
          {paymentMethods.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                title="No saved cards"
                description="A card is saved when you use it to fund a campaign."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {paymentMethods.map((method) => (
                <li key={method.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="text-sm font-medium capitalize text-fg">
                    {method.brandLabel} ···· {method.last4}
                  </span>
                  <span className="text-xs text-fg-subtle">
                    expires {String(method.expMonth).padStart(2, '0')}/{method.expYear}
                  </span>
                  {method.isDefault ? <Badge tone="info">Default</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-5">
          <CardHeader
            title="Payments"
            description="Every deposit, with its outcome. A payment is only credited to your balance when the provider confirms it — a card authorisation on its own is not money."
          />
        </div>

        {deposits.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              title="No payments yet"
              description="Fund a campaign and the payment appears here."
            />
          </div>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Campaign</TH>
                  <TH>Status</TH>
                  <TH align="right">Amount</TH>
                  <TH align="right">Refunded</TH>
                </TR>
              </THead>
              <TBody>
                {deposits.map((deposit) => (
                  <TR key={deposit.id}>
                    <TD>
                      <span title={formatDateTime(deposit.createdAt)}>
                        {formatRelative(deposit.createdAt)}
                      </span>
                    </TD>
                    <TD>
                      {deposit.campaign ? (
                        <Link
                          href={`/brand/campaigns/${deposit.campaign.id}`}
                          className="text-fg hover:text-primary"
                        >
                          {deposit.campaign.name}
                        </Link>
                      ) : (
                        <span className="text-fg-subtle">Account balance</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={depositTone(deposit.status)}>{humanize(deposit.status)}</Badge>
                      {deposit.failureMessage ? (
                        <p className="mt-1 text-xs text-danger">{deposit.failureMessage}</p>
                      ) : null}
                    </TD>
                    <TD align="right">{formatMicros(deposit.amountMicros)}</TD>
                    <TD align="right">
                      {deposit.refundedMicros > 0n ? formatMicros(deposit.refundedMicros) : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

function depositTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    case 'refunded':
      return 'warning';
    default:
      return 'neutral';
  }
}
