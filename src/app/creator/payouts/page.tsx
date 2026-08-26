import type { Metadata } from 'next';

import { PayoutPanel } from '@/components/creator/payout-panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { balanceSummary } from '@/lib/billing/earnings';
import { checkPayoutEligibility } from '@/lib/billing/payouts';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageCreator } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, formatRelative, humanize, statusTone } from '@/lib/format';
import { formatMicros } from '@/lib/money';
import { getSettings } from '@/lib/settings';
import { stripeConfigured } from '@/lib/stripe';

export const metadata: Metadata = { title: 'Payouts' };
export const dynamic = 'force-dynamic';

export default async function CreatorPayoutsPage() {
  const { creator } = await pageCreator();
  const csrfToken = await currentCsrfToken();

  const [balance, eligibility, payouts, settings] = await Promise.all([
    balanceSummary(creator.id),
    checkPayoutEligibility(creator.id),
    prisma.payout.findMany({
      where: { creatorId: creator.id },
      orderBy: { requestedAt: 'desc' },
      take: 50,
      include: { _count: { select: { earnings: true } } },
    }),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Withdraw your available balance and track every payment."
      />

      <StatGrid columns={3} className="mb-6">
        <Stat
          label="Available to withdraw"
          value={formatMicros(balance.availableMicros)}
          tone={balance.availableMicros > 0n ? 'success' : 'neutral'}
        />
        <Stat
          label="Pending"
          value={formatMicros(balance.pendingMicros)}
          hint="Clears after the campaign hold period"
        />
        <Stat label="Paid to date" value={formatMicros(balance.paidMicros)} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card padded={false}>
            <div className="p-5">
              <CardHeader
                title="Payout history"
                description="Every withdrawal, including any that failed."
              />
            </div>

            {payouts.length === 0 ? (
              <div className="border-t border-border p-5">
                <EmptyState
                  title="No payouts yet"
                  description={`Your balance becomes withdrawable once it clears ${formatMicros(BigInt(settings.minimumPayoutMicros))}.`}
                  className="border-0 py-8"
                />
              </div>
            ) : (
              <TableWrap className="border-t border-border">
                <Table>
                  <THead>
                    <TR>
                      <TH>Requested</TH>
                      <TH>Status</TH>
                      <TH align="right">Earnings</TH>
                      <TH align="right">Amount</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {payouts.map((payout) => (
                      <TR key={payout.id}>
                        <TD>
                          <div className="text-fg">{formatRelative(payout.requestedAt)}</div>
                          <div className="text-2xs text-fg-subtle">
                            {formatDateTime(payout.requestedAt)}
                          </div>
                        </TD>
                        <TD>
                          <Badge tone={statusTone(payout.status)}>{humanize(payout.status)}</Badge>
                          {payout.paidAt ? (
                            <div className="mt-1 text-2xs text-fg-subtle">
                              Sent {formatRelative(payout.paidAt)}
                            </div>
                          ) : null}
                          {/* A failure must always say why, and must say that
                              the money came back. */}
                          {payout.failureMessage ? (
                            <div className="mt-1 max-w-xs text-2xs text-danger text-pretty">
                              {payout.failureMessage} Your balance was returned in full.
                            </div>
                          ) : null}
                          {payout.holdReason ? (
                            <div className="mt-1 max-w-xs text-2xs text-warning text-pretty">
                              {payout.holdReason}
                            </div>
                          ) : null}
                        </TD>
                        <TD align="right" numeric className="text-fg-muted">
                          {payout._count.earnings}
                        </TD>
                        <TD align="right" numeric className="font-medium">
                          {formatMicros(payout.amountMicros)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Card>

          <Card>
            <CardHeader
              title="How payouts work"
              description="The path a dollar takes from a click to your bank."
            />
            <ol className="mt-4 space-y-3">
              {[
                {
                  title: 'Earned',
                  body: 'Qualified traffic or a conversion creates an earning, held as pending while it is verified.',
                },
                {
                  title: 'Approved',
                  body: `After the campaign's verification period the earning is approved and starts a ${settings.earningHoldDays}-day hold.`,
                },
                {
                  title: 'Available',
                  body: 'Once the hold elapses the amount joins your withdrawable balance.',
                },
                {
                  title: 'Paid',
                  body: 'You request a payout and the funds are transferred to your connected account, typically arriving in 1–3 business days.',
                },
              ].map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-fg">{step.title}</p>
                    <p className="mt-0.5 text-sm text-fg-muted text-pretty">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <PayoutPanel
            csrfToken={csrfToken}
            availableMicros={balance.availableMicros.toString()}
            minimumMicros={settings.minimumPayoutMicros}
            eligible={eligibility.eligible}
            blockReason={eligibility.eligible ? null : eligibility.reason}
            blockCode={eligibility.eligible ? null : eligibility.code}
            stripeConfigured={stripeConfigured()}
            payoutsEnabled={creator.stripePayoutsEnabled}
            hasConnectAccount={Boolean(creator.stripeAccountId)}
            requirementsDue={creator.stripeRequirementsDue}
            taxFormStatus={creator.taxFormStatus}
          />
        </div>
      </div>
    </>
  );
}
