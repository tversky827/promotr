import Link from 'next/link';

import { LinkRowActions } from '@/components/creator/link-actions';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { trackingLinkUrl } from '@/lib/brand';
import { prisma } from '@/lib/db';
import { describePayout, formatNumber, formatRelative, humanize } from '@/lib/format';
import { formatMicros, formatUnitPrice } from '@/lib/money';

/**
 * A publisher's tracking links, with what each one has earned.
 *
 * This is the table a publisher actually comes back for — it is where they copy
 * a link from — so it lives on the overview rather than behind another menu
 * entry of its own.
 */
export async function LinksTable({
  creatorId,
  csrfToken,
  limit = 10,
}: {
  creatorId: string;
  csrfToken: string;
  limit?: number;
}) {
  const links = await prisma.trackingLink.findMany({
    where: { creatorId, active: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
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
  });

  const total = await prisma.trackingLink.count({ where: { creatorId, active: true } });
  const stats = await linkStats(links.map((link) => link.id));

  if (links.length === 0) {
    return (
      <Card>
        <CardHeader title="Your links" />
        <div className="mt-4">
          <EmptyState
            title="No links yet"
            description="Pick a campaign from Browse and take a link — it takes about ten seconds."
          />
        </div>
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <div className="p-5">
        <CardHeader
          title="Your links"
          description={
            total > links.length
              ? `Your ${links.length} most recent of ${total} active links`
              : undefined
          }
        />
      </div>

      <TableWrap className="border-t border-border">
        <Table>
          <THead>
            <TR>
              <TH>Campaign</TH>
              <TH>Link</TH>
              <TH align="right">Clicks</TH>
              <TH align="right">Conv.</TH>
              <TH align="right">Earned</TH>
              <TH align="right">EPC</TH>
              <TH align="right">Copy</TH>
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
              const epc = stat.clicks > 0 ? stat.netMicros / BigInt(stat.clicks) : 0n;

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
                    </div>
                  </TD>

                  <TD>
                    <code className="font-mono text-xs text-fg-muted">/go/{link.code}</code>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">
                      {link.subId ? <Badge tone="primary">sub: {link.subId}</Badge> : null}
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
                    {formatUnitPrice(epc)}
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

  // An earning reaches a link by two routes: through the click that produced it
  // (cost per click), or through the conversion it paid for (everything else).
  // Only the click route was counted here, so every campaign that pays on
  // conversion showed a publisher zero earned against a link that had earned
  // them money. The second branch skips rows the first already counted, and it
  // also covers an earning whose click has aged out of the retention window.
  const earnings = await prisma.$queryRaw<Array<{ link_id: string; net: bigint }>>`
    SELECT link_id, COALESCE(SUM(net), 0)::bigint AS net
    FROM (
      SELECT c."linkId" AS link_id, e."netMicros" AS net
      FROM "earnings" e
      JOIN "clicks" c ON c.id = e."clickId"
      WHERE c."linkId" = ANY(${linkIds}::uuid[])
        AND e.status NOT IN ('REJECTED', 'REVERSED')

      UNION ALL

      SELECT v."linkId" AS link_id, e."netMicros" AS net
      FROM "earnings" e
      JOIN "conversions" v ON v.id = e."conversionId"
      WHERE v."linkId" = ANY(${linkIds}::uuid[])
        AND e."clickId" IS NULL
        AND e.status NOT IN ('REJECTED', 'REVERSED')
    ) attributed
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
