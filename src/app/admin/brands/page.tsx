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

export const metadata: Metadata = { title: 'Brands' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 30;

export default async function AdminBrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; verification?: string; q?: string }>;
}) {
  await pageAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where: Prisma.BrandWhereInput = {
    ...(params.verification ? { verification: params.verification as never } : {}),
    ...(params.q
      ? {
          OR: [
            { displayName: { contains: params.q, mode: 'insensitive' } },
            { legalName: { contains: params.q, mode: 'insensitive' } },
            { contactEmail: { contains: params.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [brands, total] = await Promise.all([
    prisma.brand.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { _count: { select: { campaigns: true } } },
    }),
    prisma.brand.count({ where }),
  ]);

  const balances = await prisma.ledgerAccount.findMany({
    where: { type: 'BRAND_DEPOSIT', ownerId: { in: brands.map((b) => b.id) } },
    select: { ownerId: true, balanceMicros: true },
  });
  const balanceMap = new Map(balances.map((b) => [b.ownerId, b.balanceMicros]));

  return (
    <>
      <PageHeader title="Brands" description="Advertiser accounts and their verification status." />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="scroll-x flex gap-1.5">
          <Tab href="/admin/brands" label="All" active={!params.verification} />
          {(['PENDING', 'VERIFIED', 'UNVERIFIED', 'REJECTED', 'SUSPENDED'] as const).map((v) => (
            <Tab
              key={v}
              href={`/admin/brands?verification=${v}`}
              label={humanize(v)}
              active={params.verification === v}
            />
          ))}
        </div>
        <SearchBar placeholder="Search brands" />
      </div>

      {brands.length === 0 ? (
        <EmptyState title="No brands match" description="Try a different filter." />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Brand</TH>
                    <TH>Verification</TH>
                    <TH align="right">Campaigns</TH>
                    <TH align="right">Balance</TH>
                    <TH align="right">Joined</TH>
                  </TR>
                </THead>
                <TBody>
                  {brands.map((brandRecord) => (
                    <TR key={brandRecord.id}>
                      <TD>
                        <Link
                          href={`/admin/brands/${brandRecord.id}`}
                          className="font-medium text-fg hover:text-primary"
                        >
                          {brandRecord.displayName}
                        </Link>
                        <div className="text-2xs text-fg-subtle">
                          {brandRecord.legalName} · {brandRecord.country}
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(brandRecord.verification)}>
                          {humanize(brandRecord.verification)}
                        </Badge>
                      </TD>
                      <TD align="right" numeric>
                        {formatNumber(brandRecord._count.campaigns)}
                      </TD>
                      <TD align="right" numeric className="font-medium">
                        {formatMicros(balanceMap.get(brandRecord.id) ?? 0n, { showSubCent: false })}
                      </TD>
                      <TD align="right" className="text-fg-muted">
                        {formatRelative(brandRecord.createdAt)}
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
