import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { notifyAdmins, notifyBrand } from '@/lib/notify';
import { getSettings } from '@/lib/settings';
import { screenUrl, validateDestinationUrl } from '@/lib/urlsafety';
import { brand as branding } from '@/lib/brand';

/**
 * Campaign moderation.
 *
 * Produces a risk score (0-100) and a list of flags. Above the configured
 * threshold — or whenever a check could not be performed — the campaign goes to
 * a human. Auto-approval only happens when every check ran and every check
 * passed, which is why an unconfigured Safe Browsing key results in manual
 * review rather than a silent pass.
 */

export interface ModerationFlag {
  code: string;
  weight: number;
  detail: string;
}

export interface ModerationResult {
  score: number;
  flags: ModerationFlag[];
  decision: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED';
  notes: string;
}

/** Claims no advertiser may make on this platform, regardless of vertical. */
const UNREALISTIC_CLAIMS = [
  /\bguaranteed\s+(income|profit|returns?|earnings)\b/i,
  /\brisk[-\s]?free\s+(investment|returns?)\b/i,
  /\bget\s+rich\s+quick\b/i,
  /\bmake\s+\$?\d[\d,]*\s*(\/|per\s+)?(day|week|hour)\s+guaranteed\b/i,
  /\bcures?\s+(cancer|diabetes|covid)\b/i,
  /\bmiracle\s+(cure|treatment)\b/i,
  /\bdoctors?\s+hate\s+(him|her|this)\b/i,
  /\bno\s+risk\b.*\bguaranteed\b/i,
];

const RESTRICTED_VERTICALS: Array<[RegExp, string]> = [
  [/\b(binary\s+options?|forex\s+signals?|crypto\s+(investment|trading)\s+bot)\b/i, 'speculative-finance'],
  [/\b(payday|title)\s+loans?\b/i, 'payday-loans'],
  [/\b(cbd|kratom|nootropic)\b/i, 'regulated-substances'],
  [/\b(casino|sportsbook|betting|gambling)\b/i, 'gambling'],
  [/\b(vape|e-?cigarette|nicotine|tobacco)\b/i, 'tobacco'],
  [/\b(firearms?|ammunition|silencers?)\b/i, 'weapons'],
  [/\b(escort|adult\s+dating|webcam\s+girls)\b/i, 'adult'],
  [/\b(essay\s+writing\s+service|diploma\s+mill)\b/i, 'academic-fraud'],
];

export async function moderateCampaign(campaignId: string): Promise<ModerationResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { brand: true },
  });
  if (!campaign) {
    return { score: 100, flags: [], decision: 'REJECTED', notes: 'Campaign not found' };
  }

  const settings = await getSettings();
  const flags: ModerationFlag[] = [];
  const haystack =
    `${campaign.name} ${campaign.description} ${campaign.offerSummary} ${campaign.objective}`.toLowerCase();

  // --- Destination URL -----------------------------------------------------

  const validation = validateDestinationUrl(campaign.destinationUrl, { requireHttps: true });
  if (!validation.ok) {
    flags.push({
      code: 'INVALID_DESTINATION',
      weight: 100,
      detail: validation.errors.join(' '),
    });
  }
  for (const warning of validation.warnings) {
    flags.push({ code: 'DESTINATION_WARNING', weight: 15, detail: warning });
  }

  const screening = await screenUrl(campaign.destinationUrl);
  if (screening.checked && !screening.safe) {
    flags.push({
      code: 'MALICIOUS_DESTINATION',
      weight: 100,
      detail: `Safe Browsing flagged this URL: ${screening.threats.join(', ')}`,
    });
  } else if (!screening.checked) {
    // The check could not run. That is not a pass — it is an unknown, and an
    // unknown means a human looks at it.
    flags.push({
      code: 'SCREENING_UNAVAILABLE',
      weight: 30,
      detail: screening.unavailableReason ?? 'URL screening did not run',
    });
  }

  // --- Content -------------------------------------------------------------

  for (const pattern of UNREALISTIC_CLAIMS) {
    const match = pattern.exec(haystack);
    if (match) {
      flags.push({
        code: 'UNREALISTIC_CLAIM',
        weight: 45,
        detail: `Contains an unsupportable claim: "${match[0]}"`,
      });
    }
  }

  for (const keyword of settings.prohibitedKeywords) {
    if (haystack.includes(keyword.toLowerCase())) {
      flags.push({
        code: 'PROHIBITED_KEYWORD',
        weight: 40,
        detail: `Contains a prohibited phrase: "${keyword}"`,
      });
    }
  }

  for (const [pattern, vertical] of RESTRICTED_VERTICALS) {
    if (pattern.test(haystack)) {
      const prohibited = settings.prohibitedCategories.includes(vertical);
      flags.push({
        code: prohibited ? 'PROHIBITED_CATEGORY' : 'RESTRICTED_VERTICAL',
        weight: prohibited ? 100 : 35,
        detail: prohibited
          ? `This platform does not accept ${vertical} campaigns`
          : `Appears to be a regulated vertical (${vertical}) and needs manual review`,
      });
    }
  }

  if (settings.prohibitedCategories.includes(campaign.category.toLowerCase())) {
    flags.push({
      code: 'PROHIBITED_CATEGORY',
      weight: 100,
      detail: `The category "${campaign.category}" is not accepted`,
    });
  }

  // --- Advertiser trust ----------------------------------------------------

  if (campaign.brand.verification !== 'VERIFIED') {
    flags.push({
      code: 'UNVERIFIED_BRAND',
      weight: settings.brandVerificationRequiredToLaunch ? 60 : 25,
      detail: `The advertiser is ${campaign.brand.verification.toLowerCase()}`,
    });
  }

  const brandAgeMs = Date.now() - campaign.brand.createdAt.getTime();
  if (brandAgeMs < 24 * 60 * 60 * 1000) {
    flags.push({
      code: 'NEW_ADVERTISER',
      weight: 15,
      detail: 'The advertiser account was created in the last 24 hours',
    });
  }

  // Destination domain should belong to the advertiser.
  const destinationHost = safeHost(campaign.destinationUrl);
  const websiteHost = safeHost(campaign.brand.website);
  if (destinationHost && websiteHost && !hostsRelated(destinationHost, websiteHost)) {
    flags.push({
      code: 'DESTINATION_DOMAIN_MISMATCH',
      weight: 25,
      detail: `The destination (${destinationHost}) is not on the advertiser's stated website domain (${websiteHost})`,
    });
  }

  // --- Decision ------------------------------------------------------------

  const score = Math.min(100, flags.reduce((sum, f) => sum + f.weight, 0));
  const blocking = flags.some((f) => f.weight >= 100);

  let decision: ModerationResult['decision'];
  if (blocking) decision = 'REJECTED';
  else if (score >= settings.campaignModerationScoreThreshold) decision = 'PENDING_REVIEW';
  else if (settings.campaignAutoApproveEnabled && flags.length === 0) decision = 'APPROVED';
  else decision = 'PENDING_REVIEW';

  const notes =
    flags.length === 0
      ? 'All automated checks passed.'
      : flags.map((f) => `[${f.code}] ${f.detail}`).join('\n');

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      moderationScore: score,
      moderationFlags: flags.map((f) => f.code),
      moderationNotes: notes,
      status:
        decision === 'REJECTED'
          ? 'REJECTED'
          : decision === 'APPROVED'
            ? 'APPROVED'
            : 'PENDING_REVIEW',
      reviewedAt: decision === 'APPROVED' ? new Date() : null,
    },
  });

  logger.info('campaign.moderated', { campaignId, score, decision, flags: flags.map((f) => f.code) });

  if (decision === 'REJECTED') {
    await notifyBrand(campaign.brandId, {
      type: 'campaign.rejected',
      title: `${campaign.name} was not approved`,
      body: notes,
      actionPath: `/brand/campaigns/${campaignId}`,
      emailTemplate: {
        name: 'campaignRejected',
        params: {
          campaignName: campaign.name,
          reason: notes,
          url: `${branding.appUrl}/brand/campaigns/${campaignId}`,
        },
      },
    });
  } else if (decision === 'APPROVED') {
    await notifyBrand(campaign.brandId, {
      type: 'campaign.approved',
      title: `${campaign.name} is approved`,
      body: 'Fund the campaign to make it visible to publishers.',
      actionPath: `/brand/campaigns/${campaignId}/funding`,
      emailTemplate: {
        name: 'campaignApproved',
        params: {
          campaignName: campaign.name,
          url: `${branding.appUrl}/brand/campaigns/${campaignId}/funding`,
        },
      },
    });
  } else {
    await notifyAdmins({
      type: 'generic',
      title: 'A campaign needs review',
      body: `${campaign.name} (${campaign.brand.displayName}) scored ${score} in moderation.`,
      actionPath: `/admin/campaigns/${campaignId}`,
      email: false,
    });
  }

  return { score, flags, decision, notes };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function hostsRelated(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
