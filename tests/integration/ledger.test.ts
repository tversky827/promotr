import { beforeEach, afterAll, describe, expect, it } from 'vitest';

import { accounts, balanceOf, post, reconcileAccount, verifyGlobalBalance } from '@/lib/billing/ledger';
import { prisma } from '@/lib/db';

import { disconnect, resetDatabase, testDb } from '../helpers/db';
import { createBrand, createCreator } from '../helpers/factories';

describe('ledger', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnect();
    await prisma.$disconnect();
  });

  it('posts a balanced transaction and updates both account balances', async () => {
    const { brand } = await createBrand();

    await prisma.$transaction(async (tx) => {
      await post(tx, {
        kind: 'BRAND_DEPOSIT',
        idempotencyKey: 'deposit-1',
        description: 'Test deposit',
        lines: [
          {
            account: accounts.externalSettlement(),
            direction: 'DEBIT',
            amountMicros: 100_000_000n,
          },
          {
            account: accounts.brandDeposit(brand.id),
            direction: 'CREDIT',
            amountMicros: 100_000_000n,
          },
        ],
      });
    });

    expect(await balanceOf(accounts.brandDeposit(brand.id))).toBe(100_000_000n);
    // EXTERNAL_SETTLEMENT is debit-natured, so paying money in shows as positive.
    expect(await balanceOf(accounts.externalSettlement())).toBe(100_000_000n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('refuses an unbalanced transaction', async () => {
    const { brand } = await createBrand();
    await expect(
      prisma.$transaction(async (tx) =>
        post(tx, {
          kind: 'BRAND_DEPOSIT',
          idempotencyKey: 'bad-1',
          description: 'Unbalanced',
          lines: [
            { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: 100n },
            { account: accounts.brandDeposit(brand.id), direction: 'CREDIT', amountMicros: 50n },
          ],
        }),
      ),
    ).rejects.toThrow(/Unbalanced/);
  });

  it('rejects non-positive amounts', async () => {
    const { brand } = await createBrand();
    await expect(
      prisma.$transaction(async (tx) =>
        post(tx, {
          kind: 'BRAND_DEPOSIT',
          idempotencyKey: 'bad-2',
          description: 'Zero amount',
          lines: [
            { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: 0n },
            { account: accounts.brandDeposit(brand.id), direction: 'CREDIT', amountMicros: 0n },
          ],
        }),
      ),
    ).rejects.toThrow(/must be positive/);
  });

  it('is idempotent — replaying a key does not double-post', async () => {
    const { brand } = await createBrand();

    const runOnce = () =>
      prisma.$transaction(async (tx) =>
        post(tx, {
          kind: 'BRAND_DEPOSIT',
          idempotencyKey: 'deposit-idem',
          description: 'Deposit',
          lines: [
            { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: 5_000_000n },
            { account: accounts.brandDeposit(brand.id), direction: 'CREDIT', amountMicros: 5_000_000n },
          ],
        }),
      );

    const first = await runOnce();
    const second = await runOnce();
    const third = await runOnce();

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(second.transactionId).toBe(first.transactionId);
    expect(await balanceOf(accounts.brandDeposit(brand.id))).toBe(5_000_000n);
    expect(await testDb.ledgerEntry.count()).toBe(2);
  });

  it('makes entries immutable — the database refuses updates and deletes', async () => {
    const { brand } = await createBrand();
    await prisma.$transaction(async (tx) =>
      post(tx, {
        kind: 'BRAND_DEPOSIT',
        idempotencyKey: 'immutable-1',
        description: 'Deposit',
        lines: [
          { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: 1_000_000n },
          { account: accounts.brandDeposit(brand.id), direction: 'CREDIT', amountMicros: 1_000_000n },
        ],
      }),
    );

    const entry = await testDb.ledgerEntry.findFirstOrThrow();

    await expect(
      testDb.ledgerEntry.update({ where: { id: entry.id }, data: { amountMicros: 1n } }),
    ).rejects.toThrow(/append-only/);

    await expect(testDb.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('records a running balance on each entry', async () => {
    const { creator } = await createCreator();

    for (let i = 1; i <= 3; i += 1) {
      await prisma.$transaction(async (tx) =>
        post(tx, {
          kind: 'EARNING_ACCRUAL',
          idempotencyKey: `accrual-${i}`,
          description: `Accrual ${i}`,
          lines: [
            { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: 1_000_000n },
            {
              account: accounts.publisherAvailable(creator.id),
              direction: 'CREDIT',
              amountMicros: 1_000_000n,
            },
          ],
        }),
      );
    }

    const account = await testDb.ledgerAccount.findFirstOrThrow({
      where: { type: 'PUBLISHER_AVAILABLE', ownerId: creator.id },
    });
    const entries = await testDb.ledgerEntry.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(entries.map((e) => e.balanceAfter)).toEqual([1_000_000n, 2_000_000n, 3_000_000n]);
  });

  it('reconciles the cached balance against the sum of entries', async () => {
    const { brand } = await createBrand();
    await prisma.$transaction(async (tx) =>
      post(tx, {
        kind: 'BRAND_DEPOSIT',
        idempotencyKey: 'recon-1',
        description: 'Deposit',
        lines: [
          { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: 7_777_777n },
          { account: accounts.brandDeposit(brand.id), direction: 'CREDIT', amountMicros: 7_777_777n },
        ],
      }),
    );

    const account = await testDb.ledgerAccount.findFirstOrThrow({
      where: { type: 'BRAND_DEPOSIT', ownerId: brand.id },
    });
    const result = await reconcileAccount(account.id);

    expect(result.ok).toBe(true);
    expect(result.drift).toBe(0n);
    expect(result.derivedMicros).toBe(7_777_777n);
  });

  it('detects drift when a cached balance is tampered with', async () => {
    const { brand } = await createBrand();
    await prisma.$transaction(async (tx) =>
      post(tx, {
        kind: 'BRAND_DEPOSIT',
        idempotencyKey: 'drift-1',
        description: 'Deposit',
        lines: [
          { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: 1_000_000n },
          { account: accounts.brandDeposit(brand.id), direction: 'CREDIT', amountMicros: 1_000_000n },
        ],
      }),
    );

    const account = await testDb.ledgerAccount.findFirstOrThrow({
      where: { type: 'BRAND_DEPOSIT', ownerId: brand.id },
    });
    // Simulate corruption by writing the cache directly.
    await testDb.ledgerAccount.update({
      where: { id: account.id },
      data: { balanceMicros: 999n },
    });

    const result = await reconcileAccount(account.id);
    expect(result.ok).toBe(false);
    expect(result.drift).toBe(999n - 1_000_000n);
  });

  it('creates exactly one account for a singleton platform account under concurrency', async () => {
    const { brand } = await createBrand();

    // Ten concurrent postings all touching PLATFORM_REVENUE for the first time.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        prisma.$transaction(async (tx) =>
          post(tx, {
            kind: 'PLATFORM_FEE',
            idempotencyKey: `fee-${i}`,
            description: 'Fee',
            lines: [
              { account: accounts.brandDeposit(brand.id), direction: 'DEBIT', amountMicros: 100n },
              { account: accounts.platformRevenue(), direction: 'CREDIT', amountMicros: 100n },
            ],
          }),
        ),
      ),
    );

    const platformAccounts = await testDb.ledgerAccount.findMany({
      where: { type: 'PLATFORM_REVENUE' },
    });
    expect(platformAccounts).toHaveLength(1);
    expect(platformAccounts[0]!.balanceMicros).toBe(1000n);
  });
});
