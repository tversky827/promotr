'use server';

import { z } from 'zod';

import { recordAudit, recordFinancialAudit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth/guards';
import { revokeAllSessions } from '@/lib/auth/session';
import { approve as approveEarning, reject as rejectEarning, reverse as reverseEarning } from '@/lib/billing/earnings';
import { failPayout, processPayout } from '@/lib/billing/payouts';
import { refundDeposit } from '@/lib/billing/funding';
import { accounts, balanceOf, ensureAccount, post } from '@/lib/billing/ledger';
import { prisma, withSerializableTransaction } from '@/lib/db';
import { enqueue, retryDeadJob } from '@/lib/jobs/queue';
import { logger } from '@/lib/observability/logger';
import { parseAmount } from '@/lib/money';
import { notifyBrand, notifyCreator } from '@/lib/notify';
import { DEFAULT_SETTINGS, updateSetting, type PlatformSettings } from '@/lib/settings';

import { action, actionError, actionOk } from './shared';

/**
 * Administrative actions.
 *
 * Every action here writes an audit record with the actor, the reason, and the
 * before/after state. Financial actions additionally record the balance on both
 * sides of the change. This is what makes the question "who moved this money,
 * when, and why" answerable rather than a matter of trust.
 *
 * Nothing here bypasses the ledger. An administrator adjusting a balance posts
 * a real double-entry transaction like any other movement — there is no
 * back door that writes `balanceMicros` directly.
 */

const REASON = z
  .string()
  .trim()
  .min(10, 'Record a reason of at least 10 characters — this is a permanent audit record')
  .max(1000);

// ---------------------------------------------------------------------------
// Users, brands, publishers
// ---------------------------------------------------------------------------

const suspendUserSchema = z.object({
  userId: z.string().uuid(),
  reason: REASON,
});

export const suspendUser = action(suspendUserSchema, async (input, context) => {
  const session = await requireAdmin('admin:users:manage');

  const target = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!target) return actionError('That user was not found.');
  if (target.role === 'ADMIN') {
    return actionError('Administrator accounts cannot be suspended from this screen.');
  }

  await prisma.user.update({
    where: { id: input.userId },
    data: { status: 'SUSPENDED', suspendedReason: input.reason },
  });

  // Suspension must take effect immediately, not at next session expiry.
  const revoked = await revokeAllSessions(input.userId);

  // Cascade to the account's marketplace presence.
  await prisma.creator.updateMany({
    where: { userId: input.userId },
    data: { verification: 'SUSPENDED', suspendedReason: input.reason },
  });
  await prisma.campaign.updateMany({
    where: { brand: { members: { some: { userId: input.userId, role: 'BRAND_OWNER' } } }, status: 'ACTIVE' },
    data: { status: 'SUSPENDED', pausedAt: new Date() },
  });

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: 'admin.user.suspended',
    entityKind: 'user',
    entityId: input.userId,
    reason: input.reason,
    before: { status: target.status },
    after: { status: 'SUSPENDED' },
    metadata: { sessionsRevoked: revoked },
  });

  logger.warn('admin.user_suspended', {
    adminId: session.user.id,
    userId: input.userId,
    reason: input.reason,
  });

  return actionOk(undefined, 'Account suspended and signed out everywhere.');
});

const reactivateSchema = z.object({ userId: z.string().uuid(), reason: REASON });

export const reactivateUser = action(reactivateSchema, async (input, context) => {
  const session = await requireAdmin('admin:users:manage');

  const target = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!target) return actionError('That user was not found.');

  await prisma.user.update({
    where: { id: input.userId },
    data: { status: 'ACTIVE', suspendedReason: null },
  });
  await prisma.creator.updateMany({
    where: { userId: input.userId, verification: 'SUSPENDED' },
    data: { verification: 'VERIFIED', suspendedReason: null },
  });

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: 'admin.user.reactivated',
    entityKind: 'user',
    entityId: input.userId,
    reason: input.reason,
    before: { status: target.status },
    after: { status: 'ACTIVE' },
  });

  return actionOk(undefined, 'Account reactivated.');
});

const verifySchema = z.object({
  brandId: z.string().uuid(),
  decision: z.enum(['VERIFIED', 'REJECTED', 'SUSPENDED']),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const decideBrandVerification = action(verifySchema, async (input, context) => {
  const session = await requireAdmin('admin:brands:manage');

  const brandRecord = await prisma.brand.findUnique({ where: { id: input.brandId } });
  if (!brandRecord) return actionError('That brand was not found.');

  await prisma.brand.update({
    where: { id: input.brandId },
    data: {
      verification: input.decision,
      verificationNotes: input.notes || null,
      verifiedAt: input.decision === 'VERIFIED' ? new Date() : null,
      suspendedReason: input.decision === 'SUSPENDED' ? input.notes || 'Suspended by an administrator' : null,
    },
  });

  if (input.decision === 'SUSPENDED') {
    await prisma.campaign.updateMany({
      where: { brandId: input.brandId, status: 'ACTIVE' },
      data: { status: 'SUSPENDED', pausedAt: new Date() },
    });
  }

  await notifyBrand(input.brandId, {
    type: 'generic',
    title:
      input.decision === 'VERIFIED'
        ? 'Your business is verified'
        : input.decision === 'REJECTED'
          ? 'Business verification was not approved'
          : 'Your account has been suspended',
    body:
      input.decision === 'VERIFIED'
        ? 'You can now launch campaigns.'
        : input.notes || 'Contact support for details.',
    actionPath: '/brand/settings',
  });

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: `admin.brand.${input.decision.toLowerCase()}`,
    entityKind: 'brand',
    entityId: input.brandId,
    reason: input.notes || null,
    before: { verification: brandRecord.verification },
    after: { verification: input.decision },
  });

  return actionOk(undefined, `Brand marked ${input.decision.toLowerCase()}.`);
});

const creatorStatusSchema = z.object({
  creatorId: z.string().uuid(),
  decision: z.enum(['VERIFIED', 'RESTRICTED', 'SUSPENDED', 'UNVERIFIED']),
  reason: REASON,
});

export const setCreatorStatus = action(creatorStatusSchema, async (input, context) => {
  const session = await requireAdmin('admin:creators:manage');

  const creator = await prisma.creator.findUnique({ where: { id: input.creatorId } });
  if (!creator) return actionError('That publisher was not found.');

  await prisma.creator.update({
    where: { id: input.creatorId },
    data: {
      verification: input.decision,
      suspendedReason: input.decision === 'SUSPENDED' ? input.reason : null,
      verificationNotes: input.reason,
    },
  });

  if (input.decision === 'SUSPENDED') {
    // Their links keep resolving so visitors are not stranded, but the redirect
    // path records the traffic as non-billable.
    await prisma.trackingLink.updateMany({
      where: { creatorId: input.creatorId },
      data: { active: false },
    });
  }

  await notifyCreator(input.creatorId, {
    type: 'generic',
    title:
      input.decision === 'SUSPENDED'
        ? 'Your publisher account has been suspended'
        : input.decision === 'RESTRICTED'
          ? 'Your account is under review'
          : 'Your account status changed',
    body: input.reason,
    actionPath: '/creator/disputes',
  });

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: `admin.creator.${input.decision.toLowerCase()}`,
    entityKind: 'creator',
    entityId: input.creatorId,
    reason: input.reason,
    before: { verification: creator.verification },
    after: { verification: input.decision },
  });

  return actionOk(undefined, `Publisher marked ${input.decision.toLowerCase()}.`);
});

// ---------------------------------------------------------------------------
// Campaign moderation
// ---------------------------------------------------------------------------

const moderateSchema = z.object({
  campaignId: z.string().uuid(),
  decision: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export const moderateCampaignDecision = action(moderateSchema, async (input, context) => {
  const session = await requireAdmin('admin:campaigns:moderate');

  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    include: { brand: { select: { id: true, displayName: true } } },
  });
  if (!campaign) return actionError('That campaign was not found.');

  if (input.decision === 'REJECTED' && !input.notes) {
    return actionError('A rejection must include a reason the brand can act on.', {
      notes: 'Explain what needs to change',
    });
  }

  await prisma.campaign.update({
    where: { id: input.campaignId },
    data: {
      status: input.decision,
      moderationNotes: input.notes || campaign.moderationNotes,
      reviewedAt: new Date(),
      reviewedByUserId: session.user.id,
      ...(input.decision === 'SUSPENDED' ? { pausedAt: new Date() } : {}),
    },
  });

  await notifyBrand(campaign.brand.id, {
    type: input.decision === 'APPROVED' ? 'campaign.approved' : 'campaign.rejected',
    title:
      input.decision === 'APPROVED'
        ? `${campaign.name} is approved`
        : input.decision === 'REJECTED'
          ? `${campaign.name} was not approved`
          : `${campaign.name} has been suspended`,
    body:
      input.decision === 'APPROVED'
        ? 'Fund the campaign to make it visible to publishers.'
        : (input.notes ?? 'Contact support for details.'),
    actionPath: `/brand/campaigns/${campaign.id}`,
    emailTemplate: {
      name: input.decision === 'APPROVED' ? 'campaignApproved' : 'campaignRejected',
      params: { campaignName: campaign.name, reason: input.notes ?? '', url: `/brand/campaigns/${campaign.id}` },
    },
  });

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: `admin.campaign.${input.decision.toLowerCase()}`,
    entityKind: 'campaign',
    entityId: campaign.id,
    reason: input.notes || null,
    before: { status: campaign.status },
    after: { status: input.decision },
  });

  return actionOk(undefined, `Campaign ${input.decision.toLowerCase()}.`);
});

// ---------------------------------------------------------------------------
// Fraud review
// ---------------------------------------------------------------------------

const fraudDecisionSchema = z.object({
  fraudEventId: z.string().uuid(),
  resolution: z.enum(['approved', 'rejected', 'held', 'investigating']),
  note: z.string().trim().max(1000).optional().or(z.literal('')),
});

/**
 * Resolve a flagged event.
 *
 * "Approved" releases the held earnings to the publisher — a flag is a question,
 * not a verdict, and clearing it must actually make the publisher whole.
 */
export const resolveFraudEvent = action(fraudDecisionSchema, async (input, context) => {
  const session = await requireAdmin('admin:fraud:review');

  const event = await prisma.fraudEvent.findUnique({ where: { id: input.fraudEventId } });
  if (!event) return actionError('That fraud event was not found.');

  await prisma.fraudEvent.update({
    where: { id: input.fraudEventId },
    data: {
      resolution: input.resolution,
      resolvedByUserId: session.user.id,
      resolvedAt: new Date(),
      resolutionNote: input.note || null,
    },
  });

  // Act on the earnings the flag was holding.
  const earnings = await prisma.earning.findMany({
    where: {
      status: 'UNDER_REVIEW',
      ...(event.clickId ? { clickId: event.clickId } : {}),
      ...(event.conversionId ? { conversionId: event.conversionId } : {}),
    },
  });

  for (const earning of earnings) {
    if (input.resolution === 'approved') {
      await approveEarning(earning.id, {
        actorUserId: session.user.id,
        reason: input.note || 'Cleared by review',
      });
    } else if (input.resolution === 'rejected') {
      await rejectEarning(
        earning.id,
        input.note || 'Rejected after manual fraud review',
        { actorUserId: session.user.id },
      );
    }
  }

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: `admin.fraud.${input.resolution}`,
    entityKind: 'fraud_event',
    entityId: input.fraudEventId,
    reason: input.note || null,
    metadata: { earningsAffected: earnings.length, score: event.score },
  });

  return actionOk(
    { earningsAffected: earnings.length },
    input.resolution === 'approved'
      ? `Cleared. ${earnings.length} earning(s) released to the publisher.`
      : input.resolution === 'rejected'
        ? `Rejected. ${earnings.length} earning(s) reversed and the brand's budget returned.`
        : 'Marked for further investigation.',
  );
});

const payoutHoldSchema = z.object({
  creatorId: z.string().uuid(),
  hold: z.enum(['true', 'false']),
  reason: REASON,
});

export const setPayoutHold = action(payoutHoldSchema, async (input, context) => {
  const session = await requireAdmin('admin:payouts:manage');
  const holding = input.hold === 'true';

  const creator = await prisma.creator.findUnique({ where: { id: input.creatorId } });
  if (!creator) return actionError('That publisher was not found.');

  await prisma.creator.update({
    where: { id: input.creatorId },
    data: { payoutHold: holding, payoutHoldReason: holding ? input.reason : null },
  });

  await notifyCreator(input.creatorId, {
    type: 'generic',
    title: holding ? 'A hold has been placed on your payouts' : 'Your payout hold has been lifted',
    body: holding
      ? `${input.reason} Your balance is unaffected and remains yours.`
      : 'You can request a payout again.',
    actionPath: '/creator/payouts',
  });

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: holding ? 'admin.payout.hold_placed' : 'admin.payout.hold_released',
    entityKind: 'creator',
    entityId: input.creatorId,
    reason: input.reason,
    before: { payoutHold: creator.payoutHold },
    after: { payoutHold: holding },
  });

  return actionOk(undefined, holding ? 'Payout hold placed.' : 'Payout hold released.');
});

const payoutActionSchema = z.object({
  payoutId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  reason: REASON,
});

export const decidePayout = action(payoutActionSchema, async (input, context) => {
  const session = await requireAdmin('admin:payouts:manage');

  const payout = await prisma.payout.findUnique({ where: { id: input.payoutId } });
  if (!payout) return actionError('That payout was not found.');
  if (payout.status !== 'REQUESTED' && payout.status !== 'ON_HOLD') {
    return actionError(`This payout is already ${payout.status.toLowerCase()}.`);
  }

  if (input.decision === 'approve') {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    await enqueue('payout.process', { payoutId: payout.id }, { idempotencyKey: `payout:process:${payout.id}` });
  } else {
    await failPayout(payout.id, 'rejected_by_admin', input.reason);
  }

  await recordFinancialAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: `admin.payout.${input.decision}`,
    entityKind: 'payout',
    entityId: payout.id,
    reason: input.reason,
    beforeMicros: payout.amountMicros,
    afterMicros: payout.amountMicros,
    amountMicros: payout.amountMicros,
    metadata: { creatorId: payout.creatorId, decision: input.decision },
  });

  return actionOk(
    undefined,
    input.decision === 'approve'
      ? 'Payout approved and queued for transfer.'
      : 'Payout rejected. The balance has been returned to the publisher.',
  );
});

/** Runs a payout immediately rather than waiting for the worker. */
export const runPayoutNow = action(
  z.object({ payoutId: z.string().uuid() }),
  async (input, context) => {
    const session = await requireAdmin('admin:payouts:manage');
    const result = await processPayout(input.payoutId);

    await recordAudit({
      actorUserId: session.user.id,
      actorRole: 'ADMIN',
      actorIp: context.ip,
      action: 'admin.payout.run_now',
      entityKind: 'payout',
      entityId: input.payoutId,
      metadata: { ok: result.ok, error: result.error },
    });

    return result.ok
      ? actionOk(undefined, 'Transfer created.')
      : actionError(result.error ?? 'The transfer failed.');
  },
);

// ---------------------------------------------------------------------------
// Ledger adjustments
// ---------------------------------------------------------------------------

const adjustmentSchema = z.object({
  creatorId: z.string().uuid(),
  direction: z.enum(['credit', 'debit']),
  amount: z.string().trim().min(1, 'Enter an amount'),
  reason: REASON,
});

/**
 * Manually adjust a publisher's available balance.
 *
 * This posts a real double-entry transaction against platform revenue — the
 * money comes from or goes to somewhere specific, and the ledger stays balanced.
 * There is deliberately no path that writes a balance directly.
 */
export const adjustCreatorBalance = action(adjustmentSchema, async (input, context) => {
  const session = await requireAdmin('admin:ledger:adjust');

  const creator = await prisma.creator.findUnique({ where: { id: input.creatorId } });
  if (!creator) return actionError('That publisher was not found.');

  let amountMicros: bigint;
  try {
    amountMicros = parseAmount(input.amount);
  } catch {
    return actionError('Enter a valid amount.', { amount: 'Not a valid amount' });
  }
  if (amountMicros <= 0n) {
    return actionError('Enter a positive amount and choose credit or debit.', {
      amount: 'Must be positive',
    });
  }

  const before = await balanceOf(accounts.publisherAvailable(creator.id));

  if (input.direction === 'debit' && before < amountMicros) {
    return actionError(
      `That publisher's available balance is ${money(before)}. A larger debit would drive it negative.`,
      { amount: 'More than the available balance' },
    );
  }

  const idempotencyKey = `adjust:${creator.id}:${Date.now()}`;

  await withSerializableTransaction(async (tx) => {
    await ensureAccount(tx, accounts.publisherAvailable(creator.id));

    await post(tx, {
      kind: 'MANUAL_ADJUSTMENT',
      idempotencyKey,
      description: `Manual ${input.direction} for publisher ${creator.handle}`,
      actorUserId: session.user.id,
      reason: input.reason,
      metadata: { creatorId: creator.id, direction: input.direction },
      lines:
        input.direction === 'credit'
          ? [
              { account: accounts.platformRevenue(), direction: 'DEBIT', amountMicros },
              { account: accounts.publisherAvailable(creator.id), direction: 'CREDIT', amountMicros },
            ]
          : [
              { account: accounts.publisherAvailable(creator.id), direction: 'DEBIT', amountMicros },
              { account: accounts.platformRevenue(), direction: 'CREDIT', amountMicros },
            ],
    });
  });

  const after = await balanceOf(accounts.publisherAvailable(creator.id));

  await recordFinancialAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: 'admin.ledger.adjustment',
    entityKind: 'creator',
    entityId: creator.id,
    reason: input.reason,
    beforeMicros: before,
    afterMicros: after,
    amountMicros,
    metadata: { direction: input.direction, idempotencyKey },
  });

  await notifyCreator(creator.id, {
    type: 'generic',
    title:
      input.direction === 'credit'
        ? `${money(amountMicros)} was added to your balance`
        : `${money(amountMicros)} was deducted from your balance`,
    body: input.reason,
    actionPath: '/creator/earnings',
  });

  logger.warn('admin.balance_adjusted', {
    adminId: session.user.id,
    creatorId: creator.id,
    direction: input.direction,
    amountMicros: amountMicros.toString(),
    beforeMicros: before.toString(),
    afterMicros: after.toString(),
  });

  return actionOk(
    { beforeMicros: before.toString(), afterMicros: after.toString() },
    `Balance adjusted from ${money(before)} to ${money(after)}.`,
  );
});

const refundSchema = z.object({
  depositId: z.string().uuid(),
  amount: z.string().trim().min(1, 'Enter an amount'),
  reason: REASON,
});

export const issueRefund = action(refundSchema, async (input, context) => {
  const session = await requireAdmin('admin:refunds:issue');

  let amountMicros: bigint;
  try {
    amountMicros = parseAmount(input.amount);
  } catch {
    return actionError('Enter a valid amount.', { amount: 'Not a valid amount' });
  }

  const result = await refundDeposit({
    depositId: input.depositId,
    amountMicros,
    reason: input.reason,
    actorUserId: session.user.id,
  });

  void context;
  return actionOk(
    { refundedMicros: result.refundedMicros.toString() },
    `Refunded ${money(result.refundedMicros)}.`,
  );
});

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

const earningActionSchema = z.object({
  earningId: z.string().uuid(),
  decision: z.enum(['approve', 'reject', 'reverse']),
  reason: REASON,
});

export const decideEarning = action(earningActionSchema, async (input, context) => {
  const session = await requireAdmin('admin:fraud:review');

  const earning =
    input.decision === 'approve'
      ? await approveEarning(input.earningId, {
          actorUserId: session.user.id,
          reason: input.reason,
        })
      : input.decision === 'reject'
        ? await rejectEarning(input.earningId, input.reason, { actorUserId: session.user.id })
        : await reverseEarning(input.earningId, input.reason, { actorUserId: session.user.id });

  if (!earning) return actionError('That earning was not found.');

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: `admin.earning.${input.decision}`,
    entityKind: 'earning',
    entityId: input.earningId,
    reason: input.reason,
    after: { status: earning.status },
  });

  return actionOk(undefined, `Earning ${earning.status.toLowerCase()}.`);
});

// ---------------------------------------------------------------------------
// Platform settings
// ---------------------------------------------------------------------------

const settingSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
});

export const updatePlatformSetting = action(settingSchema, async (input, context) => {
  const session = await requireAdmin('admin:settings:manage');

  if (!(input.key in DEFAULT_SETTINGS)) {
    return actionError(`Unknown setting "${input.key}".`);
  }
  const key = input.key as keyof PlatformSettings;
  const current = DEFAULT_SETTINGS[key];

  let parsed: unknown;
  try {
    if (typeof current === 'number') {
      parsed = Number(input.value);
      if (!Number.isFinite(parsed as number)) throw new Error('not a number');
    } else if (typeof current === 'boolean') {
      parsed = input.value === 'true' || input.value === 'on';
    } else if (Array.isArray(current)) {
      parsed = input.value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    } else {
      parsed = input.value;
    }
  } catch {
    return actionError(`"${input.value}" is not valid for ${input.key}.`, { value: 'Invalid value' });
  }

  const { getSettings } = await import('@/lib/settings');
  const before = (await getSettings())[key];

  await updateSetting(key, parsed as never, session.user.id);

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: 'admin.setting.updated',
    entityKind: 'platform_setting',
    entityId: input.key,
    before: { value: before },
    after: { value: parsed },
  });

  logger.warn('admin.setting_changed', {
    adminId: session.user.id,
    key: input.key,
    before: JSON.stringify(before),
    after: JSON.stringify(parsed),
  });

  return actionOk(undefined, `${input.key} updated.`);
});

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const retryJob = action(
  z.object({ jobId: z.string().uuid() }),
  async (input, context) => {
    const session = await requireAdmin('admin:system:read');
    const ok = await retryDeadJob(input.jobId);

    await recordAudit({
      actorUserId: session.user.id,
      actorIp: context.ip,
      action: 'admin.job.retried',
      entityKind: 'job',
      entityId: input.jobId,
    });

    return ok ? actionOk(undefined, 'Job re-queued.') : actionError('That job could not be re-queued.');
  },
);

export const runReconciliation = action(z.object({}), async (_input, context) => {
  const session = await requireAdmin('admin:system:read');

  const { reconcileAll, verifyGlobalBalance } = await import('@/lib/billing/ledger');
  const global = await verifyGlobalBalance();
  const { checked, drifted } = await reconcileAll();

  await recordAudit({
    actorUserId: session.user.id,
    actorIp: context.ip,
    action: 'admin.ledger.reconciled',
    entityKind: 'ledger',
    metadata: { checked, drifted: drifted.length, balanced: global.balanced },
  });

  return actionOk(
    {
      checked,
      drifted: drifted.length,
      balanced: global.balanced,
      debits: global.debits.toString(),
      credits: global.credits.toString(),
    },
    global.balanced && drifted.length === 0
      ? `Ledger is consistent across ${checked} accounts.`
      : `Discrepancy found: ${drifted.length} account(s) drifted${global.balanced ? '' : ', and global debits do not equal credits'}.`,
  );
});

function money(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / 1_000_000n;
  const cents = (abs % 1_000_000n) / 10_000n;
  return `${negative ? '-' : ''}$${whole}.${cents.toString().padStart(2, '0')}`;
}
