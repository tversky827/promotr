import type { Metadata } from 'next';

import { Pagination } from '@/components/ui/pagination';
import { SearchBar } from '@/components/admin/search-bar';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { pageAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, formatRelative, humanize } from '@/lib/format';

import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

/**
 * The audit log.
 *
 * Append-only history of every administrative and financial action. Before and
 * after state is shown inline because the whole point is that a reviewer can
 * see what actually changed without reconstructing it.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; entity?: string }>;
}) {
  await pageAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where: Prisma.AuditLogWhereInput = {
    ...(params.entity ? { entityKind: params.entity } : {}),
    ...(params.q
      ? {
          OR: [
            { action: { contains: params.q, mode: 'insensitive' } },
            { entityId: { contains: params.q, mode: 'insensitive' } },
            { reason: { contains: params.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { actor: { select: { name: true, email: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every administrative and financial action, with who did it and why. Append-only."
        action={<SearchBar placeholder="Search actions, IDs, reasons" />}
      />

      {entries.length === 0 ? (
        <EmptyState title="No audit entries match" description="Try a different search." />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Actor</TH>
                    <TH>Action</TH>
                    <TH>Entity</TH>
                    <TH>Change</TH>
                  </TR>
                </THead>
                <TBody>
                  {entries.map((entry) => (
                    <TR key={entry.id}>
                      <TD>
                        <div className="whitespace-nowrap text-fg">
                          {formatRelative(entry.createdAt)}
                        </div>
                        <div className="whitespace-nowrap text-2xs text-fg-subtle">
                          {formatDateTime(entry.createdAt)}
                        </div>
                      </TD>
                      <TD>
                        {entry.actor ? (
                          <>
                            <div className="text-fg">{entry.actor.name}</div>
                            <div className="text-2xs text-fg-subtle">{entry.actor.email}</div>
                          </>
                        ) : (
                          <span className="text-fg-subtle">System</span>
                        )}
                      </TD>
                      <TD>
                        <span className="font-mono text-xs text-fg">{entry.action}</span>
                        {entry.actorRole ? (
                          <div className="mt-0.5">
                            <Badge tone={entry.actorRole === 'ADMIN' ? 'primary' : 'neutral'}>
                              {humanize(entry.actorRole)}
                            </Badge>
                          </div>
                        ) : null}
                      </TD>
                      <TD>
                        <div className="text-xs text-fg-muted">{entry.entityKind}</div>
                        {entry.entityId ? (
                          <div className="max-w-[12rem] truncate font-mono text-2xs text-fg-subtle">
                            {entry.entityId}
                          </div>
                        ) : null}
                      </TD>
                      <TD>
                        {entry.reason ? (
                          <p className="mb-1 max-w-sm text-xs text-fg text-pretty">{entry.reason}</p>
                        ) : null}
                        {entry.before || entry.after ? (
                          <div className="max-w-sm font-mono text-2xs text-fg-subtle">
                            {entry.before ? (
                              <div className="truncate">
                                <span className="text-danger">−</span> {JSON.stringify(entry.before)}
                              </div>
                            ) : null}
                            {entry.after ? (
                              <div className="truncate">
                                <span className="text-success">+</span> {JSON.stringify(entry.after)}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
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
