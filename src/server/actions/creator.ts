'use server';

import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requireCreator } from '@/lib/auth/guards';
import {
  checkPayoutEligibility,
  createConnectDashboardLink,
  createConnectOnboardingLink,
  requestPayout,
} from '@/lib/billing/payouts';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { enforceRateLimit } from '@/lib/ratelimit';
import { requestExport } from '@/lib/analytics/exports';

import { action, actionError, actionOk, stringArraySchema, type ActionResult } from './shared';

/**
 * Publisher account actions: profile, payout setup, withdrawals, exports.
 */

const HANDLE = z
  .string()
  .trim()
  .min(3, 'Handles need at least 3 characters')
  .max(40, 'Handles can be at most 40 characters')
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Use lowercase letters, numbers and dashes only');

const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a display name').max(80),
  handle: HANDLE,
  bio: z.string().trim().max(1000, 'Keep your bio under 1000 characters').optional().or(z.literal('')),
  website: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || /^https?:\/\/.+\..+/.test(v), 'Enter a full URL starting with https://')
    .optional()
    .or(z.literal('')),
  publisherType: z.enum([
    'CREATOR', 'WEBSITE', 'NEWSLETTER', 'COMMUNITY', 'APP', 'PODCAST', 'MEDIA_COMPANY',
  ]),
  categories: stringArraySchema,
  audienceCountries: stringArraySchema,
  channels: stringArraySchema,
  country: z.string().trim().length(2, 'Use a two-letter country code').toUpperCase(),
  isPublic: z
    .union([z.literal('on'), z.literal('true'), z.undefined(), z.null()])
    .transform((v) => v === 'on' || v === 'true'),
});

export const updateCreatorProfile = action(profileSchema, async (input, context) => {
  const { creator, user } = await requireCreator('creator:update');

  // The handle appears in public profile URLs, so uniqueness is enforced.
  if (input.handle !== creator.handle) {
    const taken = await prisma.creator.findUnique({
      where: { handle: input.handle },
      select: { id: true },
    });
    if (taken && taken.id !== creator.id) {
      return actionError('That handle is already taken.', { handle: 'Already taken' });
    }
  }

  await prisma.$transaction([
    prisma.creator.update({
      where: { id: creator.id },
      data: {
        handle: input.handle,
        publisherType: input.publisherType,
        country: input.country,
      },
    }),
    prisma.creatorProfile.upsert({
      where: { creatorId: creator.id },
      create: {
        creatorId: creator.id,
        displayName: input.displayName,
        bio: input.bio || null,
        website: input.website || null,
        categories: input.categories,
        audienceCountries: input.audienceCountries.map((c) => c.toUpperCase()),
        channels: input.channels as never,
        isPublic: input.isPublic,
      },
      update: {
        displayName: input.displayName,
        bio: input.bio || null,
        website: input.website || null,
        categories: input.categories,
        audienceCountries: input.audienceCountries.map((c) => c.toUpperCase()),
        channels: input.channels as never,
        isPublic: input.isPublic,
      },
    }),
  ]);

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'creator.profile_updated',
    entityKind: 'creator',
    entityId: creator.id,
  });

  return actionOk(undefined, 'Profile saved.');
});

const socialSchema = z.object({
  platform: z.string().trim().min(1),
  handle: z.string().trim().min(1, 'Enter your handle on that platform').max(120),
  profileUrl: z.string().trim().max(300).optional().or(z.literal('')),
  followers: z.string().trim().optional().or(z.literal('')),
});

/**
 * Connect a social account.
 *
 * Self-declared rather than API-verified: the platform APIs each require their
 * own OAuth app and review process, and gating participation on them would
 * exclude exactly the long-tail publishers this marketplace is for. The data is
 * treated as a claim (shown as "self-reported") and never affects payouts,
 * which are driven purely by measured traffic. The schema supports real
 * verification (`verifiedAt`, token columns) when an integration is added.
 */
export const addSocialAccount = action(socialSchema, async (input) => {
  const { creator } = await requireCreator('creator:update');

  const followers = input.followers ? Number.parseInt(input.followers.replace(/\D/g, ''), 10) : null;

  await prisma.socialAccount.upsert({
    where: {
      creatorId_platform_handle: {
        creatorId: creator.id,
        platform: input.platform as never,
        handle: input.handle,
      },
    },
    create: {
      creatorId: creator.id,
      platform: input.platform as never,
      handle: input.handle,
      profileUrl: input.profileUrl || null,
      followers: Number.isFinite(followers) ? followers : null,
    },
    update: {
      profileUrl: input.profileUrl || null,
      followers: Number.isFinite(followers) ? followers : null,
    },
  });

  return actionOk(undefined, 'Account added.');
});

const removeSocialSchema = z.object({ id: z.string().uuid() });

export const removeSocialAccount = action(removeSocialSchema, async (input) => {
  const { creator } = await requireCreator('creator:update');
  await prisma.socialAccount.deleteMany({ where: { id: input.id, creatorId: creator.id } });
  return actionOk(undefined, 'Account removed.');
});

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

/** Starts Stripe Connect onboarding and returns the hosted link. */
export async function startPayoutSetup(): Promise<ActionResult<{ url: string }>> {
  const { creator } = await requireCreator('creator:payout:settings');

  try {
    const { url } = await createConnectOnboardingLink({ creatorId: creator.id });
    return actionOk({ url });
  } catch (error) {
    logger.error('creator.connect_onboarding_failed', {
      creatorId: creator.id,
      error: (error as Error).message,
    });
    throw error;
  }
}

export async function openPayoutDashboard(): Promise<ActionResult<{ url: string | null }>> {
  const { creator } = await requireCreator('creator:payout:settings');
  const url = await createConnectDashboardLink(creator);
  return actionOk({ url });
}

export const withdrawEarnings = action(z.object({}), async (_input, context) => {
  const { creator, user } = await requireCreator('creator:payout:request');
  await enforceRateLimit('payoutRequest', creator.id);

  const result = await requestPayout({ creatorId: creator.id, actorUserId: user.id });

  if ('error' in result) {
    return actionError(result.error, undefined, result.code);
  }

  void context;
  return actionOk(
    { payoutId: result.payout.id, amountCents: result.payout.amountCents },
    result.payout.status === 'APPROVED'
      ? 'Payout requested. It will be sent to your connected account shortly.'
      : 'Payout requested. It is queued for review before being sent.',
  );
});

export async function payoutEligibility() {
  const { creator } = await requireCreator('creator:payout:request');
  return checkPayoutEligibility(creator.id);
}

const taxFormSchema = z.object({
  taxFormKind: z.enum(['W9', 'W8BEN', 'W8BENE'], {
    errorMap: () => ({ message: 'Choose the form that applies to you' }),
  }),
  confirm: z
    .union([z.literal('on'), z.literal('true')])
    .transform(() => true)
    .refine((v) => v, { message: 'Confirm the information is accurate' }),
});

/**
 * Records which tax form the publisher is submitting.
 *
 * The form itself is collected by Stripe during Connect onboarding — we
 * deliberately do not handle tax identification numbers directly. This records
 * the declaration so the payout gate can check it, and so an operator can
 * reconcile against Stripe's records at year end.
 *
 * This is not tax advice, and the UI says so.
 */
export const declareTaxStatus = action(taxFormSchema, async (input, context) => {
  const { creator, user } = await requireCreator('creator:payout:settings');

  await prisma.creator.update({
    where: { id: creator.id },
    data: {
      taxFormKind: input.taxFormKind,
      taxFormStatus: 'submitted',
      taxFormSubmittedAt: new Date(),
    },
  });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'creator.tax_status_declared',
    entityKind: 'creator',
    entityId: creator.id,
    metadata: { taxFormKind: input.taxFormKind },
  });

  return actionOk(
    undefined,
    'Tax status recorded. Complete the form itself in your payout provider onboarding.',
  );
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const exportSchema = z.object({
  kind: z.enum(['clicks', 'conversions', 'earnings', 'payouts']),
  from: z.string().optional().or(z.literal('')),
  to: z.string().optional().or(z.literal('')),
  campaignId: z.string().uuid().optional().or(z.literal('')),
});

export const requestCreatorExport = action(exportSchema, async (input) => {
  const { creator, user } = await requireCreator('creator:export');
  await enforceRateLimit('export', creator.id);

  const { exportJobId } = await requestExport({
    userId: user.id,
    kind: input.kind,
    scopeKind: 'creator',
    scopeId: creator.id,
    filters: {
      from: input.from || undefined,
      to: input.to || undefined,
      campaignId: input.campaignId || undefined,
    },
  });

  return actionOk(
    { exportJobId },
    'Export started. It will appear in your exports list when ready.',
  );
});
