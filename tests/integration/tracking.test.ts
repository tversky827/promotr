import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import * as budget from '@/lib/billing/budget';
import { accounts, balanceOf, post, verifyGlobalBalance } from '@/lib/billing/ledger';
import { balanceSummary } from '@/lib/billing/earnings';
import { prisma } from '@/lib/db';
import { recordClick, resolveRedirect } from '@/lib/tracking/redirect';
import { CLICK_ID_PARAM } from '@/lib/tracking/destination';

import { disconnect, resetDatabase, testDb } from '../helpers/db';
import { createBrand, createCampaign, createCreator, createTrackingLink } from '../helpers/factories';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

/** Drive one visitor through a tracking link, end to end. */
async function click(
  code: string,
  overrides: Partial<{ ip: string; userAgent: string | null; referrer: string; country: string; query: string }> = {},
) {
  const request = {
    code,
    ip: overrides.ip ?? '203.0.113.45',
    userAgent: overrides.userAgent === undefined ? CHROME : overrides.userAgent,
    referrer: overrides.referrer ?? 'https://www.tiktok.com/@creator/video/1',
    country: overrides.country ?? 'US',
    region: 'CA',
    city: 'San Francisco',
    query: new URLSearchParams(overrides.query ?? ''),
  };
  const { outcome, link, clickId } = await resolveRedirect(request);
  if (link && outcome.kind === 'redirect') {
    await recordClick({ clickId, link, request, latencyMs: 5 });
  }
  return { outcome, clickId };
}

describe('tracking', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnect();
    await prisma.$disconnect();
  });

  it('REQUIRED TEST 3 — a click redirects and is recorded', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    const { outcome, clickId } = await click(link.code);

    expect(outcome.kind).toBe('redirect');
    const url = new URL((outcome as { url: string }).url);
    expect(url.origin + url.pathname).toBe('https://brand.example.com/landing');
    // The click id is passed through so the brand can report a conversion back.
    expect(url.searchParams.get(CLICK_ID_PARAM)).toBe(clickId);

    const recorded = await testDb.click.findFirst({ where: { id: clickId } });
    expect(recorded).not.toBeNull();
    expect(recorded!.campaignId).toBe(campaign.id);
    expect(recorded!.creatorId).toBe(creator.id);
    expect(recorded!.country).toBe('US');
    expect(recorded!.browser).toBe('Chrome');
    expect(recorded!.deviceType).toBe('desktop');
    expect(recorded!.referrerHost).toBe('tiktok.com');
  });

  it('never stores a raw IP address', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    const { clickId } = await click(link.code, { ip: '198.51.100.22' });
    const recorded = await testDb.click.findFirstOrThrow({ where: { id: clickId } });

    expect(recorded.ipHash).not.toContain('198.51.100.22');
    expect(recorded.ipPrefixHash).not.toContain('198.51.100');
    expect(JSON.stringify(recorded)).not.toContain('198.51.100.22');
  });

  it('REQUIRED TEST 4 — a qualified click generates a publisher earning', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    // $0.20 to the publisher, 20% platform default fee.
    const campaign = await createCampaign(brand.id, { payoutMicros: 200_000n });
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    await click(link.code);

    const earning = await testDb.earning.findFirstOrThrow({ where: { creatorId: creator.id } });
    expect(earning.netMicros).toBe(200_000n); // exactly what the campaign advertised
    expect(earning.grossMicros).toBe(250_000n); // brand charged $0.25
    expect(earning.feeMicros).toBe(50_000n); // platform keeps $0.05
    expect(earning.status).toBe('PENDING');
    expect(earning.eventType).toBe('CLICK');

    const balance = await balanceSummary(creator.id);
    expect(balance.pendingMicros).toBe(200_000n);
    expect(balance.availableMicros).toBe(0n);

    expect(await balanceOf(accounts.platformRevenue())).toBe(50_000n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('does not bill twice for the same visitor inside the dedupe window', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    await click(link.code);
    const second = await click(link.code); // same IP, same UA → same fingerprint

    const clicks = await testDb.click.findMany({ orderBy: { createdAt: 'asc' } });
    expect(clicks).toHaveLength(2);
    // Both visits are recorded — the brand should see the traffic…
    expect(clicks[1]!.eligibility).toBe('DUPLICATE');
    // …but only one is paid for.
    expect(clicks[1]!.billable).toBe(false);
    expect(await testDb.earning.count()).toBe(1);
    // The visitor is still redirected; de-duplication is a billing decision.
    expect(second.outcome.kind).toBe('redirect');
  });

  it('REQUIRED TEST 7 — automated traffic is flagged and not paid', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    const { clickId, outcome } = await click(link.code, { userAgent: 'python-requests/2.31.0' });

    // The bot is still redirected — we do not reveal that it was detected.
    expect(outcome.kind).toBe('redirect');

    const recorded = await testDb.click.findFirstOrThrow({ where: { id: clickId } });
    expect(recorded.isBot).toBe(true);
    expect(recorded.eligibility).toBe('REJECTED');
    expect(recorded.billable).toBe(false);
    expect(recorded.fraudScore).toBeGreaterThanOrEqual(76);
    expect(recorded.fraudSignals).toContain('AUTOMATION_UA');

    // No money moved.
    expect(await testDb.earning.count()).toBe(0);
    const balance = await balanceSummary(creator.id);
    expect(balance.pendingMicros).toBe(0n);

    // The decision is explained in the fraud console.
    const fraudEvent = await testDb.fraudEvent.findFirst({ where: { clickId } });
    expect(fraudEvent).not.toBeNull();
    expect(fraudEvent!.band).toBe('HIGH');
    const signals = fraudEvent!.signals as Array<{ code: string; explanation: string }>;
    expect(signals[0]!.explanation).toMatch(/scripted automation/i);
  });

  it('records declared crawlers without penalising the publisher', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    const { clickId } = await click(link.code, {
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    });

    const recorded = await testDb.click.findFirstOrThrow({ where: { id: clickId } });
    expect(recorded.isBot).toBe(true);
    expect(recorded.billable).toBe(false);
    // Crawlers are not fraud, so no fraud event is raised against the publisher.
    expect(await testDb.fraudEvent.count({ where: { clickId } })).toBe(0);
  });

  it('blocks traffic from countries the campaign does not target', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id, { allowedCountries: ['US', 'CA'] });
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    const { clickId } = await click(link.code, { country: 'FR', ip: '203.0.113.99' });

    const recorded = await testDb.click.findFirstOrThrow({ where: { id: clickId } });
    expect(recorded.eligibility).toBe('GEO_BLOCKED');
    expect(recorded.billable).toBe(false);
    // A targeting miss is not fraud and must not appear in the fraud console.
    expect(await testDb.fraudEvent.count({ where: { clickId } })).toBe(0);
  });

  it('REQUIRED TEST 6 — an exhausted budget stops billable activity', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id, { payoutMicros: 200_000n });
    // Exactly one click's worth of gross ($0.25).
    await fund(brand.id, campaign.id, 250_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    await click(link.code, { ip: '203.0.113.1' });
    await click(link.code, { ip: '203.0.113.2' });
    const third = await click(link.code, { ip: '203.0.113.3' });

    expect(await testDb.earning.count()).toBe(1);

    const clicks = await testDb.click.findMany({ orderBy: { createdAt: 'asc' } });
    expect(clicks[0]!.billable).toBe(true);
    expect(clicks[1]!.eligibility).toBe('BUDGET_EXHAUSTED');
    expect(clicks[2]!.eligibility).toBe('BUDGET_EXHAUSTED');

    // Visitors are still delivered to the advertiser — the brand simply is not
    // charged for them.
    expect(third.outcome.kind).toBe('redirect');

    const snapshot = await budget.budgetSnapshot(campaign.id);
    expect(snapshot!.availableMicros).toBe(0n);
    expect(snapshot!.reservedMicros).toBeLessThanOrEqual(snapshot!.fundedMicros);
  });

  it('REQUIRED TEST 12 — a suspended publisher cannot generate billable traffic', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    await testDb.creator.update({
      where: { id: creator.id },
      data: { verification: 'SUSPENDED', suspendedReason: 'Invalid traffic' },
    });

    const { clickId, outcome } = await click(link.code);

    expect(outcome.kind).toBe('redirect');
    const recorded = await testDb.click.findFirstOrThrow({ where: { id: clickId } });
    expect(recorded.eligibility).toBe('SUSPENDED_PUBLISHER');
    expect(recorded.billable).toBe(false);
    expect(await testDb.earning.count()).toBe(0);
  });

  it('stops sending traffic when a campaign is paused', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    await testDb.campaign.update({ where: { id: campaign.id }, data: { status: 'PAUSED' } });

    const { outcome } = await click(link.code);
    expect(outcome.kind).toBe('inactive');
  });

  it('returns not_found for an unknown code without leaking whether it existed', async () => {
    const { outcome } = await click('ZZZZZZZZZZ');
    expect(outcome.kind).toBe('not_found');
  });

  it('forwards the publisher sub-id and UTM parameters to the destination', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await testDb.trackingLink.update({
      where: { id: (await createTrackingLink(campaign.id, creator.id)).id },
      data: { subId: 'video-42', utmSource: 'tiktok', utmCampaign: 'spring' },
    });

    const { outcome, clickId } = await click(link.code);
    const url = new URL((outcome as { url: string }).url);

    expect(url.searchParams.get('subid')).toBe('video-42');
    expect(url.searchParams.get('utm_source')).toBe('tiktok');
    expect(url.searchParams.get('utm_campaign')).toBe('spring');

    const recorded = await testDb.click.findFirstOrThrow({ where: { id: clickId } });
    expect(recorded.subId).toBe('video-42');
    expect(recorded.utmSource).toBe('tiktok');
  });

  it('forwards nothing that identifies the visitor to the advertiser', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await fund(brand.id, campaign.id, 100_000_000n);
    const link = await createTrackingLink(campaign.id, creator.id);

    const { outcome } = await click(link.code, { ip: '198.51.100.77' });
    const url = (outcome as { url: string }).url;

    expect(url).not.toContain('198.51.100.77');
    expect(url).not.toContain(creator.id);
    expect(url).not.toContain(campaign.id);
    // Only the opaque click id, sub-id and UTMs cross the boundary.
    const params = [...new URL(url).searchParams.keys()].sort();
    expect(params).toEqual([CLICK_ID_PARAM]);
  });
});
