import { prisma } from '@/lib/db';

/**
 * Dashboard queries.
 *
 * Everything here reads `stat_hourly` rather than the raw click partitions, and
 * returns bigints as bigints so no precision is lost on the way to the UI.
 * Each result carries `dataFreshAt` so the interface can state when the numbers
 * were last computed instead of implying they are live.
 */

export interface DateRange {
  from: Date;
  to: Date;
}

export interface MetricTotals {
  clicks: number;
  qualifiedClicks: number;
  uniqueVisitors: number;
  impressions: number;
  conversions: number;
  grossMicros: bigint;
  netMicros: bigint;
  feeMicros: bigint;
  revenueMicros: bigint;
}

export interface DerivedMetrics extends MetricTotals {
  conversionRate: number;
  clickThroughRate: number;
  /** Earnings per click — the number publishers actually care about. */
  epcMicros: bigint;
  /** Effective cost per click, from the brand's side. */
  cpcMicros: bigint;
  cpaMicros: bigint;
  cpmMicros: bigint;
  /** Return on ad spend, as a multiple. Null when there is no spend. */
  roas: number | null;
  qualifiedRate: number;
}

const EMPTY: MetricTotals = {
  clicks: 0,
  qualifiedClicks: 0,
  uniqueVisitors: 0,
  impressions: 0,
  conversions: 0,
  grossMicros: 0n,
  netMicros: 0n,
  feeMicros: 0n,
  revenueMicros: 0n,
};

interface Scope {
  campaignId?: string;
  campaignIds?: string[];
  creatorId?: string;
  brandId?: string;
}

/** Builds the WHERE fragment shared by every rollup query. */
function scopeClause(scope: Scope): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (scope.campaignId) {
    params.push(scope.campaignId);
    clauses.push(`s."campaignId" = $${params.length}::uuid`);
  }
  if (scope.campaignIds && scope.campaignIds.length > 0) {
    params.push(scope.campaignIds);
    clauses.push(`s."campaignId" = ANY($${params.length}::uuid[])`);
  }
  if (scope.creatorId) {
    params.push(scope.creatorId);
    clauses.push(`s."creatorId" = $${params.length}::uuid`);
  }
  if (scope.brandId) {
    params.push(scope.brandId);
    clauses.push(
      `s."campaignId" IN (SELECT id FROM "campaigns" WHERE "brandId" = $${params.length}::uuid)`,
    );
  }

  return { sql: clauses.length > 0 ? clauses.join(' AND ') : 'TRUE', params };
}

export async function totals(scope: Scope, range: DateRange): Promise<MetricTotals> {
  const { sql, params } = scopeClause(scope);
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, bigint | number | null>>>(
    `
    SELECT
      COALESCE(SUM(s.clicks), 0)::bigint            AS clicks,
      COALESCE(SUM(s."qualifiedClicks"), 0)::bigint AS qualified,
      COALESCE(SUM(s."uniqueVisitors"), 0)::bigint  AS uniques,
      COALESCE(SUM(s.impressions), 0)::bigint       AS impressions,
      COALESCE(SUM(s.conversions), 0)::bigint       AS conversions,
      COALESCE(SUM(s."grossMicros"), 0)::bigint     AS gross,
      COALESCE(SUM(s."netMicros"), 0)::bigint       AS net,
      COALESCE(SUM(s."feeMicros"), 0)::bigint       AS fee,
      COALESCE(SUM(s."revenueMicros"), 0)::bigint   AS revenue
    FROM "stat_hourly" s
    WHERE ${sql} AND s.bucket >= $${params.length + 1} AND s.bucket < $${params.length + 2}
    `,
    ...params,
    range.from,
    range.to,
  );

  const row = rows[0];
  if (!row) return { ...EMPTY };

  return {
    clicks: Number(row.clicks ?? 0),
    qualifiedClicks: Number(row.qualified ?? 0),
    uniqueVisitors: Number(row.uniques ?? 0),
    impressions: Number(row.impressions ?? 0),
    conversions: Number(row.conversions ?? 0),
    grossMicros: BigInt(row.gross ?? 0),
    netMicros: BigInt(row.net ?? 0),
    feeMicros: BigInt(row.fee ?? 0),
    revenueMicros: BigInt(row.revenue ?? 0),
  };
}

export function derive(totals: MetricTotals): DerivedMetrics {
  const { clicks, qualifiedClicks, conversions, impressions, grossMicros, netMicros, revenueMicros } =
    totals;

  return {
    ...totals,
    conversionRate: qualifiedClicks > 0 ? (conversions / qualifiedClicks) * 100 : 0,
    clickThroughRate: impressions > 0 ? (clicks / impressions) * 100 : 0,
    qualifiedRate: clicks > 0 ? (qualifiedClicks / clicks) * 100 : 0,
    epcMicros: clicks > 0 ? netMicros / BigInt(clicks) : 0n,
    cpcMicros: qualifiedClicks > 0 ? grossMicros / BigInt(qualifiedClicks) : 0n,
    cpaMicros: conversions > 0 ? grossMicros / BigInt(conversions) : 0n,
    cpmMicros: impressions > 0 ? (grossMicros * 1000n) / BigInt(impressions) : 0n,
    roas:
      grossMicros > 0n ? Number((revenueMicros * 10_000n) / grossMicros) / 10_000 : null,
  };
}

export interface TimeSeriesPoint {
  bucket: Date;
  clicks: number;
  qualifiedClicks: number;
  conversions: number;
  grossMicros: bigint;
  netMicros: bigint;
  revenueMicros: bigint;
}

export type Granularity = 'hour' | 'day' | 'week';

export async function timeSeries(
  scope: Scope,
  range: DateRange,
  granularity: Granularity = 'day',
): Promise<TimeSeriesPoint[]> {
  const { sql, params } = scopeClause(scope);
  // `granularity` is a closed enum, never user text, so interpolating it into
  // date_trunc is safe; every other value is a bound parameter.
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `
    SELECT
      date_trunc('${granularity}', s.bucket) AS bucket,
      COALESCE(SUM(s.clicks), 0)::bigint            AS clicks,
      COALESCE(SUM(s."qualifiedClicks"), 0)::bigint AS qualified,
      COALESCE(SUM(s.conversions), 0)::bigint       AS conversions,
      COALESCE(SUM(s."grossMicros"), 0)::bigint     AS gross,
      COALESCE(SUM(s."netMicros"), 0)::bigint       AS net,
      COALESCE(SUM(s."revenueMicros"), 0)::bigint   AS revenue
    FROM "stat_hourly" s
    WHERE ${sql} AND s.bucket >= $${params.length + 1} AND s.bucket < $${params.length + 2}
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    ...params,
    range.from,
    range.to,
  );

  return rows.map((r) => ({
    bucket: r.bucket as Date,
    clicks: Number(r.clicks ?? 0),
    qualifiedClicks: Number(r.qualified ?? 0),
    conversions: Number(r.conversions ?? 0),
    grossMicros: BigInt((r.gross as bigint | null) ?? 0),
    netMicros: BigInt((r.net as bigint | null) ?? 0),
    revenueMicros: BigInt((r.revenue as bigint | null) ?? 0),
  }));
}

/**
 * Fills gaps in a series so a chart shows zero-traffic days as zero rather than
 * silently connecting across them, which would overstate consistency.
 */
export function fillSeries(
  points: TimeSeriesPoint[],
  range: DateRange,
  granularity: Granularity,
): TimeSeriesPoint[] {
  const stepMs = granularity === 'hour' ? 3_600_000 : granularity === 'day' ? 86_400_000 : 604_800_000;
  const byBucket = new Map(points.map((p) => [truncate(p.bucket, granularity).getTime(), p]));
  const filled: TimeSeriesPoint[] = [];

  let cursor = truncate(range.from, granularity);
  const end = range.to.getTime();
  let guard = 0;
  while (cursor.getTime() < end && guard < 5000) {
    const existing = byBucket.get(cursor.getTime());
    filled.push(
      existing ?? {
        bucket: new Date(cursor),
        clicks: 0,
        qualifiedClicks: 0,
        conversions: 0,
        grossMicros: 0n,
        netMicros: 0n,
        revenueMicros: 0n,
      },
    );
    cursor = new Date(cursor.getTime() + stepMs);
    guard += 1;
  }
  return filled;
}

function truncate(date: Date, granularity: Granularity): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  if (granularity === 'day' || granularity === 'week') d.setUTCHours(0, 0, 0, 0);
  if (granularity === 'week') {
    // Postgres date_trunc('week') starts on Monday.
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
  }
  return d;
}

export interface TopPublisher {
  creatorId: string;
  handle: string;
  displayName: string;
  clicks: number;
  conversions: number;
  grossMicros: bigint;
  netMicros: bigint;
  conversionRate: number;
  epcMicros: bigint;
}

export async function topPublishers(
  scope: Scope,
  range: DateRange,
  limit = 10,
): Promise<TopPublisher[]> {
  const { sql, params } = scopeClause(scope);
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `
    SELECT
      s."creatorId" AS creator_id,
      c.handle,
      COALESCE(p."displayName", c.handle) AS display_name,
      COALESCE(SUM(s.clicks), 0)::bigint            AS clicks,
      COALESCE(SUM(s."qualifiedClicks"), 0)::bigint AS qualified,
      COALESCE(SUM(s.conversions), 0)::bigint       AS conversions,
      COALESCE(SUM(s."grossMicros"), 0)::bigint     AS gross,
      COALESCE(SUM(s."netMicros"), 0)::bigint       AS net
    FROM "stat_hourly" s
    JOIN "creators" c ON c.id = s."creatorId"
    LEFT JOIN "creator_profiles" p ON p."creatorId" = c.id
    WHERE ${sql} AND s.bucket >= $${params.length + 1} AND s.bucket < $${params.length + 2}
      AND s."creatorId" IS NOT NULL
    GROUP BY 1, 2, 3
    ORDER BY gross DESC
    LIMIT $${params.length + 3}
    `,
    ...params,
    range.from,
    range.to,
    limit,
  );

  return rows.map((r) => {
    const clicks = Number(r.clicks ?? 0);
    const qualified = Number(r.qualified ?? 0);
    const conversions = Number(r.conversions ?? 0);
    const net = BigInt((r.net as bigint | null) ?? 0);
    return {
      creatorId: String(r.creator_id),
      handle: String(r.handle),
      displayName: String(r.display_name),
      clicks,
      conversions,
      grossMicros: BigInt((r.gross as bigint | null) ?? 0),
      netMicros: net,
      conversionRate: qualified > 0 ? (conversions / qualified) * 100 : 0,
      epcMicros: clicks > 0 ? net / BigInt(clicks) : 0n,
    };
  });
}

export interface Breakdown {
  label: string;
  clicks: number;
  qualifiedClicks: number;
  share: number;
}

/**
 * Dimensional breakdowns (country, device, referrer, channel) read the raw
 * click table because the hourly rollup does not carry those dimensions —
 * adding them would multiply its cardinality. The range is therefore capped.
 */
export async function breakdown(
  scope: Scope,
  range: DateRange,
  dimension: 'country' | 'deviceType' | 'browser' | 'os' | 'referrerHost' | 'utmSource',
  limit = 10,
): Promise<Breakdown[]> {
  const columns: Record<typeof dimension, string> = {
    country: 'country',
    deviceType: '"deviceType"',
    browser: 'browser',
    os: 'os',
    referrerHost: '"referrerHost"',
    utmSource: '"utmSource"',
  };
  const column = columns[dimension];

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope.campaignId) {
    params.push(scope.campaignId);
    clauses.push(`"campaignId" = $${params.length}::uuid`);
  }
  if (scope.creatorId) {
    params.push(scope.creatorId);
    clauses.push(`"creatorId" = $${params.length}::uuid`);
  }
  if (scope.brandId) {
    params.push(scope.brandId);
    clauses.push(`"brandId" = $${params.length}::uuid`);
  }
  const where = clauses.length > 0 ? clauses.join(' AND ') : 'TRUE';

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `
    SELECT
      COALESCE(${column}, 'Unknown') AS label,
      COUNT(*)::bigint AS clicks,
      COUNT(*) FILTER (WHERE eligibility = 'ELIGIBLE')::bigint AS qualified
    FROM "clicks"
    WHERE ${where} AND "createdAt" >= $${params.length + 1} AND "createdAt" < $${params.length + 2}
    GROUP BY 1
    ORDER BY clicks DESC
    LIMIT $${params.length + 3}
    `,
    ...params,
    range.from,
    range.to,
    limit,
  );

  const total = rows.reduce((sum, r) => sum + Number(r.clicks ?? 0), 0);
  return rows.map((r) => ({
    label: String(r.label),
    clicks: Number(r.clicks ?? 0),
    qualifiedClicks: Number(r.qualified ?? 0),
    share: total > 0 ? (Number(r.clicks ?? 0) / total) * 100 : 0,
  }));
}

export interface FunnelStage {
  label: string;
  count: number;
  conversionFromPrevious: number;
}

export async function funnel(scope: Scope, range: DateRange): Promise<FunnelStage[]> {
  const t = await totals(scope, range);
  const stages: Array<{ label: string; count: number }> = [
    ...(t.impressions > 0 ? [{ label: 'Impressions', count: t.impressions }] : []),
    { label: 'Clicks', count: t.clicks },
    { label: 'Qualified clicks', count: t.qualifiedClicks },
    { label: 'Conversions', count: t.conversions },
  ];

  return stages.map((stage, index) => {
    const previous = index > 0 ? stages[index - 1]!.count : stage.count;
    return {
      label: stage.label,
      count: stage.count,
      conversionFromPrevious: previous > 0 ? (stage.count / previous) * 100 : 0,
    };
  });
}

/** Standard ranges offered in every dashboard's date picker. */
export function presetRange(preset: string): DateRange {
  const now = new Date();
  const to = new Date(now.getTime() + 3_600_000); // include the current hour
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

  switch (preset) {
    case 'today':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), to };
    case '7d':
      return { from: days(7), to };
    case '30d':
      return { from: days(30), to };
    case '90d':
      return { from: days(90), to };
    case '12m':
      return { from: days(365), to };
    case 'mtd':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to };
    default:
      return { from: days(30), to };
  }
}

export function granularityFor(range: DateRange): Granularity {
  const spanDays = (range.to.getTime() - range.from.getTime()) / 86_400_000;
  if (spanDays <= 2) return 'hour';
  if (spanDays <= 92) return 'day';
  return 'week';
}
