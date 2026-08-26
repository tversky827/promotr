import { accounts, post, type Tx } from '@/lib/billing/ledger';
import * as budget from '@/lib/billing/budget';
import { isUniqueViolation, prisma, withSerializableTransaction } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { getSettings } from '@/lib/settings';

import type { BillableEvent, Earning, EarningStatus } from '@prisma/client';

/**
 * Earnings lifecycle.
 *
 *   PENDING       accrued; brand funds reserved; publisher cannot withdraw
 *   UNDER_REVIEW  flagged by the fraud engine; funds stay reserved
 *   APPROVED      cleared; moves to the publisher's pending ledger balance
 *   AVAILABLE     hold period elapsed; withdrawable
 *   PAID          included in a completed payout
 *   REJECTED      never valid (fraud, budget); reservation returned to brand
 *   REVERSED      was valid, then undone (refund, chargeback, dispute)
 *
 * Every transition is idempotent and writes ledger entries in the same database
 * transaction as the status change, so the ledger and the earnings table can
 * never disagree — this is what makes "every dollar explainable" true rather
 * than aspirational.
 */

export interface AccrueInput {
  creatorId: string;
  campaignId: string;
  eventType: BillableEvent;
  quantity?: number;
  grossMicros: bigint;
  feeMicros: bigint;
  netMicros: bigint;
  /** Stable key derived from the source event — makes retries safe. */
  idempotencyKey: string;
  clickId?: string | null;
  conversionId?: string | null;
  /** When true the earning lands UNDER_REVIEW instead of PENDING. */
  holdForReview?: boolean;
  reviewReason?: string;
}

export type AccrueResult =
  | { ok: true; earning: Earning; created: boolean }
  | { ok: false; reason: 'BUDGET_EXHAUSTED' | 'NO_BUDGET' | 'DAILY_CAP'; remainingMicros: bigint };

/**
 * Accrue an earning against a campaign's reserved budget.
 *
 * The budget reservation and the earning row are created in one transaction, so
 * an earning can never exist without funds behind it, and funds can never be
 * reserved without an earning to explain them.
 */
export async function accrue(input: AccrueInput): Promise<AccrueResult> {
  if (input.netMicros + input.feeMicros !== input.grossMicros) {
    throw new Error(
      `Earning arithmetic mismatch: ${input.netMicros} + ${input.feeMicros} != ${input.grossMicros}`,
    );
  }

  // A concurrent accrual with the same key surfaces as a unique violation,
  // which aborts the Postgres transaction — so it is caught out here, where the
  // transaction has already rolled back (releasing its budget reservation with
  // it) and the winner's row can safely be read.
  try {
    return await accrueInTransaction(input);
  } catch (error) {
    if (isUniqueViolation(error, 'idempotencyKey')) {
      const winner = await prisma.earning.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (winner) return { ok: true, earning: winner, created: false };
    }
    throw error;
  }
}

async function accrueInTransaction(input: AccrueInput): Promise<AccrueResult> {
  return withSerializableTransaction(async (tx) => {
    // Idempotency first: a retry must not double-reserve budget.
    const existing = await tx.earning.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return { ok: true as const, earning: existing, created: false };
    }

    const reservation = await budget.reserve(tx, input.campaignId, input.grossMicros);
    if (!reservation.ok) {
      return {
        ok: false as const,
        reason:
          reservation.reason === 'NO_BUDGET'
            ? ('NO_BUDGET' as const)
            : reservation.reason === 'DAILY_CAP'
              ? ('DAILY_CAP' as const)
              : ('BUDGET_EXHAUSTED' as const),
        remainingMicros: reservation.remainingMicros,
      };
    }

    const status: EarningStatus = input.holdForReview ? 'UNDER_REVIEW' : 'PENDING';

    const earning: Earning = await tx.earning.create({
      data: {
        creatorId: input.creatorId,
        campaignId: input.campaignId,
        conversionId: input.conversionId ?? null,
        clickId: input.clickId ?? null,
        eventType: input.eventType,
        quantity: input.quantity ?? 1,
        grossMicros: input.grossMicros,
        feeMicros: input.feeMicros,
        netMicros: input.netMicros,
        status,
        statusReason: input.reviewReason ?? null,
        idempotencyKey: input.idempotencyKey,
      },
    });

    // Ledger: campaign escrow is committed, split between the publisher's
    // pending balance and platform revenue. Escrow is only debited on approval;
    // at accrual we record the obligation against the reserved portion.
    await post(tx, {
      kind: 'EARNING_ACCRUAL',
      idempotencyKey: `earning:accrue:${earning.id}`,
      description: `Accrue ${input.eventType} earning for publisher ${input.creatorId}`,
      metadata: {
        earningId: earning.id,
        campaignId: input.campaignId,
        creatorId: input.creatorId,
        eventType: input.eventType,
      },
      lines: [
        {
          account: accounts.campaignEscrow(input.campaignId),
          direction: 'DEBIT',
          amountMicros: input.grossMicros,
        },
        {
          account: accounts.publisherPending(input.creatorId),
          direction: 'CREDIT',
          amountMicros: input.netMicros,
        },
        ...(input.feeMicros > 0n
          ? [
              {
                account: accounts.platformRevenue(),
                direction: 'CREDIT' as const,
                amountMicros: input.feeMicros,
              },
            ]
          : []),
      ],
    });

    return { ok: true as const, earning, created: true };
  });
}

/**
 * Approve an earning: the publisher's balance moves from pending to available
 * after the configured hold period, and the campaign's reservation becomes
 * settled spend.
 */
export async function approve(
  earningId: string,
  options: { actorUserId?: string; reason?: string; skipHold?: boolean } = {},
): Promise<Earning | null> {
  const settings = await getSettings();

  return withSerializableTransaction(async (tx) => {
    const earning = await tx.earning.findUnique({ where: { id: earningId } });
    if (!earning) return null;
    if (earning.status === 'APPROVED' || earning.status === 'AVAILABLE' || earning.status === 'PAID') {
      return earning; // Already approved — idempotent.
    }
    if (earning.status === 'REJECTED' || earning.status === 'REVERSED') {
      return earning; // Terminal; approval is not a valid transition.
    }

    await budget.settle(tx, earning.campaignId, earning.grossMicros);

    const availableAt = options.skipHold
      ? new Date()
      : new Date(Date.now() + settings.earningHoldDays * 24 * 60 * 60 * 1000);
    const immediatelyAvailable = availableAt <= new Date();

    const updated = await tx.earning.update({
      where: { id: earningId },
      data: {
        status: immediatelyAvailable ? 'AVAILABLE' : 'APPROVED',
        approvedAt: new Date(),
        availableAt,
        statusReason: options.reason ?? null,
      },
    });

    if (immediatelyAvailable) {
      await moveToAvailable(tx, earning.creatorId, earning.netMicros, earning.id);
    }

    return updated;
  });
}

/**
 * Move an approved earning's value from the publisher's pending balance to
 * their available (withdrawable) balance. Called at approval when there is no
 * hold, and by the release job once the hold elapses.
 */
async function moveToAvailable(
  tx: Tx,
  creatorId: string,
  netMicros: bigint,
  earningId: string,
): Promise<void> {
  if (netMicros <= 0n) return;
  await post(tx, {
    kind: 'EARNING_APPROVAL',
    idempotencyKey: `earning:available:${earningId}`,
    description: `Release earning ${earningId} to available balance`,
    metadata: { earningId, creatorId },
    lines: [
      {
        account: accounts.publisherPending(creatorId),
        direction: 'DEBIT',
        amountMicros: netMicros,
      },
      {
        account: accounts.publisherAvailable(creatorId),
        direction: 'CREDIT',
        amountMicros: netMicros,
      },
    ],
  });
}

/**
 * Which publisher account currently holds an earning's value.
 * APPROVED earnings are still in the pending account — they only move to
 * available once the hold period elapses — so status, not "was it settled",
 * decides where the money is.
 */
function holdingAccount(status: EarningStatus, creatorId: string) {
  return status === 'AVAILABLE' || status === 'PAID'
    ? accounts.publisherAvailable(creatorId)
    : accounts.publisherPending(creatorId);
}

/** Run by the scheduled job: promote APPROVED earnings past their hold date. */
export async function releaseMaturedEarnings(limit = 500): Promise<number> {
  const due = await prisma.earning.findMany({
    where: { status: 'APPROVED', availableAt: { lte: new Date() } },
    select: { id: true },
    take: limit,
  });

  let released = 0;
  for (const { id } of due) {
    try {
      await withSerializableTransaction(async (tx) => {
        const earning = await tx.earning.findUnique({ where: { id } });
        if (!earning || earning.status !== 'APPROVED') return;
        await tx.earning.update({ where: { id }, data: { status: 'AVAILABLE' } });
        await moveToAvailable(tx, earning.creatorId, earning.netMicros, earning.id);
      });
      released += 1;
    } catch (error) {
      logger.error('earnings.release_failed', { earningId: id, error: (error as Error).message });
    }
  }
  return released;
}

/**
 * Reject an earning that was never valid. The brand's reservation is returned
 * in full and the publisher's pending balance is unwound.
 *
 * This does NOT confiscate money the publisher legitimately earned; it applies
 * only to events the fraud engine or an admin determined were not real. The
 * publisher can dispute the decision (see src/lib/disputes.ts).
 */
export async function reject(
  earningId: string,
  reason: string,
  options: { actorUserId?: string } = {},
): Promise<Earning | null> {
  return withSerializableTransaction(async (tx) => {
    const earning = await tx.earning.findUnique({ where: { id: earningId } });
    if (!earning) return null;
    if (earning.status === 'REJECTED') return earning;
    if (earning.status === 'PAID') {
      throw new Error('A paid earning cannot be rejected; reverse it instead');
    }

    const wasSettled = earning.status === 'APPROVED' || earning.status === 'AVAILABLE';
    if (wasSettled) {
      await budget.unsettle(tx, earning.campaignId, earning.grossMicros);
    } else {
      await budget.release(tx, earning.campaignId, earning.grossMicros);
    }

    // Unwind the accrual: return escrow, remove the publisher's claim and the
    // platform's fee.
    await post(tx, {
      kind: 'EARNING_REVERSAL',
      idempotencyKey: `earning:reject:${earning.id}`,
      description: `Reject earning ${earning.id}: ${reason}`,
      actorUserId: options.actorUserId,
      reason,
      metadata: { earningId: earning.id, creatorId: earning.creatorId },
      lines: [
        {
          account: holdingAccount(earning.status, earning.creatorId),
          direction: 'DEBIT',
          amountMicros: earning.netMicros,
        },
        ...(earning.feeMicros > 0n
          ? [
              {
                account: accounts.platformRevenue(),
                direction: 'DEBIT' as const,
                amountMicros: earning.feeMicros,
              },
            ]
          : []),
        {
          account: accounts.campaignEscrow(earning.campaignId),
          direction: 'CREDIT',
          amountMicros: earning.grossMicros,
        },
      ],
    });

    return tx.earning.update({
      where: { id: earningId },
      data: { status: 'REJECTED', statusReason: reason, reversedAt: new Date() },
    });
  });
}

/**
 * Reverse an earning that has already been paid out. The publisher's available
 * balance goes negative-capable via a debit; the shortfall is recovered from
 * future earnings. Used for chargebacks and post-payout dispute resolutions.
 */
export async function reverse(
  earningId: string,
  reason: string,
  options: { actorUserId?: string } = {},
): Promise<Earning | null> {
  return withSerializableTransaction(async (tx) => {
    const earning = await tx.earning.findUnique({ where: { id: earningId } });
    if (!earning) return null;
    if (earning.status === 'REVERSED') return earning;

    await budget.unsettle(tx, earning.campaignId, earning.grossMicros);

    await post(tx, {
      kind: 'EARNING_REVERSAL',
      idempotencyKey: `earning:reverse:${earning.id}`,
      description: `Reverse earning ${earning.id}: ${reason}`,
      actorUserId: options.actorUserId,
      reason,
      metadata: { earningId: earning.id, creatorId: earning.creatorId, wasPaid: earning.status === 'PAID' },
      lines: [
        {
          // A PAID earning's value has already left the available account; the
          // debit drives it negative and the shortfall is recovered from the
          // publisher's future earnings.
          account: holdingAccount(earning.status, earning.creatorId),
          direction: 'DEBIT',
          amountMicros: earning.netMicros,
        },
        ...(earning.feeMicros > 0n
          ? [
              {
                account: accounts.platformRevenue(),
                direction: 'DEBIT' as const,
                amountMicros: earning.feeMicros,
              },
            ]
          : []),
        {
          account: accounts.campaignEscrow(earning.campaignId),
          direction: 'CREDIT',
          amountMicros: earning.grossMicros,
        },
      ],
    });

    return tx.earning.update({
      where: { id: earningId },
      data: { status: 'REVERSED', statusReason: reason, reversedAt: new Date() },
    });
  });
}

/** Publisher balance summary, derived from the ledger and the earnings table. */
export interface BalanceSummary {
  pendingMicros: bigint;
  availableMicros: bigint;
  paidMicros: bigint;
  lifetimeMicros: bigint;
  underReviewMicros: bigint;
}

export async function balanceSummary(creatorId: string): Promise<BalanceSummary> {
  const [pending, available, paidAgg, grouped] = await Promise.all([
    prisma.ledgerAccount.findUnique({
      where: {
        type_ownerKind_ownerId_currency: {
          type: 'PUBLISHER_PENDING',
          ownerKind: 'creator',
          ownerId: creatorId,
          currency: 'usd',
        },
      },
      select: { balanceMicros: true },
    }),
    prisma.ledgerAccount.findUnique({
      where: {
        type_ownerKind_ownerId_currency: {
          type: 'PUBLISHER_AVAILABLE',
          ownerKind: 'creator',
          ownerId: creatorId,
          currency: 'usd',
        },
      },
      select: { balanceMicros: true },
    }),
    // Paid-to-date comes from settled payouts, not a ledger account: a
    // cumulative counter has no natural double-entry counterparty, and adding
    // one would double-count the movement the clearing account already records.
    prisma.payout.aggregate({
      where: { creatorId, status: 'PAID' },
      _sum: { amountMicros: true },
    }),
    prisma.earning.groupBy({
      by: ['status'],
      where: { creatorId },
      _sum: { netMicros: true },
    }),
  ]);

  const byStatus = new Map(grouped.map((g) => [g.status, g._sum.netMicros ?? 0n]));
  const lifetime = ['PENDING', 'APPROVED', 'AVAILABLE', 'PAID'].reduce(
    (total, status) => total + (byStatus.get(status as EarningStatus) ?? 0n),
    0n,
  );

  return {
    pendingMicros: pending?.balanceMicros ?? 0n,
    availableMicros: available?.balanceMicros ?? 0n,
    paidMicros: paidAgg._sum.amountMicros ?? 0n,
    lifetimeMicros: lifetime,
    underReviewMicros: byStatus.get('UNDER_REVIEW') ?? 0n,
  };
}
