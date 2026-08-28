import { randomUUID } from 'node:crypto';

import { recordAudit } from '@/lib/audit';
import { balanceSummary } from '@/lib/billing/earnings';
import { accounts, post } from '@/lib/billing/ledger';
import { prisma, withSerializableTransaction } from '@/lib/db';
import { env, integrations } from '@/lib/env';
import { logger } from '@/lib/observability/logger';
import { splitToCents } from '@/lib/money';
import { getSettings } from '@/lib/settings';
import { assertNotDemo, demoEnabled } from '@/lib/demo/mode';
import { getStripe, stripeConfigured, StripeNotConfiguredError } from '@/lib/stripe';
import { enqueue } from '@/lib/jobs/queue';

import type { Creator, Payout } from '@prisma/client';

/**
 * Publisher payouts via Stripe Connect.
 *
 * Money leaves the platform only through this module, and only after four
 * independent gates:
 *
 *   1. The publisher's ledger balance covers it (checked under a row lock).
 *   2. The balance clears the operator's minimum payout threshold.
 *   3. The publisher is verified, has a tax form on file, and is not on hold —
 *      each individually configurable by the operator.
 *   4. Their Stripe Connect account reports `payouts_enabled`.
 *
 * The ledger moves money in two steps. `PAYOUT_INITIATED` shifts it from the
 * publisher's available balance into a clearing account; `PAYOUT_SETTLED` moves
 * it out of clearing once Stripe confirms via webhook. Between the two the
 * money is visibly in transit, which is what makes a failed transfer easy to
 * reconcile rather than a mystery.
 */

export type PayoutEligibility =
  | { eligible: true; availableMicros: bigint; amountCents: number }
  | { eligible: false; reason: string; code: PayoutBlockCode; availableMicros: bigint };

export type PayoutBlockCode =
  | 'STRIPE_NOT_CONFIGURED'
  | 'BELOW_MINIMUM'
  | 'NO_BALANCE'
  | 'NOT_VERIFIED'
  | 'NO_TAX_FORM'
  | 'PAYOUT_HOLD'
  | 'NO_CONNECT_ACCOUNT'
  | 'CONNECT_INCOMPLETE'
  | 'SUSPENDED'
  | 'PENDING_PAYOUT_EXISTS';

/**
 * Everything blocking a payout, evaluated in one place so the UI can explain
 * precisely what the publisher needs to do next.
 */
export async function checkPayoutEligibility(creatorId: string): Promise<PayoutEligibility> {
  const settings = await getSettings();
  const creator = await prisma.creator.findUniqueOrThrow({ where: { id: creatorId } });
  const balance = await balanceSummary(creatorId);
  const available = balance.availableMicros;

  /*
   * A demo publisher is paid over an internal rail: the ledger movement is the
   * real one, but nothing leaves the platform, so the provider checks below do
   * not apply to them. Every other gate — suspension, holds, the minimum, the
   * balance itself — is enforced exactly as it is for a real publisher, because
   * showing those working is the point of the walkthrough.
   */
  const onDemoRail = demoEnabled && creator.isDemo;

  if (!onDemoRail && !stripeConfigured()) {
    return {
      eligible: false,
      code: 'STRIPE_NOT_CONFIGURED',
      reason:
        'Payouts are unavailable because this deployment has no payment provider configured. Contact support.',
      availableMicros: available,
    };
  }
  if (creator.verification === 'SUSPENDED') {
    return {
      eligible: false,
      code: 'SUSPENDED',
      reason: 'This account is suspended. Payouts are paused while it is under review.',
      availableMicros: available,
    };
  }
  if (creator.payoutHold) {
    return {
      eligible: false,
      code: 'PAYOUT_HOLD',
      reason: creator.payoutHoldReason ?? 'A payout hold is in place on this account.',
      availableMicros: available,
    };
  }
  if (settings.creatorVerificationRequiredForPayout && creator.verification !== 'VERIFIED') {
    return {
      eligible: false,
      code: 'NOT_VERIFIED',
      reason: 'Complete identity verification before requesting a payout.',
      availableMicros: available,
    };
  }
  if (settings.creatorTaxFormRequiredForPayout && creator.taxFormStatus !== 'verified') {
    return {
      eligible: false,
      code: 'NO_TAX_FORM',
      reason: 'Submit your tax information before requesting a payout.',
      availableMicros: available,
    };
  }
  if (!onDemoRail && !creator.stripeAccountId) {
    return {
      eligible: false,
      code: 'NO_CONNECT_ACCOUNT',
      reason: 'Connect a payout account to receive earnings.',
      availableMicros: available,
    };
  }
  if (!onDemoRail && !creator.stripePayoutsEnabled) {
    return {
      eligible: false,
      code: 'CONNECT_INCOMPLETE',
      reason:
        creator.stripeRequirementsDue.length > 0
          ? `Your payout account needs more information: ${creator.stripeRequirementsDue.join(', ')}`
          : 'Your payout account setup is incomplete.',
      availableMicros: available,
    };
  }

  const pending = await prisma.payout.count({
    where: { creatorId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
  });
  if (pending > 0) {
    return {
      eligible: false,
      code: 'PENDING_PAYOUT_EXISTS',
      reason: 'A payout is already in progress. It must complete before another can be requested.',
      availableMicros: available,
    };
  }

  const minimum = BigInt(settings.minimumPayoutMicros);
  if (available <= 0n) {
    return {
      eligible: false,
      code: 'NO_BALANCE',
      reason: 'There is no available balance to pay out yet.',
      availableMicros: available,
    };
  }
  if (available < minimum) {
    return {
      eligible: false,
      code: 'BELOW_MINIMUM',
      reason: `Your available balance is below the payout minimum.`,
      availableMicros: available,
    };
  }

  // Sub-cent dust cannot be transferred and stays in the balance.
  const { cents } = splitToCents(available);
  if (cents <= 0n) {
    return {
      eligible: false,
      code: 'BELOW_MINIMUM',
      reason: 'Your available balance is less than one cent.',
      availableMicros: available,
    };
  }

  return { eligible: true, availableMicros: available, amountCents: Number(cents) };
}

/**
 * Create a payout request. Moves the publisher's available balance into the
 * clearing account so it cannot be spent twice while the transfer is in flight.
 */
export async function requestPayout(params: {
  creatorId: string;
  actorUserId: string;
  amountMicros?: bigint;
}): Promise<{ payout: Payout } | { error: string; code: PayoutBlockCode }> {
  const eligibility = await checkPayoutEligibility(params.creatorId);
  if (!eligibility.eligible) {
    return { error: eligibility.reason, code: eligibility.code };
  }

  const settings = await getSettings();
  const creator = await prisma.creator.findUniqueOrThrow({
    where: { id: params.creatorId },
    select: { isDemo: true },
  });
  const requested = params.amountMicros ?? eligibility.availableMicros;
  const amountMicros = requested > eligibility.availableMicros ? eligibility.availableMicros : requested;
  // Only whole cents can be transferred; the remainder stays with the publisher.
  const { cents } = splitToCents(amountMicros);
  const transferableMicros = cents * 10_000n;

  if (transferableMicros <= 0n) {
    return { error: 'The requested amount is less than one cent.', code: 'BELOW_MINIMUM' };
  }

  const payoutId = randomUUID();

  const payout = await withSerializableTransaction(async (tx) => {
    // Re-read the balance under lock: the eligibility check above was advisory,
    // and an earning could have been reversed in between.
    const account = await tx.ledgerAccount.findUnique({
      where: {
        type_ownerKind_ownerId_currency: {
          type: 'PUBLISHER_AVAILABLE',
          ownerKind: 'creator',
          ownerId: params.creatorId,
          currency: 'usd',
        },
      },
    });
    const locked = await tx.$queryRaw<Array<{ balanceMicros: bigint }>>`
      SELECT "balanceMicros" FROM "ledger_accounts" WHERE id = ${account?.id ?? ''}::uuid FOR UPDATE
    `;
    const currentBalance = locked[0]?.balanceMicros ?? 0n;
    if (currentBalance < transferableMicros) {
      throw new InsufficientBalanceError(currentBalance, transferableMicros);
    }

    const created = await tx.payout.create({
      data: {
        id: payoutId,
        creatorId: params.creatorId,
        amountMicros: transferableMicros,
        amountCents: Number(cents),
        // Recorded on the payout itself, so a demo payment is identifiable
        // forever afterwards rather than only while DEMO_MODE happens to be on.
        method: demoEnabled && creator.isDemo ? 'demo' : 'stripe_connect',
        status:
          transferableMicros <= BigInt(settings.payoutAutoApproveUnderMicros)
            ? 'APPROVED'
            : 'REQUESTED',
        idempotencyKey: `payout:${payoutId}`,
        approvedAt: transferableMicros <= BigInt(settings.payoutAutoApproveUnderMicros) ? new Date() : null,
      },
    });

    // Attach the earnings this payout covers, oldest first, so the publisher's
    // ledger shows exactly which earnings were settled by which payment.
    const earnings = await tx.earning.findMany({
      where: { creatorId: params.creatorId, status: 'AVAILABLE', payoutId: null },
      orderBy: { availableAt: 'asc' },
      select: { id: true, netMicros: true },
    });
    let covered = 0n;
    const coveredIds: string[] = [];
    for (const earning of earnings) {
      if (covered >= transferableMicros) break;
      covered += earning.netMicros;
      coveredIds.push(earning.id);
    }
    if (coveredIds.length > 0) {
      await tx.earning.updateMany({
        where: { id: { in: coveredIds } },
        data: { payoutId: created.id, status: 'PAID' },
      });
    }

    // Two lines, one movement: the platform's liability to the publisher
    // becomes a liability in transit. Nothing is created or destroyed, which is
    // what lets a failed transfer be undone exactly.
    await post(tx, {
      kind: 'PAYOUT_INITIATED',
      idempotencyKey: `payout:initiate:${created.id}`,
      description: `Payout ${created.id} initiated`,
      actorUserId: params.actorUserId,
      metadata: { payoutId: created.id, creatorId: params.creatorId },
      lines: [
        {
          account: accounts.publisherAvailable(params.creatorId),
          direction: 'DEBIT',
          amountMicros: transferableMicros,
        },
        {
          account: accounts.payoutClearing(),
          direction: 'CREDIT',
          amountMicros: transferableMicros,
        },
      ],
    });

    return created;
  });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: 'payout.requested',
    entityKind: 'payout',
    entityId: payout.id,
    metadata: { creatorId: params.creatorId, amountMicros: transferableMicros.toString() },
  });

  if (payout.status === 'APPROVED') {
    await enqueue('payout.process', { payoutId: payout.id }, { idempotencyKey: `payout:process:${payout.id}` });
  }

  logger.info('payout.requested', {
    payoutId: payout.id,
    creatorId: params.creatorId,
    amountCents: payout.amountCents,
    status: payout.status,
  });

  return { payout };
}

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly available: bigint,
    public readonly requested: bigint,
  ) {
    super(`Insufficient balance: ${available} available, ${requested} requested`);
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Execute an approved payout against Stripe. Called by the payout job so a
 * Stripe outage retries rather than failing the publisher's request.
 */
export async function processPayout(payoutId: string): Promise<{ ok: boolean; error?: string }> {
  const payout = await prisma.payout.findUniqueOrThrow({
    where: { id: payoutId },
    include: { creator: true },
  });

  if (payout.status === 'PAID') return { ok: true };
  if (payout.status !== 'APPROVED' && payout.status !== 'PROCESSING') {
    return { ok: false, error: `Payout is ${payout.status}, not approved` };
  }
  /*
   * The demo rail. A demo payout has already moved the balance into the payout
   * clearing account by the same double-entry posting a real one uses; all that
   * differs is that there is no provider on the other side to wait for, so it
   * settles here instead of on a Stripe webhook. No provider call is made and
   * no transfer id is invented.
   */
  if (payout.method === 'demo') {
    await prisma.payout.update({
      where: { id: payoutId },
      data: { status: 'PROCESSING', processedAt: new Date() },
    });
    const { settled } = await settlePayout({ payoutId });
    logger.info('payout.demo_settled', { payoutId, amountCents: payout.amountCents, settled });
    return { ok: true };
  }

  if (!payout.creator.stripeAccountId) {
    await failPayout(payoutId, 'no_connect_account', 'The publisher has no connected payout account');
    return { ok: false, error: 'No connected payout account' };
  }

  if (!stripeConfigured()) {
    throw new StripeNotConfiguredError('process a payout');
  }

  await prisma.payout.update({
    where: { id: payoutId },
    data: { status: 'PROCESSING', processedAt: new Date() },
  });

  try {
    const stripe = getStripe('process a payout');
    const transfer = await stripe.transfers.create(
      {
        amount: payout.amountCents,
        currency: payout.currency,
        destination: payout.creator.stripeAccountId,
        description: `Publisher earnings payout ${payout.id}`,
        metadata: { payoutId: payout.id, creatorId: payout.creatorId },
      },
      // Stripe-side idempotency: a job retry after a timeout cannot double-pay.
      { idempotencyKey: payout.idempotencyKey },
    );

    await prisma.payout.update({
      where: { id: payoutId },
      data: { stripeTransferId: transfer.id },
    });

    logger.info('payout.transfer_created', {
      payoutId,
      transferId: transfer.id,
      amountCents: payout.amountCents,
    });

    // The ledger settles when Stripe confirms by webhook. For platforms where
    // transfers settle immediately, the webhook arrives within seconds.
    return { ok: true };
  } catch (error) {
    const message = (error as Error).message;
    const code = (error as { code?: string }).code ?? 'transfer_failed';
    logger.error('payout.transfer_failed', { payoutId, error: message, code });
    await failPayout(payoutId, code, message);
    return { ok: false, error: message };
  }
}

/**
 * Confirm a settled payout. Called from the Stripe webhook; idempotent so
 * duplicate deliveries settle once.
 */
export async function settlePayout(params: {
  payoutId?: string;
  stripeTransferId?: string;
  stripePayoutId?: string;
}): Promise<{ settled: boolean }> {
  const payout = params.payoutId
    ? await prisma.payout.findUnique({ where: { id: params.payoutId } })
    : params.stripeTransferId
      ? await prisma.payout.findUnique({ where: { stripeTransferId: params.stripeTransferId } })
      : null;

  if (!payout) {
    logger.warn('payout.settle_unknown', params);
    return { settled: false };
  }
  if (payout.status === 'PAID') return { settled: false };

  await withSerializableTransaction(async (tx) => {
    await post(tx, {
      kind: 'PAYOUT_SETTLED',
      idempotencyKey: `payout:settle:${payout.id}`,
      description: `Payout ${payout.id} settled`,
      metadata: { payoutId: payout.id, creatorId: payout.creatorId },
      lines: [
        // The in-transit liability is discharged…
        {
          account: accounts.payoutClearing(),
          direction: 'DEBIT',
          amountMicros: payout.amountMicros,
        },
        // …and the money has left the platform.
        {
          account: accounts.externalSettlement(),
          direction: 'CREDIT',
          amountMicros: payout.amountMicros,
        },
      ],
    });

    await tx.payout.update({
      where: { id: payout.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        stripePayoutId: params.stripePayoutId ?? null,
      },
    });
  });

  await enqueue('notify.generic', {
    kind: 'payout.sent',
    creatorId: payout.creatorId,
    payoutId: payout.id,
  }).catch(() => undefined);

  logger.info('payout.settled', { payoutId: payout.id, amountCents: payout.amountCents });
  return { settled: true };
}

/**
 * Mark a payout failed and return the money to the publisher's available
 * balance. Their earnings go back to AVAILABLE so they can retry — a failed
 * transfer must never cost a publisher their money.
 */
export async function failPayout(
  payoutId: string,
  code: string,
  message: string,
): Promise<void> {
  await withSerializableTransaction(async (tx) => {
    const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (payout.status === 'FAILED' || payout.status === 'PAID') return;

    await post(tx, {
      kind: 'PAYOUT_FAILED',
      idempotencyKey: `payout:fail:${payout.id}`,
      description: `Payout ${payout.id} failed: ${code}`,
      reason: message,
      metadata: { payoutId: payout.id, creatorId: payout.creatorId, code },
      lines: [
        // The exact inverse of PAYOUT_INITIATED: the money returns to the
        // publisher's available balance in full. A failed transfer must never
        // cost a publisher their earnings.
        {
          account: accounts.payoutClearing(),
          direction: 'DEBIT',
          amountMicros: payout.amountMicros,
        },
        {
          account: accounts.publisherAvailable(payout.creatorId),
          direction: 'CREDIT',
          amountMicros: payout.amountMicros,
        },
      ],
    });

    await tx.earning.updateMany({
      where: { payoutId: payout.id },
      data: { status: 'AVAILABLE', payoutId: null },
    });

    await tx.payout.update({
      where: { id: payout.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureCode: code,
        failureMessage: message.slice(0, 500),
      },
    });
  });

  await enqueue('notify.generic', { kind: 'payout.failed', payoutId }).catch(() => undefined);
  logger.error('payout.failed', { payoutId, code, message });
}

// ---------------------------------------------------------------------------
// Stripe Connect onboarding
// ---------------------------------------------------------------------------

/**
 * Create (or reuse) the publisher's Connect account and return a one-time
 * onboarding link. Identity documents, bank details and tax forms are collected
 * by Stripe, never by this application — that is deliberate: we do not want
 * that data, and Stripe's onboarding is what makes the payouts compliant.
 */
export async function createConnectOnboardingLink(params: {
  creatorId: string;
  returnPath?: string;
}): Promise<{ url: string; accountId: string }> {
  const creator = await prisma.creator.findUniqueOrThrow({
    where: { id: params.creatorId },
    include: { user: true },
  });
  assertNotDemo(creator, 'connect a real payout account');

  const stripe = getStripe('set up payouts');

  let accountId = creator.stripeAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create(
      {
        type: integrations.stripe.accountType,
        email: creator.user.email,
        country: creator.country ?? 'US',
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        metadata: { creatorId: creator.id, userId: creator.userId },
        settings: {
          payouts: { schedule: { interval: 'manual' } },
        },
      },
      { idempotencyKey: `connect:${creator.id}` },
    );
    accountId = account.id;
    await prisma.creator.update({
      where: { id: creator.id },
      data: { stripeAccountId: accountId },
    });
  }

  const returnUrl = `${env.appUrl}${params.returnPath ?? '/creator/payouts'}`;
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${returnUrl}?refresh=1`,
    return_url: `${returnUrl}?connected=1`,
    type: 'account_onboarding',
  });

  return { url: link.url, accountId };
}

/** Mirror a Connect account's current state into our database. */
export async function syncConnectAccount(accountId: string): Promise<void> {
  if (!stripeConfigured()) return;
  const stripe = getStripe('sync a payout account');

  const account = await stripe.accounts.retrieve(accountId);
  const requirements = [
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? []),
  ];

  const creator = await prisma.creator.findUnique({ where: { stripeAccountId: accountId } });
  if (!creator) {
    logger.warn('connect.unknown_account', { accountId });
    return;
  }

  await prisma.creator.update({
    where: { id: creator.id },
    data: {
      stripePayoutsEnabled: account.payouts_enabled ?? false,
      stripeChargesEnabled: account.charges_enabled ?? false,
      stripeRequirementsDue: [...new Set(requirements)],
      // Stripe completing its identity checks is what verifies a publisher.
      verification:
        account.payouts_enabled && creator.verification === 'UNVERIFIED'
          ? 'VERIFIED'
          : creator.verification,
    },
  });

  logger.info('connect.synced', {
    creatorId: creator.id,
    payoutsEnabled: account.payouts_enabled,
    requirementsDue: requirements.length,
  });
}

/** Login link to the publisher's Stripe Express dashboard. */
export async function createConnectDashboardLink(creator: Creator): Promise<string | null> {
  if (!stripeConfigured() || !creator.stripeAccountId) return null;
  if (integrations.stripe.accountType !== 'express') return null;
  const stripe = getStripe('open the payout dashboard');
  const link = await stripe.accounts.createLoginLink(creator.stripeAccountId);
  return link.url;
}
