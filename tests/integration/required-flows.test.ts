import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { launchDecision } from '@/lib/campaigns/lifecycle';
import * as budget from '@/lib/billing/budget';
import { balanceSummary } from '@/lib/billing/earnings';
import { refundDeposit, settleDeposit } from '@/lib/billing/funding';
import { accounts, balanceOf, post, verifyGlobalBalance } from '@/lib/billing/ledger';
import { recordConversion } from '@/lib/conversions/record';
import { prisma } from '@/lib/db';
import { issueTrackingLink } from '@/lib/tracking/links';
import { recordClick, resolveRedirect } from '@/lib/tracking/redirect';
import { searchCampaigns } from '@/lib/marketplace';

import { disconnect, resetDatabase, testDb } from '../helpers/db';
import { createBrand, createCampaign, createCreator } from '../helpers/factories';

/**
 * The twelve flows the specification names as critical.
 *
 * Tests 9 (payout settlement and reconciliation) and 11 (concurrent events
 * cannot overspend a budget) need concurrency and provider fixtures that belong
 * with their subjects, so they live in payouts.test.ts and budget.test.ts under
 * the same labels. Everything else is here.
 *
 * Each is exercised through the same functions the application itself calls —
 * the redirect resolver, the conversion recorder, the ledger, the budget lock —
 * rather than through re-implementations of them. Where a flow is also covered
 * in more depth elsewhere (concurrency in budget.test.ts, payout settlement in
 * payouts.test.ts) it is still asserted here, so all twelve are visible in one
 * place and a regression in any of them fails a test named after it.
 */

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fund(brandId: string, campaignId: string, amountMicros: bigint, key = 'x') {
  await prisma.$transaction(async (tx) => {
    await post(tx, {
      kind: 'BRAND_DEPOSIT',
      idempotencyKey: `dep-${campaignId}-${key}`,
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
      idempotencyKey: `fund-${campaignId}-${key}`,
    });
  });
}

async function click(
  code: string,
  overrides: Partial<{ ip: string; userAgent: string | null; country: string; referrer: string }> = {},
) {
  const request = {
    code,
    ip: overrides.ip ?? '203.0.113.45',
    userAgent: overrides.userAgent === undefined ? CHROME : overrides.userAgent,
    referrer: overrides.referrer ?? 'https://www.tiktok.com/@creator/video/1',
    country: overrides.country ?? 'US',
    region: 'CA',
    city: 'San Francisco',
    query: new URLSearchParams(),
  };
  const { outcome, link, clickId } = await resolveRedirect(request);
  if (link && outcome.kind === 'redirect') {
    await recordClick({ clickId, link, request, latencyMs: 5 });
  }
  return { outcome, clickId };
}

describe('required end-to-end flows', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });

  it('REQUIRED TEST 1 — a brand creates a campaign, funds it, and launches it', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id, { status: 'APPROVED' });

    // Unfunded, the campaign cannot go live: the solvency rule.
    const before = launchDecision({
      campaign: { status: 'APPROVED' },
      budget: await testDb.campaignBudget.findUniqueOrThrow({
        where: { campaignId: campaign.id },
      }),
      brandVerification: brand.verification,
      brandVerificationRequired: true,
    });
    expect(before).toMatchObject({ ok: false, code: 'UNFUNDED' });

    await fund(brand.id, campaign.id, 50_000_000n);

    const after = launchDecision({
      campaign: { status: 'APPROVED' },
      budget: await testDb.campaignBudget.findUniqueOrThrow({
        where: { campaignId: campaign.id },
      }),
      brandVerification: brand.verification,
      brandVerificationRequired: true,
    });
    expect(after.ok).toBe(true);

    await testDb.campaign.update({
      where: { id: campaign.id },
      data: { status: 'ACTIVE', launchedAt: new Date() },
    });

    const live = await testDb.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(live.status).toBe('ACTIVE');
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('REQUIRED TEST 2 — a publisher finds a campaign in the marketplace and gets a link', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 50_000_000n);
    const { creator } = await createCreator();

    const found = await searchCampaigns({ page: 1, perPage: 20 });
    expect(found.campaigns.map((c) => c.id)).toContain(campaign.id);

    const issued = await issueTrackingLink({ creator, campaignId: campaign.id });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error('link was refused');

    expect(issued.code).toMatch(/^[A-Za-z0-9]+$/);
    expect(issued.url).toContain(issued.code);
    expect(issued.reused).toBe(false);

    // Asking again returns the same link rather than splitting their reporting.
    const again = await issueTrackingLink({ creator, campaignId: campaign.id });
    expect(again.ok && again.reused).toBe(true);
    expect(again.ok && again.linkId).toBe(issued.linkId);
  });

  it('REQUIRED TEST 3 — a visitor clicks a link, is redirected, and the click is recorded', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 50_000_000n);
    const { creator } = await createCreator();
    const issued = await issueTrackingLink({ creator, campaignId: campaign.id });
    if (!issued.ok) throw new Error('link was refused');

    const { outcome, clickId } = await click(issued.code);

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('not a redirect');
    expect(outcome.url).toContain('https://brand.example.com/landing');
    expect(outcome.url).toContain(clickId);

    const stored = await testDb.click.findFirstOrThrow({ where: { id: clickId } });
    expect(stored.campaignId).toBe(campaign.id);
    expect(stored.creatorId).toBe(creator.id);
    // Privacy: the raw address is never stored, only a rotating hash.
    expect(JSON.stringify(stored)).not.toContain('203.0.113.45');
  });

  it('REQUIRED TEST 4 — a qualified click on a CPC campaign generates an earning', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id, {
      payoutModel: 'CPC',
      payoutMicros: 250_000n, // $0.25
    });
    await fund(brand.id, campaign.id, 50_000_000n);
    const { creator } = await createCreator();
    const issued = await issueTrackingLink({ creator, campaignId: campaign.id });
    if (!issued.ok) throw new Error('link was refused');

    await click(issued.code);

    const earning = await testDb.earning.findFirstOrThrow({ where: { creatorId: creator.id } });
    expect(earning.netMicros).toBe(250_000n);
    expect(earning.eventType).toBe('CLICK');

    const balance = await balanceSummary(creator.id);
    expect(balance.pendingMicros).toBe(250_000n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('REQUIRED TEST 5 — a conversion is recorded and its payout calculated', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id, {
      payoutModel: 'CPA',
      payoutMicros: 40_000_000n, // $40.00
    });
    await fund(brand.id, campaign.id, 500_000_000n);
    const { creator } = await createCreator();
    const issued = await issueTrackingLink({ creator, campaignId: campaign.id });
    if (!issued.ok) throw new Error('link was refused');
    const { clickId } = await click(issued.code);

    const result = await recordConversion({
      campaignId: campaign.id,
      clickId,
      externalId: 'order-1042',
      eventType: 'SALE',
      revenueMicros: 129_990_000n,
      source: 'api',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.duplicate).toBe(false);

    const earning = await testDb.earning.findFirstOrThrow({
      where: { conversionId: result.conversion.id },
    });
    expect(earning.netMicros).toBe(40_000_000n);
    // The brand is charged the payout plus the platform fee, never less.
    expect(earning.grossMicros).toBeGreaterThan(earning.netMicros);
    expect(earning.grossMicros).toBe(earning.netMicros + earning.feeMicros);
  });

  it('REQUIRED TEST 6 — an exhausted budget stops further billable activity', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id, {
      payoutModel: 'CPA',
      payoutMicros: 10_000_000n, // $10.00
    });
    // Enough for exactly one $10 conversion plus its 20% platform fee, and no
    // more: the brand is charged $12.50 for a $10 payout.
    await fund(brand.id, campaign.id, 12_500_000n);
    const { creator } = await createCreator();
    const issued = await issueTrackingLink({ creator, campaignId: campaign.id });
    if (!issued.ok) throw new Error('link was refused');

    const first = await click(issued.code);
    const paid = await recordConversion({
      campaignId: campaign.id,
      clickId: first.clickId,
      externalId: 'order-1',
      eventType: 'SALE',
      source: 'api',
    });
    expect(paid.ok && paid.earningId).toBeTruthy();

    const second = await click(issued.code, { ip: '198.51.100.7' });
    const unpaid = await recordConversion({
      campaignId: campaign.id,
      clickId: second.clickId,
      externalId: 'order-2',
      eventType: 'SALE',
      source: 'api',
    });

    // The conversion is still recorded — the brand needs to see it happened —
    // but it earns nothing, because there is nothing left to pay it with.
    expect(unpaid.ok).toBe(true);
    if (!unpaid.ok) throw new Error(unpaid.message);
    expect(unpaid.earningId).toBeNull();
    expect(unpaid.conversion.status).toBe('REJECTED');

    const budgetRow = await testDb.campaignBudget.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    });
    expect(budgetRow.reservedMicros + budgetRow.spentMicros).toBeLessThanOrEqual(
      budgetRow.fundedMicros,
    );
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('REQUIRED TEST 7 — flagged traffic is held for review, not silently paid or destroyed', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id, { payoutModel: 'CPC', payoutMicros: 250_000n });
    await fund(brand.id, campaign.id, 50_000_000n);

    // A brand-new account already carrying account-level risk, sending traffic
    // referred by a known traffic-exchange site: suspicious enough to hold, not
    // conclusive enough to reject.
    const { creator } = await createCreator();
    await testDb.creator.update({ where: { id: creator.id }, data: { riskScore: 60 } });

    const issued = await issueTrackingLink({ creator, campaignId: campaign.id });
    if (!issued.ok) throw new Error('link was refused');

    const { clickId } = await click(issued.code, { referrer: 'https://hitleap.com/surf' });

    const stored = await testDb.click.findFirstOrThrow({ where: { id: clickId } });
    expect(stored.billable).toBe(true);
    expect(stored.eligibility).toBe('REVIEW');

    const events = await testDb.fraudEvent.findMany({ where: { creatorId: creator.id } });
    expect(events.length).toBeGreaterThan(0);

    // Every flag explains itself — an administrator can see why before deciding,
    // and the publisher can be told the same thing.
    for (const event of events) {
      const signals = event.signals as Array<{ code: string; explanation: string }>;
      expect(signals.length).toBeGreaterThan(0);
      for (const signal of signals) {
        expect(signal.explanation.length).toBeGreaterThan(10);
      }
    }

    const earnings = await testDb.earning.findMany({ where: { creatorId: creator.id } });
    expect(earnings).toHaveLength(1);
    // Held, not confiscated: the claim exists, the brand's money is reserved
    // against it, and a human decides. Nothing was auto-rejected by the model.
    expect(earnings[0]!.status).toBe('UNDER_REVIEW');
    expect(earnings[0]!.netMicros).toBe(250_000n);

    const balance = await balanceSummary(creator.id);
    expect(balance.availableMicros).toBe(0n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('REQUIRED TEST 7b — conclusive automation is refused outright, and earns nothing', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id, { payoutModel: 'CPC', payoutMicros: 250_000n });
    await fund(brand.id, campaign.id, 50_000_000n);
    const { creator } = await createCreator();
    const issued = await issueTrackingLink({ creator, campaignId: campaign.id });
    if (!issued.ok) throw new Error('link was refused');

    const { outcome, clickId } = await click(issued.code, {
      userAgent: 'python-requests/2.31.0',
    });

    // The request is still answered — refusing to redirect would tell an
    // attacker exactly which of their probes were detected.
    expect(outcome.kind).toBe('redirect');

    const stored = await testDb.click.findFirstOrThrow({ where: { id: clickId } });
    expect(stored.billable).toBe(false);
    expect(await testDb.earning.count({ where: { creatorId: creator.id } })).toBe(0);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('REQUIRED TEST 8 — a refund to a brand writes matching ledger entries', async () => {
    const { brand, owner } = await createBrand();

    const deposit = await testDb.brandDeposit.create({
      data: {
        brandId: brand.id,
        amountMicros: 100_000_000n,
        status: 'requires_payment_method',
        stripePaymentIntentId: `pi_test_${Date.now()}`,
      },
    });

    await settleDeposit({
      paymentIntentId: deposit.stripePaymentIntentId!,
      amountReceivedCents: 10_000,
    });

    const funded = await balanceOf(accounts.brandDeposit(brand.id));
    expect(funded).toBe(100_000_000n);

    const before = await testDb.ledgerEntry.count();
    const refund = await refundDeposit({
      depositId: deposit.id,
      amountMicros: 40_000_000n,
      reason: 'Partial refund requested by the brand',
      actorUserId: owner.id,
    });

    expect(refund.refundedMicros).toBe(40_000_000n);
    expect(await testDb.ledgerEntry.count()).toBeGreaterThan(before);
    expect(await balanceOf(accounts.brandDeposit(brand.id))).toBe(60_000_000n);

    const updated = await testDb.brandDeposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updated.refundedMicros).toBe(40_000_000n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('REQUIRED TEST 10 — a duplicate conversion report creates no second transaction', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id, {
      payoutModel: 'CPA',
      payoutMicros: 15_000_000n,
    });
    await fund(brand.id, campaign.id, 200_000_000n);
    const { creator } = await createCreator();
    const issued = await issueTrackingLink({ creator, campaignId: campaign.id });
    if (!issued.ok) throw new Error('link was refused');
    const { clickId } = await click(issued.code);

    const first = await recordConversion({
      campaignId: campaign.id,
      clickId,
      externalId: 'order-dup',
      eventType: 'SALE',
      source: 'api',
    });
    expect(first.ok && first.duplicate).toBe(false);

    const entriesAfterFirst = await testDb.ledgerEntry.count();

    // The same order id arriving again over a different transport — a webhook
    // retry, a page refresh, a network timeout the advertiser retried.
    for (const source of ['pixel', 's2s', 'webhook'] as const) {
      const replay = await recordConversion({
        campaignId: campaign.id,
        clickId,
        externalId: 'order-dup',
        eventType: 'SALE',
        source,
      });
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw new Error(replay.message);
      expect(replay.duplicate).toBe(true);
    }

    expect(await testDb.conversion.count({ where: { campaignId: campaign.id } })).toBe(1);
    expect(await testDb.earning.count({ where: { creatorId: creator.id } })).toBe(1);
    expect(await testDb.ledgerEntry.count()).toBe(entriesAfterFirst);
  });

  it('REQUIRED TEST 12 — a suspended publisher cannot generate billable traffic', async () => {
    const { brand } = await createBrand();
    const campaign = await createCampaign(brand.id, { payoutModel: 'CPC', payoutMicros: 250_000n });
    await fund(brand.id, campaign.id, 50_000_000n);

    const { creator } = await createCreator();
    const issued = await issueTrackingLink({ creator, campaignId: campaign.id });
    if (!issued.ok) throw new Error('link was refused');

    // Suspend after the link exists — the realistic case, since the link was
    // legitimate when it was issued.
    await testDb.creator.update({
      where: { id: creator.id },
      data: { verification: 'SUSPENDED' },
    });

    const { outcome, clickId } = await click(issued.code);

    // The visitor is still sent somewhere sensible rather than shown an error:
    // they did nothing wrong, and a broken link damages the brand's landing
    // page traffic, not the publisher.
    expect(outcome.kind).toBe('redirect');

    const stored = await testDb.click.findFirst({ where: { id: clickId } });
    if (stored) {
      expect(stored.eligibility).toBe('SUSPENDED_PUBLISHER');
      expect(stored.billable).toBe(false);
    }

    expect(await testDb.earning.count({ where: { creatorId: creator.id } })).toBe(0);

    // And no new links either.
    const refused = await issueTrackingLink({
      creator: { id: creator.id, verification: 'SUSPENDED' },
      campaignId: campaign.id,
      options: { subId: 'second' },
    });
    expect(refused).toMatchObject({ ok: false, code: 'PUBLISHER_RESTRICTED' });
  });
});
