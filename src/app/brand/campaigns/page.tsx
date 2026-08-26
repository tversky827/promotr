import Link from 'next/link';
import type { Metadata } from 'next';

import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { pageBrand } from '@/lib/auth/guards';
import { availableMicros } from '@/lib/billing/budget';
import { prisma } from '@/lib/db';
import { describePayout, formatDate, formatNumber, humanize, statusTone } from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'Campaigns' };
export const dynamic = 'force-dynamic';

export default async function BrandCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { brand } = await pageBrand();
  const { status } = await searchParams;

  const campaigns = await prisma.campaign.findMany({
    where: { brandId: brand.id, ...(status ? { status: status as never } : {}) },
    orderBy: { createdAt: 'desc' },
    include: { budget: true, _count: { select: { links: true, conversions: true } } },
  });

  const counts = await prisma.campaign.groupBy({
    by: ['status'],
    where: { brandId: brand.id },
    _count: true,
  });
  const countMap = new Map(counts.map((row) => [row.status, row._count]));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Everything you have created, live or otherwise."
        action={<ButtonLink href="/brand/campaigns/new">New campaign</ButtonLink>}
      />

      <div className="scroll-x mb-4 flex gap-1.5">
        <Tab href="/brand/campaigns" label="All" active={!status} />
        {(['ACTIVE', 'PENDING_REVIEW', 'APPROVED', 'DRAFT', 'PAUSED', 'COMPLETED', 'REJECTED'] as const).map(
          (value) => (
            <Tab
              key={value}
              href={`/brand/campaigns?status=${value}`}
              label={humanize(value)}
              active={status === value}
              count={countMap.get(value)}
            />
          ),
        )}
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          title={status ? `No ${humanize(status).toLowerCase()} campaigns` : 'No campaigns yet'}
          description="Create a campaign, fund it, and publishers can start sending traffic straight away."
          action={<ButtonLink href="/brand/campaigns/new">Create a campaign</ButtonLink>}
        />
      ) : (
        <Card padded={false}>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Campaign</TH>
                  <TH>Status</TH>
                  <TH align="right">Publishers</TH>
                  <TH align="right">Conversions</TH>
                  <TH align="right">Budget left</TH>
                  <TH align="right">Spent</TH>
                </TR>
              </THead>
              <TBody>
                {campaigns.map((campaign) => {
                  const remaining = campaign.budget ? availableMicros(campaign.budget) : 0n;
                  const needsFunding =
                    remaining <= 0n &&
                    (campaign.status === 'APPROVED' || campaign.status === 'ACTIVE');

                  return (
                    <TR key={campaign.id}>
                      <TD>
                        <Link
                          href={`/brand/campaigns/${campaign.id}`}
                          className="font-medium text-fg hover:text-primary"
                        >
                          {campaign.name}
                        </Link>
                        <div className="mt-0.5 text-2xs text-fg-subtle">
                          {describePayout(campaign)} · created {formatDate(campaign.createdAt)}
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(campaign.status)}>{humanize(campaign.status)}</Badge>
                        {needsFunding ? (
                          <div className="mt-1">
                            <Badge tone="warning">Needs funding</Badge>
                          </div>
                        ) : null}
                      </TD>
                      <TD align="right" numeric>
                        {formatNumber(campaign._count.links)}
                      </TD>
                      <TD align="right" numeric>
                        {formatNumber(campaign._count.conversions)}
                      </TD>
                      <TD align="right" numeric>
                        {formatMicros(remaining, { showSubCent: false })}
                      </TD>
                      <TD align="right" numeric>
                        {formatMicros(campaign.budget?.spentMicros ?? 0n, { showSubCent: false })}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
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
