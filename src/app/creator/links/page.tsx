import Link from 'next/link';
import type { Metadata } from 'next';

import { LinkRowActions } from '@/components/creator/link-actions';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageCreator } from '@/lib/auth/guards';
import { trackingLinkUrl } from '@/lib/brand';
import { prisma } from '@/lib/db';
import { describePayout, formatNumber, formatRelative, humanize } from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'My links' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

export default async function CreatorLinksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { creator } = await pageCreator();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const showInactive = params.status === 'inactive';
  const csrfToken = await currentCsrfToken();

  const where = { creatorId: creator.id, ...(showInactive ? {} : { active: true }) };

  const [links, total] = await Promise.all([
    prisma.trackingLink.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        campaign: {
          select: {
            name: true,
            slug: true,
            status: true,
            payoutModel: true,
            payoutMicros: true,
            revshareBps: true,
          },
        },
      },
    }),
    prisma.trackingLink.count({ where }),
  ]);

  // Per-link performance comes from the raw click table because sub-ID level
  // detail is not carried in the hourly rollup.
  const stats = await linkStats(links.map((link) => link.id));

  return (
    <>
      <PageHeader
        title="My links"
        description="Every tracking link you have generated. Add a sub-ID to tell placements apart."
        action={<ButtonLink href="/campaigns">Get another link</ButtonLink>}
      />

      <div className="mb-4 flex gap-2">
        <FilterTab href="/creator/links" active={!showInactive} label="Active" />
        <FilterTab href="/creator/links?status=inactive" active={showInactive} label="All links" />
      </div>

      {links.length === 0 ? (
        <EmptyState
          title={showInactive ? 'No links yet' : 'No active links'}
          description="Find a campaign that fits your audience and generate a link — it takes about ten seconds."
          action={<ButtonLink href="/campaigns">Browse campaigns</ButtonLink>}
        />
      ) : (
        <>
          <Card padded={false}>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Campaign</TH>
                    <TH>Link</TH>
                    <TH align="right">Clicks</TH>
                    <TH align="right">Conv.</TH>
                    <TH align="right">Earned</TH>
                    <TH align="right">EPC</TH>
                    <TH align="right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {links.map((link) => {
                    const stat = stats.get(link.id) ?? {
                      clicks: 0,
                      qualified: 0,
                      conversions: 0,
                      netMicros: 0n,
                    };
                    const epc =
                      stat.clicks > 0 ? stat.netMicros / BigInt(stat.clicks) : 0n;

                    return (
                      <TR key={link.id}>
                        <TD>
                          <Link
                            href={`/campaigns/${link.campaign.slug}`}
                            className="font-medium text-fg hover:text-primary"
                          >
                            {link.campaign.name}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-fg-subtle">
                              {describePayout(link.campaign)}
                            </span>
                            {link.campaign.status !== 'ACTIVE' ? (
                              <Badge tone="warning">{humanize(link.campaign.status)}</Badge>
                            ) : null}
                            {!link.active ? <Badge tone="neutral">Inactive</Badge> : null}
                          </div>
                        </TD>

                        <TD>
                          <code className="font-mono text-xs text-fg-muted">
                            /go/{link.code}
                          </code>
                          <div className="mt-0.5 flex flex-wrap gap-1.5">
                            {link.subId ? (
                              <Badge tone="primary">sub: {link.subId}</Badge>
                            ) : null}
                            {link.label ? (
                              <span className="text-xs text-fg-subtle">{link.label}</span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-2xs text-fg-subtle">
                            Created {formatRelative(link.createdAt)}
                          </div>
                        </TD>

                        <TD align="right" numeric>
                          <div>{formatNumber(stat.clicks)}</div>
                          {stat.clicks !== stat.qualified ? (
                            <div className="text-2xs text-fg-subtle">
                              {formatNumber(stat.qualified)} qualified
                            </div>
                          ) : null}
                        </TD>
                        <TD align="right" numeric>
                          {formatNumber(stat.conversions)}
                        </TD>
                        <TD align="right" numeric className="font-medium">
                          {formatMicros(stat.netMicros)}
                        </TD>
                        <TD align="right" numeric className="text-fg-muted">
                          {formatMicros(epc)}
                        </TD>
                        <TD align="right">
                          <LinkRowActions
                            linkId={link.id}
                            url={trackingLinkUrl(link.code)}
                            active={link.active}
                            csrfToken={csrfToken}
                          />
                        </TD>
                      </TR>
                    );
                  })}
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

function FilterTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-md bg-primary-soft px-3 py-1.5 text-sm font-medium text-primary'
          : 'rounded-md px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg'
      }
    >
      {label}
    </Link>
  );
}

async function linkStats(linkIds: string[]) {
  if (linkIds.length === 0) return new Map<string, LinkStat>();

  const rows = await prisma.$queryRaw<
    Array<{ link_id: string; clicks: bigint; qualified: bigint }>
  >`
    SELECT "linkId" AS link_id,
           COUNT(*)::bigint AS clicks,
           COUNT(*) FILTER (WHERE eligibility IN ('ELIGIBLE', 'REVIEW'))::bigint AS qualified
    FROM "clicks"
    WHERE "linkId" = ANY(${linkIds}::uuid[])
    GROUP BY 1
  `;

  const conversions = await prisma.$queryRaw<
    Array<{ link_id: string; conversions: bigint }>
  >`
    SELECT "linkId" AS link_id, COUNT(*)::bigint AS conversions
    FROM "conversions"
    WHERE "linkId" = ANY(${linkIds}::uuid[]) AND status <> 'REJECTED'
    GROUP BY 1
  `;

  const earnings = await prisma.$queryRaw<Array<{ link_id: string; net: bigint }>>`
    SELECT c."linkId" AS link_id, COALESCE(SUM(e."netMicros"), 0)::bigint AS net
    FROM "earnings" e
    JOIN "clicks" c ON c.id = e."clickId"
    WHERE c."linkId" = ANY(${linkIds}::uuid[])
      AND e.status NOT IN ('REJECTED', 'REVERSED')
    GROUP BY 1
  `;

  const map = new Map<string, LinkStat>();
  for (const row of rows) {
    map.set(row.link_id, {
      clicks: Number(row.clicks),
      qualified: Number(row.qualified),
      conversions: 0,
      netMicros: 0n,
    });
  }
  for (const row of conversions) {
    const entry = map.get(row.link_id) ?? { clicks: 0, qualified: 0, conversions: 0, netMicros: 0n };
    entry.conversions = Number(row.conversions);
    map.set(row.link_id, entry);
  }
  for (const row of earnings) {
    const entry = map.get(row.link_id) ?? { clicks: 0, qualified: 0, conversions: 0, netMicros: 0n };
    entry.netMicros = row.net;
    map.set(row.link_id, entry);
  }
  return map;
}

interface LinkStat {
  clicks: number;
  qualified: number;
  conversions: number;
  netMicros: bigint;
}
