import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { approve } from '@/lib/billing/earnings';
import { balanceSummary } from '@/lib/billing/earnings';
import { accounts, balanceOf, post, verifyGlobalBalance } from '@/lib/billing/ledger';
import {
  checkPayoutEligibility,
  failPayout,
  requestPayout,
  settlePayout,
} from '@/lib/billing/payouts';
import * as budget from '@/lib/billing/budget';
import { accrue } from '@/lib/billing/earnings';
import { prisma } from '@/lib/db';

import { disconnect, resetDatabase, testDb } from '../helpers/db';
import { createBrand, createCampaign, createCreator } from '../helpers/factories';

/**
 * Give a publisher a real, withdrawable balance by driving money through the
 * actual accrual and approval path rather than writing the ledger directly.
 */
async function giveAvailableBalance(
  creatorId: string,
  brandId: string,
  campaignId: string,
  netMicros: bigint,
) {
  const gross = (netMicros * 10_000n) / 8_000n; // 20% fee
  await prisma.$transaction(async (tx) => {
    await post(tx, {
      kind: 'BRAND_DEPOSIT',
      idempotencyKey: `dep-${campaignId}-${netMicros}`,
      description: 'Deposit',
      lines: [
        { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: gross },
        { account: accounts.brandDeposit(brandId), direction: 'CREDIT', amountMicros: gross },
      ],
    });
    await budget.fundCampaign(tx, {
      campaignId,
      brandId,
      amountMicros: gross,
      idempotencyKey: `fund-${campaignId}-${netMicros}`,
    });
  });

  const result = await accrue({
    creatorId,
    campaignId,
    eventType: 'SALE',
    grossMicros: gross,
    feeMicros: gross - netMicros,
    netMicros,
    idempotencyKey: `earn-${campaignId}-${netMicros}`,
  });
  if (!result.ok) throw new Error('accrual failed in test setup');
  // skipHold makes the earning immediately withdrawable.
  await approve(result.earning.id, { skipHold: true });
  return result.earning.id;
}

/** A publisher who has cleared every payout gate except Stripe itself. */
async function payoutReadyCreator() {
  const { creator } = await createCreator();
  await testDb.creator.update({
    where: { id: creator.id },
    data: {
      stripeAccountId: `acct_test_${creator.id.slice(0, 8)}`,
      stripePayoutsEnabled: true,
      verification: 'VERIFIED',
      taxFormStatus: 'verified',
    },
  });
  return testDb.creator.findUniqueOrThrow({ where: { id: creator.id } });
}

describe('payouts', () => {
  beforeEach(async () => {
    await resetDatabase();
    // Stripe is deliberately unconfigured in tests; eligibility checks that
    // depend on it are exercised explicitly below.
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterAll(async () => {
    await disconnect();
    await prisma.$disconnect();
  });

  it('reports "not configured" rather than pretending payouts work', async () => {
    const creator = await payoutReadyCreator();
    const eligibility = await checkPayoutEligibility(creator.id);

    expect(eligibility.eligible).toBe(false);
    if (eligibility.eligible) return;
    expect(eligibility.code).toBe('STRIPE_NOT_CONFIGURED');
    expect(eligibility.reason).toMatch(/no payment provider configured/i);
  });

  describe('with Stripe configured', () => {
    beforeEach(() => {
      // A key is needed for the eligibility gate; no Stripe call is made in
      // these tests — `processPayout` is the only thing that reaches the API.
      process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_for_gating';
    });

    it('blocks a payout below the minimum threshold', async () => {
      const { brand } = await createBrand();
      const creator = await payoutReadyCreator();
      const campaign = await createCampaign(brand.id);
      await giveAvailableBalance(creator.id, brand.id, campaign.id, 5_000_000n); // $5

      const eligibility = await checkPayoutEligibility(creator.id);
      expect(eligibility.eligible).toBe(false);
      if (eligibility.eligible) return;
      expect(eligibility.code).toBe('BELOW_MINIMUM'); // default minimum is $25
    });

    it('blocks a payout when identity verification is incomplete', async () => {
      const { brand } = await createBrand();
      const creator = await payoutReadyCreator();
      const campaign = await createCampaign(brand.id);
      await giveAvailableBalance(creator.id, brand.id, campaign.id, 100_000_000n);
      await testDb.creator.update({
        where: { id: creator.id },
        data: { verification: 'UNVERIFIED' },
      });

      const eligibility = await checkPayoutEligibility(creator.id);
      expect(eligibility.eligible).toBe(false);
      if (eligibility.eligible) return;
      expect(eligibility.code).toBe('NOT_VERIFIED');
    });

    it('blocks a payout while an administrative hold is in place', async () => {
      const { brand } = await createBrand();
      const creator = await payoutReadyCreator();
      const campaign = await createCampaign(brand.id);
      await giveAvailableBalance(creator.id, brand.id, campaign.id, 100_000_000n);
      await testDb.creator.update({
        where: { id: creator.id },
        data: { payoutHold: true, payoutHoldReason: 'Traffic quality review' },
      });

      const eligibility = await checkPayoutEligibility(creator.id);
      expect(eligibility.eligible).toBe(false);
      if (eligibility.eligible) return;
      expect(eligibility.code).toBe('PAYOUT_HOLD');
      expect(eligibility.reason).toBe('Traffic quality review');
    });

    it('requesting a payout moves the balance into clearing', async () => {
      const { brand } = await createBrand();
      const creator = await payoutReadyCreator();
      const campaign = await createCampaign(brand.id);
      await giveAvailableBalance(creator.id, brand.id, campaign.id, 100_000_000n); // $100

      const before = await balanceSummary(creator.id);
      expect(before.availableMicros).toBe(100_000_000n);

      const result = await requestPayout({ creatorId: creator.id, actorUserId: creator.userId });
      expect('payout' in result).toBe(true);
      if (!('payout' in result)) return;

      expect(result.payout.amountCents).toBe(10_000);
      expect(result.payout.amountMicros).toBe(100_000_000n);

      const after = await balanceSummary(creator.id);
      expect(after.availableMicros).toBe(0n); // cannot be spent twice
      expect(await balanceOf(accounts.payoutClearing())).toBe(100_000_000n);
      expect((await verifyGlobalBalance()).balanced).toBe(true);

      // The earnings this payout covers are marked, so the publisher's ledger
      // shows which earnings each payment settled.
      const earnings = await testDb.earning.findMany({ where: { payoutId: result.payout.id } });
      expect(earnings.length).toBeGreaterThan(0);
      expect(earnings[0]!.status).toBe('PAID');
    });

    it('REQUIRED TEST 9 — a settled payout reconciles the balance', async () => {
      const { brand } = await createBrand();
      const creator = await payoutReadyCreator();
      const campaign = await createCampaign(brand.id);
      await giveAvailableBalance(creator.id, brand.id, campaign.id, 100_000_000n);

      const result = await requestPayout({ creatorId: creator.id, actorUserId: creator.userId });
      if (!('payout' in result)) throw new Error('setup failed');

      // Stripe confirms by webhook.
      const settled = await settlePayout({
        payoutId: result.payout.id,
        stripeTransferId: 'tr_test_123',
      });
      expect(settled.settled).toBe(true);

      const payout = await testDb.payout.findUniqueOrThrow({ where: { id: result.payout.id } });
      expect(payout.status).toBe('PAID');
      expect(payout.paidAt).not.toBeNull();

      // Clearing is empty; the money has left the platform.
      expect(await balanceOf(accounts.payoutClearing())).toBe(0n);
      const balance = await balanceSummary(creator.id);
      expect(balance.availableMicros).toBe(0n);
      expect(balance.paidMicros).toBe(100_000_000n);
      expect((await verifyGlobalBalance()).balanced).toBe(true);
    });

    it('settling the same payout twice does not double-count', async () => {
      const { brand } = await createBrand();
      const creator = await payoutReadyCreator();
      const campaign = await createCampaign(brand.id);
      await giveAvailableBalance(creator.id, brand.id, campaign.id, 100_000_000n);

      const result = await requestPayout({ creatorId: creator.id, actorUserId: creator.userId });
      if (!('payout' in result)) throw new Error('setup failed');

      const first = await settlePayout({ payoutId: result.payout.id });
      const second = await settlePayout({ payoutId: result.payout.id });
      const third = await settlePayout({ payoutId: result.payout.id });

      expect(first.settled).toBe(true);
      expect(second.settled).toBe(false);
      expect(third.settled).toBe(false);

      expect(await balanceOf(accounts.payoutClearing())).toBe(0n);
      expect((await balanceSummary(creator.id)).paidMicros).toBe(100_000_000n);
      expect((await verifyGlobalBalance()).balanced).toBe(true);
    });

    it('a failed payout returns the money to the publisher, in full', async () => {
      const { brand } = await createBrand();
      const creator = await payoutReadyCreator();
      const campaign = await createCampaign(brand.id);
      await giveAvailableBalance(creator.id, brand.id, campaign.id, 100_000_000n);

      const result = await requestPayout({ creatorId: creator.id, actorUserId: creator.userId });
      if (!('payout' in result)) throw new Error('setup failed');

      await failPayout(result.payout.id, 'account_closed', 'The destination bank account was closed');

      const payout = await testDb.payout.findUniqueOrThrow({ where: { id: result.payout.id } });
      expect(payout.status).toBe('FAILED');
      expect(payout.failureCode).toBe('account_closed');

      // Every micro is back where it started.
      const balance = await balanceSummary(creator.id);
      expect(balance.availableMicros).toBe(100_000_000n);
      expect(balance.paidMicros).toBe(0n);
      expect(await balanceOf(accounts.payoutClearing())).toBe(0n);
      expect((await verifyGlobalBalance()).balanced).toBe(true);

      // The earnings are withdrawable again so the publisher can retry.
      const earnings = await testDb.earning.findMany({ where: { creatorId: creator.id } });
      expect(earnings.every((e) => e.status === 'AVAILABLE')).toBe(true);
      expect(earnings.every((e) => e.payoutId === null)).toBe(true);
    });

    it('refuses a second payout while one is in flight', async () => {
      const { brand } = await createBrand();
      const creator = await payoutReadyCreator();
      const campaign = await createCampaign(brand.id);
      await giveAvailableBalance(creator.id, brand.id, campaign.id, 200_000_000n);

      const first = await requestPayout({ creatorId: creator.id, actorUserId: creator.userId });
      expect('payout' in first).toBe(true);

      const second = await requestPayout({ creatorId: creator.id, actorUserId: creator.userId });
      expect('error' in second).toBe(true);
      if (!('error' in second)) return;
      expect(second.code).toBe('PENDING_PAYOUT_EXISTS');
    });

    it('leaves sub-cent dust in the balance rather than rounding it away', async () => {
      const { brand } = await createBrand();
      const creator = await payoutReadyCreator();
      const campaign = await createCampaign(brand.id);
      // $30.001234 — not a whole number of cents.
      await giveAvailableBalance(creator.id, brand.id, campaign.id, 30_001_234n);

      const result = await requestPayout({ creatorId: creator.id, actorUserId: creator.userId });
      if (!('payout' in result)) throw new Error(JSON.stringify(result));

      expect(result.payout.amountCents).toBe(3000); // $30.00 transferred
      expect(result.payout.amountMicros).toBe(30_000_000n);

      // The 1,234 micros of dust is still the publisher's money.
      const balance = await balanceSummary(creator.id);
      expect(balance.availableMicros).toBe(1_234n);
      expect((await verifyGlobalBalance()).balanced).toBe(true);
    });

    it('never pays out more than the ledger balance, even under concurrency', async () => {
      const { brand } = await createBrand();
      const creator = await payoutReadyCreator();
      const campaign = await createCampaign(brand.id);
      await giveAvailableBalance(creator.id, brand.id, campaign.id, 100_000_000n);

      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          requestPayout({ creatorId: creator.id, actorUserId: creator.userId }),
        ),
      );

      const created = attempts.filter(
        (a) => a.status === 'fulfilled' && 'payout' in a.value,
      );
      expect(created).toHaveLength(1);

      const total = await testDb.payout.aggregate({ _sum: { amountMicros: true } });
      expect(total._sum.amountMicros).toBe(100_000_000n);
      expect(await balanceOf(accounts.publisherAvailable(creator.id))).toBe(0n);
      expect((await verifyGlobalBalance()).balanced).toBe(true);
    });
  });
});
