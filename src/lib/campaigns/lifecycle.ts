import { availableMicros } from '@/lib/billing/budget';

/**
 * Campaign launch gating.
 *
 * Separated from the server action because these are the rules that decide
 * whether real money starts moving, and rules that decide that should be
 * readable — and testable — on their own, without a session or a form.
 *
 * The rule that matters most is solvency: a campaign cannot go live without
 * funds behind it. A publisher who accrues an earning the brand cannot pay is
 * a publisher we have lied to.
 */

export type LaunchDecision =
  | { ok: true; availableMicros: bigint }
  | { ok: false; code: LaunchBlock; reason: string }
  | { ok: 'already-live' };

export type LaunchBlock =
  | 'IN_REVIEW'
  | 'REJECTED'
  | 'NOT_SUBMITTED'
  | 'BRAND_UNVERIFIED'
  | 'UNFUNDED';

export function launchDecision(params: {
  campaign: { status: string };
  budget: { fundedMicros: bigint; reservedMicros: bigint; spentMicros: bigint } | null;
  brandVerification: string;
  brandVerificationRequired: boolean;
}): LaunchDecision {
  const { campaign, budget, brandVerification, brandVerificationRequired } = params;

  if (campaign.status === 'ACTIVE') return { ok: 'already-live' };

  if (campaign.status !== 'APPROVED' && campaign.status !== 'PAUSED') {
    return {
      ok: false,
      code:
        campaign.status === 'PENDING_REVIEW'
          ? 'IN_REVIEW'
          : campaign.status === 'REJECTED'
            ? 'REJECTED'
            : 'NOT_SUBMITTED',
      reason:
        campaign.status === 'PENDING_REVIEW'
          ? 'This campaign is still in review.'
          : campaign.status === 'REJECTED'
            ? 'This campaign was not approved. Edit it and resubmit.'
            : 'Submit the campaign for review before launching it.',
    };
  }

  if (brandVerificationRequired && brandVerification !== 'VERIFIED') {
    return {
      ok: false,
      code: 'BRAND_UNVERIFIED',
      reason:
        'Your business needs to be verified before campaigns can go live. We will email you when it is done.',
    };
  }

  const available = budget ? availableMicros(budget) : 0n;
  if (available <= 0n) {
    return {
      ok: false,
      code: 'UNFUNDED',
      reason:
        'Fund the campaign before launching it. Publishers must never accrue earnings that cannot be paid.',
    };
  }

  return { ok: true, availableMicros: available };
}
