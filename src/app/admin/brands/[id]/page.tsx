import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { BrandAdminPanel } from '@/components/admin/brand-panel';
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
import { accounts, balanceOf } from '@/lib/billing/ledger';
import { prisma } from '@/lib/db';
import { formatDateTime, formatNumber, humanize, statusTone } from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'Brand' };
export const dynamic = 'force-dynamic';

export default async function AdminBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await pageAdmin();
  const csrfToken = await currentCsrfToken();

  const brandRecord = await prisma.brand.findUnique({
    where: { id },
    include: {
      members: { include: { user: { select: { name: true, email: true, status: true } } } },
      campaigns: { orderBy: { createdAt: 'desc' }, take: 10, include: { budget: true } },
      domains: true,
      _count: { select: { campaigns: true, apiKeys: true, webhooks: true } },
    },
  });
  if (!brandRecord) notFound();

  const [balance, deposits, spend] = await Promise.all([
    balanceOf(accounts.brandDeposit(brandRecord.id)),
    prisma.brandDeposit.findMany({
      where: { brandId: brandRecord.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.earning.aggregate({
      where: {
        campaign: { brandId: brandRecord.id },
        status: { notIn: ['REJECTED', 'REVERSED'] },
      },
      _sum: { grossMicros: true, feeMicros: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[{ label: 'Brands', href: '/admin/brands' }, { label: brandRecord.displayName }]}
          />
        }
        title={brandRecord.displayName}
        description={brandRecord.legalName}
        action={
          <Badge tone={statusTone(brandRecord.verification)}>
            {humanize(brandRecord.verification)}
          </Badge>
        }
      />

      <StatGrid columns={4} className="mb-6">
        <Stat label="Account balance" value={formatMicros(balance, { showSubCent: false })} />
        <Stat
          label="Lifetime spend"
          value={formatMicros(spend._sum.grossMicros ?? 0n, { showSubCent: false })}
        />
        <Stat
          label="Platform fees earned"
          value={formatMicros(spend._sum.feeMicros ?? 0n, { showSubCent: false })}
          tone="primary"
        />
        <Stat label="Campaigns" value={formatNumber(brandRecord._count.campaigns)} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Business details" description="Submitted at onboarding." />
            <DescriptionList columns={2} className="mt-4">
              <Field label="Legal name">{brandRecord.legalName}</Field>
              <Field label="Trading name">{brandRecord.displayName}</Field>
              <Field label="Website">
                <a
                  href={brandRecord.website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="break-all text-sm text-primary hover:underline"
                >
                  {brandRecord.website}
                </a>
              </Field>
              <Field label="Industry">{humanize(brandRecord.category)}</Field>
              <Field label="Contact">{brandRecord.contactEmail}</Field>
              <Field label="Country">{brandRecord.country}</Field>
              {brandRecord.addressLine1 ? (
                <Field label="Address">
                  {[
                    brandRecord.addressLine1,
                    brandRecord.city,
                    brandRecord.region,
                    brandRecord.postalCode,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Field>
              ) : null}
              <Field label="Tax ID" hint="Stored encrypted; not displayed">
                {brandRecord.taxId ? 'On file' : 'Not provided'}
              </Field>
              <Field label="Joined">{formatDateTime(brandRecord.createdAt)}</Field>
              {brandRecord.description ? (
                <Field label="Description">
                  <span className="text-sm">{brandRecord.description}</span>
                </Field>
              ) : null}
            </DescriptionList>
          </Card>

          <Card padded={false}>
            <div className="p-5">
              <CardHeader title="Campaigns" />
            </div>
            <TableWrap className="border-t border-border">
              <Table>
                <THead>
                  <TR>
                    <TH>Campaign</TH>
                    <TH>Status</TH>
                    <TH align="right">Funded</TH>
                    <TH align="right">Spent</TH>
                  </TR>
                </THead>
                <TBody>
                  {brandRecord.campaigns.length === 0 ? (
                    <TableEmpty colSpan={4} message="No campaigns yet." />
                  ) : (
                    brandRecord.campaigns.map((campaign) => (
                      <TR key={campaign.id}>
                        <TD>
                          <Link
                            href={`/admin/campaigns/${campaign.id}`}
                            className="font-medium text-fg hover:text-primary"
                          >
                            {campaign.name}
                          </Link>
                        </TD>
                        <TD>
                          <Badge tone={statusTone(campaign.status)}>
                            {humanize(campaign.status)}
                          </Badge>
                        </TD>
                        <TD align="right" numeric>
                          {formatMicros(campaign.budget?.fundedMicros ?? 0n, { showSubCent: false })}
                        </TD>
                        <TD align="right" numeric>
                          {formatMicros(campaign.budget?.spentMicros ?? 0n, { showSubCent: false })}
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
              <CardHeader title="Deposits" description="Money paid in." />
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
                    <TableEmpty colSpan={4} message="No deposits." />
                  ) : (
                    deposits.map((deposit) => (
                      <TR key={deposit.id}>
                        <TD className="text-fg-muted">{formatDateTime(deposit.createdAt)}</TD>
                        <TD>
                          <Badge tone={statusTone(deposit.status)}>{humanize(deposit.status)}</Badge>
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
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <BrandAdminPanel
            brandId={brandRecord.id}
            verification={brandRecord.verification}
            csrfToken={csrfToken}
          />

          <Card>
            <CardHeader title="Team" />
            <ul className="mt-3 space-y-2">
              {brandRecord.members.map((member) => (
                <li key={member.id} className="text-sm">
                  <div className="font-medium text-fg">{member.user.name}</div>
                  <div className="text-2xs text-fg-subtle">
                    {member.user.email} · {humanize(member.role)}
                    {member.user.status !== 'ACTIVE' ? ` · ${humanize(member.user.status)}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {brandRecord.domains.length > 0 ? (
            <Card>
              <CardHeader title="Verified domains" />
              <ul className="mt-3 space-y-1.5">
                {brandRecord.domains.map((domain) => (
                  <li key={domain.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-mono text-xs text-fg">{domain.domain}</span>
                    <Badge tone={domain.verifiedAt ? 'success' : 'neutral'}>
                      {domain.verifiedAt ? 'Verified' : 'Pending'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
