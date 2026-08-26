import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { availableMicros } from '@/lib/billing/budget';

/**
 * Marketplace search.
 *
 * Full-text search over campaign name, description and offer summary using
 * Postgres `tsvector`, backed by the GIN index created in the
 * `20260826163000_integrity_partitions` migration. A dedicated search engine is
 * unnecessary at this cardinality — campaigns number in the thousands, not the
 * millions — and Postgres keeps search consistent with the transactional data.
 */

export type SortOption =
  | 'newest'
  | 'payout_high'
  | 'payout_low'
  | 'trending'
  | 'ending_soon'
  | 'budget_high';

export interface MarketplaceFilters {
  query?: string;
  categories?: string[];
  payoutModels?: string[];
  channels?: string[];
  country?: string;
  minPayoutMicros?: bigint;
  maxPayoutMicros?: bigint;
  /** Hide campaigns requiring approval. */
  openOnly?: boolean;
  /** Hide campaigns whose funded budget is exhausted. */
  fundedOnly?: boolean;
  sort?: SortOption;
  page?: number;
  perPage?: number;
}

export interface MarketplaceCampaign {
  id: string;
  slug: string;
  name: string;
  category: string;
  offerSummary: string;
  payoutModel: string;
  payoutMicros: bigint;
  revshareBps: number;
  requiresApproval: boolean;
  allowedCountries: string[];
  allowedChannels: string[];
  prohibitedChannels: string[];
  endsAt: Date | null;
  launchedAt: Date | null;
  createdAt: Date;
  attributionWindowHours: number;
  brandName: string;
  brandSlug: string;
  brandVerified: boolean;
  budgetRemainingMicros: bigint;
  budgetFundedMicros: bigint;
  budgetExhausted: boolean;
  /** Qualified clicks in the last 7 days — the "trending" signal. */
  recentClicks: number;
}

export interface MarketplaceResult {
  campaigns: MarketplaceCampaign[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

const DEFAULT_PER_PAGE = 24;
const MAX_PER_PAGE = 60;

export async function searchCampaigns(
  filters: MarketplaceFilters = {},
): Promise<MarketplaceResult> {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, filters.perPage ?? DEFAULT_PER_PAGE));
  const offset = (page - 1) * perPage;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`c.status = 'ACTIVE'`,
    Prisma.sql`c."isPublic" = true`,
    // Never surface a campaign whose window has closed.
    Prisma.sql`(c."endsAt" IS NULL OR c."endsAt" > now())`,
    Prisma.sql`(c."startsAt" IS NULL OR c."startsAt" <= now())`,
  ];

  if (filters.query && filters.query.trim() !== '') {
    const term = filters.query.trim();
    conditions.push(
      Prisma.sql`(
        to_tsvector('english',
          coalesce(c.name,'') || ' ' || coalesce(c.description,'') || ' ' ||
          coalesce(c."offerSummary",'') || ' ' || coalesce(c.category,'')
        ) @@ plainto_tsquery('english', ${term})
        OR c.name ILIKE ${'%' + term + '%'}
        OR b."displayName" ILIKE ${'%' + term + '%'}
      )`,
    );
  }

  if (filters.categories && filters.categories.length > 0) {
    conditions.push(Prisma.sql`c.category = ANY(${filters.categories})`);
  }

  if (filters.payoutModels && filters.payoutModels.length > 0) {
    conditions.push(
      Prisma.sql`c."payoutModel"::text = ANY(${filters.payoutModels})`,
    );
  }

  if (filters.channels && filters.channels.length > 0) {
    // A campaign matches when it allows the channel, or allows everything.
    conditions.push(
      Prisma.sql`(
        cardinality(c."allowedChannels") = 0
        OR c."allowedChannels"::text[] && ${filters.channels}
      ) AND NOT (c."prohibitedChannels"::text[] && ${filters.channels})`,
    );
  }

  if (filters.country) {
    conditions.push(
      Prisma.sql`(
        cardinality(c."allowedCountries") = 0
        OR ${filters.country} = ANY(c."allowedCountries")
      ) AND NOT (${filters.country} = ANY(c."blockedCountries"))`,
    );
  }

  if (filters.minPayoutMicros !== undefined) {
    conditions.push(Prisma.sql`c."payoutMicros" >= ${filters.minPayoutMicros}`);
  }
  if (filters.maxPayoutMicros !== undefined) {
    conditions.push(Prisma.sql`c."payoutMicros" <= ${filters.maxPayoutMicros}`);
  }
  if (filters.openOnly) {
    conditions.push(Prisma.sql`c."requiresApproval" = false`);
  }
  if (filters.fundedOnly !== false) {
    // Default: only show campaigns that can actually pay.
    conditions.push(
      Prisma.sql`(bd."fundedMicros" - bd."reservedMicros" - bd."spentMicros") > 0`,
    );
  }

  const where = Prisma.join(conditions, ' AND ');
  const orderBy = orderClause(filters.sort ?? 'newest');

  const rows = await prisma.$queryRaw<
    Array<Record<string, unknown> & { total_count: bigint }>
  >(Prisma.sql`
    SELECT
      c.id, c.slug, c.name, c.category, c."offerSummary",
      c."payoutModel"::text AS payout_model, c."payoutMicros", c."revshareBps",
      c."requiresApproval", c."allowedCountries", c."allowedChannels"::text[] AS allowed_channels,
      c."prohibitedChannels"::text[] AS prohibited_channels,
      c."endsAt", c."launchedAt", c."createdAt", c."attributionWindowHours",
      b."displayName" AS brand_name, b.slug AS brand_slug,
      (b.verification = 'VERIFIED') AS brand_verified,
      bd."fundedMicros", bd."reservedMicros", bd."spentMicros",
      COALESCE(t.recent_clicks, 0)::int AS recent_clicks,
      COUNT(*) OVER ()::bigint AS total_count
    FROM "campaigns" c
    JOIN "brands" b ON b.id = c."brandId"
    JOIN "campaign_budgets" bd ON bd."campaignId" = c.id
    LEFT JOIN (
      SELECT "campaignId", SUM("qualifiedClicks")::int AS recent_clicks
      FROM "stat_hourly"
      WHERE bucket >= now() - interval '7 days'
      GROUP BY "campaignId"
    ) t ON t."campaignId" = c.id
    WHERE ${where}
    ${orderBy}
    LIMIT ${perPage} OFFSET ${offset}
  `);

  const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;

  return {
    campaigns: rows.map(toCampaign),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

function orderClause(sort: SortOption): Prisma.Sql {
  switch (sort) {
    case 'payout_high':
      // Revenue-share campaigns have no flat payout, so they sort by share.
      return Prisma.sql`ORDER BY c."payoutMicros" DESC, c."revshareBps" DESC, c."launchedAt" DESC`;
    case 'payout_low':
      return Prisma.sql`ORDER BY c."payoutMicros" ASC, c."launchedAt" DESC`;
    case 'trending':
      return Prisma.sql`ORDER BY COALESCE(t.recent_clicks, 0) DESC, c."launchedAt" DESC`;
    case 'ending_soon':
      // Campaigns with no end date sort last rather than being excluded.
      return Prisma.sql`ORDER BY c."endsAt" ASC NULLS LAST, c."launchedAt" DESC`;
    case 'budget_high':
      return Prisma.sql`ORDER BY (bd."fundedMicros" - bd."reservedMicros" - bd."spentMicros") DESC`;
    case 'newest':
    default:
      return Prisma.sql`ORDER BY c."launchedAt" DESC NULLS LAST, c."createdAt" DESC`;
  }
}

function toCampaign(row: Record<string, unknown>): MarketplaceCampaign {
  const funded = BigInt((row.fundedMicros as bigint | null) ?? 0);
  const reserved = BigInt((row.reservedMicros as bigint | null) ?? 0);
  const spent = BigInt((row.spentMicros as bigint | null) ?? 0);
  const remaining = availableMicros({
    fundedMicros: funded,
    reservedMicros: reserved,
    spentMicros: spent,
  });

  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    category: String(row.category),
    offerSummary: String(row.offerSummary),
    payoutModel: String(row.payout_model),
    payoutMicros: BigInt((row.payoutMicros as bigint | null) ?? 0),
    revshareBps: Number(row.revshareBps ?? 0),
    requiresApproval: Boolean(row.requiresApproval),
    allowedCountries: (row.allowedCountries as string[]) ?? [],
    allowedChannels: (row.allowed_channels as string[]) ?? [],
    prohibitedChannels: (row.prohibited_channels as string[]) ?? [],
    endsAt: (row.endsAt as Date | null) ?? null,
    launchedAt: (row.launchedAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
    attributionWindowHours: Number(row.attributionWindowHours ?? 720),
    brandName: String(row.brand_name),
    brandSlug: String(row.brand_slug),
    brandVerified: Boolean(row.brand_verified),
    budgetRemainingMicros: remaining,
    budgetFundedMicros: funded,
    budgetExhausted: remaining <= 0n,
    recentClicks: Number(row.recent_clicks ?? 0),
  };
}

/** Distinct categories with live campaigns, for the filter sidebar. */
export async function marketplaceFacets(): Promise<{
  categories: Array<{ value: string; count: number }>;
  payoutModels: Array<{ value: string; count: number }>;
}> {
  const [categories, models] = await Promise.all([
    prisma.$queryRaw<Array<{ value: string; count: bigint }>>`
      SELECT category AS value, COUNT(*)::bigint AS count
      FROM "campaigns"
      WHERE status = 'ACTIVE' AND "isPublic" = true
      GROUP BY category
      ORDER BY count DESC, value ASC
      LIMIT 30
    `,
    prisma.$queryRaw<Array<{ value: string; count: bigint }>>`
      SELECT "payoutModel"::text AS value, COUNT(*)::bigint AS count
      FROM "campaigns"
      WHERE status = 'ACTIVE' AND "isPublic" = true
      GROUP BY "payoutModel"
      ORDER BY count DESC
    `,
  ]);

  return {
    categories: categories.map((c) => ({ value: c.value, count: Number(c.count) })),
    payoutModels: models.map((m) => ({ value: m.value, count: Number(m.count) })),
  };
}

/** Full campaign detail for the public campaign page. */
export async function campaignBySlug(slug: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    include: {
      brand: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          website: true,
          category: true,
          verification: true,
          logoUrl: true,
          description: true,
          createdAt: true,
        },
      },
      rules: { orderBy: { createdAt: 'asc' } },
      creatives: { orderBy: { createdAt: 'asc' } },
      budget: true,
    },
  });

  if (!campaign) return null;

  const stats = await prisma.statHourly.aggregate({
    where: { campaignId: campaign.id, bucket: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    _sum: { qualifiedClicks: true, conversions: true },
  });

  const publishers = await prisma.trackingLink.groupBy({
    by: ['creatorId'],
    where: { campaignId: campaign.id },
    _count: true,
  });

  return {
    ...campaign,
    stats: {
      qualifiedClicks30d: stats._sum.qualifiedClicks ?? 0,
      conversions30d: stats._sum.conversions ?? 0,
      activePublishers: publishers.length,
    },
  };
}

export type CampaignDetail = NonNullable<Awaited<ReturnType<typeof campaignBySlug>>>;
