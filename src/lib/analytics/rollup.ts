import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

/**
 * Hourly aggregation.
 *
 * Dashboards read `stat_hourly`, never the raw click partitions. At ten million
 * clicks a month a "clicks over the last 30 days" chart would otherwise scan
 * tens of millions of rows on every page load; against the rollup it reads a
 * few hundred.
 *
 * The aggregation is idempotent: re-running any hour recomputes it from source
 * rather than incrementing, so a retry after a partial failure self-heals.
 */

export async function rollupHour(bucket: Date): Promise<number> {
  const start = truncateToHour(bucket);
  const end = new Date(start.getTime() + 3_600_000);

  // One statement per source table, joined by (campaign, creator, hour). Doing
  // the aggregation in SQL keeps millions of rows out of the application.
  const result = await prisma.$executeRaw`
    INSERT INTO "stat_hourly" (
      id, bucket, "campaignId", "creatorId",
      clicks, "qualifiedClicks", "uniqueVisitors", impressions,
      conversions, "grossMicros", "netMicros", "feeMicros", "revenueMicros", "updatedAt"
    )
    SELECT
      gen_random_uuid(),
      ${start},
      COALESCE(c.campaign_id, i.campaign_id, v.campaign_id, e.campaign_id),
      COALESCE(c.creator_id, i.creator_id, v.creator_id, e.creator_id),
      COALESCE(c.clicks, 0),
      COALESCE(c.qualified, 0),
      COALESCE(c.uniques, 0),
      COALESCE(i.impressions, 0),
      COALESCE(v.conversions, 0),
      COALESCE(e.gross, 0),
      COALESCE(e.net, 0),
      COALESCE(e.fee, 0),
      COALESCE(v.revenue, 0),
      now()
    FROM (
      SELECT "campaignId" AS campaign_id, "creatorId" AS creator_id,
             COUNT(*)::int AS clicks,
             COUNT(*) FILTER (WHERE eligibility = 'ELIGIBLE')::int AS qualified,
             COUNT(DISTINCT "sessionFp")::int AS uniques
      FROM "clicks"
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY 1, 2
    ) c
    FULL OUTER JOIN (
      SELECT "campaignId" AS campaign_id, "creatorId" AS creator_id,
             COUNT(*)::int AS impressions
      FROM "impressions"
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY 1, 2
    ) i ON i.campaign_id = c.campaign_id AND i.creator_id = c.creator_id
    FULL OUTER JOIN (
      SELECT "campaignId" AS campaign_id, "creatorId" AS creator_id,
             COUNT(*)::int AS conversions,
             SUM("revenueMicros")::bigint AS revenue
      FROM "conversions"
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
        AND status <> 'REJECTED'
      GROUP BY 1, 2
    ) v ON v.campaign_id = COALESCE(c.campaign_id, i.campaign_id)
       AND v.creator_id = COALESCE(c.creator_id, i.creator_id)
    FULL OUTER JOIN (
      SELECT "campaignId" AS campaign_id, "creatorId" AS creator_id,
             SUM("grossMicros")::bigint AS gross,
             SUM("netMicros")::bigint AS net,
             SUM("feeMicros")::bigint AS fee
      FROM "earnings"
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
        AND status NOT IN ('REJECTED', 'REVERSED')
      GROUP BY 1, 2
    ) e ON e.campaign_id = COALESCE(c.campaign_id, i.campaign_id, v.campaign_id)
       AND e.creator_id = COALESCE(c.creator_id, i.creator_id, v.creator_id)
    -- A full outer join means any one source can be the only side present for
    -- an hour, so both keys are read through the same COALESCE chain above. The
    -- guard is belt and braces: all four sources have both columns NOT NULL.
    WHERE COALESCE(c.campaign_id, i.campaign_id, v.campaign_id, e.campaign_id) IS NOT NULL
      AND COALESCE(c.creator_id, i.creator_id, v.creator_id, e.creator_id) IS NOT NULL
    ON CONFLICT (bucket, "campaignId", "creatorId") DO UPDATE SET
      clicks = EXCLUDED.clicks,
      "qualifiedClicks" = EXCLUDED."qualifiedClicks",
      "uniqueVisitors" = EXCLUDED."uniqueVisitors",
      impressions = EXCLUDED.impressions,
      conversions = EXCLUDED.conversions,
      "grossMicros" = EXCLUDED."grossMicros",
      "netMicros" = EXCLUDED."netMicros",
      "feeMicros" = EXCLUDED."feeMicros",
      "revenueMicros" = EXCLUDED."revenueMicros",
      "updatedAt" = now()
  `;

  logger.debug('analytics.rollup_hour', { bucket: start.toISOString(), rows: result });
  return result;
}

/**
 * Roll up recent hours. The current hour is included and recomputed on each
 * run, which is what makes dashboards "near real-time" — data is at most one
 * worker cycle behind, and the UI always shows the rollup's own timestamp so
 * nothing is presented as more live than it is.
 */
export async function rollupRecent(hours = 3): Promise<number> {
  let total = 0;
  for (let i = 0; i < hours; i += 1) {
    const bucket = new Date(Date.now() - i * 3_600_000);
    total += await rollupHour(bucket);
  }
  return total;
}

/** Backfill a range — used after an outage or when adding a new metric. */
export async function backfill(from: Date, to: Date): Promise<number> {
  let total = 0;
  let cursor = truncateToHour(from);
  const end = truncateToHour(to);
  while (cursor <= end) {
    total += await rollupHour(cursor);
    cursor = new Date(cursor.getTime() + 3_600_000);
  }
  return total;
}

function truncateToHour(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** When the rollup last ran, so the UI can show data freshness honestly. */
export async function lastRollupAt(): Promise<Date | null> {
  const row = await prisma.statHourly.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  });
  return row?.updatedAt ?? null;
}
