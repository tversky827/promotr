import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

import type {
  EntryDirection,
  LedgerAccount,
  LedgerAccountType,
  TransactionKind,
} from '@prisma/client';

/**
 * Double-entry ledger.
 *
 * Rules, enforced here and again by database triggers (see the
 * `20260826163000_integrity_partitions` migration):
 *
 *   1. Every transaction balances: sum(debits) == sum(credits).
 *   2. Entries are append-only. A mistake is corrected by a new, offsetting
 *      transaction, never by editing history.
 *   3. Every posting carries an idempotency key. Re-posting the same key is a
 *      no-op that returns the original transaction, which is what makes webhook
 *      replays and job retries safe.
 *   4. Balances are cached on `ledger_accounts` for fast reads but are always
 *      derivable by summing entries. `reconcileAccount` proves they agree.
 *
 * Sign convention: this is a liability-heavy ledger. Money the platform owes
 * (publisher balances, brand deposits) lives in accounts whose natural balance
 * is a CREDIT. `balanceMicros` is stored in each account's natural sign, so a
 * publisher's available balance is a positive number.
 */

export type Tx = Prisma.TransactionClient;

/** Accounts whose natural balance increases on CREDIT (liabilities, income). */
const CREDIT_NATURED: ReadonlySet<LedgerAccountType> = new Set<LedgerAccountType>([
  'BRAND_DEPOSIT',
  'CAMPAIGN_ESCROW',
  'PUBLISHER_PENDING',
  'PUBLISHER_AVAILABLE',
  'PLATFORM_REVENUE',
  'ROUNDING',
]);

export interface AccountRef {
  type: LedgerAccountType;
  ownerKind: 'platform' | 'brand' | 'creator' | 'campaign' | 'external';
  /** Empty string for singleton platform/external accounts. */
  ownerId?: string;
  currency?: string;
}

export interface PostingLine {
  account: AccountRef;
  direction: EntryDirection;
  amountMicros: bigint;
}

export interface PostingInput {
  kind: TransactionKind;
  idempotencyKey: string;
  description: string;
  lines: PostingLine[];
  actorUserId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PostingResult {
  transactionId: string;
  /** True when this call created the transaction; false when it was a replay. */
  created: boolean;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

function accountKey(ref: AccountRef): string {
  return `${ref.type}:${ref.ownerKind}:${ref.ownerId ?? ''}:${ref.currency ?? 'usd'}`;
}

/**
 * Find or create a ledger account.
 *
 * Creation uses INSERT ... ON CONFLICT DO NOTHING rather than catching a unique
 * violation. Inside a Postgres transaction a failed statement aborts the whole
 * transaction, so "try insert, catch duplicate, select instead" does not work —
 * every subsequent statement would fail with 25P02. The conflict clause keeps
 * the statement successful whichever way the race goes.
 */
export async function ensureAccount(tx: Tx, ref: AccountRef): Promise<LedgerAccount> {
  const ownerId = ref.ownerId ?? '';
  const currency = ref.currency ?? 'usd';
  const where = {
    type_ownerKind_ownerId_currency: {
      type: ref.type,
      ownerKind: ref.ownerKind,
      ownerId,
      currency,
    },
  };

  const existing = await tx.ledgerAccount.findUnique({ where });
  if (existing) return existing;

  await tx.$executeRaw`
    INSERT INTO "ledger_accounts"
      (id, type, "ownerKind", "ownerId", currency, "balanceMicros", "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid(),
      ${ref.type}::"LedgerAccountType",
      ${ref.ownerKind},
      ${ownerId},
      ${currency},
      0,
      now(),
      now()
    )
    ON CONFLICT (type, "ownerKind", "ownerId", currency) DO NOTHING
  `;

  return tx.ledgerAccount.findUniqueOrThrow({ where });
}

/**
 * Post a balanced transaction.
 *
 * Must be called inside an existing database transaction: the caller normally
 * has other work (creating an earning, decrementing a budget) that has to
 * commit atomically with the ledger entries.
 */
export async function post(tx: Tx, input: PostingInput): Promise<PostingResult> {
  if (input.lines.length < 2) {
    throw new LedgerError('A ledger transaction needs at least two lines');
  }

  let debits = 0n;
  let credits = 0n;
  for (const line of input.lines) {
    if (line.amountMicros <= 0n) {
      throw new LedgerError(
        `Ledger amounts must be positive; direction carries the sign (got ${line.amountMicros})`,
      );
    }
    if (line.direction === 'DEBIT') debits += line.amountMicros;
    else credits += line.amountMicros;
  }
  if (debits !== credits) {
    throw new LedgerError(
      `Unbalanced transaction "${input.description}": debits=${debits} credits=${credits}`,
    );
  }

  // Idempotency and the race against a concurrent identical posting are handled
  // by one statement: the insert either creates the row (RETURNING gives us the
  // id) or conflicts and returns nothing, in which case the other caller won and
  // this call is a replay. Doing it this way — rather than catching a unique
  // violation — matters because a failed statement aborts the whole Postgres
  // transaction, taking the ledger entries down with it.
  const metadata = input.metadata
    ? JSON.stringify(serialize(input.metadata))
    : null;

  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "ledger_transactions"
      (id, kind, "idempotencyKey", description, "actorUserId", reason, metadata, "createdAt")
    VALUES (
      gen_random_uuid(),
      ${input.kind}::"TransactionKind",
      ${input.idempotencyKey},
      ${input.description},
      ${input.actorUserId ?? null}::uuid,
      ${input.reason ?? null},
      ${metadata}::jsonb,
      now()
    )
    ON CONFLICT ("idempotencyKey") DO NOTHING
    RETURNING id
  `;

  if (inserted.length === 0) {
    logger.debug('ledger.replay', { idempotencyKey: input.idempotencyKey });
    const found = await tx.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    return { transactionId: found.id, created: false };
  }

  const transaction = { id: inserted[0]!.id };

  // Group lines by account so one account touched twice gets a single balance
  // update and a deterministic lock order.
  const byAccount = new Map<string, { ref: AccountRef; delta: bigint; lines: PostingLine[] }>();
  for (const line of input.lines) {
    const key = accountKey(line.account);
    const entry = byAccount.get(key) ?? { ref: line.account, delta: 0n, lines: [] };
    entry.delta += signedDelta(line.account.type, line.direction, line.amountMicros);
    entry.lines.push(line);
    byAccount.set(key, entry);
  }

  // Sorting by key gives every posting the same lock acquisition order, which
  // is what prevents deadlocks between concurrent transactions.
  for (const key of [...byAccount.keys()].sort()) {
    const group = byAccount.get(key)!;
    const account = await ensureAccount(tx, group.ref);

    // Lock the row and re-read the balance so concurrent postings serialise.
    const locked = await tx.$queryRaw<Array<{ balanceMicros: bigint }>>`
      SELECT "balanceMicros" FROM "ledger_accounts" WHERE id = ${account.id}::uuid FOR UPDATE
    `;
    const current = locked[0]?.balanceMicros ?? 0n;
    const next = current + group.delta;

    await tx.ledgerAccount.update({
      where: { id: account.id },
      data: { balanceMicros: next },
    });

    // balanceAfter is recorded per entry so the ledger is independently
    // auditable without replaying every prior entry.
    let running = current;
    for (const line of group.lines) {
      running += signedDelta(group.ref.type, line.direction, line.amountMicros);
      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          accountId: account.id,
          direction: line.direction,
          amountMicros: line.amountMicros,
          balanceAfter: running,
        },
      });
    }
  }

  return { transactionId: transaction.id, created: true };
}

function signedDelta(
  type: LedgerAccountType,
  direction: EntryDirection,
  amount: bigint,
): bigint {
  const creditNatured = CREDIT_NATURED.has(type);
  if (direction === 'CREDIT') return creditNatured ? amount : -amount;
  return creditNatured ? -amount : amount;
}

/** Current cached balance, in the account's natural sign. */
export async function balanceOf(ref: AccountRef, client: Tx | typeof prisma = prisma): Promise<bigint> {
  const account = await client.ledgerAccount.findUnique({
    where: {
      type_ownerKind_ownerId_currency: {
        type: ref.type,
        ownerKind: ref.ownerKind,
        ownerId: ref.ownerId ?? '',
        currency: ref.currency ?? 'usd',
      },
    },
    select: { balanceMicros: true },
  });
  return account?.balanceMicros ?? 0n;
}

export interface ReconciliationResult {
  accountId: string;
  type: LedgerAccountType;
  ownerKind: string;
  ownerId: string;
  cachedMicros: bigint;
  derivedMicros: bigint;
  drift: bigint;
  ok: boolean;
}

/**
 * Recompute an account's balance from its entries and compare with the cache.
 * Any non-zero drift is a bug or tampering and is surfaced to the admin health
 * screen — it is never silently corrected.
 */
export async function reconcileAccount(accountId: string): Promise<ReconciliationResult> {
  const account = await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: accountId } });

  const rows = await prisma.$queryRaw<Array<{ debits: bigint | null; credits: bigint | null }>>`
    SELECT
      COALESCE(SUM(CASE WHEN direction = 'DEBIT'  THEN "amountMicros" ELSE 0 END), 0)::bigint AS debits,
      COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountMicros" ELSE 0 END), 0)::bigint AS credits
    FROM "ledger_entries"
    WHERE "accountId" = ${accountId}::uuid
  `;

  const debits = rows[0]?.debits ?? 0n;
  const credits = rows[0]?.credits ?? 0n;
  const derived = CREDIT_NATURED.has(account.type) ? credits - debits : debits - credits;
  const drift = account.balanceMicros - derived;

  return {
    accountId,
    type: account.type,
    ownerKind: account.ownerKind,
    ownerId: account.ownerId,
    cachedMicros: account.balanceMicros,
    derivedMicros: derived,
    drift,
    ok: drift === 0n,
  };
}

/** Reconcile every account. Run by the nightly job and the admin health page. */
export async function reconcileAll(): Promise<{
  checked: number;
  drifted: ReconciliationResult[];
}> {
  const accounts = await prisma.ledgerAccount.findMany({ select: { id: true } });
  const drifted: ReconciliationResult[] = [];
  for (const { id } of accounts) {
    const result = await reconcileAccount(id);
    if (!result.ok) drifted.push(result);
  }
  if (drifted.length > 0) {
    logger.error('ledger.drift_detected', {
      count: drifted.length,
      accounts: drifted.map((d) => ({ id: d.accountId, drift: d.drift.toString() })),
    });
  }
  return { checked: accounts.length, drifted };
}

/**
 * Global solvency check: across the whole ledger, debits must equal credits.
 * If this ever fails the ledger has been written to outside `post`.
 */
export async function verifyGlobalBalance(): Promise<{
  debits: bigint;
  credits: bigint;
  balanced: boolean;
}> {
  const rows = await prisma.$queryRaw<Array<{ debits: bigint | null; credits: bigint | null }>>`
    SELECT
      COALESCE(SUM(CASE WHEN direction = 'DEBIT'  THEN "amountMicros" ELSE 0 END), 0)::bigint AS debits,
      COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountMicros" ELSE 0 END), 0)::bigint AS credits
    FROM "ledger_entries"
  `;
  const debits = rows[0]?.debits ?? 0n;
  const credits = rows[0]?.credits ?? 0n;
  return { debits, credits, balanced: debits === credits };
}

function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serialize(v)]),
    );
  }
  return value;
}

/** Named account constructors, so account identity is never spelled by hand. */
export const accounts = {
  brandDeposit: (brandId: string): AccountRef => ({
    type: 'BRAND_DEPOSIT',
    ownerKind: 'brand',
    ownerId: brandId,
  }),
  campaignEscrow: (campaignId: string): AccountRef => ({
    type: 'CAMPAIGN_ESCROW',
    ownerKind: 'campaign',
    ownerId: campaignId,
  }),
  publisherPending: (creatorId: string): AccountRef => ({
    type: 'PUBLISHER_PENDING',
    ownerKind: 'creator',
    ownerId: creatorId,
  }),
  publisherAvailable: (creatorId: string): AccountRef => ({
    type: 'PUBLISHER_AVAILABLE',
    ownerKind: 'creator',
    ownerId: creatorId,
  }),
  publisherPaid: (creatorId: string): AccountRef => ({
    type: 'PUBLISHER_PAID',
    ownerKind: 'creator',
    ownerId: creatorId,
  }),
  platformRevenue: (): AccountRef => ({
    type: 'PLATFORM_REVENUE',
    ownerKind: 'platform',
    ownerId: '',
  }),
  payoutClearing: (): AccountRef => ({
    type: 'PAYOUT_CLEARING',
    ownerKind: 'platform',
    ownerId: '',
  }),
  externalSettlement: (): AccountRef => ({
    type: 'EXTERNAL_SETTLEMENT',
    ownerKind: 'external',
    ownerId: '',
  }),
  rounding: (): AccountRef => ({ type: 'ROUNDING', ownerKind: 'platform', ownerId: '' }),
} as const;
