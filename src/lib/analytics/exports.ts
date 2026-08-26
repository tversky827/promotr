import { prisma } from '@/lib/db';
import { toCsvRow } from '@/lib/csv';
import { logger } from '@/lib/observability/logger';
import { microsToDecimalString } from '@/lib/money';
import { putObject, presignGetUrl, storageConfigured, storageKey } from '@/lib/storage/s3';
import { notify } from '@/lib/notify';

/**
 * Asynchronous CSV exports.
 *
 * Large exports run in the background because a brand pulling ninety days of
 * click data would otherwise hold an HTTP connection open for minutes and risk
 * a gateway timeout. Rows are streamed from the database in batches so memory
 * stays flat regardless of export size.
 *
 * With object storage configured the result is uploaded and a time-limited
 * presigned link is issued. Without it, the export still completes and is
 * served directly from the app — smaller, but functional rather than broken.
 */

const BATCH_SIZE = 5000;
/** Guard rail: an export beyond this is almost certainly a mis-set filter. */
const MAX_ROWS = 1_000_000;

export type ExportKind =
  | 'clicks'
  | 'conversions'
  | 'earnings'
  | 'creators'
  | 'spend'
  | 'payouts';

export interface ExportFilters {
  from?: string;
  to?: string;
  campaignId?: string;
  creatorId?: string;
  brandId?: string;
  status?: string;
}

export async function requestExport(params: {
  userId: string;
  kind: ExportKind;
  scopeKind: 'brand' | 'creator' | 'admin';
  scopeId?: string;
  filters: ExportFilters;
}): Promise<{ exportJobId: string }> {
  const job = await prisma.exportJob.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      scopeKind: params.scopeKind,
      scopeId: params.scopeId ?? null,
      filters: params.filters as never,
      status: 'queued',
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });

  const { enqueue } = await import('@/lib/jobs/queue');
  await enqueue(
    'export.generate',
    { exportJobId: job.id },
    { idempotencyKey: `export:${job.id}` },
  );

  return { exportJobId: job.id };
}

export async function generateExport(exportJobId: string): Promise<void> {
  const job = await prisma.exportJob.findUnique({ where: { id: exportJobId } });
  if (!job) return;
  if (job.status === 'ready') return;

  await prisma.exportJob.update({ where: { id: exportJobId }, data: { status: 'running' } });

  try {
    const filters = job.filters as ExportFilters;
    const { headers, rows } = definitionFor(job.kind as ExportKind);

    const chunks: string[] = [`${toCsvRow(headers)}\r\n`];
    let rowCount = 0;

    for await (const batch of rows(filters, job.scopeKind, job.scopeId)) {
      if (batch.length === 0) continue;
      chunks.push(`${batch.map(toCsvRow).join('\r\n')}\r\n`);
      rowCount += batch.length;
      if (rowCount >= MAX_ROWS) {
        logger.warn('export.truncated', { exportJobId, rowCount: MAX_ROWS });
        chunks.push(`\r\n"Export truncated at ${MAX_ROWS} rows. Narrow the date range."\r\n`);
        break;
      }
    }

    const body = chunks.join('');
    const filename = `${job.kind}-${new Date().toISOString().slice(0, 10)}.csv`;

    let fileUrl: string | null = null;
    let key: string | null = null;

    if (storageConfigured()) {
      key = storageKey('exports', filename);
      await putObject({
        key,
        body,
        contentType: 'text/csv; charset=utf-8',
        cacheControl: 'private, max-age=0',
      });
      fileUrl = presignGetUrl(key, 7 * 86_400);
    }

    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: {
        status: 'ready',
        rowCount,
        // Without object storage the file is served from the app itself.
        fileUrl: fileUrl ?? `/api/exports/${exportJobId}/download`,
        storageKey: key,
        completedAt: new Date(),
      },
    });

    // Without storage the CSV must live somewhere until it is downloaded.
    if (!storageConfigured()) inlineCache.set(exportJobId, { body, filename });

    await notify({
      userId: job.userId,
      type: 'generic',
      title: 'Your export is ready',
      body: `${rowCount.toLocaleString()} rows exported.`,
      actionPath: `/exports/${exportJobId}`,
      email: false,
    });

    logger.info('export.ready', { exportJobId, kind: job.kind, rowCount });
  } catch (error) {
    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: { status: 'failed', errorMessage: (error as Error).message.slice(0, 500) },
    });
    logger.error('export.failed', { exportJobId, error: (error as Error).message });
    throw error;
  }
}

/**
 * In-process cache for deployments without object storage. Bounded and
 * short-lived on purpose: it is a convenience for small self-hosted setups, not
 * a storage layer. DEPLOYMENT.md recommends configuring S3 for production.
 */
const inlineCache = new Map<string, { body: string; filename: string }>();

export function takeInlineExport(exportJobId: string): { body: string; filename: string } | null {
  return inlineCache.get(exportJobId) ?? null;
}

setInterval(
  () => {
    if (inlineCache.size > 50) {
      const excess = inlineCache.size - 50;
      let removed = 0;
      for (const key of inlineCache.keys()) {
        if (removed >= excess) break;
        inlineCache.delete(key);
        removed += 1;
      }
    }
  },
  10 * 60_000,
).unref?.();

type BatchGenerator = (
  filters: ExportFilters,
  scopeKind: string,
  scopeId: string | null,
) => AsyncGenerator<unknown[][]>;

function definitionFor(kind: ExportKind): { headers: string[]; rows: BatchGenerator } {
  switch (kind) {
    case 'clicks':
      return { headers: CLICK_HEADERS, rows: clickRows };
    case 'conversions':
      return { headers: CONVERSION_HEADERS, rows: conversionRows };
    case 'earnings':
      return { headers: EARNING_HEADERS, rows: earningRows };
    case 'payouts':
      return { headers: PAYOUT_HEADERS, rows: payoutRows };
    case 'creators':
      return { headers: CREATOR_HEADERS, rows: creatorRows };
    case 'spend':
      return { headers: SPEND_HEADERS, rows: spendRows };
    default:
      throw new Error(`Unknown export kind: ${kind}`);
  }
}

function dateRange(filters: ExportFilters): { from: Date; to: Date } {
  return {
    from: filters.from ? new Date(filters.from) : new Date(Date.now() - 30 * 86_400_000),
    to: filters.to ? new Date(filters.to) : new Date(),
  };
}

const CLICK_HEADERS = [
  'click_id', 'timestamp', 'campaign', 'publisher', 'country', 'region', 'device',
  'browser', 'os', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'sub_id', 'eligibility', 'billable', 'fraud_score', 'fraud_signals',
];

async function* clickRows(
  filters: ExportFilters,
  scopeKind: string,
  scopeId: string | null,
): AsyncGenerator<unknown[][]> {
  const { from, to } = dateRange(filters);
  let cursor: Date = from;

  // Keyset pagination on createdAt: OFFSET would degrade quadratically over a
  // partitioned table with millions of rows.
  for (;;) {
    const clicks = await prisma.click.findMany({
      where: {
        createdAt: { gte: cursor, lt: to },
        ...(scopeKind === 'brand' && scopeId ? { brandId: scopeId } : {}),
        ...(scopeKind === 'creator' && scopeId ? { creatorId: scopeId } : {}),
        ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters.creatorId ? { creatorId: filters.creatorId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });
    if (clicks.length === 0) return;

    const campaignNames = await nameMap('campaign', clicks.map((c) => c.campaignId));
    const publisherNames = await nameMap('creator', clicks.map((c) => c.creatorId));

    yield clicks.map((c) => [
      c.id,
      c.createdAt.toISOString(),
      campaignNames.get(c.campaignId) ?? c.campaignId,
      publisherNames.get(c.creatorId) ?? c.creatorId,
      c.country, c.region, c.deviceType, c.browser, c.os, c.referrerHost,
      c.utmSource, c.utmMedium, c.utmCampaign, c.utmContent, c.utmTerm, c.subId,
      c.eligibility, c.billable, c.fraudScore, c.fraudSignals.join(' '),
    ]);

    const last = clicks[clicks.length - 1]!;
    if (clicks.length < BATCH_SIZE) return;
    cursor = new Date(last.createdAt.getTime() + 1);
  }
}

const CONVERSION_HEADERS = [
  'conversion_id', 'timestamp', 'campaign', 'publisher', 'external_id', 'event_type',
  'revenue', 'publisher_payout', 'platform_fee', 'currency', 'status', 'source', 'fraud_score',
];

async function* conversionRows(
  filters: ExportFilters,
  scopeKind: string,
  scopeId: string | null,
): AsyncGenerator<unknown[][]> {
  const { from, to } = dateRange(filters);
  let cursor = from;

  for (;;) {
    const rows = await prisma.conversion.findMany({
      where: {
        createdAt: { gte: cursor, lt: to },
        ...(scopeKind === 'creator' && scopeId ? { creatorId: scopeId } : {}),
        ...(scopeKind === 'brand' && scopeId ? { campaign: { brandId: scopeId } } : {}),
        ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
      },
      include: { campaign: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) return;

    const publisherNames = await nameMap('creator', rows.map((r) => r.creatorId));

    yield rows.map((r) => [
      r.id,
      r.createdAt.toISOString(),
      r.campaign.name,
      publisherNames.get(r.creatorId) ?? r.creatorId,
      r.externalId,
      r.eventType,
      microsToDecimalString(r.revenueMicros),
      microsToDecimalString(r.payoutMicros),
      microsToDecimalString(r.feeMicros),
      r.currency.toUpperCase(),
      r.status,
      r.source,
      r.fraudScore,
    ]);

    if (rows.length < BATCH_SIZE) return;
    cursor = new Date(rows[rows.length - 1]!.createdAt.getTime() + 1);
  }
}

const EARNING_HEADERS = [
  'earning_id', 'timestamp', 'campaign', 'publisher', 'event_type', 'quantity',
  'brand_charged', 'platform_fee', 'publisher_earned', 'status', 'available_at', 'payout_id',
];

async function* earningRows(
  filters: ExportFilters,
  scopeKind: string,
  scopeId: string | null,
): AsyncGenerator<unknown[][]> {
  const { from, to } = dateRange(filters);
  let cursor = from;

  for (;;) {
    const rows = await prisma.earning.findMany({
      where: {
        createdAt: { gte: cursor, lt: to },
        ...(scopeKind === 'creator' && scopeId ? { creatorId: scopeId } : {}),
        ...(scopeKind === 'brand' && scopeId ? { campaign: { brandId: scopeId } } : {}),
        ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
      },
      include: { campaign: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) return;

    const publisherNames = await nameMap('creator', rows.map((r) => r.creatorId));

    yield rows.map((r) => [
      r.id,
      r.createdAt.toISOString(),
      r.campaign.name,
      publisherNames.get(r.creatorId) ?? r.creatorId,
      r.eventType,
      r.quantity,
      microsToDecimalString(r.grossMicros),
      microsToDecimalString(r.feeMicros),
      microsToDecimalString(r.netMicros),
      r.status,
      r.availableAt?.toISOString() ?? '',
      r.payoutId ?? '',
    ]);

    if (rows.length < BATCH_SIZE) return;
    cursor = new Date(rows[rows.length - 1]!.createdAt.getTime() + 1);
  }
}

const PAYOUT_HEADERS = [
  'payout_id', 'requested_at', 'paid_at', 'amount', 'currency', 'status', 'method', 'failure_reason',
];

async function* payoutRows(
  filters: ExportFilters,
  scopeKind: string,
  scopeId: string | null,
): AsyncGenerator<unknown[][]> {
  const { from, to } = dateRange(filters);
  const rows = await prisma.payout.findMany({
    where: {
      requestedAt: { gte: from, lt: to },
      ...(scopeKind === 'creator' && scopeId ? { creatorId: scopeId } : {}),
    },
    orderBy: { requestedAt: 'asc' },
    take: MAX_ROWS,
  });

  yield rows.map((r) => [
    r.id,
    r.requestedAt.toISOString(),
    r.paidAt?.toISOString() ?? '',
    microsToDecimalString(r.amountMicros),
    r.currency.toUpperCase(),
    r.status,
    r.method,
    r.failureMessage ?? '',
  ]);
}

const CREATOR_HEADERS = [
  'publisher', 'handle', 'clicks', 'qualified_clicks', 'conversions',
  'conversion_rate', 'brand_spend', 'publisher_earned', 'epc',
];

async function* creatorRows(
  filters: ExportFilters,
  scopeKind: string,
  scopeId: string | null,
): AsyncGenerator<unknown[][]> {
  const { from, to } = dateRange(filters);
  const { topPublishers } = await import('@/lib/analytics/queries');
  const rows = await topPublishers(
    {
      ...(scopeKind === 'brand' && scopeId ? { brandId: scopeId } : {}),
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
    },
    { from, to },
    5000,
  );

  yield rows.map((r) => [
    r.displayName,
    r.handle,
    r.clicks,
    r.clicks,
    r.conversions,
    `${r.conversionRate.toFixed(2)}%`,
    microsToDecimalString(r.grossMicros),
    microsToDecimalString(r.netMicros),
    microsToDecimalString(r.epcMicros),
  ]);
}

const SPEND_HEADERS = [
  'date', 'campaign', 'clicks', 'qualified_clicks', 'conversions',
  'spend', 'publisher_payouts', 'platform_fees', 'revenue', 'roas',
];

async function* spendRows(
  filters: ExportFilters,
  scopeKind: string,
  scopeId: string | null,
): AsyncGenerator<unknown[][]> {
  const { from, to } = dateRange(filters);

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      date_trunc('day', s.bucket)::date AS day,
      c.name AS campaign,
      SUM(s.clicks)::bigint AS clicks,
      SUM(s."qualifiedClicks")::bigint AS qualified,
      SUM(s.conversions)::bigint AS conversions,
      SUM(s."grossMicros")::bigint AS gross,
      SUM(s."netMicros")::bigint AS net,
      SUM(s."feeMicros")::bigint AS fee,
      SUM(s."revenueMicros")::bigint AS revenue
    FROM "stat_hourly" s
    JOIN "campaigns" c ON c.id = s."campaignId"
    WHERE s.bucket >= ${from} AND s.bucket < ${to}
      AND (${scopeId}::uuid IS NULL OR c."brandId" = ${scopeId}::uuid)
    GROUP BY 1, 2
    ORDER BY 1 ASC, 2 ASC
  `;

  yield rows.map((r) => {
    const gross = BigInt((r.gross as bigint | null) ?? 0);
    const revenue = BigInt((r.revenue as bigint | null) ?? 0);
    return [
      r.day,
      r.campaign,
      Number(r.clicks ?? 0),
      Number(r.qualified ?? 0),
      Number(r.conversions ?? 0),
      microsToDecimalString(gross),
      microsToDecimalString(BigInt((r.net as bigint | null) ?? 0)),
      microsToDecimalString(BigInt((r.fee as bigint | null) ?? 0)),
      microsToDecimalString(revenue),
      gross > 0n ? (Number((revenue * 100n) / gross) / 100).toFixed(2) : '',
    ];
  });
}

/** Resolves display names in one query rather than N. */
async function nameMap(kind: 'campaign' | 'creator', ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  if (kind === 'campaign') {
    const rows = await prisma.campaign.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  const rows = await prisma.creator.findMany({
    where: { id: { in: unique } },
    select: { id: true, handle: true, profile: { select: { displayName: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.profile?.displayName ?? r.handle]));
}
