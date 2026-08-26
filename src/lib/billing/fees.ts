import { applyBps } from '@/lib/money';
import { getSettings } from '@/lib/settings';

import type { Campaign, Creator } from '@prisma/client';

/**
 * Platform fee resolution.
 *
 * The fee is what the platform keeps out of what the brand spends:
 *
 *   gross  = what the brand is charged for the event
 *   fee    = gross * feeBps + flatFee
 *   net    = gross - fee   → what the publisher earns
 *
 * The campaign's `payoutMicros` is the PUBLISHER'S net earning — the number
 * shown in the marketplace — so gross is derived upward from it. A brand
 * advertising "$0.20 per click" with a 25% fee is charged $0.2667 and the
 * publisher receives exactly $0.20. Quoting the publisher's number is the
 * honest way round: the creator sees precisely what they will be paid.
 *
 * Precedence, most specific first:
 *   1. campaign.platformFeeBps
 *   2. creator.feeBpsOverride  (publisher tier / negotiated rate)
 *   3. brand.defaultFeeBps
 *   4. platform default setting
 */

export interface FeeInputs {
  campaignFeeBps?: number | null;
  campaignFeeFlatMicros?: bigint | null;
  creatorFeeBps?: number | null;
  brandFeeBps?: number | null;
}

export interface ResolvedFee {
  feeBps: number;
  flatMicros: bigint;
  source: 'campaign' | 'creator' | 'brand' | 'platform';
}

export async function resolveFee(inputs: FeeInputs): Promise<ResolvedFee> {
  const settings = await getSettings();
  const flatMicros = inputs.campaignFeeFlatMicros ?? BigInt(settings.platformFeeFlatMicros);

  if (inputs.campaignFeeBps !== null && inputs.campaignFeeBps !== undefined) {
    return { feeBps: inputs.campaignFeeBps, flatMicros, source: 'campaign' };
  }
  if (inputs.creatorFeeBps !== null && inputs.creatorFeeBps !== undefined) {
    return { feeBps: inputs.creatorFeeBps, flatMicros, source: 'creator' };
  }
  if (inputs.brandFeeBps !== null && inputs.brandFeeBps !== undefined) {
    return { feeBps: inputs.brandFeeBps, flatMicros, source: 'brand' };
  }
  return { feeBps: settings.platformFeeBps, flatMicros, source: 'platform' };
}

export interface FeeBreakdown {
  grossMicros: bigint;
  feeMicros: bigint;
  netMicros: bigint;
  feeBps: number;
}

/**
 * Given the publisher's net earning, compute what the brand is charged.
 *
 *   net = gross - (gross * bps / 10000) - flat
 *   ⇒ gross = (net + flat) / (1 - bps/10000)
 *
 * Computed with integer arithmetic throughout; `feeMicros` is then derived by
 * subtraction so gross == fee + net holds exactly, which the
 * `earnings_amounts_consistent` database constraint enforces.
 */
export function grossFromNet(netMicros: bigint, fee: ResolvedFee): FeeBreakdown {
  if (netMicros <= 0n) {
    return { grossMicros: 0n, feeMicros: 0n, netMicros: 0n, feeBps: fee.feeBps };
  }
  const bps = BigInt(Math.max(0, Math.min(9999, Math.trunc(fee.feeBps))));
  const numerator = (netMicros + fee.flatMicros) * 10_000n;
  const denominator = 10_000n - bps;
  // Round the brand's charge up so the publisher's net is never short-changed
  // by rounding; the platform absorbs at most one micro.
  const gross = (numerator + denominator - 1n) / denominator;
  return {
    grossMicros: gross,
    feeMicros: gross - netMicros,
    netMicros,
    feeBps: fee.feeBps,
  };
}

/**
 * Given what the brand is charged, split out the fee. Used for revenue-share
 * campaigns, where the brand's spend is a percentage of real revenue and is
 * therefore the known quantity.
 */
export function splitGross(grossMicros: bigint, fee: ResolvedFee): FeeBreakdown {
  if (grossMicros <= 0n) {
    return { grossMicros: 0n, feeMicros: 0n, netMicros: 0n, feeBps: fee.feeBps };
  }
  let feeMicros = applyBps(grossMicros, fee.feeBps) + fee.flatMicros;
  if (feeMicros > grossMicros) feeMicros = grossMicros;
  if (feeMicros < 0n) feeMicros = 0n;
  return {
    grossMicros,
    feeMicros,
    netMicros: grossMicros - feeMicros,
    feeBps: fee.feeBps,
  };
}

export async function feeForCampaign(
  campaign: Pick<Campaign, 'platformFeeBps' | 'platformFeeFlatMicros'>,
  creator: Pick<Creator, 'feeBpsOverride'> | null,
  brandDefaultFeeBps: number | null,
): Promise<ResolvedFee> {
  return resolveFee({
    campaignFeeBps: campaign.platformFeeBps,
    campaignFeeFlatMicros: campaign.platformFeeFlatMicros || null,
    creatorFeeBps: creator?.feeBpsOverride ?? null,
    brandFeeBps: brandDefaultFeeBps,
  });
}
