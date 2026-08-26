import { trackingLinkUrl } from '@/lib/brand';
import { generateTrackingCode } from '@/lib/crypto/ids';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { getSettings } from '@/lib/settings';

/**
 * Issuing a tracking link.
 *
 * This is the product's central promise — see a campaign, accept its terms,
 * have a working link in seconds — so it lives here rather than inside a server
 * action: the rules that decide whether a publisher gets a link are business
 * rules, and they are testable without a request, a session or a form.
 *
 * The only gates are ones a brand explicitly asked for (approval-required
 * campaigns) or ones that protect the marketplace (suspended publishers,
 * campaigns that are not live).
 */

export interface LinkOptions {
  label?: string | null;
  subId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  channel?: string | null;
}

export interface IssuedLink {
  linkId: string;
  code: string;
  url: string;
  /** True when an identical link already existed and was returned instead. */
  reused: boolean;
  campaignId: string;
  termsVersion: number;
}

export type IssueRefusal = {
  ok: false;
  /** Machine-readable so the UI can offer the right next step. */
  code:
    | 'CAMPAIGN_NOT_FOUND'
    | 'CAMPAIGN_NOT_ACTIVE'
    | 'PUBLISHER_RESTRICTED'
    | 'APPROVAL_REQUIRED'
    | 'APPLICATION_PENDING'
    | 'APPLICATION_REJECTED'
    | 'LINK_LIMIT_REACHED';
  reason: string;
};

export type IssueResult = ({ ok: true } & IssuedLink) | IssueRefusal;

export async function issueTrackingLink(params: {
  creator: { id: string; verification: string };
  campaignId: string;
  options?: LinkOptions;
}): Promise<IssueResult> {
  const { creator, campaignId, options = {} } = params;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      isPublic: true,
      requiresApproval: true,
      termsVersion: true,
    },
  });

  if (!campaign || (!campaign.isPublic && campaign.status !== 'ACTIVE')) {
    return { ok: false, code: 'CAMPAIGN_NOT_FOUND', reason: 'That campaign is not available.' };
  }

  if (campaign.status !== 'ACTIVE') {
    return {
      ok: false,
      code: 'CAMPAIGN_NOT_ACTIVE',
      reason: `This campaign is ${campaign.status.toLowerCase().replace('_', ' ')} and is not accepting new traffic.`,
    };
  }

  // A suspended or restricted publisher gets no new links. Traffic they have
  // already sent is a separate question, decided by the fraud review — this
  // only stops the flow of new billable activity.
  if (creator.verification === 'SUSPENDED' || creator.verification === 'RESTRICTED') {
    return {
      ok: false,
      code: 'PUBLISHER_RESTRICTED',
      reason: 'Your publisher account cannot take new campaign links while it is under review.',
    };
  }

  if (campaign.requiresApproval) {
    const application = await prisma.campaignApplication.findUnique({
      where: { campaignId_creatorId: { campaignId: campaign.id, creatorId: creator.id } },
      select: { status: true },
    });

    if (!application) {
      return {
        ok: false,
        code: 'APPROVAL_REQUIRED',
        reason: 'This campaign requires approval. Apply first, then your link will be generated.',
      };
    }
    if (application.status === 'PENDING') {
      return {
        ok: false,
        code: 'APPLICATION_PENDING',
        reason: 'Your application to this campaign is still being reviewed.',
      };
    }
    if (application.status !== 'APPROVED') {
      return {
        ok: false,
        code: 'APPLICATION_REJECTED',
        reason: 'Your application to this campaign was not accepted.',
      };
    }
  }

  const settings = await getSettings();
  const existingCount = await prisma.trackingLink.count({
    where: { campaignId: campaign.id, creatorId: creator.id },
  });
  if (existingCount >= settings.maxLinksPerCreatorPerCampaign) {
    return {
      ok: false,
      code: 'LINK_LIMIT_REACHED',
      reason: `You have reached the limit of ${settings.maxLinksPerCreatorPerCampaign} links for this campaign. Deactivate one to create another.`,
    };
  }

  // Reuse an identical existing link rather than minting a near-duplicate: a
  // publisher clicking "Get link" twice should get the same link back, not a
  // second one that splits their reporting.
  const duplicate = await prisma.trackingLink.findFirst({
    where: {
      campaignId: campaign.id,
      creatorId: creator.id,
      active: true,
      subId: options.subId || null,
      utmSource: options.utmSource || null,
      utmMedium: options.utmMedium || null,
      utmCampaign: options.utmCampaign || null,
      utmContent: options.utmContent || null,
    },
  });

  if (duplicate) {
    return {
      ok: true,
      linkId: duplicate.id,
      code: duplicate.code,
      url: trackingLinkUrl(duplicate.code),
      reused: true,
      campaignId: campaign.id,
      termsVersion: duplicate.termsVersion,
    };
  }

  const link = await prisma.trackingLink.create({
    data: {
      code: generateTrackingCode(),
      campaignId: campaign.id,
      creatorId: creator.id,
      label: options.label || null,
      subId: options.subId || null,
      utmSource: options.utmSource || null,
      utmMedium: options.utmMedium || null,
      utmCampaign: options.utmCampaign || null,
      utmContent: options.utmContent || null,
      channel: (options.channel || null) as never,
      // Durable record of exactly which terms this publisher agreed to, so a
      // later change by the brand cannot rewrite what was agreed.
      termsVersion: campaign.termsVersion,
      termsAcceptedAt: new Date(),
    },
  });

  logger.info('link.created', {
    linkId: link.id,
    campaignId: campaign.id,
    creatorId: creator.id,
  });

  return {
    ok: true,
    linkId: link.id,
    code: link.code,
    url: trackingLinkUrl(link.code),
    reused: false,
    campaignId: campaign.id,
    termsVersion: link.termsVersion,
  };
}
