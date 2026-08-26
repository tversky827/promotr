'use server';

import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requireCreator } from '@/lib/auth/guards';
import { brand, trackingLinkUrl } from '@/lib/brand';
import { generateTrackingCode } from '@/lib/crypto/ids';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { enforceRateLimit } from '@/lib/ratelimit';
import { getSettings } from '@/lib/settings';
import { invalidateLinkCache } from '@/lib/tracking/redirect';

import { action, actionError, actionOk } from './shared';

/**
 * Tracking link generation.
 *
 * This is the product's core promise: see a campaign, accept its terms, have a
 * working link in seconds. The only gates are the ones a brand explicitly asked
 * for (approval-required campaigns) or that protect the marketplace (suspended
 * accounts, inactive campaigns).
 *
 * The accepted terms version is recorded on the link itself, so if a brand
 * later changes the campaign terms there is a durable record of what each
 * publisher actually agreed to.
 */

const SUB_ID = z
  .string()
  .trim()
  .max(64, 'Sub-IDs can be at most 64 characters')
  .regex(/^[A-Za-z0-9_.\-]*$/, 'Use only letters, numbers, dashes, dots and underscores')
  .optional()
  .or(z.literal(''));

const UTM = z.string().trim().max(120).optional().or(z.literal(''));

const createLinkSchema = z.object({
  campaignId: z.string().uuid('That campaign is not valid'),
  acceptTerms: z
    .union([z.literal('on'), z.literal('true')])
    .transform(() => true)
    .refine((v) => v === true, { message: 'You must accept the campaign terms' }),
  label: z.string().trim().max(80).optional().or(z.literal('')),
  subId: SUB_ID,
  utmSource: UTM,
  utmMedium: UTM,
  utmCampaign: UTM,
  utmContent: UTM,
  channel: z.string().trim().max(40).optional().or(z.literal('')),
});

export const createTrackingLink = action(createLinkSchema, async (input, context) => {
  const { creator, user } = await requireCreator('creator:links:create');
  await enforceRateLimit('linkGeneration', creator.id);

  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    include: { budget: true, brand: { select: { displayName: true } } },
  });

  if (!campaign || (!campaign.isPublic && campaign.status !== 'ACTIVE')) {
    return actionError('That campaign is not available.');
  }
  if (campaign.status !== 'ACTIVE') {
    return actionError(
      `This campaign is ${campaign.status.toLowerCase().replace('_', ' ')} and is not accepting new traffic.`,
    );
  }
  if (creator.verification === 'SUSPENDED' || creator.verification === 'RESTRICTED') {
    return actionError(
      'Your publisher account cannot take new campaign links while it is under review.',
    );
  }

  // Approval-required campaigns need an accepted application first.
  if (campaign.requiresApproval) {
    const application = await prisma.campaignApplication.findUnique({
      where: { campaignId_creatorId: { campaignId: campaign.id, creatorId: creator.id } },
    });
    if (!application || application.status !== 'APPROVED') {
      return actionError(
        application?.status === 'PENDING'
          ? 'Your application to this campaign is still being reviewed.'
          : application?.status === 'REJECTED'
            ? 'Your application to this campaign was not accepted.'
            : 'This campaign requires approval. Apply first, then your link will be generated.',
        undefined,
        'APPROVAL_REQUIRED',
      );
    }
  }

  const settings = await getSettings();
  const existingCount = await prisma.trackingLink.count({
    where: { campaignId: campaign.id, creatorId: creator.id },
  });
  if (existingCount >= settings.maxLinksPerCreatorPerCampaign) {
    return actionError(
      `You have reached the limit of ${settings.maxLinksPerCreatorPerCampaign} links for this campaign. Deactivate one to create another.`,
    );
  }

  // Reuse an identical existing link rather than minting a near-duplicate:
  // a publisher clicking "Get link" twice should get the same link back.
  const duplicate = await prisma.trackingLink.findFirst({
    where: {
      campaignId: campaign.id,
      creatorId: creator.id,
      active: true,
      subId: input.subId || null,
      utmSource: input.utmSource || null,
      utmMedium: input.utmMedium || null,
      utmCampaign: input.utmCampaign || null,
      utmContent: input.utmContent || null,
    },
  });

  if (duplicate) {
    return actionOk({
      linkId: duplicate.id,
      code: duplicate.code,
      url: trackingLinkUrl(duplicate.code),
      reused: true,
    });
  }

  const link = await prisma.trackingLink.create({
    data: {
      code: generateTrackingCode(),
      campaignId: campaign.id,
      creatorId: creator.id,
      label: input.label || null,
      subId: input.subId || null,
      utmSource: input.utmSource || null,
      utmMedium: input.utmMedium || null,
      utmCampaign: input.utmCampaign || null,
      utmContent: input.utmContent || null,
      channel: (input.channel || null) as never,
      // Durable record of exactly which terms this publisher agreed to.
      termsVersion: campaign.termsVersion,
      termsAcceptedAt: new Date(),
    },
  });

  await recordAudit({
    actorUserId: user.id,
    actorRole: 'CREATOR',
    actorIp: context.ip,
    action: 'link.created',
    entityKind: 'tracking_link',
    entityId: link.id,
    metadata: {
      campaignId: campaign.id,
      creatorId: creator.id,
      termsVersion: campaign.termsVersion,
    },
  });

  logger.info('link.created', {
    linkId: link.id,
    campaignId: campaign.id,
    creatorId: creator.id,
  });

  return actionOk({
    linkId: link.id,
    code: link.code,
    url: trackingLinkUrl(link.code),
    reused: false,
  });
});

const applySchema = z.object({
  campaignId: z.string().uuid(),
  message: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const applyToCampaign = action(applySchema, async (input, context) => {
  const { creator, user } = await requireCreator('creator:links:create');

  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, name: true, brandId: true, requiresApproval: true, status: true },
  });
  if (!campaign || campaign.status !== 'ACTIVE') {
    return actionError('That campaign is not available.');
  }
  if (!campaign.requiresApproval) {
    return actionError('This campaign is open — you can take a link directly.');
  }

  const existing = await prisma.campaignApplication.findUnique({
    where: { campaignId_creatorId: { campaignId: campaign.id, creatorId: creator.id } },
  });
  if (existing && existing.status !== 'WITHDRAWN') {
    return actionError(
      existing.status === 'PENDING'
        ? 'Your application is already being reviewed.'
        : existing.status === 'APPROVED'
          ? 'You are already approved for this campaign.'
          : 'Your application to this campaign was not accepted.',
    );
  }

  await prisma.campaignApplication.upsert({
    where: { campaignId_creatorId: { campaignId: campaign.id, creatorId: creator.id } },
    create: {
      campaignId: campaign.id,
      creatorId: creator.id,
      message: input.message || null,
    },
    update: { status: 'PENDING', message: input.message || null, decidedAt: null },
  });

  const { notifyBrand } = await import('@/lib/notify');
  await notifyBrand(campaign.brandId, {
    type: 'generic',
    title: 'A publisher applied to your campaign',
    body: `${creator.handle} applied to promote ${campaign.name}.`,
    actionPath: `/brand/campaigns/${campaign.id}/publishers`,
    email: false,
  });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'campaign.application.created',
    entityKind: 'campaign',
    entityId: campaign.id,
    metadata: { creatorId: creator.id },
  });

  return actionOk(undefined, 'Application sent. You will be notified when the brand responds.');
});

const updateLinkSchema = z.object({
  linkId: z.string().uuid(),
  label: z.string().trim().max(80).optional().or(z.literal('')),
  active: z.union([z.literal('on'), z.literal('true'), z.literal('false'), z.undefined()]).optional(),
});

export const updateTrackingLink = action(updateLinkSchema, async (input) => {
  const { creator } = await requireCreator('creator:links:create');

  const link = await prisma.trackingLink.findFirst({
    where: { id: input.linkId, creatorId: creator.id },
  });
  if (!link) return actionError('That link was not found.');

  const active = input.active === 'on' || input.active === 'true';

  const updated = await prisma.trackingLink.update({
    where: { id: link.id },
    data: { label: input.label || null, active },
  });

  // The redirect path caches link resolution; deactivation must take effect now.
  await invalidateLinkCache(link.code);

  return actionOk(
    { active: updated.active },
    updated.active ? 'Link is active.' : 'Link deactivated. It will stop redirecting shortly.',
  );
});

const deactivateSchema = z.object({ linkId: z.string().uuid() });

export const deactivateTrackingLink = action(deactivateSchema, async (input) => {
  const { creator } = await requireCreator('creator:links:create');

  const link = await prisma.trackingLink.findFirst({
    where: { id: input.linkId, creatorId: creator.id },
  });
  if (!link) return actionError('That link was not found.');

  await prisma.trackingLink.update({ where: { id: link.id }, data: { active: false } });
  await invalidateLinkCache(link.code);

  return actionOk(undefined, 'Link deactivated.');
});

/** Builds a shareable URL with UTM parameters, without creating a new link. */
export async function buildShareUrl(params: {
  code: string;
  subId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}): Promise<string> {
  const url = new URL(trackingLinkUrl(params.code));
  if (params.subId) url.searchParams.set('subid', params.subId);
  if (params.utmSource) url.searchParams.set('utm_source', params.utmSource);
  if (params.utmMedium) url.searchParams.set('utm_medium', params.utmMedium);
  if (params.utmCampaign) url.searchParams.set('utm_campaign', params.utmCampaign);
  return url.toString();
}

export async function trackingBaseUrl(): Promise<string> {
  return brand.trackingUrl;
}
