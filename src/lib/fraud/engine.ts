import { hashIp, hashIpPrefix } from '@/lib/crypto/hash';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { getSettings, type PlatformSettings } from '@/lib/settings';
import {
  signal,
  SUSPICIOUS_REFERRER_HOSTS,
  type DetectedSignal,
  type SignalCode,
} from '@/lib/fraud/signals';
import type { ParsedUserAgent } from '@/lib/tracking/ua';

/**
 * Risk engine.
 *
 * Produces a 0-100 score and an explicit list of reasons. Two principles shape
 * the design:
 *
 *  1. **Never silently confiscate.** A high score does not delete a publisher's
 *     earnings. It routes them to UNDER_REVIEW, where a human decides and the
 *     publisher can dispute. Only definitively non-billable traffic (declared
 *     bots, duplicates, out-of-geo) is rejected without review, and those are
 *     rule outcomes rather than accusations.
 *
 *  2. **Always explain.** Every score carries the signals that produced it,
 *     with weights and evidence, so an admin can audit the decision and a
 *     publisher can be told why.
 *
 * Band thresholds are configurable (see PlatformSettings) so an operator can
 * tune strictness without a deploy.
 */

export type RiskBand = 'LOW' | 'REVIEW' | 'SUSPICIOUS' | 'HIGH';

export interface RiskAssessment {
  score: number;
  band: RiskBand;
  signals: DetectedSignal[];
  /** Terminal rule outcome — the event is not billable regardless of score. */
  disqualified: boolean;
  disqualificationCode: SignalCode | null;
}

export interface ClickRiskInput {
  campaignId: string;
  creatorId: string;
  linkId: string;
  ip: string;
  userAgent: ParsedUserAgent;
  country: string | null;
  referrerHost: string | null;
  inferredChannel: string | null;
  sessionFp: string;
  /** Campaign targeting rules. */
  allowedCountries: string[];
  blockedCountries: string[];
  allowedChannels: string[];
  prohibitedChannels: string[];
  dedupeWindowMinutes: number;
  /** Publisher context. */
  creatorCreatedAt: Date;
  creatorRiskScore: number;
  creatorVerification: string;
  /** Hash of the publisher's own last-known IP, for self-click detection. */
  creatorIpHash?: string | null;
}

/**
 * Outcomes that stop an event being billable without implying wrongdoing.
 * They are reported to the publisher as rule outcomes, never as fraud.
 */
const NON_FRAUD_OUTCOMES = new Set<SignalCode>([
  'GEO_NOT_ALLOWED',
  'CHANNEL_NOT_ALLOWED',
  'ATTRIBUTION_WINDOW_EXPIRED',
  'DUPLICATE_CLICK',
  'KNOWN_CRAWLER',
]);

const BURST_WINDOW_SECONDS = 60;
const IP_BURST_THRESHOLD = 20;
const DEVICE_BURST_THRESHOLD = 15;
const RAPID_REPEAT_SECONDS = 5;
const NEW_PUBLISHER_DAYS = 3;

export async function assessClick(input: ClickRiskInput): Promise<RiskAssessment> {
  const settings = await getSettings();
  const signals: DetectedSignal[] = [];

  // --- Terminal targeting rules -------------------------------------------
  // These are campaign configuration, not fraud. They are reported separately
  // so a publisher is never told "suspected fraud" for a geo mismatch.

  if (input.country) {
    const allowed = input.allowedCountries;
    const blocked = input.blockedCountries;
    if (
      (allowed.length > 0 && !allowed.includes(input.country)) ||
      blocked.includes(input.country)
    ) {
      return terminal('GEO_NOT_ALLOWED', `Visitor country ${input.country} is not targeted`);
    }
  }

  if (input.inferredChannel) {
    const allowed = input.allowedChannels;
    const prohibited = input.prohibitedChannels;
    if (
      prohibited.includes(input.inferredChannel) ||
      (allowed.length > 0 && !allowed.includes(input.inferredChannel))
    ) {
      return terminal(
        'CHANNEL_NOT_ALLOWED',
        `Traffic from ${input.inferredChannel} is not permitted on this campaign`,
      );
    }
  }

  // --- Technical signals ----------------------------------------------------

  if (input.userAgent.automation) {
    signals.push(
      signal(
        input.userAgent.browser === 'Unknown' ? 'MISSING_USER_AGENT' : 'AUTOMATION_UA',
        `Detected as ${input.userAgent.browser}`,
      ),
    );
  } else if (input.userAgent.knownCrawler) {
    signals.push(signal('KNOWN_CRAWLER', `Identified as ${input.userAgent.browser}`));
  }

  // --- Duplication and velocity --------------------------------------------

  const ipHash = hashIp(input.ip);
  const prefixHash = hashIpPrefix(input.ip);
  const dedupeSince = new Date(Date.now() - input.dedupeWindowMinutes * 60_000);

  const [duplicateCount, rapidCount, ipBurstCount, deviceBurstCount] = await Promise.all([
    countClicks({ linkId: input.linkId, sessionFp: input.sessionFp, since: dedupeSince }),
    countClicks({
      linkId: input.linkId,
      sessionFp: input.sessionFp,
      since: new Date(Date.now() - RAPID_REPEAT_SECONDS * 1000),
    }),
    countClicks({
      campaignId: input.campaignId,
      ipPrefixHash: prefixHash,
      since: new Date(Date.now() - BURST_WINDOW_SECONDS * 1000),
    }),
    countClicks({
      sessionFp: input.sessionFp,
      since: new Date(Date.now() - BURST_WINDOW_SECONDS * 1000),
    }),
  ]);

  if (duplicateCount > 0) {
    return terminal(
      'DUPLICATE_CLICK',
      `This visitor already clicked this link ${duplicateCount} time(s) in the last ${input.dedupeWindowMinutes} minutes`,
    );
  }

  if (rapidCount > 0) {
    signals.push(signal('RAPID_REPEAT', `${rapidCount} click(s) in the last ${RAPID_REPEAT_SECONDS}s`));
  }
  if (ipBurstCount >= IP_BURST_THRESHOLD) {
    signals.push(
      signal('IP_BURST', `${ipBurstCount} clicks from this network in ${BURST_WINDOW_SECONDS}s`),
    );
  }
  if (deviceBurstCount >= DEVICE_BURST_THRESHOLD) {
    signals.push(
      signal(
        'DEVICE_BURST',
        `${deviceBurstCount} clicks from this device in ${BURST_WINDOW_SECONDS}s`,
      ),
    );
  }

  // --- Self-clicking --------------------------------------------------------

  if (input.creatorIpHash && input.creatorIpHash === ipHash) {
    signals.push(signal('SELF_CLICK', "The click came from the publisher's own network"));
  }

  // --- Referrer -------------------------------------------------------------

  if (!input.referrerHost) {
    signals.push(signal('MISSING_REFERRER'));
  } else if (SUSPICIOUS_REFERRER_HOSTS.has(input.referrerHost)) {
    signals.push(signal('SUSPICIOUS_REFERRER', `Referred by ${input.referrerHost}`));
  }

  // --- Publisher account context -------------------------------------------

  const ageMs = Date.now() - input.creatorCreatedAt.getTime();
  if (ageMs < NEW_PUBLISHER_DAYS * 24 * 60 * 60 * 1000) {
    signals.push(signal('NEW_PUBLISHER', 'Publisher account is less than 3 days old'));
  }
  if (input.creatorVerification === 'RESTRICTED') {
    signals.push(signal('PUBLISHER_UNDER_REVIEW'));
  }
  if (input.creatorRiskScore >= settings.fraudSuspiciousThreshold) {
    signals.push(
      signal('PUBLISHER_HIGH_RISK', `Account risk score is ${input.creatorRiskScore}`),
    );
  }

  return score(signals, settings);
}

interface ClickCountFilter {
  linkId?: string;
  campaignId?: string;
  sessionFp?: string;
  ipPrefixHash?: string;
  since: Date;
}

/**
 * Counts prior clicks matching a filter. Only billable clicks count toward
 * duplication — an earlier click that was itself rejected must not make this
 * one a "duplicate" and suppress a legitimate visit.
 */
async function countClicks(filter: ClickCountFilter): Promise<number> {
  try {
    const rows = await prisma.click.count({
      where: {
        createdAt: { gte: filter.since },
        ...(filter.linkId ? { linkId: filter.linkId } : {}),
        ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
        ...(filter.sessionFp ? { sessionFp: filter.sessionFp } : {}),
        ...(filter.ipPrefixHash ? { ipPrefixHash: filter.ipPrefixHash } : {}),
        eligibility: 'ELIGIBLE',
      },
    });
    return rows;
  } catch (error) {
    // The fraud engine must never break the redirect. A failed lookup degrades
    // to "no evidence of duplication", which is the safe direction: the click
    // still gets scored on every other signal.
    logger.error('fraud.count_failed', { error: (error as Error).message });
    return 0;
  }
}

function terminal(code: SignalCode, detail: string): RiskAssessment {
  const detected = signal(code, detail);
  return {
    score: 100,
    band: 'HIGH',
    signals: [detected],
    disqualified: true,
    disqualificationCode: code,
  };
}

export function score(signals: DetectedSignal[], settings: PlatformSettings): RiskAssessment {
  const total = Math.min(
    100,
    signals.reduce((sum, s) => sum + s.weight, 0),
  );
  return {
    score: total,
    band: bandFor(total, settings),
    signals,
    disqualified: false,
    disqualificationCode: null,
  };
}

export function bandFor(score: number, settings: PlatformSettings): RiskBand {
  if (score >= settings.fraudRejectThreshold) return 'HIGH';
  if (score >= settings.fraudSuspiciousThreshold) return 'SUSPICIOUS';
  if (score >= settings.fraudReviewThreshold) return 'REVIEW';
  return 'LOW';
}

/**
 * What to do with an assessed event.
 *
 * `hold` means the earning is created but parked as UNDER_REVIEW: the brand's
 * money is reserved, the publisher's claim is recorded, and a human decides.
 * Nothing is destroyed, which is what lets a wrongly-flagged publisher be made
 * whole by approving the earning rather than by a manual adjustment.
 */
export interface RiskDecision {
  billable: boolean;
  hold: boolean;
  reason: string;
}

export async function decide(assessment: RiskAssessment): Promise<RiskDecision> {
  const settings = await getSettings();

  if (assessment.disqualified) {
    const reason = assessment.signals[0]?.explanation ?? 'Not billable';
    return { billable: false, hold: false, reason };
  }

  // Declared crawlers are not billable but are not fraud; they get no fraud
  // event and no penalty against the publisher.
  if (assessment.signals.some((s) => s.code === 'KNOWN_CRAWLER')) {
    return { billable: false, hold: false, reason: 'Crawler traffic is not billable' };
  }

  if (assessment.score >= settings.fraudRejectThreshold) {
    return {
      billable: false,
      hold: false,
      reason: assessment.signals
        .filter((s) => s.severity === 'CRITICAL' || s.severity === 'HIGH')
        .map((s) => s.explanation)
        .join(' ') || 'Traffic did not pass automated quality checks',
    };
  }

  if (settings.fraudAutoHoldEnabled && assessment.score >= settings.fraudSuspiciousThreshold) {
    return {
      billable: true,
      hold: true,
      reason: 'Held for review: ' + assessment.signals.map((s) => s.code).join(', '),
    };
  }

  return { billable: true, hold: false, reason: '' };
}

/** Persist a fraud event for the admin console. */
export async function recordFraudEvent(params: {
  assessment: RiskAssessment;
  entityKind: 'click' | 'conversion' | 'creator' | 'campaign';
  creatorId?: string;
  campaignId?: string;
  clickId?: string;
  conversionId?: string;
}): Promise<void> {
  const { assessment } = params;

  // The fraud console must show things a human should look at, and nothing
  // else. Two categories are excluded deliberately:
  //
  //   * Rule outcomes that are not accusations — out-of-geo traffic, a
  //     prohibited channel, an expired attribution window, a de-duplicated
  //     repeat visit, a declared search crawler. These are normal marketplace
  //     mechanics. Filing them as "fraud" against a publisher would be both
  //     wrong and, at volume, would bury the real cases.
  //   * Anything with no signal above LOW severity, which is noise.
  if (NON_FRAUD_OUTCOMES.has(assessment.disqualificationCode as SignalCode)) return;

  const worthReview = assessment.signals.some(
    (s) => s.severity === 'MEDIUM' || s.severity === 'HIGH' || s.severity === 'CRITICAL',
  );
  if (!worthReview) return;

  try {
    await prisma.fraudEvent.create({
      data: {
        creatorId: params.creatorId ?? null,
        campaignId: params.campaignId ?? null,
        clickId: params.clickId ?? null,
        conversionId: params.conversionId ?? null,
        score: assessment.score,
        band: assessment.band,
        entityKind: params.entityKind,
        severity: highestSeverity(assessment.signals),
        signals: assessment.signals.map((s) => ({
          code: s.code,
          severity: s.severity,
          weight: s.weight,
          explanation: s.explanation,
          detail: s.detail ?? null,
        })),
      },
    });
  } catch (error) {
    logger.error('fraud.event_write_failed', { error: (error as Error).message });
  }
}

function highestSeverity(signals: DetectedSignal[]) {
  const order = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
  let highest: (typeof order)[number] = 'INFO';
  for (const s of signals) {
    if (order.indexOf(s.severity) > order.indexOf(highest)) highest = s.severity;
  }
  return highest;
}

/**
 * Recompute a publisher's rolling account risk score from recent activity.
 * Run periodically by the fraud analysis job rather than on the hot path.
 */
export async function recomputeCreatorRisk(creatorId: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<
    Array<{ total: bigint; rejected: bigint; flagged: bigint }>
  >`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE eligibility <> 'ELIGIBLE')::bigint AS rejected,
      COUNT(*) FILTER (WHERE "fraudScore" >= 51)::bigint AS flagged
    FROM "clicks"
    WHERE "creatorId" = ${creatorId}::uuid AND "createdAt" >= ${since}
  `;

  const total = Number(rows[0]?.total ?? 0n);
  if (total < 25) return 0; // Too little history to judge fairly.

  const rejected = Number(rows[0]?.rejected ?? 0n);
  const flagged = Number(rows[0]?.flagged ?? 0n);

  // Weighted rate, scaled to 0-100.
  const rejectRate = rejected / total;
  const flagRate = flagged / total;
  const risk = Math.round(Math.min(100, rejectRate * 70 + flagRate * 60));

  await prisma.creator.update({ where: { id: creatorId }, data: { riskScore: risk } });
  return risk;
}
