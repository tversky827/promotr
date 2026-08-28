import Link from 'next/link';
import type { Metadata } from 'next';

import { ButtonLink } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { pageBrand } from '@/lib/auth/guards';
import { availableMicros } from '@/lib/billing/budget';
import { prisma } from '@/lib/db';
import {
  describePayout,
  formatCompact,
  formatDate,
  formatNumber,
  humanize,
  statusTone,
} from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'Campaigns' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

export default async function BrandCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { brand } = await pageBrand();
  const { status, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? '1') || 1);

  const where = { brandId: brand.id, ...(status ? { status: status as never } : {}) };

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { budget: true, _count: { select: { links: true, conversions: true } } },
    }),
    prisma.campaign.count({ where }),
  ]);

  const counts = await prisma.campaign.groupBy({
    by: ['status'],
    where: { brandId: brand.id },
    _count: true,
  });
  const countMap = new Map(counts.map((row) => [row.status, row._count]));

  /*
   * Lifetime performance per campaign, from the rollups rather than the raw
   * partitions. Read in one query for the whole page: a per-row lookup would
   * be twenty-five round trips to render one table.
   */
  const performance = await campaignPerformance(campaigns.map((campaign) => campaign.id));

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
                  <TH align="right">Creators</TH>
                  <TH align="right">Impressions</TH>
                  <TH align="right">Clicks</TH>
                  <TH align="right">Conversions</TH>
                  <TH align="right">Spend</TH>
                  <TH align="right">Revenue</TH>
                  <TH align="right">ROAS</TH>
                </TR>
              </THead>
              <TBody>
                {campaigns.map((campaign) => {
                  const remaining = campaign.budget ? availableMicros(campaign.budget) : 0n;
                  const stats = performance.get(campaign.id) ?? EMPTY_PERFORMANCE;
                  const roas =
                    stats.grossMicros > 0n
                      ? Number((stats.revenueMicros * 10_000n) / stats.grossMicros) / 10_000
                      : null;
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
                        {stats.impressions > 0 ? formatCompact(stats.impressions) : '—'}
                      </TD>
                      <TD align="right" numeric>
                        {formatCompact(stats.clicks)}
                      </TD>
                      <TD align="right" numeric>
                        {formatNumber(stats.conversions)}
                      </TD>
                      <TD align="right" numeric>
                        {formatMicros(stats.grossMicros, { showSubCent: false })}
                        <div className="text-2xs text-fg-subtle">
                          {formatMicros(remaining, { showSubCent: false })} left
                        </div>
                      </TD>
                      <TD align="right" numeric>
                        {stats.revenueMicros > 0n
                          ? formatMicros(stats.revenueMicros, { showSubCent: false })
                          : '—'}
                      </TD>
                      <TD align="right" numeric>
                        {roas !== null ? (
                          <span className={roas >= 1 ? 'font-medium text-primary' : 'text-fg'}>
                            {roas.toFixed(2)}×
                          </span>
                        ) : (
                          '—'
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {total > PER_PAGE ? (
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
          total={total}
          perPage={PER_PAGE}
          className="mt-6"
        />
      ) : null}
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

interface CampaignPerformance {
  impressions: number;
  clicks: number;
  conversions: number;
  grossMicros: bigint;
  revenueMicros: bigint;
}

const EMPTY_PERFORMANCE: CampaignPerformance = {
  impressions: 0,
  clicks: 0,
  conversions: 0,
  grossMicros: 0n,
  revenueMicros: 0n,
};

async function campaignPerformance(ids: string[]): Promise<Map<string, CampaignPerformance>> {
  if (ids.length === 0) return new Map();

  const rows = await prisma.$queryRaw<
    Array<{
      campaignId: string;
      impressions: bigint;
      clicks: bigint;
      conversions: bigint;
      gross: bigint;
      revenue: bigint;
    }>
  >`
    SELECT
      "campaignId",
      COALESCE(SUM(impressions), 0)::bigint     AS impressions,
      COALESCE(SUM(clicks), 0)::bigint          AS clicks,
      COALESCE(SUM(conversions), 0)::bigint     AS conversions,
      COALESCE(SUM("grossMicros"), 0)::bigint   AS gross,
      COALESCE(SUM("revenueMicros"), 0)::bigint AS revenue
    FROM "stat_hourly"
    WHERE "campaignId" = ANY(${ids}::uuid[])
    GROUP BY "campaignId"
  `;

  return new Map(
    rows.map((row) => [
      row.campaignId,
      {
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        conversions: Number(row.conversions),
        grossMicros: BigInt(row.gross),
        revenueMicros: BigInt(row.revenue),
      },
    ]),
  );
}
