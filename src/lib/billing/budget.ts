import { accounts, post, type Tx } from '@/lib/billing/ledger';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

/**
 * Campaign budget control.
 *
 * This is the module that stops the platform accruing liability it cannot fund.
 * The invariant is:
 *
 *     reserved + spent <= funded
 *
 * enforced three ways, deliberately redundantly:
 *
 *   1. `SELECT ... FOR UPDATE` on the single `campaign_budgets` row. Concurrent
 *      billable events for one campaign serialise behind this lock, so two
 *      simultaneous clicks cannot both read the same remaining balance and both
 *      decide there is room. This is the primary mechanism.
 *   2. A CHECK constraint on the table (`campaign_budget_within_funding`), so a
 *      code path that bypasses this module still cannot record an overspend.
 *   3. The ledger itself, where escrow can never go negative.
 *
 * Money moves through two phases. `reserve` commits funds when an earning is
 * accrued (pending). `settle` converts a reservation into spend when the
 * earning is approved. `release` returns a reservation when an earning is
 * rejected or reversed. Keeping reserve and spend separate is what makes a
 * fraud hold financially honest: the brand's money is committed but not yet
 * transferred, and can be returned intact.
 */

export interface ReserveResult {
  ok: boolean;
  reason?: 'INSUFFICIENT_FUNDS' | 'NO_BUDGET' | 'DAILY_CAP';
  remainingMicros: bigint;
  reservedMicros: bigint;
}

interface BudgetRow {
  id: string;
  campaignId: string;
  totalBudgetMicros: bigint;
  fundedMicros: bigint;
  reservedMicros: bigint;
  spentMicros: bigint;
  dailyCapMicros: bigint | null;
  lowBalanceBps: number;
  lowBalanceNotifiedAt: Date | null;
  exhaustedAt: Date | null;
}

/** Lock and read the budget row. Must be called inside a transaction. */
async function lockBudget(tx: Tx, campaignId: string): Promise<BudgetRow | null> {
  const rows = await tx.$queryRaw<BudgetRow[]>`
    SELECT id, "campaignId", "totalBudgetMicros", "fundedMicros", "reservedMicros",
           "spentMicros", "dailyCapMicros", "lowBalanceBps", "lowBalanceNotifiedAt",
           "exhaustedAt"
    FROM "campaign_budgets"
    WHERE "campaignId" = ${campaignId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export function availableMicros(budget: {
  fundedMicros: bigint;
  reservedMicros: bigint;
  spentMicros: bigint;
}): bigint {
  const remaining = budget.fundedMicros - budget.reservedMicros - budget.spentMicros;
  return remaining > 0n ? remaining : 0n;
}

/**
 * Commit `amountMicros` of the campaign's funded balance.
 * Returns ok:false when the campaign cannot cover it — the caller then records
 * the event as BUDGET_EXHAUSTED and does not pay for it.
 */
export async function reserve(
  tx: Tx,
  campaignId: string,
  amountMicros: bigint,
): Promise<ReserveResult> {
  if (amountMicros <= 0n) {
    return { ok: true, remainingMicros: 0n, reservedMicros: 0n };
  }

  const budget = await lockBudget(tx, campaignId);
  if (!budget) {
    return { ok: false, reason: 'NO_BUDGET', remainingMicros: 0n, reservedMicros: 0n };
  }

  const available = availableMicros(budget);
  if (available < amountMicros) {
    // Stamp exhaustion once so the notification job can act on the transition.
    if (!budget.exhaustedAt) {
      await tx.campaignBudget.update({
        where: { id: budget.id },
        data: { exhaustedAt: new Date() },
      });
    }
    return {
      ok: false,
      reason: 'INSUFFICIENT_FUNDS',
      remainingMicros: available,
      reservedMicros: budget.reservedMicros,
    };
  }

  if (budget.dailyCapMicros && budget.dailyCapMicros > 0n) {
    const spentToday = await spentSince(tx, campaignId, startOfUtcDay());
    if (spentToday + amountMicros > budget.dailyCapMicros) {
      return {
        ok: false,
        reason: 'DAILY_CAP',
        remainingMicros: available,
        reservedMicros: budget.reservedMicros,
      };
    }
  }

  const updated = await tx.campaignBudget.update({
    where: { id: budget.id },
    data: {
      reservedMicros: { increment: amountMicros },
      version: { increment: 1 },
    },
  });

  return {
    ok: true,
    remainingMicros: availableMicros(updated),
    reservedMicros: updated.reservedMicros,
  };
}

/** Convert a reservation into settled spend (earning approved). */
export async function settle(tx: Tx, campaignId: string, amountMicros: bigint): Promise<void> {
  if (amountMicros <= 0n) return;
  const budget = await lockBudget(tx, campaignId);
  if (!budget) throw new Error(`Campaign ${campaignId} has no budget row`);

  // Guard against settling more than was reserved, which would corrupt the
  // invariant even though the CHECK constraint would still pass.
  const amount = amountMicros > budget.reservedMicros ? budget.reservedMicros : amountMicros;

  await tx.campaignBudget.update({
    where: { id: budget.id },
    data: {
      reservedMicros: { decrement: amount },
      spentMicros: { increment: amount },
      version: { increment: 1 },
    },
  });
}

/** Return a reservation to the campaign (earning rejected or reversed). */
export async function release(tx: Tx, campaignId: string, amountMicros: bigint): Promise<void> {
  if (amountMicros <= 0n) return;
  const budget = await lockBudget(tx, campaignId);
  if (!budget) return;

  const amount = amountMicros > budget.reservedMicros ? budget.reservedMicros : amountMicros;
  await tx.campaignBudget.update({
    where: { id: budget.id },
    data: {
      reservedMicros: { decrement: amount },
      version: { increment: 1 },
      // Releasing funds can un-exhaust a campaign.
      exhaustedAt: null,
    },
  });
}

/** Reverse settled spend (refund, chargeback, post-approval reversal). */
export async function unsettle(tx: Tx, campaignId: string, amountMicros: bigint): Promise<void> {
  if (amountMicros <= 0n) return;
  const budget = await lockBudget(tx, campaignId);
  if (!budget) return;

  const amount = amountMicros > budget.spentMicros ? budget.spentMicros : amountMicros;
  await tx.campaignBudget.update({
    where: { id: budget.id },
    data: { spentMicros: { decrement: amount }, version: { increment: 1 }, exhaustedAt: null },
  });
}

/**
 * Add funds to a campaign, moving money from the brand's deposit balance into
 * the campaign's escrow. Both the budget row and the ledger are updated in the
 * caller's transaction so they can never disagree.
 */
export async function fundCampaign(
  tx: Tx,
  params: {
    campaignId: string;
    brandId: string;
    amountMicros: bigint;
    idempotencyKey: string;
    actorUserId?: string;
    reason?: string;
  },
): Promise<{ fundedMicros: bigint }> {
  const { campaignId, brandId, amountMicros } = params;
  if (amountMicros <= 0n) throw new Error('Funding amount must be positive');

  const budget = await lockBudget(tx, campaignId);
  if (!budget) throw new Error(`Campaign ${campaignId} has no budget row`);

  await post(tx, {
    kind: 'CAMPAIGN_FUND',
    idempotencyKey: params.idempotencyKey,
    description: `Fund campaign ${campaignId}`,
    actorUserId: params.actorUserId,
    reason: params.reason,
    metadata: { campaignId, brandId, amountMicros },
    lines: [
      // Reduce the brand's unallocated deposit…
      { account: accounts.brandDeposit(brandId), direction: 'DEBIT', amountMicros },
      // …and hold it against this campaign.
      { account: accounts.campaignEscrow(campaignId), direction: 'CREDIT', amountMicros },
    ],
  });

  const updated = await tx.campaignBudget.update({
    where: { id: budget.id },
    data: {
      fundedMicros: { increment: amountMicros },
      version: { increment: 1 },
      exhaustedAt: null,
      lowBalanceNotifiedAt: null,
    },
  });

  return { fundedMicros: updated.fundedMicros };
}

/**
 * Return unspent, unreserved campaign funds to the brand's deposit balance.
 * Used when a campaign is completed or cancelled.
 */
export async function defundCampaign(
  tx: Tx,
  params: {
    campaignId: string;
    brandId: string;
    idempotencyKey: string;
    actorUserId?: string;
    reason?: string;
    amountMicros?: bigint;
  },
): Promise<{ returnedMicros: bigint }> {
  const budget = await lockBudget(tx, params.campaignId);
  if (!budget) return { returnedMicros: 0n };

  const available = availableMicros(budget);
  const amount = params.amountMicros
    ? params.amountMicros > available
      ? available
      : params.amountMicros
    : available;

  if (amount <= 0n) return { returnedMicros: 0n };

  await post(tx, {
    kind: 'CAMPAIGN_DEFUND',
    idempotencyKey: params.idempotencyKey,
    description: `Return unspent funds from campaign ${params.campaignId}`,
    actorUserId: params.actorUserId,
    reason: params.reason,
    metadata: { campaignId: params.campaignId, amountMicros: amount },
    lines: [
      { account: accounts.campaignEscrow(params.campaignId), direction: 'DEBIT', amountMicros: amount },
      { account: accounts.brandDeposit(params.brandId), direction: 'CREDIT', amountMicros: amount },
    ],
  });

  await tx.campaignBudget.update({
    where: { id: budget.id },
    data: { fundedMicros: { decrement: amount }, version: { increment: 1 } },
  });

  return { returnedMicros: amount };
}

async function spentSince(tx: Tx, campaignId: string, since: Date): Promise<bigint> {
  const rows = await tx.$queryRaw<Array<{ total: bigint | null }>>`
    SELECT COALESCE(SUM("grossMicros"), 0)::bigint AS total
    FROM "earnings"
    WHERE "campaignId" = ${campaignId}::uuid
      AND "createdAt" >= ${since}
      AND status <> 'REJECTED'
      AND status <> 'REVERSED'
  `;
  return rows[0]?.total ?? 0n;
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Read-only snapshot for dashboards. */
export async function budgetSnapshot(campaignId: string) {
  const budget = await prisma.campaignBudget.findUnique({ where: { campaignId } });
  if (!budget) return null;
  const available = availableMicros(budget);
  const funded = budget.fundedMicros;
  return {
    totalBudgetMicros: budget.totalBudgetMicros,
    fundedMicros: funded,
    reservedMicros: budget.reservedMicros,
    spentMicros: budget.spentMicros,
    availableMicros: available,
    exhausted: budget.exhaustedAt !== null,
    percentRemaining: funded > 0n ? Number((available * 10_000n) / funded) / 100 : 0,
  };
}

/** Campaigns whose remaining budget has dropped below their alert threshold. */
export async function campaignsNeedingLowBalanceAlert(): Promise<
  Array<{ campaignId: string; remainingMicros: bigint; fundedMicros: bigint }>
> {
  const rows = await prisma.$queryRaw<
    Array<{ campaignId: string; remaining: bigint; funded: bigint }>
  >`
    SELECT b."campaignId", 
           (b."fundedMicros" - b."reservedMicros" - b."spentMicros") AS remaining,
           b."fundedMicros" AS funded
    FROM "campaign_budgets" b
    JOIN "campaigns" c ON c.id = b."campaignId"
    WHERE c.status = 'ACTIVE'
      AND b."fundedMicros" > 0
      AND b."lowBalanceNotifiedAt" IS NULL
      AND (b."fundedMicros" - b."reservedMicros" - b."spentMicros") * 10000
          <= b."fundedMicros" * b."lowBalanceBps"
  `;
  logger.debug('budget.low_balance_scan', { count: rows.length });
  return rows.map((r) => ({
    campaignId: r.campaignId,
    remainingMicros: r.remaining,
    fundedMicros: r.funded,
  }));
}
