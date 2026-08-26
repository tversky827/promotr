import Link from 'next/link';
import type { Metadata } from 'next';

import { Pagination } from '@/components/ui/pagination';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { pageAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, formatNumber, humanize, statusTone } from '@/lib/format';
import { formatMicros } from '@/lib/money';

import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Conversions' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

export default async function AdminConversionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; source?: string }>;
}) {
  await pageAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where: Prisma.ConversionWhereInput = {
    ...(params.status ? { status: params.status as never } : {}),
    ...(params.source ? { source: params.source } : {}),
  };

  const [conversions, total, counts, sources, value] = await Promise.all([
    prisma.conversion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { campaign: { select: { id: true, name: true } } },
    }),
    prisma.conversion.count({ where }),
    prisma.conversion.groupBy({ by: ['status'], _count: true }),
    prisma.conversion.groupBy({ by: ['source'], _count: true }),
    prisma.conversion.aggregate({
      where: { status: { notIn: ['REJECTED', 'REVERSED'] } },
      _sum: { revenueMicros: true, payoutMicros: true, feeMicros: true },
    }),
  ]);

  const countMap = new Map(counts.map((row) => [row.status, row._count]));

  const creatorIds = [...new Set(conversions.map((c) => c.creatorId))];
  const creators = creatorIds.length
    ? await prisma.creator.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, handle: true },
      })
    : [];
  const creatorMap = new Map(creators.map((c) => [c.id, c.handle]));

  return (
    <>
      <PageHeader
        title="Conversions"
        description="Every conversion reported by a brand, across all four ingestion transports."
      />

      <StatGrid columns={4} className="mb-6">
        <Stat label="Total" value={formatNumber(total)} />
        <Stat
          label="Reported revenue"
          value={formatMicros(value._sum.revenueMicros ?? 0n, { showSubCent: false })}
        />
        <Stat
          label="Publisher payouts"
          value={formatMicros(value._sum.payoutMicros ?? 0n, { showSubCent: false })}
        />
        <Stat
          label="Platform fees"
          value={formatMicros(value._sum.feeMicros ?? 0n, { showSubCent: false })}
          tone="primary"
        />
      </StatGrid>

      <div className="scroll-x mb-4 flex gap-1.5">
        <Tab href="/admin/conversions" label="All" active={!params.status && !params.source} />
        {(['PENDING', 'APPROVED', 'REJECTED', 'UNDER_REVIEW', 'REVERSED'] as const).map((status) => (
          <Tab
            key={status}
            href={`/admin/conversions?status=${status}`}
            label={humanize(status)}
            active={params.status === status}
            count={countMap.get(status)}
          />
        ))}
        <span className="mx-1 w-px bg-border" aria-hidden="true" />
        {sources.map((source) => (
          <Tab
            key={source.source}
            href={`/admin/conversions?source=${source.source}`}
            label={source.source}
            active={params.source === source.source}
            count={source._count}
          />
        ))}
      </div>

      {conversions.length === 0 ? (
        <EmptyState title="No conversions match" description="Try a different filter." />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Order</TH>
                    <TH>Campaign</TH>
                    <TH>Publisher</TH>
                    <TH>Status</TH>
                    <TH align="right">Value</TH>
                    <TH align="right">Payout</TH>
                  </TR>
                </THead>
                <TBody>
                  {conversions.map((conversion) => (
                    <TR key={conversion.id}>
                      <TD className="whitespace-nowrap text-2xs text-fg-muted">
                        {formatDateTime(conversion.createdAt)}
                      </TD>
                      <TD>
                        <div className="max-w-[10rem] truncate font-mono text-xs text-fg">
                          {conversion.externalId}
                        </div>
                        <Badge tone="neutral" className="mt-0.5">
                          {conversion.source}
                        </Badge>
                      </TD>
                      <TD>
                        <Link
                          href={`/admin/campaigns/${conversion.campaign.id}`}
                          className="max-w-[10rem] truncate text-sm text-fg hover:text-primary"
                        >
                          {conversion.campaign.name}
                        </Link>
                      </TD>
                      <TD>
                        <Link
                          href={`/admin/creators/${conversion.creatorId}`}
                          className="text-sm text-fg hover:text-primary"
                        >
                          {creatorMap.get(conversion.creatorId) ?? '—'}
                        </Link>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(conversion.status)}>
                          {humanize(conversion.status)}
                        </Badge>
                        {conversion.statusReason ? (
                          <div className="mt-0.5 max-w-[12rem] truncate text-2xs text-fg-subtle">
                            {conversion.statusReason}
                          </div>
                        ) : null}
                      </TD>
                      <TD align="right" numeric>
                        {conversion.revenueMicros > 0n
                          ? formatMicros(conversion.revenueMicros)
                          : '—'}
                      </TD>
                      <TD align="right" numeric className="font-medium">
                        {formatMicros(conversion.payoutMicros)}
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
