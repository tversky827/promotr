import Link from 'next/link';
import type { Metadata } from 'next';

import { Pagination } from '@/components/ui/pagination';
import { SearchBar } from '@/components/admin/search-bar';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { pageAdmin } from '@/lib/auth/guards';
import { availableMicros } from '@/lib/billing/budget';
import { prisma } from '@/lib/db';
import { describePayout, formatRelative, humanize, statusTone } from '@/lib/format';
import { formatMicros } from '@/lib/money';

import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Campaigns' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 30;

export default async function AdminCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  await pageAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where: Prisma.CampaignWhereInput = {
    ...(params.status ? { status: params.status as never } : {}),
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: 'insensitive' } },
            { brand: { displayName: { contains: params.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [campaigns, total, counts] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        brand: { select: { id: true, displayName: true, verification: true } },
        budget: true,
      },
    }),
    prisma.campaign.count({ where }),
    prisma.campaign.groupBy({ by: ['status'], _count: true }),
  ]);

  const countMap = new Map(counts.map((row) => [row.status, row._count]));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Every campaign on the platform. Review pending ones and moderate live ones."
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="scroll-x flex gap-1.5">
          <Tab href="/admin/campaigns" label="All" active={!params.status} />
          {(['PENDING_REVIEW', 'ACTIVE', 'APPROVED', 'PAUSED', 'REJECTED', 'SUSPENDED', 'DRAFT'] as const).map(
            (status) => (
              <Tab
                key={status}
                href={`/admin/campaigns?status=${status}`}
                label={humanize(status)}
                active={params.status === status}
                count={countMap.get(status)}
              />
            ),
          )}
        </div>
        <SearchBar placeholder="Search campaigns or brands" />
      </div>

      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns match" description="Try a different filter or search term." />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Campaign</TH>
                    <TH>Brand</TH>
                    <TH>Status</TH>
                    <TH align="right">Risk</TH>
                    <TH align="right">Budget left</TH>
                    <TH align="right">Created</TH>
                  </TR>
                </THead>
                <TBody>
                  {campaigns.map((campaign) => (
                    <TR key={campaign.id}>
                      <TD>
                        <Link
                          href={`/admin/campaigns/${campaign.id}`}
                          className="font-medium text-fg hover:text-primary"
                        >
                          {campaign.name}
                        </Link>
                        <div className="text-2xs text-fg-subtle">{describePayout(campaign)}</div>
                      </TD>
                      <TD>
                        <Link
                          href={`/admin/brands/${campaign.brand.id}`}
                          className="text-fg hover:text-primary"
                        >
                          {campaign.brand.displayName}
                        </Link>
                        <div className="text-2xs text-fg-subtle">
                          {humanize(campaign.brand.verification)}
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(campaign.status)}>{humanize(campaign.status)}</Badge>
                      </TD>
                      <TD align="right" numeric>
                        {campaign.moderationScore !== null ? (
                          <Badge
                            tone={
                              campaign.moderationScore >= 60
                                ? 'danger'
                                : campaign.moderationScore >= 30
                                  ? 'warning'
                                  : 'success'
                            }
                          >
                            {campaign.moderationScore}
                          </Badge>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </TD>
                      <TD align="right" numeric>
                        {formatMicros(campaign.budget ? availableMicros(campaign.budget) : 0n, {
                          showSubCent: false,
                        })}
                      </TD>
                      <TD align="right" className="text-fg-muted">
                        {formatRelative(campaign.createdAt)}
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
