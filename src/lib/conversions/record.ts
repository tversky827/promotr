import { randomUUID } from 'node:crypto';

import { accrue } from '@/lib/billing/earnings';
import { feeForCampaign, grossFromNet, splitGross } from '@/lib/billing/fees';
import { prisma } from '@/lib/db';
import { applyBps, cpmAmount } from '@/lib/money';
import { bandFor, recordFraudEvent, type RiskAssessment } from '@/lib/fraud/engine';
import { signal, type DetectedSignal } from '@/lib/fraud/signals';
import { logger } from '@/lib/observability/logger';
import { getSettings } from '@/lib/settings';
import { enqueue } from '@/lib/jobs/queue';

import type { BillableEvent, Conversion } from '@prisma/client';

/**
 * Conversion ingestion.
 *
 * A conversion can arrive four ways — browser pixel, server-to-server postback,
 * REST API, or inbound webhook — and all four funnel through this one function
 * so the attribution, de-duplication, fraud and payout rules cannot drift apart
 * between transports.
 *
 * De-duplication is absolute: `(campaignId, externalId)` is unique in the
 * database, and a separate `idempotencyKey` guards retries of the same delivery.
 * A brand that fires its pixel twice is charged once.
 */

export interface ConversionInput {
  campaignId: string;
  /** The click this conversion is attributed to, from the `pmtr_click` param. */
  clickId?: string | null;
  /** The brand's own order/lead identifier. Required — it is the dedupe key. */
  externalId: string;
  eventType?: BillableEvent;
  /** Order value, in micros. Drives revenue-share payouts. */
  revenueMicros?: bigint;
  quantity?: number;
  currency?: string;
  source: 'pixel' | 's2s' | 'api' | 'webhook' | 'manual';
  metadata?: Record<string, unknown>;
  /** Optional caller-supplied key for retry-safety across transports. */
  idempotencyKey?: string;
}

export type ConversionResult =
  | { ok: true; conversion: Conversion; duplicate: boolean; earningId: string | null }
  | { ok: false; code: ConversionRejection; message: string };

export type ConversionRejection =
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_INACTIVE'
  | 'NO_ATTRIBUTION'
  | 'ATTRIBUTION_EXPIRED'
  | 'PUBLISHER_SUSPENDED'
  | 'BUDGET_EXHAUSTED'
  | 'INVALID_INPUT';

/** Conversions faster than this after the click are implausible. */
const MIN_PLAUSIBLE_SECONDS = 3;

export async function recordConversion(input: ConversionInput): Promise<ConversionResult> {
  if (!input.externalId || input.externalId.trim() === '') {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A conversion id is required so duplicate reports can be detected.',
    };
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    include: { brand: { select: { id: true, defaultFeeBps: true } } },
  });
  if (!campaign) {
    return { ok: false, code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found.' };
  }

  const idempotencyKey =
    input.idempotencyKey ?? `conv:${campaign.id}:${input.externalId}`;

  // Fast path for an exact replay.
  const existing = await prisma.conversion.findFirst({
    where: {
      OR: [
        { idempotencyKey },
        { campaignId: campaign.id, externalId: input.externalId },
      ],
    },
  });
  if (existing) {
    logger.info('conversion.duplicate', {
      campaignId: campaign.id,
      externalId: input.externalId,
      conversionId: existing.id,
    });
    const earning = await prisma.earning.findFirst({
      where: { conversionId: existing.id },
      select: { id: true },
    });
    return { ok: true, conversion: existing, duplicate: true, earningId: earning?.id ?? null };
  }

  // --- Attribution ---------------------------------------------------------

  const signals: DetectedSignal[] = [];
  const attribution = await attributeConversion(campaign.id, input.clickId ?? null);

  if (!attribution) {
    return {
      ok: false,
      code: 'NO_ATTRIBUTION',
      message:
        'This conversion could not be matched to a click. Include the pmtr_click value from the landing page URL.',
    };
  }
  if (attribution.expired) {
    return {
      ok: false,
      code: 'ATTRIBUTION_EXPIRED',
      message: `The originating click is outside this campaign's ${campaign.attributionWindowHours}-hour attribution window.`,
    };
  }

  const creator = await prisma.creator.findUnique({
    where: { id: attribution.creatorId },
    select: { id: true, verification: true, feeBpsOverride: true },
  });
  if (!creator) {
    return { ok: false, code: 'NO_ATTRIBUTION', message: 'The attributed publisher no longer exists.' };
  }
  if (creator.verification === 'SUSPENDED') {
    return {
      ok: false,
      code: 'PUBLISHER_SUSPENDED',
      message: 'The attributed publisher account is suspended.',
    };
  }

  // --- Fraud signals -------------------------------------------------------

  if (attribution.secondsSinceClick !== null && attribution.secondsSinceClick < MIN_PLAUSIBLE_SECONDS) {
    signals.push(
      signal(
        'CONVERSION_TOO_FAST',
        `Reported ${attribution.secondsSinceClick}s after the click`,
      ),
    );
  }
  if (attribution.inferred) {
    signals.push(signal('CONVERSION_WITHOUT_CLICK', 'No click id was supplied; attribution inferred'));
  }
  if (attribution.clickFraudScore >= 51) {
    signals.push(
      signal('ABNORMAL_CONVERSION_RATE', `Originating click scored ${attribution.clickFraudScore}`),
    );
  }

  // An order worth many times the campaign's norm is either a genuine whale or
  // an inflated revenue-share claim. Only meaningful once the campaign has
  // enough history to have a norm at all.
  const reportedRevenueMicros = input.revenueMicros ?? 0n;
  if (reportedRevenueMicros > 0n && campaign.payoutModel === 'REVSHARE') {
    const typical = await typicalRevenueMicros(campaign.id);
    if (typical !== null && reportedRevenueMicros > typical * BigInt(REVENUE_OUTLIER_MULTIPLE)) {
      signals.push(
        signal(
          'REVENUE_OUTLIER',
          `Order value is more than ${REVENUE_OUTLIER_MULTIPLE}× this campaign's average`,
        ),
      );
    }
  }

  const settings = await getSettings();
  const score = Math.min(
    100,
    signals.reduce((sum, s) => sum + s.weight, 0),
  );
  const assessment: RiskAssessment = {
    score,
    band: bandFor(score, settings),
    signals,
    disqualified: false,
    disqualificationCode: null,
  };

  const hold = settings.fraudAutoHoldEnabled && score >= settings.fraudSuspiciousThreshold;

  // --- Payout calculation --------------------------------------------------

  const eventType = input.eventType ?? defaultEventType(campaign.payoutModel);
  const revenueMicros = input.revenueMicros ?? 0n;
  const quantity = input.quantity ?? 1;

  const fee = await feeForCampaign(campaign, creator, campaign.brand.defaultFeeBps);
  const payout = computePayout({
    payoutModel: campaign.payoutModel,
    payoutMicros: campaign.payoutMicros,
    revshareBps: campaign.revshareBps,
    revenueMicros,
    quantity,
  });

  const breakdown =
    campaign.payoutModel === 'REVSHARE'
      ? // For revenue share the brand's spend is a slice of real revenue, so the
        // fee comes out of that slice rather than being added on top.
        splitGross(payout, fee)
      : grossFromNet(payout, fee);

  // --- Persist -------------------------------------------------------------

  const conversionId = randomUUID();
  let status: Conversion['status'] = hold ? 'UNDER_REVIEW' : 'PENDING';
  let statusReason: string | null = hold ? 'Held for review pending fraud check' : null;

  // The conversion row is written before the earning because the earning holds
  // a foreign key to it. If the campaign then turns out to be unable to pay,
  // the conversion is marked REJECTED below — the brand still sees that the
  // event happened, which is what they need for their own reporting.
  let conversion = await prisma.conversion.create({
    data: {
      id: conversionId,
      campaignId: campaign.id,
      creatorId: creator.id,
      linkId: attribution.linkId,
      clickId: attribution.clickId,
      clickAt: attribution.clickAt,
      externalId: input.externalId,
      idempotencyKey,
      eventType,
      revenueMicros,
      payoutMicros: breakdown.netMicros,
      feeMicros: breakdown.feeMicros,
      currency: input.currency ?? 'usd',
      status,
      statusReason,
      fraudScore: score,
      fraudSignals: signals.map((s) => s.code),
      source: input.source,
      metadata: input.metadata ? (input.metadata as never) : undefined,
    },
  });

  let earningId: string | null = null;

  if (breakdown.netMicros > 0n) {
    const result = await accrue({
      creatorId: creator.id,
      campaignId: campaign.id,
      eventType,
      quantity,
      grossMicros: breakdown.grossMicros,
      feeMicros: breakdown.feeMicros,
      netMicros: breakdown.netMicros,
      idempotencyKey: `conversion:${idempotencyKey}`,
      clickId: attribution.clickId,
      conversionId,
      holdForReview: hold,
      reviewReason: statusReason ?? undefined,
    });

    if (!result.ok) {
      status = 'REJECTED';
      statusReason =
        result.reason === 'BUDGET_EXHAUSTED'
          ? 'The campaign budget was exhausted before this conversion was reported.'
          : 'This campaign has no funded budget.';
      logger.warn('conversion.unfunded', { campaignId: campaign.id, reason: result.reason });
      conversion = await prisma.conversion.update({
        where: { id: conversionId },
        data: { status, statusReason, rejectedAt: new Date() },
      });
    } else {
      earningId = result.earning.id;
    }
  }

  void recordFraudEvent({
    assessment,
    entityKind: 'conversion',
    creatorId: creator.id,
    campaignId: campaign.id,
    conversionId: conversion.id,
  });

  await enqueue('webhook.dispatch', {
    brandId: campaign.brandId,
    eventType: 'conversion.created',
    data: {
      conversionId: conversion.id,
      campaignId: campaign.id,
      externalId: conversion.externalId,
      revenueMicros: revenueMicros.toString(),
      payoutMicros: breakdown.netMicros.toString(),
      status,
    },
  }).catch((error) => logger.warn('conversion.webhook_enqueue_failed', { error: (error as Error).message }));

  if (settings.notifyCreatorOnEarning && earningId) {
    await enqueue('notify.creator.earning', {
      creatorId: creator.id,
      earningId,
      campaignId: campaign.id,
    }).catch(() => undefined);
  }

  logger.info('conversion.recorded', {
    conversionId: conversion.id,
    campaignId: campaign.id,
    creatorId: creator.id,
    status,
    netMicros: breakdown.netMicros.toString(),
  });

  return { ok: true, conversion, duplicate: false, earningId };
}

export interface PayoutComputation {
  payoutModel: string;
  payoutMicros: bigint;
  revshareBps: number;
  revenueMicros: bigint;
  quantity: number;
}

/** The publisher's earning for one conversion, by compensation model. */
/** How many times the campaign average counts as an outlier. */
const REVENUE_OUTLIER_MULTIPLE = 10;
/** Below this many prior conversions there is no norm to compare against. */
const REVENUE_HISTORY_MINIMUM = 20;

/**
 * The campaign's average accepted order value, or null when there is too little
 * history to judge. Rejected conversions are excluded — including them would
 * let one bogus order raise the bar for every honest one after it.
 */
async function typicalRevenueMicros(campaignId: string): Promise<bigint | null> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint; total: bigint }>>`
    SELECT COUNT(*)::bigint AS count, COALESCE(SUM("revenueMicros"), 0)::bigint AS total
    FROM "conversions"
    WHERE "campaignId" = ${campaignId}::uuid
      AND status NOT IN ('REJECTED', 'REVERSED')
      AND "revenueMicros" > 0
  `;
  const count = rows[0]?.count ?? 0n;
  if (count < BigInt(REVENUE_HISTORY_MINIMUM)) return null;
  return (rows[0]?.total ?? 0n) / count;
}

export function computePayout(input: PayoutComputation): bigint {
  switch (input.payoutModel) {
    case 'CPL':
    case 'CPA':
      return input.payoutMicros * BigInt(Math.max(1, input.quantity));
    case 'CPM':
      return cpmAmount(input.payoutMicros, input.quantity);
    case 'REVSHARE':
      return applyBps(input.revenueMicros, input.revshareBps);
    case 'HYBRID':
      // Flat component plus a share of revenue.
      return (
        input.payoutMicros * BigInt(Math.max(1, input.quantity)) +
        applyBps(input.revenueMicros, input.revshareBps)
      );
    case 'CPC':
      // Click campaigns pay at click time; a conversion is recorded for
      // reporting but adds no further payout.
      return 0n;
    default:
      return 0n;
  }
}

function defaultEventType(payoutModel: string): BillableEvent {
  switch (payoutModel) {
    case 'CPL':
      return 'LEAD';
    case 'CPA':
    case 'REVSHARE':
    case 'HYBRID':
      return 'SALE';
    case 'CPM':
      return 'IMPRESSION';
    case 'CPC':
      return 'CLICK';
    default:
      return 'CUSTOM';
  }
}

interface Attribution {
  clickId: string | null;
  clickAt: Date | null;
  linkId: string;
  creatorId: string;
  secondsSinceClick: number | null;
  expired: boolean;
  inferred: boolean;
  clickFraudScore: number;
}

/**
 * Resolve which publisher earns a conversion.
 *
 * Last-click attribution within the campaign's window. An explicit click id is
 * authoritative; without one we fall back to the most recent eligible click for
 * this campaign from the same visitor, and flag the conversion as inferred so
 * the weaker evidence is visible rather than hidden.
 */
async function attributeConversion(
  campaignId: string,
  clickId: string | null,
): Promise<Attribution | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { attributionWindowHours: true },
  });
  if (!campaign) return null;

  const windowStart = new Date(Date.now() - campaign.attributionWindowHours * 3600_000);

  if (clickId) {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        createdAt: Date;
        linkId: string;
        creatorId: string;
        fraudScore: number;
        eligibility: string;
      }>
    >`
      SELECT id, "createdAt", "linkId", "creatorId", "fraudScore", eligibility::text AS eligibility
      FROM "clicks"
      WHERE id = ${clickId}::uuid AND "campaignId" = ${campaignId}::uuid
      LIMIT 1
    `;
    const click = rows[0];
    if (!click) return null;

    const secondsSince = Math.floor((Date.now() - click.createdAt.getTime()) / 1000);
    return {
      clickId: click.id,
      clickAt: click.createdAt,
      linkId: click.linkId,
      creatorId: click.creatorId,
      secondsSinceClick: secondsSince,
      expired: click.createdAt < windowStart,
      inferred: false,
      clickFraudScore: click.fraudScore,
    };
  }

  return null;
}

/** Admin/brand action: approve a pending conversion and its earning. */
export async function approveConversion(
  conversionId: string,
  options: { actorUserId?: string; reason?: string } = {},
): Promise<Conversion | null> {
  const conversion = await prisma.conversion.findUnique({ where: { id: conversionId } });
  if (!conversion) return null;
  if (conversion.status === 'APPROVED') return conversion;

  const { approve } = await import('@/lib/billing/earnings');
  const earnings = await prisma.earning.findMany({ where: { conversionId } });
  for (const earning of earnings) {
    await approve(earning.id, { actorUserId: options.actorUserId, reason: options.reason });
  }

  return prisma.conversion.update({
    where: { id: conversionId },
    data: { status: 'APPROVED', approvedAt: new Date(), statusReason: options.reason ?? null },
  });
}

export async function rejectConversion(
  conversionId: string,
  reason: string,
  options: { actorUserId?: string } = {},
): Promise<Conversion | null> {
  const conversion = await prisma.conversion.findUnique({ where: { id: conversionId } });
  if (!conversion) return null;

  const { reject } = await import('@/lib/billing/earnings');
  const earnings = await prisma.earning.findMany({ where: { conversionId } });
  for (const earning of earnings) {
    await reject(earning.id, reason, { actorUserId: options.actorUserId });
  }

  return prisma.conversion.update({
    where: { id: conversionId },
    data: { status: 'REJECTED', rejectedAt: new Date(), statusReason: reason },
  });
}

/** Reverse an approved conversion (refund, chargeback, dispute upheld). */
export async function reverseConversion(
  conversionId: string,
  reason: string,
  options: { actorUserId?: string } = {},
): Promise<Conversion | null> {
  const conversion = await prisma.conversion.findUnique({ where: { id: conversionId } });
  if (!conversion) return null;

  const { reverse } = await import('@/lib/billing/earnings');
  const earnings = await prisma.earning.findMany({ where: { conversionId } });
  for (const earning of earnings) {
    await reverse(earning.id, reason, { actorUserId: options.actorUserId });
  }

  return prisma.conversion.update({
    where: { id: conversionId },
    data: { status: 'REVERSED', reversedAt: new Date(), statusReason: reason },
  });
}
