import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

/**
 * Platform settings.
 *
 * Everything an operator might need to change without a deploy lives here:
 * fees, payout thresholds, fraud cut-offs, verification requirements. Defaults
 * are declared in code (so a fresh database boots working) and overridden by
 * rows in `platform_settings`.
 *
 * Reads are cached in-process for a short TTL. The cache is per-instance, so a
 * change takes at most CACHE_TTL_MS to propagate everywhere; that is acceptable
 * for configuration and avoids a database round trip on every priced event.
 */

export interface PlatformSettings {
  /** Default platform fee in basis points, taken from the brand's spend. */
  platformFeeBps: number;
  /** Flat per-event fee in micros, applied on top of the percentage. */
  platformFeeFlatMicros: string;
  /** Minimum balance a publisher must reach to request a payout. */
  minimumPayoutMicros: string;
  /** Days an approved earning waits before becoming withdrawable. */
  earningHoldDays: number;
  /** Days a conversion stays PENDING before auto-approval, if enabled. */
  conversionAutoApproveDays: number;
  conversionAutoApproveEnabled: boolean;

  /** Fraud score bands (0-100). */
  fraudReviewThreshold: number;
  fraudSuspiciousThreshold: number;
  fraudRejectThreshold: number;
  /** Clicks above this score are held for review rather than paid immediately. */
  fraudAutoHoldEnabled: boolean;

  /** Campaign moderation. */
  campaignAutoApproveEnabled: boolean;
  campaignModerationScoreThreshold: number;
  prohibitedCategories: string[];
  prohibitedKeywords: string[];

  /** Verification requirements. */
  brandVerificationRequiredToLaunch: boolean;
  creatorVerificationRequiredForPayout: boolean;
  creatorTaxFormRequiredForPayout: boolean;

  /** Limits. */
  maxActiveCampaignsPerBrand: number;
  maxLinksPerCreatorPerCampaign: number;
  minCampaignFundingMicros: string;

  /** Payout scheduling. */
  payoutScheduleCron: string;
  payoutAutoApproveUnderMicros: string;

  supportedCurrencies: string[];
  supportedCountries: string[];

  /** Notifications. */
  notifyBrandOnConversion: boolean;
  notifyCreatorOnEarning: boolean;
  budgetLowNotifyBps: number;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  platformFeeBps: 2000, // 20%
  platformFeeFlatMicros: '0',
  minimumPayoutMicros: '25000000', // $25.00
  earningHoldDays: 7,
  conversionAutoApproveDays: 30,
  conversionAutoApproveEnabled: true,

  fraudReviewThreshold: 21,
  fraudSuspiciousThreshold: 51,
  fraudRejectThreshold: 76,
  fraudAutoHoldEnabled: true,

  campaignAutoApproveEnabled: false,
  campaignModerationScoreThreshold: 40,
  prohibitedCategories: [
    'adult',
    'gambling',
    'weapons',
    'tobacco',
    'illicit-drugs',
    'payday-loans',
    'cryptocurrency-investment',
  ],
  prohibitedKeywords: [
    'guaranteed income',
    'get rich quick',
    'risk free investment',
    'miracle cure',
    'cures cancer',
    'no risk guaranteed returns',
  ],

  brandVerificationRequiredToLaunch: true,
  creatorVerificationRequiredForPayout: true,
  creatorTaxFormRequiredForPayout: true,

  maxActiveCampaignsPerBrand: 100,
  maxLinksPerCreatorPerCampaign: 25,
  minCampaignFundingMicros: '50000000', // $50.00

  payoutScheduleCron: '0 9 * * 1', // Mondays 09:00 UTC
  payoutAutoApproveUnderMicros: '500000000', // $500.00

  supportedCurrencies: ['usd'],
  supportedCountries: [
    'US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE',
    'SE', 'NO', 'DK', 'FI', 'PT', 'AT', 'CH', 'PL', 'CZ', 'SG', 'JP', 'MX', 'BR',
  ],

  notifyBrandOnConversion: false,
  notifyCreatorOnEarning: true,
  budgetLowNotifyBps: 1500,
};

export const SETTING_DESCRIPTIONS: Record<keyof PlatformSettings, string> = {
  platformFeeBps: 'Default platform commission in basis points (2000 = 20%).',
  platformFeeFlatMicros: 'Flat platform fee per billable event, in micros.',
  minimumPayoutMicros: 'Minimum available balance before a publisher may request a payout.',
  earningHoldDays: 'Days an approved earning is held before becoming withdrawable.',
  conversionAutoApproveDays: 'Days after which a pending conversion is auto-approved.',
  conversionAutoApproveEnabled: 'Whether pending conversions auto-approve after the hold period.',
  fraudReviewThreshold: 'Risk score at or above which an event is flagged for review.',
  fraudSuspiciousThreshold: 'Risk score at or above which an event is treated as suspicious.',
  fraudRejectThreshold: 'Risk score at or above which an event is rejected outright.',
  fraudAutoHoldEnabled: 'Hold earnings from high-risk traffic pending manual review.',
  campaignAutoApproveEnabled: 'Approve campaigns automatically when moderation finds nothing.',
  campaignModerationScoreThreshold: 'Moderation score above which a campaign needs human review.',
  prohibitedCategories: 'Campaign categories that may not be listed.',
  prohibitedKeywords: 'Phrases that flag a campaign for manual review.',
  brandVerificationRequiredToLaunch: 'Require brand verification before a campaign can go live.',
  creatorVerificationRequiredForPayout: 'Require publisher verification before paying out.',
  creatorTaxFormRequiredForPayout: 'Require a tax form on file before paying out.',
  maxActiveCampaignsPerBrand: 'Maximum simultaneously active campaigns per brand.',
  maxLinksPerCreatorPerCampaign: 'Maximum tracking links one publisher may create per campaign.',
  minCampaignFundingMicros: 'Minimum amount a campaign must be funded with.',
  payoutScheduleCron: 'Cron expression for the automatic payout run.',
  payoutAutoApproveUnderMicros: 'Payout requests below this amount skip manual approval.',
  supportedCurrencies: 'Currencies the platform will transact in.',
  supportedCountries: 'Countries publishers and brands may register from.',
  notifyBrandOnConversion: 'Email brands on every conversion (noisy at volume).',
  notifyCreatorOnEarning: 'Email publishers when they earn.',
  budgetLowNotifyBps: 'Remaining-budget percentage that triggers a low-balance alert.',
};

const CACHE_TTL_MS = 30_000;
let cache: { value: PlatformSettings; expiresAt: number } | null = null;

export async function getSettings(): Promise<PlatformSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  try {
    const rows = await prisma.platformSetting.findMany();
    const merged = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key in merged) {
        (merged as Record<string, unknown>)[row.key] = row.value;
      }
    }
    cache = { value: merged, expiresAt: Date.now() + CACHE_TTL_MS };
    return merged;
  } catch (error) {
    // Never let a settings read failure take down a request path; defaults are
    // safe values by construction.
    logger.error('settings.read_failed', { error: (error as Error).message });
    return { ...DEFAULT_SETTINGS };
  }
}

export async function getSetting<K extends keyof PlatformSettings>(
  key: K,
): Promise<PlatformSettings[K]> {
  return (await getSettings())[key];
}

export async function updateSetting<K extends keyof PlatformSettings>(
  key: K,
  value: PlatformSettings[K],
  actorUserId: string,
): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: {
      key,
      value: value as never,
      description: SETTING_DESCRIPTIONS[key],
      updatedByUserId: actorUserId,
    },
    update: { value: value as never, updatedByUserId: actorUserId },
  });
  invalidateSettingsCache();
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/** Micros-typed accessors, so callers never juggle the string encoding. */
export async function getMicrosSetting(
  key: 'platformFeeFlatMicros' | 'minimumPayoutMicros' | 'minCampaignFundingMicros' | 'payoutAutoApproveUnderMicros',
): Promise<bigint> {
  return BigInt(await getSetting(key));
}
