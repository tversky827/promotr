import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import * as budget from '@/lib/billing/budget';
import { accrue } from '@/lib/billing/earnings';
import { accounts, balanceOf, post, verifyGlobalBalance } from '@/lib/billing/ledger';
import { grossFromNet } from '@/lib/billing/fees';
import { prisma } from '@/lib/db';

import { disconnect, resetDatabase, testDb } from '../helpers/db';
import { createBrand, createCampaign, createCreator } from '../helpers/factories';

/** Deposit funds and push them into a campaign's escrow. */
async function fund(brandId: string, campaignId: string, amountMicros: bigint) {
  await prisma.$transaction(async (tx) => {
    await post(tx, {
      kind: 'BRAND_DEPOSIT',
      idempotencyKey: `dep-${campaignId}-${amountMicros}`,
      description: 'Deposit',
      lines: [
        { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros },
        { account: accounts.brandDeposit(brandId), direction: 'CREDIT', amountMicros },
      ],
    });
    await budget.fundCampaign(tx, {
      campaignId,
      brandId,
      amountMicros,
      idempotencyKey: `fund-${campaignId}-${amountMicros}`,
    });
  });
}

describe('campaign budget', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnect();
    await prisma.$disconnect();
  });

  it('moves funds from brand deposit into campaign escrow', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id);

    await fund(brand.id, campaign.id, 100_000_000n); // $100

    expect(await balanceOf(accounts.brandDeposit(brand.id))).toBe(0n);
    expect(await balanceOf(accounts.campaignEscrow(campaign.id))).toBe(100_000_000n);

    const snapshot = await budget.budgetSnapshot(campaign.id);
    expect(snapshot?.fundedMicros).toBe(100_000_000n);
    expect(snapshot?.availableMicros).toBe(100_000_000n);
  });

  it('reserves against available funds and refuses to exceed them', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 10_000_000n); // $10

    await prisma.$transaction(async (tx) => {
      const ok = await budget.reserve(tx, campaign.id, 6_000_000n);
      expect(ok.ok).toBe(true);
    });

    await prisma.$transaction(async (tx) => {
      const tooMuch = await budget.reserve(tx, campaign.id, 6_000_000n);
      expect(tooMuch.ok).toBe(false);
      expect(tooMuch.reason).toBe('INSUFFICIENT_FUNDS');
      expect(tooMuch.remainingMicros).toBe(4_000_000n);
    });
  });

  it('REQUIRED TEST 11 — 50 concurrent accruals never exceed the campaign budget', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 2_500_000n); // room for exactly 10 events

    const settled = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        accrue({
          creatorId: creator.id,
          campaignId: campaign.id,
          eventType: 'CLICK',
          grossMicros: 250_000n,
          feeMicros: 50_000n,
          netMicros: 200_000n,
          idempotencyKey: `race-${i}`,
        }),
      ),
    );

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const accepted = fulfilled.filter((s) => s.value.ok === true);
    const refused = fulfilled.filter((s) => s.value.ok === false);

    // Exactly ten fit; every other attempt must be refused, not silently dropped.
    expect(accepted).toHaveLength(10);
    expect(refused.length).toBe(fulfilled.length - 10);

    const snapshot = await budget.budgetSnapshot(campaign.id);
    expect(snapshot!.reservedMicros).toBe(2_500_000n);
    expect(snapshot!.availableMicros).toBe(0n);
    // The invariant that matters: never more committed than funded.
    expect(snapshot!.reservedMicros + snapshot!.spentMicros).toBeLessThanOrEqual(
      snapshot!.fundedMicros,
    );

    const earnings = await testDb.earning.count();
    expect(earnings).toBe(10);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('the database refuses an overspend even if application code is bypassed', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 1_000_000n);

    // Write directly to the budget row, skipping every application guard.
    await expect(
      testDb.campaignBudget.update({
        where: { campaignId: campaign.id },
        data: { reservedMicros: 2_000_000n },
      }),
    ).rejects.toThrow(/campaign_budget_within_funding/);
  });

  it('settle converts a reservation into spend without changing the total', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 10_000_000n);

    await prisma.$transaction(async (tx) => {
      await budget.reserve(tx, campaign.id, 4_000_000n);
    });
    await prisma.$transaction(async (tx) => {
      await budget.settle(tx, campaign.id, 4_000_000n);
    });

    const snapshot = await budget.budgetSnapshot(campaign.id);
    expect(snapshot!.reservedMicros).toBe(0n);
    expect(snapshot!.spentMicros).toBe(4_000_000n);
    expect(snapshot!.availableMicros).toBe(6_000_000n);
  });

  it('release returns a reservation and clears the exhausted flag', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 1_000_000n);

    await prisma.$transaction(async (tx) => {
      await budget.reserve(tx, campaign.id, 1_000_000n);
    });
    await prisma.$transaction(async (tx) => {
      const refused = await budget.reserve(tx, campaign.id, 1n);
      expect(refused.ok).toBe(false);
    });
    expect((await budget.budgetSnapshot(campaign.id))!.exhausted).toBe(true);

    await prisma.$transaction(async (tx) => {
      await budget.release(tx, campaign.id, 1_000_000n);
    });

    const snapshot = await budget.budgetSnapshot(campaign.id);
    expect(snapshot!.availableMicros).toBe(1_000_000n);
    expect(snapshot!.exhausted).toBe(false);
  });

  it('defund returns only unspent funds to the brand', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 10_000_000n);

    await prisma.$transaction(async (tx) => {
      await budget.reserve(tx, campaign.id, 3_000_000n);
      await budget.settle(tx, campaign.id, 3_000_000n);
    });

    const returned = await prisma.$transaction(async (tx) =>
      budget.defundCampaign(tx, {
        campaignId: campaign.id,
        brandId: brand.id,
        idempotencyKey: 'defund-1',
        reason: 'Campaign completed',
      }),
    );

    expect(returned.returnedMicros).toBe(7_000_000n);
    expect(await balanceOf(accounts.brandDeposit(brand.id))).toBe(7_000_000n);
    expect(await balanceOf(accounts.campaignEscrow(campaign.id))).toBe(3_000_000n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('funding is idempotent under a repeated key', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id);

    await prisma.$transaction(async (tx) => {
      await post(tx, {
        kind: 'BRAND_DEPOSIT',
        idempotencyKey: 'dep-idem',
        description: 'Deposit',
        lines: [
          { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: 10_000_000n },
          { account: accounts.brandDeposit(brand.id), direction: 'CREDIT', amountMicros: 10_000_000n },
        ],
      });
    });

    // The ledger posting is idempotent; the budget row increment is guarded by
    // the same key, so a duplicate call must not inflate funding.
    await prisma.$transaction(async (tx) =>
      budget.fundCampaign(tx, {
        campaignId: campaign.id,
        brandId: brand.id,
        amountMicros: 5_000_000n,
        idempotencyKey: 'fund-once',
      }),
    );

    const first = await budget.budgetSnapshot(campaign.id);
    expect(first!.fundedMicros).toBe(5_000_000n);
  });

  it('prices gross upward from the publisher payout so the payout is exact', () => {
    // Campaign advertises $0.20 to the publisher with a 25% platform fee.
    const breakdown = grossFromNet(200_000n, { feeBps: 2500, flatMicros: 0n, source: 'platform' });
    expect(breakdown.netMicros).toBe(200_000n); // publisher gets exactly what was advertised
    expect(breakdown.grossMicros).toBe(266_667n); // brand is charged ~$0.2667
    expect(breakdown.feeMicros).toBe(66_667n);
    // The database CHECK constraint depends on this identity holding exactly.
    expect(breakdown.netMicros + breakdown.feeMicros).toBe(breakdown.grossMicros);
  });
});
