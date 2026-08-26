'use server';

import { z } from 'zod';

import { requestExport } from '@/lib/analytics/exports';
import { recordAudit } from '@/lib/audit';
import { requireBrand } from '@/lib/auth/guards';
import * as budget from '@/lib/billing/budget';
import { accounts, balanceOf } from '@/lib/billing/ledger';
import { createDeposit } from '@/lib/billing/funding';
import { slugify } from '@/lib/crypto/ids';
import { prisma, withSerializableTransaction } from '@/lib/db';
import { enqueue } from '@/lib/jobs/queue';
import { logger } from '@/lib/observability/logger';
import { parseAmount, tryParseAmount } from '@/lib/money';
import { launchDecision } from '@/lib/campaigns/lifecycle';
import { getSettings } from '@/lib/settings';
import { dispatch } from '@/lib/webhooks/outbound';
import { validateDestinationUrl } from '@/lib/urlsafety';
import { enforceRateLimit } from '@/lib/ratelimit';
import { notifyBrand } from '@/lib/notify';

import {
  action,
  actionError,
  actionOk,
  checkboxSchema,
  stringArraySchema,
  type ActionResult,
} from './shared';

/**
 * Campaign lifecycle for brands: create, edit, submit for review, fund, launch,
 * pause, and complete.
 *
 * Two rules run through all of it:
 *  - A campaign cannot go live without funds behind it, because publishers must
 *    never accrue earnings the platform cannot pay.
 *  - Changing what a campaign points at, or what it pays, after approval sends
 *    it back for review. Otherwise approval would be meaningless.
 */

const AMOUNT = z
  .string()
  .trim()
  .min(1, 'Enter an amount')
  .refine((v) => tryParseAmount(v) !== null, 'Enter a valid amount, e.g. 0.25')
  .refine((v) => (tryParseAmount(v) ?? -1n) >= 0n, 'Amounts cannot be negative');

const campaignSchema = z.object({
  name: z.string().trim().min(3, 'Give the campaign a name').max(120),
  objective: z.string().trim().min(1, 'Choose an objective'),
  category: z.string().trim().min(1, 'Choose a category'),
  description: z
    .string()
    .trim()
    .min(20, 'Describe the campaign in at least 20 characters')
    .max(4000),
  offerSummary: z
    .string()
    .trim()
    .min(10, 'Summarise the offer for publishers')
    .max(280, 'Keep the summary under 280 characters'),
  destinationUrl: z.string().trim().min(1, 'Enter the destination URL'),

  payoutModel: z.enum(['CPC', 'CPL', 'CPA', 'CPM', 'REVSHARE', 'HYBRID']),
  payoutAmount: AMOUNT.optional().or(z.literal('')),
  revsharePercent: z.string().trim().optional().or(z.literal('')),

  attributionWindowDays: z.string().trim().optional().or(z.literal('')),
  dedupeWindowHours: z.string().trim().optional().or(z.literal('')),

  requiresApproval: checkboxSchema,
  isPublic: checkboxSchema,
  minAge: z.string().trim().optional().or(z.literal('')),
  disclosureRequirement: z.string().trim().max(500).optional().or(z.literal('')),
  conversionRules: z.string().trim().max(2000).optional().or(z.literal('')),

  allowedCountries: stringArraySchema,
  blockedCountries: stringArraySchema,
  allowedChannels: stringArraySchema,
  prohibitedChannels: stringArraySchema,
  prohibitedPresets: stringArraySchema,

  totalBudget: AMOUNT.optional().or(z.literal('')),
  dailyCap: z.string().trim().optional().or(z.literal('')),

  startsAt: z.string().trim().optional().or(z.literal('')),
  endsAt: z.string().trim().optional().or(z.literal('')),

  termsBody: z.string().trim().min(20, 'Campaign terms are required').max(20_000),
});

function resolvePayout(input: z.infer<typeof campaignSchema>): {
  payoutMicros: bigint;
  revshareBps: number;
  error?: string;
} {
  const payoutMicros = input.payoutAmount ? (tryParseAmount(input.payoutAmount) ?? 0n) : 0n;
  const revshareBps = input.revsharePercent
    ? Math.round(Number.parseFloat(input.revsharePercent) * 100)
    : 0;

  switch (input.payoutModel) {
    case 'REVSHARE':
      if (!Number.isFinite(revshareBps) || revshareBps <= 0) {
        return { payoutMicros: 0n, revshareBps: 0, error: 'Enter a revenue share percentage.' };
      }
      if (revshareBps > 10_000) {
        return { payoutMicros: 0n, revshareBps: 0, error: 'Revenue share cannot exceed 100%.' };
      }
      return { payoutMicros: 0n, revshareBps };

    case 'HYBRID':
      if (payoutMicros <= 0n && revshareBps <= 0) {
        return {
          payoutMicros: 0n,
          revshareBps: 0,
          error: 'A hybrid campaign needs a flat amount, a revenue share, or both.',
        };
      }
      return { payoutMicros, revshareBps: Number.isFinite(revshareBps) ? revshareBps : 0 };

    default:
      if (payoutMicros <= 0n) {
        return { payoutMicros: 0n, revshareBps: 0, error: 'Enter what publishers earn per event.' };
      }
      return { payoutMicros, revshareBps: 0 };
  }
}

export const createCampaign = action(campaignSchema, async (input, context) => {
  const { brand, user } = await requireBrand('campaign:create');
  const settings = await getSettings();

  const activeCount = await prisma.campaign.count({
    where: { brandId: brand.id, status: { in: ['ACTIVE', 'APPROVED', 'PENDING_REVIEW'] } },
  });
  if (activeCount >= settings.maxActiveCampaignsPerBrand) {
    return actionError(
      `You have reached the limit of ${settings.maxActiveCampaignsPerBrand} concurrent campaigns.`,
    );
  }

  const urlValidation = validateDestinationUrl(input.destinationUrl, { requireHttps: true });
  if (!urlValidation.ok) {
    return actionError(urlValidation.errors.join(' '), {
      destinationUrl: urlValidation.errors[0] ?? 'Enter a valid destination URL',
    });
  }

  const payout = resolvePayout(input);
  if (payout.error) {
    return actionError(payout.error, { payoutAmount: payout.error });
  }

  const totalBudget = input.totalBudget ? (tryParseAmount(input.totalBudget) ?? 0n) : 0n;
  const dailyCap = input.dailyCap ? tryParseAmount(input.dailyCap) : null;

  const campaign = await prisma.campaign.create({
    data: {
      brandId: brand.id,
      slug: slugify(input.name),
      name: input.name,
      objective: input.objective,
      category: input.category,
      description: input.description,
      offerSummary: input.offerSummary,
      destinationUrl: urlValidation.normalized!,
      status: 'DRAFT',
      isPublic: input.isPublic,
      payoutModel: input.payoutModel,
      payoutMicros: payout.payoutMicros,
      revshareBps: payout.revshareBps,
      attributionWindowHours: hoursFromDays(input.attributionWindowDays, 30),
      cookieDurationHours: hoursFromDays(input.attributionWindowDays, 30),
      dedupeWindowMinutes: minutesFromHours(input.dedupeWindowHours, 24),
      requiresApproval: input.requiresApproval,
      minAge: input.minAge ? Number.parseInt(input.minAge, 10) || null : null,
      disclosureRequirement: input.disclosureRequirement || null,
      conversionRules: input.conversionRules || null,
      allowedCountries: input.allowedCountries.map((c) => c.toUpperCase()),
      blockedCountries: input.blockedCountries.map((c) => c.toUpperCase()),
      allowedChannels: input.allowedChannels as never,
      prohibitedChannels: input.prohibitedChannels as never,
      startsAt: parseDate(input.startsAt),
      endsAt: parseDate(input.endsAt),
      termsBody: input.termsBody,
      termsVersion: 1,
      budget: {
        create: {
          totalBudgetMicros: totalBudget,
          dailyCapMicros: dailyCap && dailyCap > 0n ? dailyCap : null,
          lowBalanceBps: settings.budgetLowNotifyBps,
        },
      },
      rules: {
        create: input.prohibitedPresets.map((preset) => ({
          kind: 'PROHIBITED',
          label: preset,
        })),
      },
    },
  });

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    actorIp: context.ip,
    action: 'campaign.created',
    entityKind: 'campaign',
    entityId: campaign.id,
    metadata: { brandId: brand.id, payoutModel: input.payoutModel },
  });

  logger.info('campaign.created', { campaignId: campaign.id, brandId: brand.id });
  return actionOk({ campaignId: campaign.id, slug: campaign.slug });
});

const updateSchema = campaignSchema.extend({ campaignId: z.string().uuid() });

export const updateCampaign = action(updateSchema, async (input, context) => {
  const { brand, user } = await requireBrand('campaign:update');

  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, brandId: brand.id },
  });
  if (!campaign) return actionError('That campaign was not found.');
  if (campaign.status === 'COMPLETED' || campaign.status === 'SUSPENDED') {
    return actionError(`A ${campaign.status.toLowerCase()} campaign cannot be edited.`);
  }

  const urlValidation = validateDestinationUrl(input.destinationUrl, { requireHttps: true });
  if (!urlValidation.ok) {
    return actionError(urlValidation.errors.join(' '), {
      destinationUrl: urlValidation.errors[0] ?? 'Enter a valid destination URL',
    });
  }

  const payout = resolvePayout(input);
  if (payout.error) return actionError(payout.error, { payoutAmount: payout.error });

  // Changing the payout or the terms changes the deal publishers agreed to, so
  // the terms version is bumped. Existing links record the version they
  // accepted, preserving what each publisher actually signed up for.
  const termsChanged = input.termsBody !== campaign.termsBody;
  const payoutChanged =
    payout.payoutMicros !== campaign.payoutMicros || payout.revshareBps !== campaign.revshareBps;
  const destinationChanged = urlValidation.normalized !== campaign.destinationUrl;

  // A live campaign whose destination or economics change must be re-reviewed;
  // otherwise approval could be bypassed by editing after the fact.
  const needsReReview =
    (campaign.status === 'ACTIVE' || campaign.status === 'APPROVED') &&
    (destinationChanged || payoutChanged);

  const totalBudget = input.totalBudget ? (tryParseAmount(input.totalBudget) ?? 0n) : 0n;
  const dailyCap = input.dailyCap ? tryParseAmount(input.dailyCap) : null;

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      name: input.name,
      objective: input.objective,
      category: input.category,
      description: input.description,
      offerSummary: input.offerSummary,
      destinationUrl: urlValidation.normalized!,
      isPublic: input.isPublic,
      payoutModel: input.payoutModel,
      payoutMicros: payout.payoutMicros,
      revshareBps: payout.revshareBps,
      attributionWindowHours: hoursFromDays(input.attributionWindowDays, 30),
      dedupeWindowMinutes: minutesFromHours(input.dedupeWindowHours, 24),
      requiresApproval: input.requiresApproval,
      minAge: input.minAge ? Number.parseInt(input.minAge, 10) || null : null,
      disclosureRequirement: input.disclosureRequirement || null,
      conversionRules: input.conversionRules || null,
      allowedCountries: input.allowedCountries.map((c) => c.toUpperCase()),
      blockedCountries: input.blockedCountries.map((c) => c.toUpperCase()),
      allowedChannels: input.allowedChannels as never,
      prohibitedChannels: input.prohibitedChannels as never,
      startsAt: parseDate(input.startsAt),
      endsAt: parseDate(input.endsAt),
      termsBody: input.termsBody,
      termsVersion: termsChanged ? campaign.termsVersion + 1 : campaign.termsVersion,
      ...(needsReReview ? { status: 'PENDING_REVIEW', reviewedAt: null } : {}),
    },
  });

  await prisma.campaignBudget.update({
    where: { campaignId: campaign.id },
    data: {
      totalBudgetMicros: totalBudget,
      dailyCapMicros: dailyCap && dailyCap > 0n ? dailyCap : null,
    },
  });

  // Prohibited-practice rules are replaced wholesale rather than diffed: the
  // form submits the complete set, so anything absent was deselected.
  await prisma.$transaction([
    prisma.campaignRule.deleteMany({ where: { campaignId: campaign.id, kind: 'PROHIBITED' } }),
    prisma.campaignRule.createMany({
      data: input.prohibitedPresets.map((preset) => ({
        campaignId: campaign.id,
        kind: 'PROHIBITED',
        label: preset,
      })),
    }),
  ]);

  if (needsReReview) {
    await enqueue('campaign.moderate', { campaignId: campaign.id });
  }

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'campaign.updated',
    entityKind: 'campaign',
    entityId: campaign.id,
    before: { payoutMicros: campaign.payoutMicros, destinationUrl: campaign.destinationUrl },
    after: { payoutMicros: payout.payoutMicros, destinationUrl: urlValidation.normalized },
    metadata: { termsChanged, needsReReview },
  });

  return actionOk(
    { campaignId: updated.id, needsReReview },
    needsReReview
      ? 'Saved. Because the payout or destination changed, the campaign is back in review.'
      : 'Campaign saved.',
  );
});

const submitSchema = z.object({ campaignId: z.string().uuid() });

export const submitForReview = action(submitSchema, async (input, context) => {
  const { brand, user } = await requireBrand('campaign:update');

  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, brandId: brand.id },
  });
  if (!campaign) return actionError('That campaign was not found.');
  if (campaign.status !== 'DRAFT' && campaign.status !== 'REJECTED') {
    return actionError('This campaign has already been submitted.');
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: 'PENDING_REVIEW' },
  });

  // Moderation runs in the background so a slow URL-screening call cannot make
  // the submit button hang.
  await enqueue(
    'campaign.moderate',
    { campaignId: campaign.id },
    { idempotencyKey: `moderate:${campaign.id}:${Date.now()}` },
  );

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'campaign.submitted',
    entityKind: 'campaign',
    entityId: campaign.id,
  });

  return actionOk(undefined, 'Submitted for review. We will email you when it is decided.');
});

/**
 * Funding either moves existing balance (no payment needed) or starts a Stripe
 * PaymentIntent. One result shape covers both so the client can branch on
 * `needsPayment` rather than on the shape itself.
 */
interface FundResult {
  needsPayment: boolean;
  clientSecret: string | null;
  publishableKey: string | null;
  depositId: string | null;
}

const fundSchema = z.object({
  campaignId: z.string().uuid(),
  amount: AMOUNT,
  /** Use the brand's existing deposit balance instead of a new card charge. */
  fromBalance: checkboxSchema,
});

export const fundCampaign = action(
  fundSchema,
  async (input, context): Promise<ActionResult<FundResult>> => {
  const { brand, user } = await requireBrand('campaign:fund');
  const settings = await getSettings();

  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, brandId: brand.id },
    include: { budget: true },
  });
  if (!campaign) return actionError('That campaign was not found.');

  const amountMicros = parseAmount(input.amount);
  const minimum = BigInt(settings.minCampaignFundingMicros);

  if (amountMicros < minimum && (campaign.budget?.fundedMicros ?? 0n) === 0n) {
    return actionError(
      `The minimum initial funding for a campaign is ${formatMoney(minimum)}.`,
      { amount: 'Below the minimum' },
    );
  }

  if (input.fromBalance) {
    // Move existing deposit balance into the campaign. No card is charged.
    const available = await balanceOf(accounts.brandDeposit(brand.id));
    if (available < amountMicros) {
      return actionError(
        `Your available balance is ${formatMoney(available)}. Add funds first, or fund a smaller amount.`,
        { amount: 'More than your balance' },
      );
    }

    await withSerializableTransaction(async (tx) => {
      await budget.fundCampaign(tx, {
        campaignId: campaign.id,
        brandId: brand.id,
        amountMicros,
        idempotencyKey: `fund:${campaign.id}:${Date.now()}`,
        actorUserId: user.id,
        reason: 'Funded from account balance',
      });
    });

    await recordAudit({
      actorUserId: user.id,
      actorIp: context.ip,
      action: 'campaign.funded',
      entityKind: 'campaign',
      entityId: campaign.id,
      metadata: { amountMicros: amountMicros.toString(), source: 'balance' },
    });

    return actionOk<FundResult>(
      { needsPayment: false, clientSecret: null, publishableKey: null, depositId: null },
      'Campaign funded.',
    );
  }

  // New money: create a Stripe PaymentIntent. The ledger is only credited when
  // Stripe confirms via webhook, never optimistically here.
  const deposit = await createDeposit({
    brandId: brand.id,
    amountMicros,
    campaignId: campaign.id,
    actorUserId: user.id,
  });

  return actionOk<FundResult>({
    needsPayment: true,
    clientSecret: deposit.clientSecret,
    publishableKey: deposit.publishableKey,
    depositId: deposit.deposit.id,
  });
  },
);

const launchSchema = z.object({ campaignId: z.string().uuid() });

export const launchCampaign = action(launchSchema, async (input, context) => {
  const { brand, user } = await requireBrand('campaign:launch');
  const settings = await getSettings();

  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, brandId: brand.id },
    include: { budget: true },
  });
  if (!campaign) return actionError('That campaign was not found.');

  const decision = launchDecision({
    campaign,
    budget: campaign.budget,
    brandVerification: brand.verification,
    brandVerificationRequired: settings.brandVerificationRequiredToLaunch,
  });

  if (decision.ok === 'already-live') return actionOk(undefined, 'This campaign is already live.');
  if (!decision.ok) return actionError(decision.reason, undefined, decision.code);

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: 'ACTIVE', launchedAt: campaign.launchedAt ?? new Date(), pausedAt: null },
  });

  await dispatch({
    brandId: brand.id,
    eventType: 'campaign.started',
    data: { campaignId: campaign.id, name: campaign.name },
  });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'campaign.launched',
    entityKind: 'campaign',
    entityId: campaign.id,
    metadata: { availableMicros: decision.availableMicros.toString() },
  });

  logger.info('campaign.launched', { campaignId: campaign.id, brandId: brand.id });
  return actionOk(undefined, 'Campaign is live. Publishers can find it in the marketplace now.');
});

const pauseSchema = z.object({
  campaignId: z.string().uuid(),
  reason: z.string().trim().max(300).optional().or(z.literal('')),
});

export const pauseCampaign = action(pauseSchema, async (input, context) => {
  const { brand, user } = await requireBrand('campaign:pause');

  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, brandId: brand.id },
  });
  if (!campaign) return actionError('That campaign was not found.');
  if (campaign.status !== 'ACTIVE') return actionError('Only a live campaign can be paused.');

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: 'PAUSED', pausedAt: new Date() },
  });

  await dispatch({
    brandId: brand.id,
    eventType: 'campaign.paused',
    data: { campaignId: campaign.id, reason: input.reason || null },
  });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'campaign.paused',
    entityKind: 'campaign',
    entityId: campaign.id,
    reason: input.reason || null,
  });

  return actionOk(
    undefined,
    'Campaign paused. Existing links stop earning immediately; unspent budget stays with the campaign.',
  );
});

const completeSchema = z.object({ campaignId: z.string().uuid() });

/** Ends a campaign and returns its unspent budget to the brand's balance. */
export const completeCampaign = action(completeSchema, async (input, context) => {
  const { brand, user } = await requireBrand('campaign:launch');

  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, brandId: brand.id },
  });
  if (!campaign) return actionError('That campaign was not found.');
  if (campaign.status === 'COMPLETED') return actionOk(undefined, 'Already completed.');

  const returned = await withSerializableTransaction(async (tx) => {
    const result = await budget.defundCampaign(tx, {
      campaignId: campaign.id,
      brandId: brand.id,
      idempotencyKey: `complete:${campaign.id}`,
      actorUserId: user.id,
      reason: 'Campaign ended by the brand',
    });
    await tx.campaign.update({
      where: { id: campaign.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return result.returnedMicros;
  });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'campaign.completed',
    entityKind: 'campaign',
    entityId: campaign.id,
    metadata: { returnedMicros: returned.toString() },
  });

  return actionOk(
    { returnedMicros: returned.toString() },
    returned > 0n
      ? `Campaign ended. ${formatMoney(returned)} of unspent budget returned to your balance.`
      : 'Campaign ended.',
  );
});

// ---------------------------------------------------------------------------
// Publisher applications
// ---------------------------------------------------------------------------

const decideSchema = z.object({
  applicationId: z.string().uuid(),
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

export const decideApplication = action(decideSchema, async (input, context) => {
  const { brand, user } = await requireBrand('campaign:applications:decide');

  const application = await prisma.campaignApplication.findFirst({
    where: { id: input.applicationId, campaign: { brandId: brand.id } },
    include: { campaign: { select: { id: true, name: true } }, creator: true },
  });
  if (!application) return actionError('That application was not found.');

  await prisma.campaignApplication.update({
    where: { id: application.id },
    data: {
      status: input.decision,
      decidedAt: new Date(),
      decidedByUserId: user.id,
      decisionNote: input.note || null,
    },
  });

  const { notifyCreator } = await import('@/lib/notify');
  await notifyCreator(application.creatorId, {
    type: input.decision === 'APPROVED' ? 'campaign.application.approved' : 'campaign.application.rejected',
    title:
      input.decision === 'APPROVED'
        ? `You are approved for ${application.campaign.name}`
        : `Your application to ${application.campaign.name} was not accepted`,
    body:
      input.decision === 'APPROVED'
        ? 'Your tracking link is ready — open the campaign to generate it.'
        : input.note || 'The brand decided not to accept this application.',
    actionPath: `/campaigns/${application.campaign.id}`,
  });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: `campaign.application.${input.decision.toLowerCase()}`,
    entityKind: 'campaign_application',
    entityId: application.id,
    reason: input.note || null,
  });

  return actionOk(
    undefined,
    input.decision === 'APPROVED' ? 'Publisher approved.' : 'Application declined.',
  );
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const exportSchema = z.object({
  kind: z.enum(['clicks', 'conversions', 'earnings', 'creators', 'spend']),
  campaignId: z.string().uuid().optional().or(z.literal('')),
  from: z.string().optional().or(z.literal('')),
  to: z.string().optional().or(z.literal('')),
});

export const requestBrandExport = action(exportSchema, async (input) => {
  const { brand, user } = await requireBrand('brand:export');
  await enforceRateLimit('export', brand.id);

  const { exportJobId } = await requestExport({
    userId: user.id,
    kind: input.kind,
    scopeKind: 'brand',
    scopeId: brand.id,
    filters: {
      campaignId: input.campaignId || undefined,
      from: input.from || undefined,
      to: input.to || undefined,
    },
  });

  return actionOk({ exportJobId }, 'Export started. It will appear in your reports when ready.');
});

// ---------------------------------------------------------------------------

function hoursFromDays(value: string | undefined, fallbackDays: number): number {
  const days = value ? Number.parseFloat(value) : Number.NaN;
  const resolved = Number.isFinite(days) && days > 0 ? days : fallbackDays;
  return Math.min(Math.round(resolved * 24), 24 * 365);
}

function minutesFromHours(value: string | undefined, fallbackHours: number): number {
  const hours = value ? Number.parseFloat(value) : Number.NaN;
  const resolved = Number.isFinite(hours) && hours >= 0 ? hours : fallbackHours;
  return Math.min(Math.round(resolved * 60), 60 * 24 * 90);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMoney(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const cents = (micros % 1_000_000n) / 10_000n;
  return `$${whole}.${cents.toString().padStart(2, '0')}`;
}

/** Re-exported so the funding UI can warn before a low-balance campaign stalls. */
export async function brandBalance(): Promise<string> {
  const { brand } = await requireBrand('brand:read');
  const balance = await balanceOf(accounts.brandDeposit(brand.id));
  return balance.toString();
}

/** Low-balance notification opt-in for a campaign. */
export async function notifyBudgetLow(campaignId: string, brandId: string): Promise<void> {
  await notifyBrand(brandId, {
    type: 'campaign.budget.low',
    title: 'Campaign budget is running low',
    body: 'Add funds to keep the campaign accruing billable activity.',
    actionPath: `/brand/campaigns/${campaignId}/funding`,
  });
}
