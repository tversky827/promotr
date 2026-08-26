import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import * as budget from '@/lib/billing/budget';
import { balanceSummary } from '@/lib/billing/earnings';
import { accounts, balanceOf, post, verifyGlobalBalance } from '@/lib/billing/ledger';
import {
  approveConversion,
  computePayout,
  recordConversion,
  reverseConversion,
} from '@/lib/conversions/record';
import { prisma } from '@/lib/db';
import { recordClick, resolveRedirect } from '@/lib/tracking/redirect';

import { disconnect, resetDatabase, testDb } from '../helpers/db';
import { createBrand, createCampaign, createCreator, createTrackingLink } from '../helpers/factories';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fund(brandId: string, campaignId: string, amountMicros: bigint) {
  await prisma.$transaction(async (tx) => {
    await post(tx, {
      kind: 'BRAND_DEPOSIT',
      idempotencyKey: `dep-${campaignId}`,
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
      idempotencyKey: `fund-${campaignId}`,
    });
  });
}

/** Click a link and return the click id the advertiser would receive. */
async function clickThrough(code: string, ip = '203.0.113.10'): Promise<string> {
  const request = {
    code,
    ip,
    userAgent: CHROME,
    referrer: 'https://www.youtube.com/watch?v=abc',
    country: 'US',
    region: 'NY',
    city: 'New York',
    query: new URLSearchParams(),
  };
  const { outcome, link, clickId } = await resolveRedirect(request);
  if (link && outcome.kind === 'redirect') {
    await recordClick({ clickId, link, request, latencyMs: 4 });
  }
  return clickId;
}

describe('conversions', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnect();
    await prisma.$disconnect();
  });

  it('a conversion is recorded and the payout calculated', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    // $40 CPA to the publisher.
    const campaign = await createCampaign(brand.id, {
      payoutModel: 'CPA',
      payoutMicros: 40_000_000n,
    });
    await fund(brand.id, campaign.id, 500_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    const clickId = await clickThrough(link.code);

    const result = await recordConversion({
      campaignId: campaign.id,
      clickId,
      externalId: 'order-1001',
      revenueMicros: 129_990_000n, // a $129.99 order
      source: 's2s',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(result.conversion.status).toBe('PENDING');
    expect(result.conversion.creatorId).toBe(creator.id);
    expect(result.conversion.payoutMicros).toBe(40_000_000n);

    const earning = await testDb.earning.findFirstOrThrow({ where: { conversionId: result.conversion.id } });
    expect(earning.netMicros).toBe(40_000_000n); // publisher gets the advertised $40
    expect(earning.grossMicros).toBe(50_000_000n); // brand charged $50 at 20% fee
    expect(earning.feeMicros).toBe(10_000_000n);
    expect(earning.eventType).toBe('SALE');

    const balance = await balanceSummary(creator.id);
    expect(balance.pendingMicros).toBe(40_000_000n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('a duplicate conversion creates no second transaction', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id, { payoutModel: 'CPL', payoutMicros: 15_000_000n });
    await fund(brand.id, campaign.id, 500_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);
    const clickId = await clickThrough(link.code);

    const payload = {
      campaignId: campaign.id,
      clickId,
      externalId: 'lead-77',
      source: 's2s' as const,
    };

    const first = await recordConversion(payload);
    const second = await recordConversion(payload);
    const third = await recordConversion(payload);

    expect(first.ok && !first.duplicate).toBe(true);
    expect(second.ok && second.duplicate).toBe(true);
    expect(third.ok && third.duplicate).toBe(true);

    expect(await testDb.conversion.count()).toBe(1);
    expect(await testDb.earning.count()).toBe(1);

    const balance = await balanceSummary(creator.id);
    expect(balance.pendingMicros).toBe(15_000_000n); // charged exactly once
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('resists concurrent duplicate delivery of the same conversion', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id, { payoutModel: 'CPA', payoutMicros: 10_000_000n });
    await fund(brand.id, campaign.id, 500_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);
    const clickId = await clickThrough(link.code);

    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        recordConversion({
          campaignId: campaign.id,
          clickId,
          externalId: 'order-race',
          source: 'pixel',
        }),
      ),
    );

    const succeeded = settled.filter((s) => s.status === 'fulfilled' && s.value.ok);
    expect(succeeded.length).toBeGreaterThan(0);
    expect(await testDb.conversion.count()).toBe(1);
    expect(await testDb.earning.count()).toBe(1);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('refuses a conversion that cannot be attributed to a click', async () => {
    const { brand } = await createBrand();
    await createCreator();
    const campaign = await createCampaign(brand.id, { payoutModel: 'CPA' });
    await fund(brand.id, campaign.id, 100_000_000n);

    const result = await recordConversion({
      campaignId: campaign.id,
      clickId: null,
      externalId: 'orphan-1',
      source: 'api',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_ATTRIBUTION');
    expect(result.message).toMatch(/pmtr_click/);
  });

  it('refuses a conversion outside the attribution window', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id, { payoutModel: 'CPA' });
    await testDb.campaign.update({
      where: { id: campaign.id },
      data: { attributionWindowHours: 24 },
    });
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);
    const clickId = await clickThrough(link.code);

    // Age the click past the window.
    await testDb.$executeRaw`
      UPDATE "clicks" SET "createdAt" = now() - interval '48 hours' WHERE id = ${clickId}::uuid
    `;

    const result = await recordConversion({
      campaignId: campaign.id,
      clickId,
      externalId: 'late-1',
      source: 's2s',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ATTRIBUTION_EXPIRED');
  });

  it('records the conversion but owes nothing when the budget is exhausted', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id, {
      payoutModel: 'CPA',
      payoutMicros: 40_000_000n,
    });
    await fund(brand.id, campaign.id, 1_000_000n); // far too little
    const link = await createTrackingLink(campaign.id, creator.id);
    const clickId = await clickThrough(link.code);

    const result = await recordConversion({
      campaignId: campaign.id,
      clickId,
      externalId: 'unfunded-1',
      source: 's2s',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The brand still sees that a conversion happened…
    expect(result.conversion.status).toBe('REJECTED');
    expect(result.conversion.statusReason).toMatch(/budget was exhausted/i);
    // …but no earning exists and no money moved.
    expect(await testDb.earning.count()).toBe(0);
    expect((await balanceSummary(creator.id)).pendingMicros).toBe(0n);
  });

  it('pays a revenue share out of reported revenue', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id, {
      payoutModel: 'REVSHARE',
      payoutMicros: 0n,
      revshareBps: 1000, // 10% of revenue
    });
    await fund(brand.id, campaign.id, 500_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);
    const clickId = await clickThrough(link.code);

    const result = await recordConversion({
      campaignId: campaign.id,
      clickId,
      externalId: 'rev-1',
      revenueMicros: 200_000_000n, // $200 order
      source: 's2s',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const earning = await testDb.earning.findFirstOrThrow();
    // 10% of $200 = $20 gross; the platform fee comes out of that slice.
    expect(earning.grossMicros).toBe(20_000_000n);
    expect(earning.feeMicros).toBe(4_000_000n); // 20%
    expect(earning.netMicros).toBe(16_000_000n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('approving a conversion settles the brand spend and clears the publisher balance', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id, { payoutModel: 'CPA', payoutMicros: 10_000_000n });
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);
    const clickId = await clickThrough(link.code);

    const result = await recordConversion({
      campaignId: campaign.id,
      clickId,
      externalId: 'approve-1',
      source: 's2s',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await approveConversion(result.conversion.id, { reason: 'Verified by brand' });

    const earning = await testDb.earning.findFirstOrThrow();
    expect(['APPROVED', 'AVAILABLE']).toContain(earning.status);

    const snapshot = await budget.budgetSnapshot(campaign.id);
    expect(snapshot!.spentMicros).toBe(12_500_000n); // $10 net + 25% markup
    expect(snapshot!.reservedMicros).toBe(0n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('reversing a conversion unwinds every ledger entry', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id, { payoutModel: 'CPA', payoutMicros: 10_000_000n });
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);
    const clickId = await clickThrough(link.code);

    const result = await recordConversion({
      campaignId: campaign.id,
      clickId,
      externalId: 'chargeback-1',
      source: 's2s',
    });
    if (!result.ok) throw new Error('setup failed');

    await approveConversion(result.conversion.id);
    const escrowAfterApproval = await balanceOf(accounts.campaignEscrow(campaign.id));

    await reverseConversion(result.conversion.id, 'Chargeback received from card network');

    const earning = await testDb.earning.findFirstOrThrow();
    expect(earning.status).toBe('REVERSED');

    // The brand's money is back in the campaign, the platform fee is unwound,
    // and the publisher's claim is removed.
    expect(await balanceOf(accounts.campaignEscrow(campaign.id))).toBe(
      escrowAfterApproval + 12_500_000n,
    );
    expect(await balanceOf(accounts.platformRevenue())).toBe(0n);

    const balance = await balanceSummary(creator.id);
    expect(balance.pendingMicros + balance.availableMicros).toBe(0n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);

    // History is preserved: the reversal is a new transaction, not an edit.
    const transactions = await testDb.ledgerTransaction.findMany({
      where: { kind: 'EARNING_REVERSAL' },
    });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.reason).toMatch(/Chargeback/);
  });
});

describe('payout computation by compensation model', () => {
  const base = { payoutMicros: 250_000n, revshareBps: 1000, revenueMicros: 100_000_000n, quantity: 1 };

  it('CPA and CPL pay a flat amount per event', () => {
    expect(computePayout({ ...base, payoutModel: 'CPA' })).toBe(250_000n);
    expect(computePayout({ ...base, payoutModel: 'CPL', quantity: 3 })).toBe(750_000n);
  });

  it('CPM pays per thousand impressions', () => {
    expect(computePayout({ ...base, payoutModel: 'CPM', payoutMicros: 5_000_000n, quantity: 1000 })).toBe(
      5_000_000n,
    );
    // A single impression is half a cent — exact, not rounded away.
    expect(computePayout({ ...base, payoutModel: 'CPM', payoutMicros: 5_000_000n, quantity: 1 })).toBe(
      5_000n,
    );
  });

  it('REVSHARE pays a percentage of reported revenue', () => {
    expect(computePayout({ ...base, payoutModel: 'REVSHARE' })).toBe(10_000_000n);
  });

  it('HYBRID combines a flat amount with a revenue share', () => {
    expect(computePayout({ ...base, payoutModel: 'HYBRID' })).toBe(250_000n + 10_000_000n);
  });

  it('CPC adds no conversion payout — it already paid at click time', () => {
    expect(computePayout({ ...base, payoutModel: 'CPC' })).toBe(0n);
  });
});
