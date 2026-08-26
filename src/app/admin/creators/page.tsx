import Link from 'next/link';
import type { Metadata } from 'next';

import { Pagination } from '@/components/ui/pagination';
import { SearchBar } from '@/components/admin/search-bar';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { pageAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatNumber, formatRelative, humanize, statusTone } from '@/lib/format';
import { formatMicros } from '@/lib/money';

import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Publishers' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 30;

export default async function AdminCreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; verification?: string; q?: string; risk?: string }>;
}) {
  await pageAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where: Prisma.CreatorWhereInput = {
    ...(params.verification ? { verification: params.verification as never } : {}),
    ...(params.risk === 'high' ? { riskScore: { gte: 51 } } : {}),
    ...(params.q
      ? {
          OR: [
            { handle: { contains: params.q, mode: 'insensitive' } },
            { user: { email: { contains: params.q, mode: 'insensitive' } } },
            { profile: { displayName: { contains: params.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [creators, total] = await Promise.all([
    prisma.creator.findMany({
      where,
      orderBy: [{ riskScore: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        user: { select: { email: true, status: true } },
        profile: { select: { displayName: true } },
        _count: { select: { links: true, earnings: true } },
      },
    }),
    prisma.creator.count({ where }),
  ]);

  // Balances resolved in one query rather than per row.
  const balances = await prisma.ledgerAccount.findMany({
    where: {
      type: 'PUBLISHER_AVAILABLE',
      ownerId: { in: creators.map((c) => c.id) },
    },
    select: { ownerId: true, balanceMicros: true },
  });
  const balanceMap = new Map(balances.map((b) => [b.ownerId, b.balanceMicros]));

  return (
    <>
      <PageHeader title="Publishers" description="Every creator and publisher account." />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="scroll-x flex gap-1.5">
          <Tab href="/admin/creators" label="All" active={!params.verification && !params.risk} />
          {(['VERIFIED', 'PENDING', 'UNVERIFIED', 'RESTRICTED', 'SUSPENDED'] as const).map((v) => (
            <Tab
              key={v}
              href={`/admin/creators?verification=${v}`}
              label={humanize(v)}
              active={params.verification === v}
            />
          ))}
          <Tab href="/admin/creators?risk=high" label="High risk" active={params.risk === 'high'} />
        </div>
        <SearchBar placeholder="Search handle or email" />
      </div>

      {creators.length === 0 ? (
        <EmptyState title="No publishers match" description="Try a different filter." />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Publisher</TH>
                    <TH>Status</TH>
                    <TH align="right">Risk</TH>
                    <TH align="right">Links</TH>
                    <TH align="right">Balance</TH>
                    <TH align="right">Joined</TH>
                  </TR>
                </THead>
                <TBody>
                  {creators.map((creator) => (
                    <TR key={creator.id}>
                      <TD>
                        <Link
                          href={`/admin/creators/${creator.id}`}
                          className="font-medium text-fg hover:text-primary"
                        >
                          {creator.profile?.displayName ?? creator.handle}
                        </Link>
                        <div className="text-2xs text-fg-subtle">
                          @{creator.handle} · {creator.user.email}
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(creator.verification)}>
                          {humanize(creator.verification)}
                        </Badge>
                        {creator.payoutHold ? (
                          <div className="mt-1">
                            <Badge tone="warning">Payout held</Badge>
                          </div>
                        ) : null}
                      </TD>
                      <TD align="right" numeric>
                        <Badge
                          tone={
                            creator.riskScore >= 76
                              ? 'danger'
                              : creator.riskScore >= 51
                                ? 'warning'
                                : 'success'
                          }
                        >
                          {creator.riskScore}
                        </Badge>
                      </TD>
                      <TD align="right" numeric>
                        {formatNumber(creator._count.links)}
                      </TD>
                      <TD align="right" numeric className="font-medium">
                        {formatMicros(balanceMap.get(creator.id) ?? 0n)}
                      </TD>
                      <TD align="right" className="text-fg-muted">
                        {formatRelative(creator.createdAt)}
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

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
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
    </Link>
  );
}
