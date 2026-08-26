import Link from 'next/link';
import type { Metadata } from 'next';

import { Pagination } from '@/components/ui/pagination';
import { SearchBar } from '@/components/admin/search-bar';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { pageAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, formatRelative, humanize, statusTone } from '@/lib/format';

import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 40;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; role?: string; status?: string; q?: string }>;
}) {
  await pageAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where: Prisma.UserWhereInput = {
    ...(params.role ? { role: params.role as never } : {}),
    ...(params.status ? { status: params.status as never } : {}),
    ...(params.q
      ? {
          OR: [
            { email: { contains: params.q, mode: 'insensitive' } },
            { name: { contains: params.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        creator: { select: { id: true, handle: true } },
        brandMemberships: { include: { brand: { select: { id: true, displayName: true } } } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return (
    <>
      <PageHeader
        title="Users"
        description="Every account. Use the publisher or brand pages for account-specific actions."
        action={<SearchBar placeholder="Search name or email" />}
      />

      <div className="scroll-x mb-4 flex gap-1.5">
        <Tab href="/admin/users" label="All" active={!params.role && !params.status} />
        {(['ADMIN', 'BRAND_OWNER', 'BRAND_MEMBER', 'CREATOR'] as const).map((role) => (
          <Tab
            key={role}
            href={`/admin/users?role=${role}`}
            label={humanize(role)}
            active={params.role === role}
          />
        ))}
        <span className="mx-1 w-px bg-border" aria-hidden="true" />
        <Tab
          href="/admin/users?status=SUSPENDED"
          label="Suspended"
          active={params.status === 'SUSPENDED'}
        />
      </div>

      {users.length === 0 ? (
        <EmptyState title="No users match" description="Try a different filter." />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>User</TH>
                    <TH>Role</TH>
                    <TH>Status</TH>
                    <TH>Account</TH>
                    <TH align="right">Last seen</TH>
                    <TH align="right">Joined</TH>
                  </TR>
                </THead>
                <TBody>
                  {users.map((user) => (
                    <TR key={user.id}>
                      <TD>
                        <div className="font-medium text-fg">{user.name}</div>
                        <div className="text-2xs text-fg-subtle">{user.email}</div>
                        {!user.emailVerifiedAt ? (
                          <Badge tone="warning" className="mt-1">
                            Email unverified
                          </Badge>
                        ) : null}
                      </TD>
                      <TD>
                        <Badge tone={user.role === 'ADMIN' ? 'primary' : 'neutral'}>
                          {humanize(user.role)}
                        </Badge>
                        {user.mfaEnabled ? (
                          <div className="mt-0.5 text-2xs text-success">MFA on</div>
                        ) : user.role === 'ADMIN' ? (
                          <div className="mt-0.5 text-2xs text-danger">No MFA</div>
                        ) : null}
                      </TD>
                      <TD>
                        <Badge tone={statusTone(user.status)}>{humanize(user.status)}</Badge>
                        {user.suspendedReason ? (
                          <div className="mt-0.5 max-w-[12rem] truncate text-2xs text-fg-subtle">
                            {user.suspendedReason}
                          </div>
                        ) : null}
                      </TD>
                      <TD>
                        {user.creator ? (
                          <Link
                            href={`/admin/creators/${user.creator.id}`}
                            className="text-sm text-primary hover:underline"
                          >
                            @{user.creator.handle}
                          </Link>
                        ) : user.brandMemberships[0] ? (
                          <Link
                            href={`/admin/brands/${user.brandMemberships[0].brand.id}`}
                            className="text-sm text-primary hover:underline"
                          >
                            {user.brandMemberships[0].brand.displayName}
                          </Link>
                        ) : (
                          <span className="text-sm text-fg-subtle">—</span>
                        )}
                      </TD>
                      <TD align="right" className="text-fg-muted">
                        {user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'Never'}
                      </TD>
                      <TD align="right" className="whitespace-nowrap text-2xs text-fg-muted">
                        {formatDateTime(user.createdAt)}
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
