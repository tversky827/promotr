import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { CreatorAdminPanel } from '@/components/admin/creator-panel';
import {
  Badge,
  Breadcrumb,
  Card,
  CardHeader,
  DescriptionList,
  Field,
  PageHeader,
} from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableEmpty, TableWrap } from '@/components/ui/table';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageAdmin } from '@/lib/auth/guards';
import { balanceSummary } from '@/lib/billing/earnings';
import { prisma } from '@/lib/db';
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  humanize,
  statusTone,
} from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'Publisher' };
export const dynamic = 'force-dynamic';

export default async function AdminCreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await pageAdmin();
  const csrfToken = await currentCsrfToken();

  const creator = await prisma.creator.findUnique({
    where: { id },
    include: {
      user: true,
      profile: true,
      socialAccounts: true,
      _count: { select: { links: true, earnings: true, payouts: true, disputes: true } },
    },
  });
  if (!creator) notFound();

  const [balance, clickStats, payouts, fraudEvents] = await Promise.all([
    balanceSummary(creator.id),
    prisma.$queryRaw<Array<{ total: bigint; qualified: bigint; rejected: bigint }>>`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE eligibility = 'ELIGIBLE')::bigint AS qualified,
        COUNT(*) FILTER (WHERE eligibility = 'REJECTED')::bigint AS rejected
      FROM "clicks" WHERE "creatorId" = ${creator.id}::uuid
    `,
    prisma.payout.findMany({
      where: { creatorId: creator.id },
      orderBy: { requestedAt: 'desc' },
      take: 10,
    }),
    prisma.fraudEvent.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const clicks = clickStats[0];
  const total = Number(clicks?.total ?? 0n);
  const qualified = Number(clicks?.qualified ?? 0n);
  const rejected = Number(clicks?.rejected ?? 0n);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: 'Publishers', href: '/admin/creators' },
              { label: creator.profile?.displayName ?? creator.handle },
            ]}
          />
        }
        title={creator.profile?.displayName ?? creator.handle}
        description={`@${creator.handle} · ${creator.user.email}`}
        action={
          <div className="flex gap-2">
            <Badge tone={statusTone(creator.verification)}>{humanize(creator.verification)}</Badge>
            {creator.payoutHold ? <Badge tone="warning">Payout held</Badge> : null}
          </div>
        }
      />

      <StatGrid columns={5} className="mb-6">
        <Stat
          label="Available"
          value={formatMicros(balance.availableMicros)}
          tone={balance.availableMicros > 0n ? 'success' : 'neutral'}
        />
        <Stat label="Pending" value={formatMicros(balance.pendingMicros)} />
        <Stat label="Paid" value={formatMicros(balance.paidMicros)} />
        <Stat
          label="Account risk"
          value={String(creator.riskScore)}
          tone={creator.riskScore >= 51 ? 'danger' : creator.riskScore >= 21 ? 'warning' : 'success'}
        />
        <Stat
          label="Rejected traffic"
          value={total > 0 ? formatPercent((rejected / total) * 100) : '—'}
          tone={total > 0 && rejected / total > 0.2 ? 'warning' : 'neutral'}
          hint={`${formatNumber(qualified)} of ${formatNumber(total)} qualified`}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card padded={false}>
            <div className="p-5">
              <CardHeader title="Fraud history" description="Every flag raised against this account." />
            </div>
            <TableWrap className="border-t border-border">
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Band</TH>
                    <TH align="right">Score</TH>
                    <TH>Resolution</TH>
                  </TR>
                </THead>
                <TBody>
                  {fraudEvents.length === 0 ? (
                    <TableEmpty colSpan={4} message="No fraud flags. Clean history." />
                  ) : (
                    fraudEvents.map((event) => (
                      <TR key={event.id}>
                        <TD className="text-fg-muted">{formatRelative(event.createdAt)}</TD>
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
                        <TD>
                          {event.resolution ? (
                            <Badge tone={event.resolution === 'approved' ? 'success' : 'danger'}>
                              {humanize(event.resolution)}
                            </Badge>
                          ) : (
                            <Link href="/admin/fraud" className="text-sm text-primary hover:underline">
                              Review
                            </Link>
                          )}
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
              <CardHeader title="Payout history" />
            </div>
            <TableWrap className="border-t border-border">
              <Table>
                <THead>
                  <TR>
                    <TH>Requested</TH>
                    <TH>Status</TH>
                    <TH align="right">Amount</TH>
                  </TR>
                </THead>
                <TBody>
                  {payouts.length === 0 ? (
                    <TableEmpty colSpan={3} message="No payouts yet." />
                  ) : (
                    payouts.map((payout) => (
                      <TR key={payout.id}>
                        <TD className="text-fg-muted">{formatDateTime(payout.requestedAt)}</TD>
                        <TD>
                          <Badge tone={statusTone(payout.status)}>{humanize(payout.status)}</Badge>
                          {payout.failureMessage ? (
                            <div className="mt-1 max-w-xs text-2xs text-danger">
                              {payout.failureMessage}
                            </div>
                          ) : null}
                        </TD>
                        <TD align="right" numeric className="font-medium">
                          {formatMicros(payout.amountMicros)}
                        </TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
            </TableWrap>
          </Card>

          <Card>
            <CardHeader title="Profile" />
            <DescriptionList columns={2} className="mt-4">
              <Field label="Publisher type">{humanize(creator.publisherType)}</Field>
              <Field label="Country">{creator.country ?? '—'}</Field>
              <Field label="Joined">{formatDateTime(creator.createdAt)}</Field>
              <Field label="Tracking links">{formatNumber(creator._count.links)}</Field>
              <Field label="Tax form">
                {creator.taxFormKind
                  ? `${creator.taxFormKind} (${creator.taxFormStatus ?? 'pending'})`
                  : 'Not submitted'}
              </Field>
              <Field label="Payout account">
                {creator.stripeAccountId
                  ? creator.stripePayoutsEnabled
                    ? 'Connected and enabled'
                    : 'Connected, setup incomplete'
                  : 'Not connected'}
              </Field>
              {creator.profile?.bio ? (
                <Field label="Bio">
                  <span className="text-sm">{creator.profile.bio}</span>
                </Field>
              ) : null}
              {creator.socialAccounts.length > 0 ? (
                <Field
                  label="Self-reported channels"
                  hint="Declared by the publisher; not independently verified"
                >
                  <span className="text-sm">
                    {creator.socialAccounts
                      .map((account) => `${account.platform} @${account.handle}`)
                      .join(', ')}
                  </span>
                </Field>
              ) : null}
            </DescriptionList>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <CreatorAdminPanel
            creatorId={creator.id}
            userId={creator.userId}
            verification={creator.verification}
            payoutHold={creator.payoutHold}
            userStatus={creator.user.status}
            csrfToken={csrfToken}
          />
        </div>
      </div>
    </>
  );
}
