import { randomUUID } from 'node:crypto';

import { feeForCampaign, grossFromNet } from '@/lib/billing/fees';
import { accrue } from '@/lib/billing/earnings';
import { fingerprint, hashIp, hashIpPrefix } from '@/lib/crypto/hash';
import { normalizeTrackingCode } from '@/lib/crypto/ids';
import { prisma } from '@/lib/db';
import { assessClick, decide, recordFraudEvent } from '@/lib/fraud/engine';
import { logger } from '@/lib/observability/logger';
import { kv } from '@/lib/redis';
import { inferChannel, parseUserAgent, referrerHost } from '@/lib/tracking/ua';
import { buildDestinationUrl } from '@/lib/tracking/destination';

import type { ClickEligibility } from '@prisma/client';

/**
 * The redirect hot path.
 *
 * Design goals, in priority order:
 *   1. The visitor must be redirected fast. Everything not required to choose a
 *      destination happens after the response is committed.
 *   2. No click may be lost, even if the database is slow or the fraud engine
 *      fails. Failures degrade to "redirect anyway, record what we can".
 *   3. A campaign must never be billed for traffic it did not agree to pay for.
 *
 * Sequence:
 *   - Resolve the link from a short cache (Redis or in-process) — a database
 *     round trip on every redirect would dominate the latency budget.
 *   - Build the destination and return it to the caller immediately.
 *   - Score, record and (if billable) accrue in a background task.
 */

export interface RedirectRequest {
  code: string;
  ip: string;
  userAgent: string | null;
  referrer: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  /** Query parameters on the tracking link, e.g. ?subid=post-4&utm_source=... */
  query: URLSearchParams;
}

export type RedirectOutcome =
  | { kind: 'redirect'; url: string; clickId: string }
  | { kind: 'not_found' }
  | { kind: 'inactive'; reason: string };

/** Cached link resolution. TTL is short so pausing a campaign takes effect fast. */
const LINK_CACHE_TTL_SECONDS = 30;

interface CachedLink {
  linkId: string;
  campaignId: string;
  creatorId: string;
  brandId: string;
  destinationUrl: string;
  campaignStatus: string;
  linkActive: boolean;
  creatorSuspended: boolean;
  payoutModel: string;
  payoutMicros: string;
  revshareBps: number;
  platformFeeBps: number | null;
  platformFeeFlatMicros: string;
  brandDefaultFeeBps: number | null;
  creatorFeeBpsOverride: number | null;
  allowedCountries: string[];
  blockedCountries: string[];
  allowedChannels: string[];
  prohibitedChannels: string[];
  dedupeWindowMinutes: number;
  creatorCreatedAt: string;
  creatorRiskScore: number;
  creatorVerification: string;
  linkSubId: string | null;
  linkUtm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    content: string | null;
    term: string | null;
  };
  destinationOverride: string | null;
}

async function resolveLink(code: string): Promise<CachedLink | null> {
  const cacheKey = `link:${code}`;

  const cached = await kv.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as CachedLink;
    } catch {
      // Corrupt cache entry — fall through to the database.
    }
  }

  const link = await prisma.trackingLink.findUnique({
    where: { code },
    include: {
      campaign: { include: { brand: { select: { id: true, defaultFeeBps: true } } } },
      creator: {
        select: {
          id: true,
          createdAt: true,
          riskScore: true,
          verification: true,
          feeBpsOverride: true,
        },
      },
    },
  });

  if (!link) return null;

  const value: CachedLink = {
    linkId: link.id,
    campaignId: link.campaignId,
    creatorId: link.creatorId,
    brandId: link.campaign.brandId,
    destinationUrl: link.campaign.destinationUrl,
    campaignStatus: link.campaign.status,
    linkActive: link.active,
    creatorSuspended: link.creator.verification === 'SUSPENDED',
    payoutModel: link.campaign.payoutModel,
    payoutMicros: link.campaign.payoutMicros.toString(),
    revshareBps: link.campaign.revshareBps,
    platformFeeBps: link.campaign.platformFeeBps,
    platformFeeFlatMicros: link.campaign.platformFeeFlatMicros.toString(),
    brandDefaultFeeBps: link.campaign.brand.defaultFeeBps,
    creatorFeeBpsOverride: link.creator.feeBpsOverride,
    allowedCountries: link.campaign.allowedCountries,
    blockedCountries: link.campaign.blockedCountries,
    allowedChannels: link.campaign.allowedChannels,
    prohibitedChannels: link.campaign.prohibitedChannels,
    dedupeWindowMinutes: link.campaign.dedupeWindowMinutes,
    creatorCreatedAt: link.creator.createdAt.toISOString(),
    creatorRiskScore: link.creator.riskScore,
    creatorVerification: link.creator.verification,
    linkSubId: link.subId,
    linkUtm: {
      source: link.utmSource,
      medium: link.utmMedium,
      campaign: link.utmCampaign,
      content: link.utmContent,
      term: link.utmTerm,
    },
    destinationOverride: link.destinationOverride,
  };

  void kv.set(cacheKey, JSON.stringify(value), LINK_CACHE_TTL_SECONDS).catch(() => undefined);
  return value;
}

export async function invalidateLinkCache(code: string): Promise<void> {
  await kv.del(`link:${code}`).catch(() => undefined);
}

/**
 * Resolve a tracking code to a destination. Returns quickly; call
 * `recordClick` afterwards (without awaiting, from the route handler's
 * `after()` hook) to do the expensive work off the response path.
 */
export async function resolveRedirect(
  request: RedirectRequest,
): Promise<{ outcome: RedirectOutcome; link: CachedLink | null; clickId: string }> {
  const clickId = randomUUID();
  const code = normalizeTrackingCode(request.code);

  const link = await resolveLink(code);
  if (!link) return { outcome: { kind: 'not_found' }, link: null, clickId };

  // A paused or finished campaign stops sending traffic immediately. The
  // visitor still gets somewhere sensible rather than an error page.
  if (link.campaignStatus !== 'ACTIVE') {
    return {
      outcome: { kind: 'inactive', reason: `Campaign is ${link.campaignStatus.toLowerCase()}` },
      link,
      clickId,
    };
  }
  if (!link.linkActive) {
    return { outcome: { kind: 'inactive', reason: 'This link has been deactivated' }, link, clickId };
  }

  const destination = buildDestinationUrl({
    base: link.destinationOverride ?? link.destinationUrl,
    clickId,
    subId: request.query.get('subid') ?? request.query.get('sub_id') ?? link.linkSubId,
    utm: {
      source: request.query.get('utm_source') ?? link.linkUtm.source,
      medium: request.query.get('utm_medium') ?? link.linkUtm.medium,
      campaign: request.query.get('utm_campaign') ?? link.linkUtm.campaign,
      content: request.query.get('utm_content') ?? link.linkUtm.content,
      term: request.query.get('utm_term') ?? link.linkUtm.term,
    },
  });

  return { outcome: { kind: 'redirect', url: destination, clickId }, link, clickId };
}

export interface RecordClickParams {
  clickId: string;
  link: CachedLink;
  request: RedirectRequest;
  latencyMs: number;
}

/**
 * Score, persist and (if billable) monetise a click. Runs after the redirect
 * has been sent, so its cost never reaches the visitor.
 */
export async function recordClick(params: RecordClickParams): Promise<void> {
  const { clickId, link, request } = params;
  const startedAt = Date.now();

  try {
    const ua = parseUserAgent(request.userAgent);
    const refHost = referrerHost(request.referrer);
    const channel = inferChannel(refHost);

    // A device fingerprint built from stable, non-identifying request
    // attributes. Deliberately coarse: it must group repeat visits from one
    // device without being able to single out a person across sites.
    const sessionFp = fingerprint([
      hashIp(request.ip),
      ua.browser,
      ua.os,
      ua.deviceType,
    ]);

    const subId = request.query.get('subid') ?? request.query.get('sub_id') ?? link.linkSubId;

    let eligibility: ClickEligibility = 'ELIGIBLE';
    let billable = false;
    let fraudScore = 0;
    let fraudSignals: string[] = [];
    let earningId: string | null = null;

    if (link.creatorSuspended) {
      // A suspended publisher's traffic is recorded but never billable.
      eligibility = 'SUSPENDED_PUBLISHER';
    } else {
      const assessment = await assessClick({
        campaignId: link.campaignId,
        creatorId: link.creatorId,
        linkId: link.linkId,
        ip: request.ip,
        userAgent: ua,
        country: request.country,
        referrerHost: refHost,
        inferredChannel: channel,
        sessionFp,
        allowedCountries: link.allowedCountries,
        blockedCountries: link.blockedCountries,
        allowedChannels: link.allowedChannels,
        prohibitedChannels: link.prohibitedChannels,
        dedupeWindowMinutes: link.dedupeWindowMinutes,
        creatorCreatedAt: new Date(link.creatorCreatedAt),
        creatorRiskScore: link.creatorRiskScore,
        creatorVerification: link.creatorVerification,
      });

      fraudScore = assessment.score;
      fraudSignals = assessment.signals.map((s) => s.code);

      const decision = await decide(assessment);
      eligibility = eligibilityFor(
        assessment.disqualificationCode,
        decision.billable,
        decision.hold,
      );

      // Only CPC campaigns pay per click. Other models pay on conversion.
      if (decision.billable && link.payoutModel === 'CPC') {
        const result = await accrueClickEarning(link, clickId, decision.hold, decision.reason);
        if (result.accrued) {
          billable = true;
          earningId = result.earningId;
        } else {
          eligibility = 'BUDGET_EXHAUSTED';
        }
      } else if (decision.billable) {
        // Billable in principle, but this model pays later.
        billable = false;
      }

      void recordFraudEvent({
        assessment,
        entityKind: 'click',
        creatorId: link.creatorId,
        campaignId: link.campaignId,
        clickId,
      });
    }

    await prisma.click.create({
      data: {
        id: clickId,
        linkId: link.linkId,
        campaignId: link.campaignId,
        creatorId: link.creatorId,
        brandId: link.brandId,
        ipHash: hashIp(request.ip),
        ipPrefixHash: hashIpPrefix(request.ip),
        country: request.country,
        region: request.region,
        city: request.city,
        deviceType: ua.deviceType,
        browser: ua.browser,
        os: ua.os,
        isBot: ua.isBot,
        referrerHost: refHost,
        // The full referrer URL can carry personal data in its query string, so
        // only the host is retained; see docs/SECURITY.md § data minimisation.
        referrerUrl: null,
        utmSource: request.query.get('utm_source') ?? link.linkUtm.source,
        utmMedium: request.query.get('utm_medium') ?? link.linkUtm.medium,
        utmCampaign: request.query.get('utm_campaign') ?? link.linkUtm.campaign,
        utmContent: request.query.get('utm_content') ?? link.linkUtm.content,
        utmTerm: request.query.get('utm_term') ?? link.linkUtm.term,
        subId,
        fraudScore,
        fraudSignals,
        eligibility,
        billable,
        earningId,
        sessionFp,
        latencyMs: params.latencyMs,
      },
    });

    await prisma.trackingLink
      .update({ where: { id: link.linkId }, data: { clickCount: { increment: 1 } } })
      .catch(() => undefined);

    logger.debug('click.recorded', {
      clickId,
      eligibility,
      billable,
      fraudScore,
      processingMs: Date.now() - startedAt,
    });
  } catch (error) {
    // A click that cannot be recorded is a lost data point, not a lost visitor:
    // the redirect already happened. Log loudly so it can be investigated.
    logger.error('click.record_failed', {
      clickId,
      linkId: link.linkId,
      error: (error as Error).message,
    });
  }
}

async function accrueClickEarning(
  link: CachedLink,
  clickId: string,
  hold: boolean,
  reason: string,
): Promise<{ accrued: boolean; earningId: string | null }> {
  const netMicros = BigInt(link.payoutMicros);
  if (netMicros <= 0n) return { accrued: false, earningId: null };

  const fee = await feeForCampaign(
    {
      platformFeeBps: link.platformFeeBps,
      platformFeeFlatMicros: BigInt(link.platformFeeFlatMicros),
    },
    { feeBpsOverride: link.creatorFeeBpsOverride },
    link.brandDefaultFeeBps,
  );
  const breakdown = grossFromNet(netMicros, fee);

  const result = await accrue({
    creatorId: link.creatorId,
    campaignId: link.campaignId,
    eventType: 'CLICK',
    grossMicros: breakdown.grossMicros,
    feeMicros: breakdown.feeMicros,
    netMicros: breakdown.netMicros,
    // One earning per click, forever — the click id is the natural idempotency key.
    idempotencyKey: `click:${clickId}`,
    clickId,
    holdForReview: hold,
    reviewReason: hold ? reason : undefined,
  });

  if (!result.ok) {
    logger.info('click.not_billable', { clickId, reason: result.reason });
    return { accrued: false, earningId: null };
  }
  return { accrued: true, earningId: result.earning.id };
}

function eligibilityFor(
  disqualification: string | null,
  billable: boolean,
  held: boolean,
): ClickEligibility {
  switch (disqualification) {
    case 'GEO_NOT_ALLOWED':
      return 'GEO_BLOCKED';
    case 'CHANNEL_NOT_ALLOWED':
      return 'CHANNEL_BLOCKED';
    case 'DUPLICATE_CLICK':
      return 'DUPLICATE';
    default:
      // A held click is billable — the brand's budget is reserved against it —
      // but it is not the same as one that passed cleanly, and an operator
      // filtering the click log needs to be able to tell them apart.
      if (!billable) return 'REJECTED';
      return held ? 'REVIEW' : 'ELIGIBLE';
  }
}
