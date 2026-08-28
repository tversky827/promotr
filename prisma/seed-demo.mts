/**
 * Audicents demo data.
 *
 *   npm run db:seed:demo
 *
 * Loads the walkthrough: nine fictional brands, fourteen live campaigns, one
 * demo publisher and one demo brand account that the role switcher signs into,
 * and roughly three months of history behind them.
 *
 * Two things make this more than a set of numbers on a screen. First, the demo
 * publisher's history is written through the real accrual path — every dollar
 * on their dashboard exists because an earning was posted to the double-entry
 * ledger against a funded campaign budget, so the balances, the payout
 * eligibility checks and the withdrawal flow all work on it for the same reason
 * they would work on a real account. Second, the figures reconcile: the
 * per-campaign rows sum to the dashboard totals, and this script asserts that
 * before it writes anything.
 *
 * The wider marketplace history — 2,480 other publishers behind the brand's
 * aggregate numbers — is written in bulk SQL rather than event by event, with
 * ledger transactions posted per campaign instead of per publisher. The books
 * still balance and every figure is still derived from rows that exist; it just
 * takes seconds instead of an hour.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import type { Campaign, ChannelType, PayoutModel } from '@prisma/client';

import {
  DEMO_BRANDS,
  DEMO_BRAND_PERFORMANCE,
  DEMO_BRAND_TARGETS,
  DEMO_CAMPAIGNS,
  DEMO_CREATOR_TARGETS,
  DEMO_FEE_BPS,
  DEMO_PERFORMANCE,
  type DemoCampaignFixture,
} from './demo-fixtures.mts';

const prisma = new PrismaClient();

const DEMO_DOMAIN = 'demo.audicents.test';
const DEMO_PASSWORD = 'AudicentsDemo123!';
const DEMO_CREATOR_EMAIL = `creator@${DEMO_DOMAIN}`;
const DEMO_BRAND_EMAIL = `brand@${DEMO_DOMAIN}`;
const DEMO_CREATOR_NAME = 'Jordan Vale';
const DEMO_CREATOR_HANDLE = 'jordan';
const DEMO_BRAND_KEY = 'northline';

/** History spans this many days, so charts have something to show. */
const HISTORY_DAYS = 90;

const MICROS = 1_000_000n;

async function main(): Promise<void> {
  console.log('\nAudicents demo data\n');

  checkFixtures();
  await assertSafeToSeed();

  await prisma.$executeRaw`SELECT ensure_time_partitions('clicks', 4, 2)`;
  await prisma.$executeRaw`SELECT ensure_time_partitions('impressions', 4, 2)`;

  await setDemoSettings();
  const brands = await seedBrands();
  const campaigns = await seedCampaigns(brands);
  await fundCampaigns(campaigns);

  const creator = await seedDemoCreator();
  await seedDemoCreatorHistory(creator, campaigns);

  await seedMarketplaceHistory(campaigns);

  await buildRollups();
  await report();

  console.log('\nDone. Sign-in is not needed — turn on DEMO_MODE and use the switcher.');
  console.log(`  Publisher  ${DEMO_CREATOR_EMAIL}`);
  console.log(`  Brand      ${DEMO_BRAND_EMAIL}`);
  console.log(`  Password   ${DEMO_PASSWORD}\n`);
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * The fixtures are hand-chosen numbers, and hand-chosen numbers drift. Every
 * total the interface will display is recomputed here from the per-campaign
 * rows and compared against what the fixtures claim, so a mistyped figure
 * fails loudly at the start rather than showing up as a dashboard that does not
 * add up.
 */
function checkFixtures(): void {
  const campaignByKey = new Map(DEMO_CAMPAIGNS.map((c) => [c.key, c]));
  const problems: string[] = [];

  let clicks = 0;
  let conversions = 0;
  let lifetime = 0n;
  let pending = 0n;

  for (const row of DEMO_PERFORMANCE) {
    const campaign = campaignByKey.get(row.campaign);
    if (!campaign) {
      problems.push(`Unknown campaign "${row.campaign}" in the publisher history`);
      continue;
    }
    clicks += row.clicks;
    conversions += row.conversions;
    lifetime += netFor(campaign, row.billable, dollars(row.revenue));
    pending += netFor(campaign, row.pendingBillable, 0n);
    if (row.pendingBillable > row.billable) {
      problems.push(`${row.campaign}: more events on hold than were earned`);
    }
    if (campaign.model !== 'CPC' && row.billable !== row.conversions) {
      problems.push(
        `${row.campaign}: pays per conversion, so billable events and conversions must match`,
      );
    }
  }

  expect(problems, 'publisher campaigns', DEMO_PERFORMANCE.length, DEMO_CREATOR_TARGETS.campaigns);
  expect(problems, 'publisher clicks', clicks, DEMO_CREATOR_TARGETS.clicks);
  expect(problems, 'publisher conversions', conversions, DEMO_CREATOR_TARGETS.conversions);
  expect(problems, 'publisher lifetime earnings', lifetime, dollars(DEMO_CREATOR_TARGETS.lifetimeEarnings));
  expect(problems, 'publisher pending', pending, dollars(DEMO_CREATOR_TARGETS.pending));
  expect(problems, 'publisher available', lifetime - pending, dollars(DEMO_CREATOR_TARGETS.available));

  const rate = Math.round((conversions / clicks) * 1000) / 10;
  expect(problems, 'publisher conversion rate', rate, DEMO_CREATOR_TARGETS.conversionRate);

  let brandClicks = 0;
  let brandSpend = 0n;
  let brandRevenue = 0n;

  for (const row of DEMO_BRAND_PERFORMANCE) {
    const campaign = campaignByKey.get(row.campaign);
    if (!campaign) {
      problems.push(`Unknown campaign "${row.campaign}" in the brand history`);
      continue;
    }
    if (campaign.brand !== DEMO_BRAND_KEY) {
      problems.push(`${row.campaign} is not one of the demo brand's campaigns`);
    }
    brandClicks += row.clicks;
    brandSpend += grossFor(campaign, row.billable, dollars(row.revenue));
    brandRevenue += dollars(row.revenue);

    const mine = DEMO_PERFORMANCE.find((p) => p.campaign === row.campaign);
    if (mine && (mine.clicks > row.clicks || mine.billable > row.billable)) {
      problems.push(`${row.campaign}: the demo publisher alone exceeds the campaign total`);
    }
  }

  expect(problems, 'brand campaigns', DEMO_BRAND_PERFORMANCE.length, DEMO_BRAND_TARGETS.activeCampaigns);
  expect(problems, 'brand clicks', brandClicks, DEMO_BRAND_TARGETS.clicks);
  expect(problems, 'brand spend', brandSpend, dollars(DEMO_BRAND_TARGETS.spend));
  expect(problems, 'brand revenue', brandRevenue, dollars(DEMO_BRAND_TARGETS.revenue));

  const widest = Math.max(...DEMO_BRAND_PERFORMANCE.map((r) => r.creators));
  if (widest > DEMO_BRAND_TARGETS.creators) {
    problems.push('A campaign claims more publishers than the brand has in total');
  }

  if (problems.length > 0) {
    console.error('The demo fixtures do not reconcile:\n');
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error('\nFix prisma/demo-fixtures.mts and run again. Nothing was written.\n');
    process.exit(1);
  }

  console.log('  Fixtures reconcile');
}

function expect(
  problems: string[],
  label: string,
  actual: number | bigint,
  target: number | bigint,
): void {
  if (actual !== target) {
    problems.push(`${label}: rows give ${format(actual)}, targets claim ${format(target)}`);
  }
}

function format(value: number | bigint): string {
  return typeof value === 'bigint' ? `${Number(value) / 1_000_000}` : String(value);
}

/**
 * Demo data is not additive: it assumes it owns the campaigns and publishers it
 * creates. Rather than try to merge into whatever is already there — and rather
 * than delete ledger history, which is append-only by design — this refuses and
 * points at the reset.
 */
async function assertSafeToSeed(): Promise<void> {
  const existing = await prisma.user.count({ where: { isDemo: true } });
  if (existing > 0) {
    console.error(
      `\nThis database already holds ${existing} demo account(s).\n\n` +
        'Demo history includes ledger entries, which are append-only and cannot be\n' +
        'removed. To load it again, reset the database first:\n\n' +
        '  npm run db:reset && npm run db:seed:demo\n',
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL ?? '';
  const local = /(@|\/\/)(localhost|127\.0\.0\.1|\[::1\]|db|postgres)([:/])/.test(url);
  if (!local && process.env.ALLOW_REMOTE_DEMO_SEED !== 'yes') {
    console.error(
      '\nDATABASE_URL does not look local. Loading demo data into a shared database\n' +
        'would put sample campaigns in front of real users.\n\n' +
        'If that is genuinely what you want, set ALLOW_REMOTE_DEMO_SEED=yes.\n',
    );
    process.exit(1);
  }
}

/**
 * The hold period the demo data is written against.
 *
 * Earnings that have not cleared are spread across the recent weeks, which only
 * reads correctly if the hold is long enough to explain them. Forty-five days
 * also matches the return windows the demo campaigns state in their own terms —
 * a network cannot release a payout before the order it was paid for can still
 * be sent back.
 */
async function setDemoSettings(): Promise<void> {
  const { updateSetting } = await import('../src/lib/settings');
  await updateSetting('earningHoldDays', 45);

  // The demo publisher's balance is above the default threshold at which a
  // withdrawal waits for a human, and a walkthrough has no human to wait for.
  // Raising it is a settings change, not a special case in the payout code:
  // the same eligibility checks and the same postings run either way.
  await updateSetting('payoutAutoApproveUnderMicros', '2500000000');

  // Campaigns that clear every automated check go live without waiting for an
  // administrator. Anything that raises a flag still goes to review — the
  // moderation rules are untouched; this only decides what happens to a clean
  // result, and a walkthrough has no administrator to wait for.
  await updateSetting('campaignAutoApproveEnabled', true);
}

// ---------------------------------------------------------------------------
// Brands and campaigns
// ---------------------------------------------------------------------------

async function seedBrands() {
  const byKey = new Map<string, { id: string; ownerUserId: string }>();

  for (const fixture of DEMO_BRANDS) {
    const isDemoBrandAccount = fixture.key === DEMO_BRAND_KEY;
    const email = isDemoBrandAccount ? DEMO_BRAND_EMAIL : `${fixture.key}@${DEMO_DOMAIN}`;

    const owner = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        role: 'BRAND_OWNER',
        name: isDemoBrandAccount ? 'Riley Ashford' : `${fixture.name} Marketing`,
        emailVerifiedAt: daysAgo(HISTORY_DAYS + 30),
        isDemo: true,
        // Backdated with the history it is about to be given. An account whose
        // row was created a minute ago is flagged as a new advertiser by
        // moderation, which would be the right call about a real account and
        // the wrong one about this data.
        createdAt: daysAgo(HISTORY_DAYS + 30),
      },
    });

    const brand = await prisma.brand.create({
      data: {
        isDemo: true,
        slug: fixture.key,
        legalName: fixture.legalName,
        displayName: fixture.name,
        website: fixture.website,
        category: fixture.category,
        country: 'US',
        contactEmail: email,
        description: fixture.about,
        // Drawn rather than fetched: a data URI keeps the demo free of any
        // third-party image, and of any request leaving the page.
        logoUrl: monogramLogo(fixture.monogram, fixture.hsl),
        verification: 'VERIFIED',
        verifiedAt: daysAgo(HISTORY_DAYS + 30),
        createdAt: daysAgo(HISTORY_DAYS + 30),
        members: { create: { userId: owner.id, role: 'BRAND_OWNER' } },
      },
    });

    byKey.set(fixture.key, { id: brand.id, ownerUserId: owner.id });
  }

  console.log(`  ${byKey.size} brands`);
  return byKey;
}

/** An inline SVG tile carrying the brand's initials. No external assets. */
function monogramLogo(monogram: string, hsl: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="hsl(${hsl})"/>` +
    `<text x="32" y="41" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" ` +
    `font-size="24" font-weight="700" letter-spacing="-0.5" fill="#F6F1E6" text-anchor="middle">` +
    `${monogram}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

async function seedCampaigns(brands: Map<string, { id: string }>) {
  const byKey = new Map<string, Campaign>();

  for (const fixture of DEMO_CAMPAIGNS) {
    const brand = brands.get(fixture.brand);
    if (!brand) throw new Error(`Campaign ${fixture.key} references unknown brand ${fixture.brand}`);

    const campaign = await prisma.campaign.create({
      data: {
        brandId: brand.id,
        slug: fixture.key,
        name: fixture.name,
        objective: fixture.objective,
        category: DEMO_BRANDS.find((b) => b.key === fixture.brand)?.category ?? 'other',
        description: fixture.description,
        offerSummary: fixture.offer,
        destinationUrl: `${DEMO_BRANDS.find((b) => b.key === fixture.brand)?.website}/offer`,
        status: 'ACTIVE',
        payoutModel: fixture.model as PayoutModel,
        payoutMicros: dollars(fixture.payout),
        revshareBps: fixture.revshareBps ?? 0,
        attributionWindowHours: 720,
        cookieDurationHours: 720,
        dedupeWindowMinutes: 1440,
        allowedCountries: fixture.countries,
        allowedChannels: fixture.channels as ChannelType[],
        prohibitedChannels: ['PAID_SEARCH', 'SMS'] as ChannelType[],
        conversionRules: fixture.conversionRules,
        disclosureRequirement:
          'Posts must carry a clear and visible disclosure of the paid relationship.',
        termsBody:
          `${fixture.name} campaign terms.\n\n` +
          `You earn on qualified activity only, as described under "What counts". ` +
          `${fixture.conversionRules}\n\n` +
          `Prohibited: incentivised traffic, automated traffic, misleading claims, ` +
          `bidding on the brand name in paid search, and any placement not listed as allowed.\n\n` +
          `You are responsible for complying with the advertising disclosure rules that ` +
          `apply where your audience is. Audicents does not provide legal advice.`,
        termsVersion: 1,
        launchedAt: daysAgo(HISTORY_DAYS + 5),
        budget: { create: { totalBudgetMicros: 0n, lowBalanceBps: 1500 } },
        rules: {
          create: fixture.rules.map((rule) => ({
            kind: rule.kind,
            label: rule.label,
            detail: rule.detail ?? null,
          })),
        },
        creatives: {
          create: [
            {
              kind: 'COPY',
              usage: 'APPROVED',
              title: 'Example post copy',
              body: fixture.exampleCopy,
            },
            { kind: 'DESCRIPTION', usage: 'OPTIONAL', title: 'The product', body: fixture.product },
            { kind: 'DESCRIPTION', usage: 'OPTIONAL', title: 'Who it is for', body: fixture.audience },
          ],
        },
      },
    });

    byKey.set(fixture.key, campaign);
  }

  console.log(`  ${byKey.size} campaigns`);
  return byKey;
}

/**
 * Funds every campaign through the ledger, with headroom over what the history
 * will spend. Budgets are what stop a campaign paying out more than the brand
 * put in, so seeding spend without seeding the funding behind it would leave
 * every campaign looking overdrawn.
 */
async function fundCampaigns(campaigns: Map<string, Campaign>): Promise<void> {
  const { accounts, post } = await import('../src/lib/billing/ledger');
  const budget = await import('../src/lib/billing/budget');

  for (const [key, campaign] of campaigns) {
    const amount = fundingFor(key);

    await prisma.$transaction(async (tx) => {
      await post(tx, {
        kind: 'BRAND_DEPOSIT',
        idempotencyKey: `demo:deposit:${campaign.id}`,
        description: `Demo funding for ${campaign.name}`,
        lines: [
          { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: amount },
          {
            account: accounts.brandDeposit(campaign.brandId),
            direction: 'CREDIT',
            amountMicros: amount,
          },
        ],
      });
      await budget.fundCampaign(tx, {
        campaignId: campaign.id,
        brandId: campaign.brandId,
        amountMicros: amount,
        idempotencyKey: `demo:fund:${campaign.id}`,
        reason: 'Demo funding',
      });
    });

    await prisma.campaignBudget.update({
      where: { campaignId: campaign.id },
      data: { totalBudgetMicros: amount },
    });
  }

  // A working balance the demo brand has not committed to anything yet, so a
  // campaign created during the walkthrough can be funded from it. Without
  // this the wizard would end on a campaign with no budget, which reads as a
  // broken flow rather than as the deliberate limit it would be.
  const northline = campaigns.get('northline-fall');
  if (northline) {
    const balance = 25_000n * MICROS;
    await prisma.$transaction(async (tx) => {
      await post(tx, {
        kind: 'BRAND_DEPOSIT',
        idempotencyKey: `demo:balance:${northline.brandId}`,
        description: 'Demo account balance',
        lines: [
          { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: balance },
          {
            account: accounts.brandDeposit(northline.brandId),
            direction: 'CREDIT',
            amountMicros: balance,
          },
        ],
      });
    });
  }

  console.log('  Campaigns funded through the ledger');
}

/** Enough to cover the seeded history with room for the demo to keep spending. */
function fundingFor(key: string): bigint {
  const fixture = DEMO_CAMPAIGNS.find((c) => c.key === key);
  if (!fixture) throw new Error(`No fixture for campaign ${key}`);

  const brandRow = DEMO_BRAND_PERFORMANCE.find((r) => r.campaign === key);
  const mine = DEMO_PERFORMANCE.find((r) => r.campaign === key);

  const spend = brandRow
    ? grossFor(fixture, brandRow.billable, dollars(brandRow.revenue))
    : mine
      ? grossFor(fixture, mine.billable, dollars(mine.revenue))
      : 0n;

  // Round up to the next whole dollar, then add half again as headroom.
  const withHeadroom = (spend * 3n) / 2n + 500n * MICROS;
  return ((withHeadroom + MICROS - 1n) / MICROS) * MICROS;
}

// ---------------------------------------------------------------------------
// The demo publisher
// ---------------------------------------------------------------------------

/** Followers per platform for the demo publisher; also part of brand reach. */
const DEMO_CREATOR_SOCIALS: Array<{ platform: ChannelType; handle: string; followers: number }> = [
  { platform: 'INSTAGRAM', handle: '@jordanvale', followers: 84_200 },
  { platform: 'TIKTOK', handle: '@jordanvale', followers: 61_400 },
  { platform: 'YOUTUBE', handle: 'Jordan Vale', followers: 38_900 },
  { platform: 'NEWSLETTER', handle: 'The Vale Letter', followers: 12_500 },
];

async function seedDemoCreator() {
  const user = await prisma.user.create({
    data: {
      email: DEMO_CREATOR_EMAIL,
      emailNormalized: DEMO_CREATOR_EMAIL,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: 'CREATOR',
      name: DEMO_CREATOR_NAME,
      emailVerifiedAt: new Date(),
      isDemo: true,
    },
  });

  const creator = await prisma.creator.create({
    data: {
      isDemo: true,
      userId: user.id,
      handle: DEMO_CREATOR_HANDLE,
      publisherType: 'CREATOR',
      country: 'US',
      verification: 'VERIFIED',
      taxFormKind: 'W9',
      taxFormStatus: 'verified',
      taxFormSubmittedAt: daysAgo(HISTORY_DAYS + 8),
      profile: {
        create: {
          displayName: DEMO_CREATOR_NAME,
          bio: 'Style, gear and the things I actually keep. Weekly on video, fortnightly by email.',
          categories: ['fashion', 'lifestyle', 'fitness'],
          audienceCountries: ['US', 'CA', 'GB'],
          channels: DEMO_CREATOR_SOCIALS.map((s) => s.platform),
        },
      },
      socialAccounts: {
        create: DEMO_CREATOR_SOCIALS.map((s) => ({
          platform: s.platform,
          handle: s.handle,
          followers: s.followers,
          verifiedAt: daysAgo(HISTORY_DAYS),
        })),
      },
    },
  });

  console.log(`  Demo publisher ${DEMO_CREATOR_NAME}`);
  return creator;
}

/**
 * The demo publisher's three months, written the way the live product writes
 * it: clicks first, then conversions attributed to those clicks, then earnings
 * accrued through the ledger against each campaign's funded budget.
 */
async function seedDemoCreatorHistory(
  creator: { id: string },
  campaigns: Map<string, Campaign>,
): Promise<void> {
  const { accrue, approve } = await import('../src/lib/billing/earnings');
  const { grossFromNet } = await import('../src/lib/billing/fees');
  const fee = { feeBps: DEMO_FEE_BPS, flatMicros: 0n, source: 'platform' as const };

  let earnings = 0;

  for (const row of DEMO_PERFORMANCE) {
    const fixture = DEMO_CAMPAIGNS.find((c) => c.key === row.campaign);
    const campaign = campaigns.get(row.campaign);
    if (!fixture || !campaign) continue;

    const link = await prisma.trackingLink.create({
      data: {
        code: await trackingCode(),
        campaignId: campaign.id,
        creatorId: creator.id,
        channel: (fixture.channels[0] ?? 'INSTAGRAM') as ChannelType,
        termsVersion: 1,
        termsAcceptedAt: daysAgo(HISTORY_DAYS - 2),
        clickCount: BigInt(row.clicks),
      },
    });

    const clicks = await insertClicks({
      linkId: link.id,
      campaignId: campaign.id,
      creatorId: creator.id,
      brandId: campaign.brandId,
      count: row.clicks,
      billable: fixture.model === 'CPC' ? row.billable : 0,
      countries: fixture.countries,
      channel: fixture.channels[0] ?? 'INSTAGRAM',
    });

    // Conversions are attributed to real clicks, because that attribution is
    // what the publisher's per-campaign figures are read from.
    const conversionIds = await insertConversions({
      campaignId: campaign.id,
      creatorId: creator.id,
      linkId: link.id,
      clickIds: clicks.all,
      count: row.conversions,
      revenueMicros: dollars(row.revenue),
      payoutMicros: fixture.model === 'CPC' ? 0n : netFor(fixture, 1, dollars(row.revenue) / BigInt(Math.max(row.conversions, 1))),
      keyPrefix: `demo:${row.campaign}`,
    });

    // One earning per billable event, exactly as the live path records them.
    const perEvent = perEventNet(fixture, row.billable, dollars(row.revenue));
    const eventType = fixture.model === 'CPC' ? 'CLICK' : fixture.model === 'CPL' ? 'LEAD' : 'SALE';

    for (let i = 0; i < row.billable; i += 1) {
      const net = perEvent[i] ?? 0n;
      if (net <= 0n) continue;
      const breakdown = grossFromNet(net, fee);

      const result = await accrue({
        creatorId: creator.id,
        campaignId: campaign.id,
        eventType,
        grossMicros: breakdown.grossMicros,
        feeMicros: breakdown.feeMicros,
        netMicros: breakdown.netMicros,
        idempotencyKey: `demo:earn:${row.campaign}:${i}`,
        clickId: fixture.model === 'CPC' ? (clicks.billable[i] ?? null) : null,
        conversionId: fixture.model === 'CPC' ? null : (conversionIds[i] ?? null),
      });

      if (!result.ok) {
        throw new Error(
          `${row.campaign}: budget ran out after ${i} of ${row.billable} events (${result.reason})`,
        );
      }
      earnings += 1;

      // The last `pendingBillable` events are the recent ones, and recent
      // earnings are the ones still on hold. Everything older has cleared.
      if (i < row.billable - row.pendingBillable) {
        await approve(result.earning.id, { skipHold: true, reason: 'Hold period elapsed' });
      }
    }
  }

  await backdateEarnings();
  console.log(`  ${earnings} earnings accrued for the demo publisher`);
}

/**
 * Net earning per billable event.
 *
 * Revenue-share campaigns pay a share of each order rather than a flat fee, so
 * the total is split across the events with the remainder going to the first
 * one — the same largest-remainder split the product uses elsewhere, and the
 * reason the campaign rows still sum to the exact figure on the dashboard.
 */
function perEventNet(
  fixture: DemoCampaignFixture,
  events: number,
  revenueMicros: bigint,
): bigint[] {
  if (events <= 0) return [];
  if (fixture.model !== 'REVSHARE') {
    return Array.from({ length: events }, () => dollars(fixture.payout));
  }
  const total = (revenueMicros * BigInt(fixture.revshareBps ?? 0)) / 10_000n;
  const each = total / BigInt(events);
  const shares = Array.from({ length: events }, () => each);
  shares[0] = (shares[0] ?? 0n) + (total - each * BigInt(events));
  return shares;
}

/** Total net earned on a campaign, from the events rather than a typed figure. */
function netFor(fixture: DemoCampaignFixture, events: number, revenueMicros: bigint): bigint {
  return perEventNet(fixture, events, revenueMicros).reduce((sum, n) => sum + n, 0n);
}

/** What the brand paid: the publisher's net, grossed up by the platform fee. */
function grossFor(fixture: DemoCampaignFixture, events: number, revenueMicros: bigint): bigint {
  const net = netFor(fixture, events, revenueMicros);
  return (net * 10_000n) / BigInt(10_000 - DEMO_FEE_BPS);
}

// ---------------------------------------------------------------------------
// Raw event generation
// ---------------------------------------------------------------------------

const DEVICES = ['mobile', 'mobile', 'mobile', 'desktop', 'tablet'];
const BROWSERS = ['Chrome', 'Safari', 'Safari', 'Firefox', 'Edge'];

/**
 * Inserts clicks in one statement, generated in the database rather than
 * assembled row by row in JavaScript — nearly three hundred thousand of them go
 * in across the whole seed.
 *
 * The first `billable` clicks (chronologically the oldest) are the ones marked
 * eligible and billable, so the earnings accrued against them below inherit
 * dates spread across the whole window instead of piling up at one edge.
 */
async function insertClicks(params: {
  linkId: string;
  campaignId: string;
  creatorId: string;
  brandId: string;
  count: number;
  billable: number;
  countries: string[];
  channel: string;
}): Promise<{ all: string[]; billable: string[] }> {
  if (params.count <= 0) return { all: [], billable: [] };

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `
    INSERT INTO "clicks" (
      id, "createdAt", "linkId", "campaignId", "creatorId", "brandId",
      "ipHash", "ipPrefixHash", country, "deviceType", browser, os, "isBot",
      "referrerHost", "subId", eligibility, billable, "sessionFp", "fraudScore"
    )
    SELECT
      gen_random_uuid(),
      -- Spread across the window with a daily rhythm, so charts look like
      -- traffic rather than like a uniform random cloud.
      now() - (($1::int - g)::float * $2::float / $1::float * interval '1 day')
            - ((g * 37 % 24) * interval '1 hour'),
      $3::uuid, $4::uuid, $5::uuid, $6::uuid,
      md5('demo-ip-' || $3 || '-' || g),
      md5('demo-net-' || $3 || '-' || (g % 400)),
      ($7::text[])[1 + (g % array_length($7::text[], 1))],
      ($8::text[])[1 + (g % array_length($8::text[], 1))],
      ($9::text[])[1 + (g % array_length($9::text[], 1))],
      CASE WHEN g % 5 < 3 THEN 'iOS' ELSE 'Android' END,
      g % 53 = 0,
      $10::text,
      NULL,
      CASE
        WHEN g % 53 = 0 THEN 'REJECTED'::"ClickEligibility"
        WHEN g % 29 = 0 THEN 'DUPLICATE'::"ClickEligibility"
        ELSE 'ELIGIBLE'::"ClickEligibility"
      END,
      -- Billable clicks are spread evenly through the window rather than
      -- being the first N: earnings inherit the date of the click that
      -- produced them, so bunching them at one end would draw an earnings
      -- chart that is a single spike.
      (g * $11::int) / $1::int > ((g - 1) * $11::int) / $1::int
        AND g % 53 <> 0 AND g % 29 <> 0,
      md5('demo-fp-' || $3 || '-' || (g % GREATEST($1::int / 3, 1))),
      CASE WHEN g % 53 = 0 THEN 70 + (g % 25) ELSE g % 18 END
    FROM generate_series(1, $1::int) AS g
    ORDER BY g
    RETURNING id
    `,
    params.count,
    HISTORY_DAYS,
    params.linkId,
    params.campaignId,
    params.creatorId,
    params.brandId,
    params.countries,
    DEVICES,
    BROWSERS,
    referrerFor(params.channel),
    // Ask for more than needed: roughly one in twenty falls out as a duplicate
    // or a reject, and the earnings below take whichever actually qualified.
    Math.min(params.count, Math.ceil(params.billable * 1.12) + 12),
  );

  // Billable clicks are read back separately, oldest first, so the earnings
  // loop can attribute one earning to each and mark the most recent as still
  // on hold. Which clicks came out billable depends on the screening above, so
  // it has to be asked rather than assumed.
  const billable = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "clicks" WHERE "linkId" = $1::uuid AND billable ORDER BY "createdAt"`,
    params.linkId,
  );

  return { all: rows.map((r) => r.id), billable: billable.map((r) => r.id) };
}

function referrerFor(channel: string): string {
  switch (channel) {
    case 'TIKTOK':
      return 'tiktok.com';
    case 'YOUTUBE':
      return 'youtube.com';
    case 'X':
      return 't.co';
    case 'PINTEREST':
      return 'pinterest.com';
    case 'FACEBOOK':
      return 'facebook.com';
    case 'INSTAGRAM':
      return 'instagram.com';
    default:
      return 'newsletter.example.com';
  }
}

/**
 * Inserts conversions attributed to the clicks that produced them, splitting
 * the campaign's reported revenue across them with the remainder on the first,
 * so the total is exact.
 */
async function insertConversions(params: {
  campaignId: string;
  creatorId: string;
  linkId: string;
  clickIds: string[];
  count: number;
  revenueMicros: bigint;
  payoutMicros: bigint;
  keyPrefix: string;
}): Promise<string[]> {
  if (params.count <= 0) return [];

  const each = params.revenueMicros / BigInt(params.count);
  const remainder = params.revenueMicros - each * BigInt(params.count);

  const ids: string[] = [];
  const values: unknown[] = [];
  const tuples: string[] = [];
  let p = 1;

  for (let i = 0; i < params.count; i += 1) {
    const id = randomUUID();
    ids.push(id);
    tuples.push(
      `($${p++}::uuid, $${p++}::uuid, $${p++}::uuid, $${p++}::uuid, $${p++}::uuid, $${p++}, $${p++}, ` +
        `$${p++}::"BillableEvent", $${p++}::bigint, $${p++}::bigint, $${p++}::"ConversionStatus", $${p++}, ` +
        `$${p++}::timestamptz, $${p++}::timestamptz, $${p++}::timestamptz, $${p++}::timestamptz)`,
    );
    // Conversions land some hours after the click they came from.
    const at = new Date(Date.now() - Math.round(((params.count - i) / params.count) * HISTORY_DAYS * 86_400_000) + (i % 9) * 3_600_000);
    values.push(
      id,
      params.campaignId,
      params.creatorId,
      params.linkId,
      params.clickIds[i % Math.max(params.clickIds.length, 1)] ?? null,
      `${params.keyPrefix}-order-${i + 1}`,
      `${params.keyPrefix}:conv:${i}`,
      'SALE',
      each + (i === 0 ? remainder : 0n),
      params.payoutMicros,
      'APPROVED',
      's2s',
      at,
      at,
      at,
      at,
    );
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "conversions" (
       id, "campaignId", "creatorId", "linkId", "clickId", "externalId", "idempotencyKey",
       "eventType", "revenueMicros", "payoutMicros", status, source,
       "attributedAt", "approvedAt", "createdAt", "updatedAt"
     ) VALUES ${tuples.join(', ')}`,
    ...values,
  );

  return ids;
}

/**
 * Earnings accrue through the ledger, which stamps them with the moment they
 * were posted — so without this every one of them would read "a minute ago" and
 * the earnings chart would be a single spike. They are dated to the click or
 * conversion that produced them. Ledger transactions keep their real
 * timestamps: those are the append-only record and are not touched.
 */
async function backdateEarnings(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "earnings" e SET "createdAt" = c."createdAt"
    FROM "clicks" c WHERE c.id = e."clickId"
  `;
  await prisma.$executeRaw`
    UPDATE "earnings" e SET "createdAt" = v."createdAt"
    FROM "conversions" v WHERE v.id = e."conversionId" AND e."clickId" IS NULL
  `;
}

// ---------------------------------------------------------------------------
// The rest of the marketplace
// ---------------------------------------------------------------------------

/**
 * The other 2,480 publishers behind the brand's numbers.
 *
 * Written in bulk: accounts, links and events go in as set-generating SQL, and
 * each campaign posts two ledger transactions — one accrual, one approval —
 * carrying a line per publisher rather than a transaction per publisher. The
 * books balance to the same totals either way; this takes seconds.
 */
async function seedMarketplaceHistory(campaigns: Map<string, Campaign>): Promise<void> {
  const others = DEMO_BRAND_TARGETS.creators - 1;
  const followerTotal = DEMO_BRAND_TARGETS.reach - DEMO_CREATOR_SOCIALS.reduce((s, x) => s + x.followers, 0);

  await prisma.$executeRawUnsafe(
    `
    WITH n AS (SELECT g FROM generate_series(1, $1::int) AS g),
    u AS (
      INSERT INTO "users" (id, email, "emailNormalized", role, name, status, "emailVerifiedAt", "isDemo", "createdAt", "updatedAt")
      SELECT gen_random_uuid(),
             'publisher' || g || '@${DEMO_DOMAIN}',
             'publisher' || g || '@${DEMO_DOMAIN}',
             'CREATOR'::"UserRole",
             ($2::text[])[1 + (g % array_length($2::text[], 1))] || ' ' ||
               ($3::text[])[1 + ((g * 7) % array_length($3::text[], 1))],
             'ACTIVE'::"UserStatus", now(), true, now(), now()
      FROM n
      RETURNING id, name
    )
    INSERT INTO "creators" (id, "isDemo", "userId", handle, "publisherType", country, verification, "createdAt", "updatedAt")
    SELECT gen_random_uuid(), true, u.id, 'pub-' || row_number() OVER (ORDER BY u.id),
           'CREATOR', 'US', 'VERIFIED'::"VerificationStatus", now(), now()
    FROM u
    `,
    others,
    FIRST_NAMES,
    LAST_NAMES,
  );

  // Follower counts, so "total reach" is the sum of real rows and lands exactly
  // on the target rather than being asserted into existence.
  await prisma.$executeRawUnsafe(
    `
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY id) AS rn, count(*) OVER () AS total
      FROM "creators" WHERE "isDemo" AND "userId" <> (SELECT id FROM "users" WHERE email = $2)
    )
    INSERT INTO "social_accounts" (id, "creatorId", platform, handle, followers, "verifiedAt", "createdAt")
    SELECT gen_random_uuid(), id, 'INSTAGRAM'::"ChannelType", '@pub' || rn,
           -- A long tail: most publishers are small, a few are large, and the
           -- remainder is placed on the first so the total is exact.
           ($1::bigint / total)::int
             + CASE WHEN rn = 1 THEN ($1::bigint - (($1::bigint / total) * total))::int ELSE 0 END
             + ((rn * 137) % 900) - 450,
           now(), now()
    FROM ranked
    `,
    followerTotal,
    DEMO_CREATOR_EMAIL,
  );

  // The jitter above does not sum to zero, so the largest account absorbs the
  // difference. Reach is then the exact sum of rows that exist, not a figure
  // the dashboard is told to display.
  await prisma.$executeRawUnsafe(
    `
    UPDATE "social_accounts" SET followers = followers + (
      $1::int - (SELECT SUM(followers)::int FROM "social_accounts")
    )
    WHERE id = (SELECT id FROM "social_accounts" ORDER BY followers DESC, id LIMIT 1)
    `,
    DEMO_BRAND_TARGETS.reach,
  );

  // Display names, so a brand's top-publisher list reads as people rather than
  // as row numbers.
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "creator_profiles" (id, "creatorId", "displayName", categories, "audienceCountries", channels, "isPublic", "createdAt", "updatedAt")
    SELECT gen_random_uuid(), c.id, u.name, ARRAY['fashion','lifestyle'], ARRAY['US','CA'],
           ARRAY['INSTAGRAM']::"ChannelType"[], true, now(), now()
    FROM "creators" c
    JOIN "users" u ON u.id = c."userId"
    WHERE c."isDemo" AND u.email <> $1
      AND NOT EXISTS (SELECT 1 FROM "creator_profiles" p WHERE p."creatorId" = c.id)
    `,
    DEMO_CREATOR_EMAIL,
  );

  const creatorIds = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT c.id FROM "creators" c
     JOIN "users" u ON u.id = c."userId"
     WHERE c."isDemo" AND u.email <> $1
     ORDER BY c.id`,
    DEMO_CREATOR_EMAIL,
  );
  const pool = creatorIds.map((r) => r.id);
  console.log(`  ${pool.length} other publishers`);

  let cursor = 0;
  for (const row of DEMO_BRAND_PERFORMANCE) {
    const fixture = DEMO_CAMPAIGNS.find((c) => c.key === row.campaign);
    const campaign = campaigns.get(row.campaign);
    if (!fixture || !campaign) continue;

    const mine = DEMO_PERFORMANCE.find((p) => p.campaign === row.campaign);
    const participants = takeWindow(pool, cursor, row.creators - 1);
    cursor = (cursor + participants.length) % Math.max(pool.length, 1);

    await seedCampaignCohort({
      campaign,
      fixture,
      creatorIds: participants,
      clicks: row.clicks - (mine?.clicks ?? 0),
      billable: row.billable - (mine?.billable ?? 0),
      conversions: row.conversions - (mine?.conversions ?? 0),
      revenueMicros: dollars(row.revenue) - dollars(mine?.revenue ?? '0'),
    });

    console.log(`  ${fixture.name}: ${participants.length} publishers`);
  }
}

/** A wrap-around slice, so every publisher in the pool is used at least once. */
function takeWindow(pool: string[], start: number, size: number): string[] {
  if (pool.length === 0 || size <= 0) return [];
  const take = Math.min(size, pool.length);
  const out: string[] = [];
  for (let i = 0; i < take; i += 1) out.push(pool[(start + i) % pool.length] as string);
  return out;
}

async function seedCampaignCohort(params: {
  campaign: Campaign;
  fixture: DemoCampaignFixture;
  creatorIds: string[];
  clicks: number;
  billable: number;
  conversions: number;
  revenueMicros: bigint;
}): Promise<void> {
  const { campaign, fixture, creatorIds } = params;
  if (creatorIds.length === 0) return;

  const clickShares = split(params.clicks, creatorIds.length);
  const conversionShares = split(params.conversions, creatorIds.length);
  // Revenue follows the conversions that produced it. Splitting it evenly
  // instead would hand revenue to publishers with no conversion to hang it on,
  // and a revenue-share campaign would then pay out less than the brand earned.
  const revenueShares = allocateBig(params.revenueMicros, conversionShares);
  const billableShares =
    fixture.model === 'REVSHARE' ? conversionShares : split(params.billable, creatorIds.length);

  // Links, one per publisher, in one statement.
  const linkRows = await prisma.$queryRawUnsafe<Array<{ id: string; creatorId: string }>>(
    `
    INSERT INTO "tracking_links" (id, code, "campaignId", "creatorId", "termsVersion", "termsAcceptedAt", "clickCount", "createdAt", "updatedAt")
    SELECT gen_random_uuid(),
           -- Same alphabet the product generates in, for the same reason.
           translate(upper(substr(md5(gen_random_uuid()::text), 1, 10)), 'ILOU', '1105'),
           $1::uuid, x.creator_id, 1, now() - interval '85 days', x.clicks::bigint, now() - interval '85 days', now()
    FROM unnest($2::uuid[], $3::int[]) AS x(creator_id, clicks)
    RETURNING id, "creatorId"
    `,
    campaign.id,
    creatorIds,
    clickShares,
  );

  const linkByCreator = new Map(linkRows.map((r) => [r.creatorId, r.id]));

  // Clicks, conversions and earnings for the whole cohort in three statements.
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "clicks" (
      id, "createdAt", "linkId", "campaignId", "creatorId", "brandId",
      "ipHash", "ipPrefixHash", country, "deviceType", browser, os, "isBot",
      "referrerHost", eligibility, billable, "sessionFp", "fraudScore"
    )
    SELECT
      gen_random_uuid(),
      now() - (random() * $5::float * interval '1 day'),
      x.link_id, $1::uuid, x.creator_id, $2::uuid,
      md5('demo-ip-' || x.link_id || '-' || g),
      md5('demo-net-' || x.link_id || '-' || (g % 200)),
      ($6::text[])[1 + (g % array_length($6::text[], 1))],
      ($7::text[])[1 + (g % array_length($7::text[], 1))],
      ($8::text[])[1 + (g % array_length($8::text[], 1))],
      CASE WHEN g % 5 < 3 THEN 'iOS' ELSE 'Android' END,
      g % 53 = 0,
      $9::text,
      CASE
        WHEN g % 53 = 0 THEN 'REJECTED'::"ClickEligibility"
        WHEN g % 29 = 0 THEN 'DUPLICATE'::"ClickEligibility"
        ELSE 'ELIGIBLE'::"ClickEligibility"
      END,
      g <= x.billable,
      md5('demo-fp-' || x.link_id || '-' || (g % GREATEST(x.clicks / 3, 1))),
      CASE WHEN g % 53 = 0 THEN 70 + (g % 25) ELSE g % 18 END
    FROM unnest($3::uuid[], $4::uuid[], $10::int[], $11::int[]) AS x(link_id, creator_id, clicks, billable)
    CROSS JOIN LATERAL generate_series(1, x.clicks) AS g
    `,
    campaign.id,
    campaign.brandId,
    creatorIds.map((id) => linkByCreator.get(id) ?? ''),
    creatorIds,
    HISTORY_DAYS,
    params.fixture.countries,
    DEVICES,
    BROWSERS,
    referrerFor(fixture.channels[0] ?? 'INSTAGRAM'),
    clickShares,
    billableShares,
  );

  if (params.conversions > 0) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "conversions" (
        id, "campaignId", "creatorId", "linkId", "externalId", "idempotencyKey",
        "eventType", "revenueMicros", "payoutMicros", status, source,
        "attributedAt", "approvedAt", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), $1::uuid, x.creator_id, x.link_id,
        'demo-' || x.link_id || '-' || g,
        'demo:cohort:' || x.link_id || ':' || g,
        'SALE'::"BillableEvent",
        -- The publisher's slice of revenue, split across their conversions with
        -- the remainder on the first, so the campaign total stays exact.
        (x.revenue / x.conversions) + CASE WHEN g = 1 THEN x.revenue - (x.revenue / x.conversions) * x.conversions ELSE 0 END,
        0,
        'APPROVED'::"ConversionStatus", 's2s',
        now() - (random() * $2::float * interval '1 day'),
        now() - (random() * $2::float * interval '1 day'),
        now() - (random() * $2::float * interval '1 day'),
        now()
      FROM unnest($3::uuid[], $4::uuid[], $5::int[], $6::bigint[]) AS x(link_id, creator_id, conversions, revenue)
      CROSS JOIN LATERAL generate_series(1, x.conversions) AS g
      WHERE x.conversions > 0
      `,
      campaign.id,
      HISTORY_DAYS,
      creatorIds.map((id) => linkByCreator.get(id) ?? ''),
      creatorIds,
      conversionShares,
      revenueShares,
    );
  }

  // One earning row per publisher, carrying the quantity it covers. The
  // earnings table records quantity precisely so an aggregated accrual does not
  // have to pretend to be a single event.
  const nets = creatorIds.map((_, i) =>
    netFor(fixture, billableShares[i] ?? 0, revenueShares[i] ?? 0n),
  );
  const grosses = nets.map((net) => (net * 10_000n) / BigInt(10_000 - DEMO_FEE_BPS));
  const fees = grosses.map((gross, i) => gross - (nets[i] ?? 0n));

  const eventType = fixture.model === 'CPC' ? 'CLICK' : fixture.model === 'CPL' ? 'LEAD' : 'SALE';

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "earnings" (
      id, "creatorId", "campaignId", "eventType", quantity,
      "grossMicros", "feeMicros", "netMicros", status, "idempotencyKey",
      "approvedAt", "availableAt", "createdAt", "updatedAt"
    )
    SELECT gen_random_uuid(), x.creator_id, $1::uuid, $2::"BillableEvent", x.quantity,
           x.gross, x.fee, x.net, 'AVAILABLE'::"EarningStatus",
           'demo:cohort:' || $1 || ':' || x.creator_id,
           now() - interval '20 days', now() - interval '13 days',
           now() - (random() * $3::float * interval '1 day'), now()
    FROM unnest($4::uuid[], $5::int[], $6::bigint[], $7::bigint[], $8::bigint[])
      AS x(creator_id, quantity, gross, fee, net)
    WHERE x.net > 0
    `,
    campaign.id,
    eventType,
    HISTORY_DAYS,
    creatorIds,
    billableShares,
    grosses,
    fees,
    nets,
  );

  await postCohortLedger({ campaign, creatorIds, nets, grosses, fees });
  await insertImpressions(campaign, creatorIds, linkByCreator, clickShares);
}

/**
 * Views of the post, not visits to the landing page.
 *
 * A click is the tail of a much larger number of people who saw the placement,
 * and the brand's funnel is unreadable without the top of it. Seeded at a fixed
 * multiple of clicks so the click-through rate the dashboards derive is a
 * consistent one rather than noise.
 */
const IMPRESSIONS_PER_CLICK = 2;

async function insertImpressions(
  campaign: Campaign,
  creatorIds: string[],
  linkByCreator: Map<string, string>,
  clickShares: number[],
): Promise<void> {
  const views = clickShares.map((clicks) => clicks * IMPRESSIONS_PER_CLICK);
  if (views.reduce((a, b) => a + b, 0) === 0) return;

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "impressions" (id, "createdAt", "linkId", "campaignId", "creatorId", "ipHash", country, billable, "sessionFp", "fraudScore")
    SELECT gen_random_uuid(),
           now() - (random() * $2::float * interval '1 day'),
           x.link_id, $1::uuid, x.creator_id,
           md5('demo-view-' || x.link_id || '-' || g),
           'US', false,
           md5('demo-vfp-' || x.link_id || '-' || (g % GREATEST(x.views / 3, 1))),
           0
    FROM unnest($3::uuid[], $4::uuid[], $5::int[]) AS x(link_id, creator_id, views)
    CROSS JOIN LATERAL generate_series(1, x.views) AS g
    WHERE x.views > 0
    `,
    campaign.id,
    HISTORY_DAYS,
    creatorIds.map((id) => linkByCreator.get(id) ?? ''),
    creatorIds,
    views,
  );
}

/**
 * Two ledger transactions for the cohort: the accrual that moves the campaign's
 * escrow into publisher liabilities and platform revenue, and the approval that
 * moves those liabilities from pending to available. Both are posted with one
 * line per publisher, which is what a batch settlement looks like anyway.
 */
async function postCohortLedger(params: {
  campaign: Campaign;
  creatorIds: string[];
  nets: bigint[];
  grosses: bigint[];
  fees: bigint[];
}): Promise<void> {
  const { campaign, creatorIds, nets, grosses, fees } = params;
  const totalGross = grosses.reduce((s, v) => s + v, 0n);
  const totalNet = nets.reduce((s, v) => s + v, 0n);
  const totalFee = fees.reduce((s, v) => s + v, 0n);
  if (totalGross <= 0n) return;

  const { accounts, post } = await import('../src/lib/billing/ledger');
  const budget = await import('../src/lib/billing/budget');

  await prisma.$transaction(
    async (tx) => {
      await post(tx, {
        kind: 'EARNING_ACCRUAL',
        idempotencyKey: `demo:cohort:accrue:${campaign.id}`,
        description: `Demo cohort earnings for ${campaign.name}`,
        metadata: { campaignId: campaign.id, publishers: creatorIds.length },
        lines: [
          {
            account: accounts.campaignEscrow(campaign.id),
            direction: 'DEBIT',
            amountMicros: totalGross,
          },
          ...creatorIds.flatMap((id, i) =>
            (nets[i] ?? 0n) > 0n
              ? [
                  {
                    account: accounts.publisherPending(id),
                    direction: 'CREDIT' as const,
                    amountMicros: nets[i] as bigint,
                  },
                ]
              : [],
          ),
          ...(totalFee > 0n
            ? [
                {
                  account: accounts.platformRevenue(),
                  direction: 'CREDIT' as const,
                  amountMicros: totalFee,
                },
              ]
            : []),
        ],
      });

      await post(tx, {
        kind: 'EARNING_APPROVAL',
        idempotencyKey: `demo:cohort:release:${campaign.id}`,
        description: `Release demo cohort earnings for ${campaign.name}`,
        metadata: { campaignId: campaign.id, publishers: creatorIds.length },
        lines: [
          ...creatorIds.flatMap((id, i) =>
            (nets[i] ?? 0n) > 0n
              ? [
                  {
                    account: accounts.publisherPending(id),
                    direction: 'DEBIT' as const,
                    amountMicros: nets[i] as bigint,
                  },
                  {
                    account: accounts.publisherAvailable(id),
                    direction: 'CREDIT' as const,
                    amountMicros: nets[i] as bigint,
                  },
                ]
              : [],
          ),
        ],
      });

      // The budget has to move with it: these earnings are settled spend, and
      // the campaign_budget_within_funding constraint will refuse the update if
      // the campaign was not funded for them.
      const reservation = await budget.reserve(tx, campaign.id, totalGross);
      if (!reservation.ok) {
        throw new Error(
          `${campaign.name}: funded budget cannot cover the seeded cohort spend (${reservation.reason})`,
        );
      }
      await budget.settle(tx, campaign.id, totalGross);
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  void totalNet;
}

// ---------------------------------------------------------------------------
// Rollups and the closing report
// ---------------------------------------------------------------------------

async function buildRollups(): Promise<void> {
  const { backfill } = await import('../src/lib/analytics/rollup');
  const rows = await backfill(new Date(Date.now() - (HISTORY_DAYS + 2) * 86_400_000), new Date());
  console.log(`  ${rows} rollup rows`);
}

/** Reads the figures back out of the database, so the log proves the claim. */
async function report(): Promise<void> {
  const { balanceSummary } = await import('../src/lib/billing/earnings');
  const creator = await prisma.creator.findFirstOrThrow({
    where: { isDemo: true, handle: DEMO_CREATOR_HANDLE },
  });
  const balance = await balanceSummary(creator.id);

  const [clicks, conversions, campaigns] = await Promise.all([
    prisma.trackingLink.aggregate({ where: { creatorId: creator.id }, _sum: { clickCount: true } }),
    prisma.conversion.count({ where: { creatorId: creator.id } }),
    prisma.trackingLink.count({ where: { creatorId: creator.id } }),
  ]);

  console.log('\n  Demo publisher, read back from the database:');
  console.log(`    Lifetime earnings  ${money(balance.pendingMicros + balance.availableMicros)}`);
  console.log(`    Pending            ${money(balance.pendingMicros)}`);
  console.log(`    Available          ${money(balance.availableMicros)}`);
  console.log(`    Clicks             ${clicks._sum.clickCount ?? 0n}`);
  console.log(`    Conversions        ${conversions}`);
  console.log(`    Campaigns          ${campaigns}`);
}

function money(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MICROS;
  const frac = (abs % MICROS) / 10_000n;
  return `${negative ? '-' : ''}$${whole.toLocaleString('en-US')}.${String(frac).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Avery', 'Rowan', 'Quinn', 'Sasha', 'Elliot', 'Nadia', 'Marcus', 'Priya',
  'Theo', 'Imani', 'Dana', 'Felix', 'Noor', 'Callum', 'Yara', 'Devon',
];

const LAST_NAMES = [
  'Reyes', 'Okafor', 'Lindqvist', 'Moreau', 'Bianchi', 'Novak', 'Haddad', 'Ferreira',
  'Sorensen', 'Kowalski', 'Nakamura', 'Adeyemi', 'Delgado', 'Ivanov', 'Mbeki', 'Larsen',
];

/** Splits `total` into `parts` whole numbers, remainder on the earliest parts. */
function split(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Distributes `total` in proportion to `weights`, largest remainder first, so
 * the parts sum to exactly the total and a zero weight receives nothing.
 */
function allocateBig(total: bigint, weights: number[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0n) return weights.map(() => 0n);

  const denominator = BigInt(sum);
  const shares = weights.map((w) => (total * BigInt(w)) / denominator);
  let allocated = shares.reduce((a, b) => a + b, 0n);

  // Hand the rounding remainder to the heaviest weights, one micro at a time.
  const order = weights
    .map((w, i) => ({ i, w }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w);

  let cursor = 0;
  while (allocated < total && order.length > 0) {
    const target = order[cursor % order.length];
    if (target) {
      shares[target.i] = (shares[target.i] ?? 0n) + 1n;
      allocated += 1n;
    }
    cursor += 1;
  }
  return shares;
}

/** Dollars as a decimal string to integer micros, without touching a float. */
function dollars(value: string): bigint {
  const [whole = '0', frac = ''] = value.trim().split('.');
  const padded = (frac + '000000').slice(0, 6);
  const sign = whole.startsWith('-') ? -1n : 1n;
  const magnitude = BigInt(whole.replace('-', '')) * MICROS + BigInt(padded);
  return sign * magnitude;
}

async function hashPassword(password: string): Promise<string> {
  const { hashPassword: hash } = await import('../src/lib/crypto/hash');
  return hash(password);
}

/**
 * Codes come from the product's own generator rather than a local one: they are
 * matched case-insensitively through a Crockford base32 normalisation, so a
 * code invented here in another alphabet would store fine and then fail to
 * resolve when someone clicked it.
 */
async function trackingCode(): Promise<string> {
  const { generateTrackingCode } = await import('../src/lib/crypto/ids');
  return generateTrackingCode();
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}


main()
  .catch((error) => {
    console.error('\nDemo seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
