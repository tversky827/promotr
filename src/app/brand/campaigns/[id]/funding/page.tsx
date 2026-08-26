import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { FundingPanel } from '@/components/brand/funding-panel';
import {
  Alert,
  Badge,
  Breadcrumb,
  Card,
  CardHeader,
  PageHeader,
} from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableEmpty, TableWrap } from '@/components/ui/table';
import { availableMicros } from '@/lib/billing/budget';
import { accounts, balanceOf } from '@/lib/billing/ledger';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageBrand } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, humanize, statusTone } from '@/lib/format';
import { formatMicros } from '@/lib/money';
import { getSettings } from '@/lib/settings';
import { stripeConfigured } from '@/lib/stripe';
import { integrations } from '@/lib/env';

export const metadata: Metadata = { title: 'Campaign funding' };
export const dynamic = 'force-dynamic';

export default async function CampaignFundingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { brand } = await pageBrand();
  const csrfToken = await currentCsrfToken();

  const campaign = await prisma.campaign.findFirst({
    where: { id, brandId: brand.id },
    include: { budget: true },
  });
  if (!campaign) notFound();

  const [depositBalance, deposits, settings] = await Promise.all([
    balanceOf(accounts.brandDeposit(brand.id)),
    prisma.brandDeposit.findMany({
      where: { brandId: brand.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    getSettings(),
  ]);

  const remaining = campaign.budget ? availableMicros(campaign.budget) : 0n;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: 'Campaigns', href: '/brand/campaigns' },
              { label: campaign.name, href: `/brand/campaigns/${campaign.id}` },
              { label: 'Funding' },
            ]}
          />
        }
        title="Campaign funding"
        description="A campaign can only accrue what you have funded. This limit is enforced by the database, not just the interface."
      />

      <StatGrid columns={4} className="mb-6">
        <Stat
          label="Available in campaign"
          value={formatMicros(remaining, { showSubCent: false })}
          tone={remaining > 0n ? 'success' : 'warning'}
        />
        <Stat
          label="Committed"
          value={formatMicros(campaign.budget?.reservedMicros ?? 0n, { showSubCent: false })}
          hint="Backing pending earnings"
        />
        <Stat
          label="Settled spend"
          value={formatMicros(campaign.budget?.spentMicros ?? 0n, { showSubCent: false })}
        />
        <Stat
          label="Account balance"
          value={formatMicros(depositBalance, { showSubCent: false })}
          hint="Unallocated, usable by any campaign"
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          {!stripeConfigured() ? (
            <Alert tone="warning" title="Payments are not configured on this deployment">
              An administrator must set STRIPE_SECRET_KEY before campaigns can be funded with a
              card. Existing account balance can still be allocated to campaigns.
            </Alert>
          ) : !integrations.stripe.liveMode ? (
            <Alert tone="info" title="Test mode">
              This deployment is using Stripe test keys. Payments will not charge a real card and no
              real money moves.
            </Alert>
          ) : null}

          <Card padded={false}>
            <div className="p-5">
              <CardHeader
                title="Payment history"
                description="Every deposit, including any that failed or were refunded."
              />
            </div>
            <TableWrap className="border-t border-border">
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Status</TH>
                    <TH align="right">Amount</TH>
                    <TH align="right">Refunded</TH>
                  </TR>
                </THead>
                <TBody>
                  {deposits.length === 0 ? (
                    <TableEmpty colSpan={4} message="No deposits yet." />
                  ) : (
                    deposits.map((deposit) => (
                      <TR key={deposit.id}>
                        <TD>
                          <div className="text-fg">{formatDateTime(deposit.createdAt)}</div>
                          {deposit.campaignId === campaign.id ? (
                            <Badge tone="primary" className="mt-1">
                              This campaign
                            </Badge>
                          ) : null}
                        </TD>
                        <TD>
                          <Badge tone={statusTone(deposit.status)}>{humanize(deposit.status)}</Badge>
                          {deposit.failureMessage ? (
                            <div className="mt-1 max-w-xs text-2xs text-danger text-pretty">
                              {deposit.failureMessage}
                            </div>
                          ) : null}
                        </TD>
                        <TD align="right" numeric className="font-medium">
                          {formatMicros(deposit.amountMicros, { showSubCent: false })}
                        </TD>
                        <TD align="right" numeric className="text-fg-muted">
                          {deposit.refundedMicros > 0n
                            ? formatMicros(deposit.refundedMicros, { showSubCent: false })
                            : '—'}
                        </TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
            </TableWrap>
          </Card>

          <Card>
            <CardHeader title="How campaign funding works" />
            <ul className="mt-4 space-y-3 text-sm text-fg-muted">
              <li className="flex gap-2.5">
                <span className="text-success" aria-hidden="true">
                  ✓
                </span>
                <span className="text-pretty">
                  Funds are held against the campaign. Nothing is charged to publishers or released
                  until activity actually happens.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-success" aria-hidden="true">
                  ✓
                </span>
                <span className="text-pretty">
                  When the budget is exhausted the campaign stops accruing billable activity
                  immediately. Traffic still reaches your site; you are simply not charged.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-success" aria-hidden="true">
                  ✓
                </span>
                <span className="text-pretty">
                  Unspent budget returns to your account balance when the campaign ends, and can be
                  used by another campaign or refunded.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-success" aria-hidden="true">
                  ✓
                </span>
                <span className="text-pretty">
                  Traffic that fails quality screening is never billed, so it does not consume
                  budget.
                </span>
              </li>
            </ul>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <FundingPanel
            campaignId={campaign.id}
            campaignName={campaign.name}
            csrfToken={csrfToken}
            accountBalanceMicros={depositBalance.toString()}
            minimumFundingMicros={settings.minCampaignFundingMicros}
            currentlyFundedMicros={(campaign.budget?.fundedMicros ?? 0n).toString()}
            stripeConfigured={stripeConfigured()}
            publishableKey={integrations.stripe.publishableKey}
          />
        </div>
      </div>
    </>
  );
}
