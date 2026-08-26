import Link from 'next/link';
import type { Metadata } from 'next';

import { Pagination } from '@/components/ui/pagination';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { pageAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { countryName, formatDateTime, formatNumber, formatPercent, humanize } from '@/lib/format';

import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Clicks' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

export default async function AdminClicksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; eligibility?: string; creator?: string }>;
}) {
  await pageAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where: Prisma.ClickWhereInput = {
    ...(params.eligibility ? { eligibility: params.eligibility as never } : {}),
    ...(params.creator ? { creatorId: params.creator } : {}),
  };

  const [clicks, total, summary] = await Promise.all([
    prisma.click.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.click.count({ where }),
    prisma.$queryRaw<Array<{ total: bigint; eligible: bigint; bot: bigint; billable: bigint }>>`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE eligibility = 'ELIGIBLE')::bigint AS eligible,
        COUNT(*) FILTER (WHERE "isBot")::bigint AS bot,
        COUNT(*) FILTER (WHERE billable)::bigint AS billable
      FROM "clicks"
      WHERE "createdAt" >= now() - interval '30 days'
    `,
  ]);

  const stats = summary[0];
  const totalClicks = Number(stats?.total ?? 0n);

  // Resolve names in one query rather than per row.
  const creatorIds = [...new Set(clicks.map((c) => c.creatorId))];
  const campaignIds = [...new Set(clicks.map((c) => c.campaignId))];
  const [creators, campaigns] = await Promise.all([
    creatorIds.length
      ? prisma.creator.findMany({ where: { id: { in: creatorIds } }, select: { id: true, handle: true } })
      : [],
    campaignIds.length
      ? prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, name: true } })
      : [],
  ]);
  const creatorMap = new Map(creators.map((c) => [c.id, c.handle]));
  const campaignMap = new Map(campaigns.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        title="Clicks"
        description="Raw click stream. IP addresses are never stored — only keyed, non-reversible hashes."
      />

      <StatGrid columns={4} className="mb-6">
        <Stat label="Clicks (30d)" value={formatNumber(totalClicks)} />
        <Stat
          label="Qualified"
          value={
            totalClicks > 0
              ? formatPercent((Number(stats?.eligible ?? 0n) / totalClicks) * 100)
              : '—'
          }
        />
        <Stat
          label="Bot traffic"
          value={
            totalClicks > 0 ? formatPercent((Number(stats?.bot ?? 0n) / totalClicks) * 100) : '—'
          }
          tone={
            totalClicks > 0 && Number(stats?.bot ?? 0n) / totalClicks > 0.15 ? 'warning' : 'neutral'
          }
        />
        <Stat label="Billable" value={formatNumber(Number(stats?.billable ?? 0n))} />
      </StatGrid>

      <div className="scroll-x mb-4 flex gap-1.5">
        <Tab href="/admin/clicks" label="All" active={!params.eligibility} />
        {(
          [
            'ELIGIBLE',
            'REJECTED',
            'DUPLICATE',
            'BUDGET_EXHAUSTED',
            'GEO_BLOCKED',
            'CHANNEL_BLOCKED',
            'SUSPENDED_PUBLISHER',
          ] as const
        ).map((value) => (
          <Tab
            key={value}
            href={`/admin/clicks?eligibility=${value}`}
            label={humanize(value)}
            active={params.eligibility === value}
          />
        ))}
      </div>

      {clicks.length === 0 ? (
        <EmptyState title="No clicks match" description="Try a different filter." />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Campaign</TH>
                    <TH>Publisher</TH>
                    <TH>Visitor</TH>
                    <TH>Source</TH>
                    <TH align="right">Risk</TH>
                    <TH>Outcome</TH>
                  </TR>
                </THead>
                <TBody>
                  {clicks.map((click) => (
                    <TR key={click.id}>
                      <TD className="whitespace-nowrap text-2xs text-fg-muted">
                        {formatDateTime(click.createdAt)}
                      </TD>
                      <TD>
                        <div className="max-w-[10rem] truncate text-sm text-fg">
                          {campaignMap.get(click.campaignId) ?? '—'}
                        </div>
                      </TD>
                      <TD>
                        <Link
                          href={`/admin/creators/${click.creatorId}`}
                          className="text-sm text-fg hover:text-primary"
                        >
                          {creatorMap.get(click.creatorId) ?? '—'}
                        </Link>
                      </TD>
                      <TD>
                        <div className="text-xs text-fg">
                          {click.country ? countryName(click.country) : 'Unknown'}
                        </div>
                        <div className="text-2xs text-fg-subtle">
                          {click.deviceType} · {click.browser}
                        </div>
                      </TD>
                      <TD>
                        <div className="max-w-[9rem] truncate text-xs text-fg-muted">
                          {click.referrerHost ?? 'Direct'}
                        </div>
                        {click.subId ? (
                          <div className="text-2xs text-fg-subtle">sub: {click.subId}</div>
                        ) : null}
                      </TD>
                      <TD align="right" numeric>
                        <Badge
                          tone={
                            click.fraudScore >= 76
                              ? 'danger'
                              : click.fraudScore >= 51
                                ? 'warning'
                                : click.fraudScore >= 21
                                  ? 'info'
                                  : 'success'
                          }
                        >
                          {click.fraudScore}
                        </Badge>
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            click.eligibility === 'ELIGIBLE'
                              ? click.billable
                                ? 'success'
                                : 'neutral'
                              : click.eligibility === 'REJECTED'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {humanize(click.eligibility)}
                        </Badge>
                        {click.fraudSignals.length > 0 ? (
                          <div className="mt-0.5 max-w-[12rem] truncate text-2xs text-fg-subtle">
                            {click.fraudSignals.join(', ')}
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
