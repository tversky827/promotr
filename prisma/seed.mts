/**
 * Development seed data.
 *
 * SAFETY: this script refuses to run against a database that already contains
 * real activity, and refuses outright when NODE_ENV is production unless
 * ALLOW_PRODUCTION_SEED is explicitly set. Seeded records are marked so they can
 * be identified and removed — see `isSeedData` below.
 *
 * Run with:  npm run db:seed
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient, type Campaign, type Creator, type PayoutModel } from '@prisma/client';

const prisma = new PrismaClient();

/** Every seeded account uses this domain, so seed data is trivially identifiable. */
const SEED_DOMAIN = 'seed.promotr.test';

const SEED_MARKER = '[seed]';

async function main(): Promise<void> {
  await assertSafeToSeed();

  console.log('Seeding development data…\n');

  await seedTermsVersions();
  const admin = await seedAdmin();
  const brands = await seedBrands();
  const creators = await seedCreators();
  const campaigns = await seedCampaigns(brands);
  await fundCampaigns(brands, campaigns);
  const links = await seedLinks(campaigns, creators);
  await seedTraffic(campaigns, creators, links);
  await seedRollups();

  console.log('\nSeed complete.\n');
  console.log('Sign in with any of these (password: DevPassword123!):');
  console.log(`  Admin      ${admin.email}`);
  console.log(`  Brand      ${brands[0]?.owner.email}`);
  console.log(`  Publisher  ${creators[0]?.user.email}`);
  console.log('\nStart the worker in another terminal to see rollups and jobs run:');
  console.log('  npm run worker\n');

  if (!targetsLocalDatabase()) {
    console.log(
      'This database is not on this machine. Those passwords are published in the\n' +
        'repository — change the administrator password before you share the URL.\n',
    );
  }
}

/**
 * Refuses to seed anything that looks like a real deployment. Seeding over
 * production data would be unrecoverable, so the check is deliberately strict.
 */
/**
 * Is the target database on this machine?
 *
 * NODE_ENV says how *this process* is running, which says nothing about where
 * the database is. Running the seed locally against a hosted database is one
 * command away, and every account it creates shares one published password —
 * so a hosted database gets its own gate.
 */
function targetsLocalDatabase(): boolean {
  const url = process.env.DATABASE_URL ?? '';
  try {
    const host = new URL(url).hostname.toLowerCase();
    // `db` and `postgres` are the service names Compose and Kubernetes use.
    return ['localhost', '127.0.0.1', '::1', 'db', 'postgres'].includes(host);
  } catch {
    // A socket path or an unparseable URL is local by definition.
    return url === '' || url.startsWith('postgres://:') || url.includes('/var/run/');
  }
}

async function assertSafeToSeed(): Promise<void> {
  if (!targetsLocalDatabase() && process.env.ALLOW_REMOTE_SEED !== 'yes') {
    throw new Error(
      `Refusing to seed ${new URL(process.env.DATABASE_URL ?? 'postgres://unknown').hostname}: it is not a local database.\n\n` +
        'Every seeded account signs in with the same published password, including an ' +
        'administrator. On anything reachable from the internet that is an open door.\n\n' +
        'If this database is genuinely disposable — a preview deployment nobody else can ' +
        'reach, or one you will drop afterwards — set ALLOW_REMOTE_SEED=yes. Then change ' +
        'the administrator password before sharing the URL.',
    );
  }

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'yes') {
    throw new Error(
      'Refusing to seed with NODE_ENV=production. Seed data must never enter a production database. ' +
        'If you are certain, set ALLOW_PRODUCTION_SEED=yes.',
    );
  }

  const [realUsers, payouts, deposits] = await Promise.all([
    prisma.user.count({ where: { emailNormalized: { not: { endsWith: SEED_DOMAIN } } } }),
    prisma.payout.count(),
    prisma.brandDeposit.count({ where: { status: 'succeeded' } }),
  ]);

  if (payouts > 0 || deposits > 0) {
    throw new Error(
      `Refusing to seed: this database has ${payouts} payout(s) and ${deposits} settled deposit(s). ` +
        'It contains real financial activity.',
    );
  }

  if (realUsers > 0) {
    throw new Error(
      `Refusing to seed: this database has ${realUsers} non-seed user account(s). ` +
        'Use a scratch database for seeding.',
    );
  }

  // A previous seed run has to be cleared before this one can start, and how
  // far that can go is decided by the ledger. Ledger entries are append-only —
  // a database trigger enforces it — and that invariant does not get a dev-mode
  // exception, so once a seed run has posted to the ledger the only correct way
  // to start over is to drop the database.
  const previousUsers = await prisma.user.count({
    where: { emailNormalized: { endsWith: SEED_DOMAIN } },
  });
  const previousLedger = await prisma.ledgerTransaction.count();

  if (previousLedger > 0) {
    throw new Error(
      `Refusing to seed: the ledger already holds ${previousLedger} transaction(s) from an ` +
        'earlier seed run, and ledger entries are append-only by design — they cannot be ' +
        'deleted to make room. Recreate the database instead:\n\n' +
        '  npm run db:reset && npm run db:seed\n',
    );
  }

  if (previousUsers > 0) {
    console.log(`Removing ${previousUsers} record(s) from an earlier, unfunded seed run…`);
    await clearSeedData();
  }
}

/**
 * Removes seed accounts and their traffic. Only reachable when the ledger is
 * empty (see above), so it never has to reason about balances.
 */
async function clearSeedData(): Promise<void> {
  const seedUsers = await prisma.user.findMany({
    where: { emailNormalized: { endsWith: SEED_DOMAIN } },
    select: { id: true },
  });
  const userIds = seedUsers.map((u) => u.id);
  if (userIds.length === 0) return;

  const creators = await prisma.creator.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const brands = await prisma.brand.findMany({
    where: { members: { some: { userId: { in: userIds } } } },
    select: { id: true },
  });

  const creatorIds = creators.map((c) => c.id);
  const brandIds = brands.map((b) => b.id);

  // Clicks and impressions are partitioned and carry no inbound foreign keys,
  // so nothing cascades to them — they are removed explicitly by publisher.
  if (creatorIds.length > 0) {
    await prisma.$executeRaw`DELETE FROM "clicks" WHERE "creatorId" = ANY(${creatorIds}::uuid[])`;
    await prisma.$executeRaw`DELETE FROM "impressions" WHERE "creatorId" = ANY(${creatorIds}::uuid[])`;
  }

  await prisma.statHourly.deleteMany({ where: { campaign: { brandId: { in: brandIds } } } });
  await prisma.earning.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.conversion.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.ledgerAccount.deleteMany({
    where: { ownerId: { in: [...creatorIds, ...brandIds] } },
  });
  await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// ---------------------------------------------------------------------------

async function seedTermsVersions(): Promise<void> {
  const kinds = [
    { kind: 'TERMS_OF_SERVICE' as const, title: 'Terms of Service' },
    { kind: 'PRIVACY_POLICY' as const, title: 'Privacy Policy' },
    { kind: 'CREATOR_AGREEMENT' as const, title: 'Creator Agreement' },
    { kind: 'BRAND_AGREEMENT' as const, title: 'Brand Agreement' },
    { kind: 'ACCEPTABLE_USE' as const, title: 'Acceptable Use Policy' },
  ];

  for (const entry of kinds) {
    await prisma.termsVersion.upsert({
      where: { kind_version: { kind: entry.kind, version: 1 } },
      create: {
        kind: entry.kind,
        version: 1,
        title: entry.title,
        body: `See /legal for the current ${entry.title}.`,
      },
      update: {},
    });
  }
  console.log('  Terms versions ready');
}

async function seedAdmin() {
  const email = `admin@${SEED_DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash: await hashPassword('DevPassword123!'),
      role: 'ADMIN',
      name: 'Platform Admin',
      emailVerifiedAt: new Date(),
    },
  });
  console.log('  Admin account created');
  return user;
}

const BRAND_FIXTURES = [
  {
    name: 'Everyday Athletic',
    legal: 'Everyday Athletic LLC',
    category: 'fitness',
    site: 'https://everydayathletic.example.com',
    about: 'Direct-to-consumer performance activewear.',
  },
  {
    name: 'Northwind Coffee',
    legal: 'Northwind Coffee Roasters Inc.',
    category: 'food',
    site: 'https://northwindcoffee.example.com',
    about: 'Single-origin coffee subscriptions.',
  },
  {
    name: 'Ledgerly',
    legal: 'Ledgerly Software Inc.',
    category: 'saas',
    site: 'https://ledgerly.example.com',
    about: 'Bookkeeping software for freelancers.',
  },
  {
    name: 'Bright Home',
    legal: 'Bright Home Goods Ltd.',
    category: 'home',
    site: 'https://brighthome.example.com',
    about: 'Sustainable homeware and lighting.',
  },
  {
    name: 'Trailhead Outdoors',
    legal: 'Trailhead Outdoors Co.',
    category: 'travel',
    site: 'https://trailhead.example.com',
    about: 'Hiking and camping gear.',
  },
];

async function seedBrands() {
  const results = [];

  for (const [index, fixture] of BRAND_FIXTURES.entries()) {
    const email = `brand${index + 1}@${SEED_DOMAIN}`;
    const owner = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        passwordHash: await hashPassword('DevPassword123!'),
        role: 'BRAND_OWNER',
        name: `${fixture.name} Owner`,
        emailVerifiedAt: new Date(),
      },
    });

    const brand = await prisma.brand.create({
      data: {
        slug: slug(fixture.name),
        legalName: fixture.legal,
        displayName: fixture.name,
        website: fixture.site,
        category: fixture.category,
        country: 'US',
        contactEmail: email,
        description: fixture.about,
        // Most verified, one pending so the admin queue is not empty.
        verification: index === 4 ? 'PENDING' : 'VERIFIED',
        verifiedAt: index === 4 ? null : new Date(),
        members: { create: { userId: owner.id, role: 'BRAND_OWNER' } },
      },
    });

    results.push({ brand, owner, fixture });
  }

  console.log(`  ${results.length} brands created`);
  return results;
}

const CREATOR_FIXTURES = [
  ['Maya Chen', 'CREATOR', ['TIKTOK', 'INSTAGRAM'], ['fitness', 'fashion']],
  ['The Weekly Brew', 'NEWSLETTER', ['NEWSLETTER'], ['food']],
  ['Dev Ledger', 'BLOG', ['WEBSITE', 'BLOG'], ['saas', 'b2b-services']],
  ['Trail Notes', 'PODCAST', ['PODCAST'], ['travel']],
  ['Home Reset', 'YOUTUBE', ['YOUTUBE'], ['home']],
  ['Budget Runner', 'CREATOR', ['TIKTOK', 'YOUTUBE'], ['fitness', 'finance']],
  ['Kitchen Table Finance', 'NEWSLETTER', ['NEWSLETTER', 'X'], ['finance']],
  ['Gear Lab', 'WEBSITE', ['WEBSITE'], ['travel', 'fitness']],
  ['Morning Pour', 'INSTAGRAM', ['INSTAGRAM'], ['food']],
  ['SaaS Notes', 'NEWSLETTER', ['NEWSLETTER'], ['saas']],
  ['Fit After Forty', 'CREATOR', ['YOUTUBE', 'FACEBOOK'], ['fitness', 'health']],
  ['The Sunday Kitchen', 'BLOG', ['BLOG', 'PINTEREST'], ['food']],
  ['Remote Stack', 'COMMUNITY', ['COMMUNITY'], ['saas']],
  ['Weekend Projects', 'YOUTUBE', ['YOUTUBE'], ['home']],
  ['Path & Peak', 'CREATOR', ['INSTAGRAM', 'TIKTOK'], ['travel']],
  ['Ledger Lines', 'BLOG', ['BLOG'], ['finance', 'saas']],
  ['Brew Method', 'CREATOR', ['TIKTOK'], ['food']],
  ['Home Signal', 'NEWSLETTER', ['NEWSLETTER'], ['home']],
  ['Strength Basics', 'CREATOR', ['YOUTUBE'], ['fitness']],
  ['Nomad Desk', 'COMMUNITY', ['COMMUNITY', 'X'], ['travel', 'saas']],
] as const;

async function seedCreators() {
  const results: Array<{ creator: Creator; user: { id: string; email: string } }> = [];

  for (const [index, [name, type, channels, categories]] of CREATOR_FIXTURES.entries()) {
    const email = `creator${index + 1}@${SEED_DOMAIN}`;
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        passwordHash: await hashPassword('DevPassword123!'),
        role: 'CREATOR',
        name,
        emailVerifiedAt: new Date(),
      },
    });

    const creator = await prisma.creator.create({
      data: {
        userId: user.id,
        handle: slug(name, false),
        publisherType: type,
        country: 'US',
        // A mix so payout gating is visible in development.
        verification: index < 15 ? 'VERIFIED' : 'UNVERIFIED',
        stripePayoutsEnabled: index < 12,
        taxFormStatus: index < 12 ? 'verified' : null,
        stripeAccountId: index < 12 ? `acct_seed_${index}` : null,
        profile: {
          create: {
            displayName: name,
            bio: `${name} publishes for an audience interested in ${categories.join(' and ')}.`,
            categories: [...categories],
            channels: [...channels] as never,
            audienceCountries: ['US', 'CA', 'GB'],
          },
        },
      },
    });

    results.push({ creator, user: { id: user.id, email } });
  }

  console.log(`  ${results.length} publishers created`);
  return results;
}

const CAMPAIGN_FIXTURES: Array<{
  brand: number;
  name: string;
  model: PayoutModel;
  payout: string;
  revshare?: number;
  objective: string;
  approval?: boolean;
  status?: 'ACTIVE' | 'PENDING_REVIEW' | 'PAUSED' | 'DRAFT';
}> = [
  { brand: 0, name: 'Spring Drop — Performance Tees', model: 'CPC', payout: '0.35', objective: 'traffic' },
  { brand: 0, name: 'Everyday Athletic — First Order', model: 'CPA', payout: '18.00', objective: 'sales' },
  { brand: 0, name: 'Activewear Revenue Share', model: 'REVSHARE', payout: '0', revshare: 1200, objective: 'sales' },
  { brand: 1, name: 'Coffee Subscription Trial', model: 'CPL', payout: '9.50', objective: 'leads' },
  { brand: 1, name: 'Northwind — Bag Sales', model: 'CPA', payout: '12.00', objective: 'sales' },
  { brand: 2, name: 'Ledgerly Free Trial', model: 'CPL', payout: '22.00', objective: 'leads', approval: true },
  { brand: 2, name: 'Ledgerly Annual Plan', model: 'CPA', payout: '85.00', objective: 'sales', approval: true },
  { brand: 2, name: 'Ledgerly Awareness', model: 'CPM', payout: '6.50', objective: 'awareness' },
  { brand: 3, name: 'Bright Home — Lighting', model: 'CPC', payout: '0.28', objective: 'traffic' },
  { brand: 3, name: 'Bright Home Hybrid', model: 'HYBRID', payout: '0.12', revshare: 500, objective: 'sales' },
  { brand: 3, name: 'Homeware Clearance', model: 'CPA', payout: '9.00', objective: 'sales', status: 'PAUSED' },
  { brand: 4, name: 'Trailhead — Hiking Boots', model: 'CPA', payout: '25.00', objective: 'sales', status: 'PENDING_REVIEW' },
  { brand: 4, name: 'Trailhead Gear Guide', model: 'CPC', payout: '0.42', objective: 'traffic', status: 'PENDING_REVIEW' },
  { brand: 0, name: 'Summer Preview (draft)', model: 'CPC', payout: '0.30', objective: 'traffic', status: 'DRAFT' },
  { brand: 1, name: 'Northwind Awareness', model: 'CPM', payout: '4.75', objective: 'awareness' },
];

async function seedCampaigns(brands: Awaited<ReturnType<typeof seedBrands>>) {
  const campaigns: Campaign[] = [];

  for (const fixture of CAMPAIGN_FIXTURES) {
    const entry = brands[fixture.brand];
    if (!entry) continue;

    const campaign = await prisma.campaign.create({
      data: {
        brandId: entry.brand.id,
        slug: slug(fixture.name),
        name: fixture.name,
        objective: fixture.objective,
        category: entry.fixture.category,
        description: `${SEED_MARKER} ${entry.fixture.about} This campaign pays publishers for ${fixture.objective}. Traffic must come from the channels listed as allowed, and conversions are verified against our order system before approval.`,
        offerSummary: `Earn on qualified ${fixture.objective} for ${entry.fixture.name}.`,
        destinationUrl: `${entry.fixture.site}/offer`,
        status: fixture.status ?? 'ACTIVE',
        payoutModel: fixture.model,
        payoutMicros: parseAmount(fixture.payout),
        revshareBps: fixture.revshare ?? 0,
        requiresApproval: fixture.approval ?? false,
        attributionWindowHours: 720,
        cookieDurationHours: 720,
        dedupeWindowMinutes: 1440,
        allowedCountries: ['US', 'CA', 'GB'],
        prohibitedChannels: ['PAID_SEARCH'] as never,
        conversionRules:
          'A completed order over $20 that is not cancelled or refunded within 30 days.',
        disclosureRequirement: 'Posts must carry a visible sponsorship or affiliate disclosure.',
        termsBody: `${SEED_MARKER} Standard campaign terms. You earn on qualified activity only. Prohibited: spam, misleading claims, incentivised traffic, bot traffic, and bidding on brand terms in paid search.`,
        termsVersion: 1,
        launchedAt: fixture.status === 'DRAFT' || fixture.status === 'PENDING_REVIEW' ? null : daysAgo(30),
        budget: {
          create: {
            totalBudgetMicros: parseAmount('10000'),
            lowBalanceBps: 1500,
          },
        },
        rules: {
          create: [
            { kind: 'PROHIBITED', label: 'spam' },
            { kind: 'PROHIBITED', label: 'misleading' },
            { kind: 'PROHIBITED', label: 'incentivised' },
          ],
        },
      },
    });
    campaigns.push(campaign);
  }

  console.log(`  ${campaigns.length} campaigns created`);
  return campaigns;
}

/** Funds campaigns through the real ledger path, so balances are consistent. */
async function fundCampaigns(
  brands: Awaited<ReturnType<typeof seedBrands>>,
  campaigns: Campaign[],
): Promise<void> {
  const { accounts, post } = await import('../src/lib/billing/ledger');
  const budget = await import('../src/lib/billing/budget');

  for (const campaign of campaigns) {
    if (campaign.status === 'DRAFT') continue;
    const amount = parseAmount('5000');

    await prisma.$transaction(async (tx) => {
      await post(tx, {
        kind: 'BRAND_DEPOSIT',
        idempotencyKey: `seed:deposit:${campaign.id}`,
        description: `${SEED_MARKER} Seed deposit`,
        lines: [
          { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: amount },
          { account: accounts.brandDeposit(campaign.brandId), direction: 'CREDIT', amountMicros: amount },
        ],
      });
      await budget.fundCampaign(tx, {
        campaignId: campaign.id,
        brandId: campaign.brandId,
        amountMicros: amount,
        idempotencyKey: `seed:fund:${campaign.id}`,
        reason: 'Seed funding',
      });
    });
  }

  void brands;
  console.log(`  Campaigns funded through the ledger`);
}

async function seedLinks(
  campaigns: Campaign[],
  creators: Awaited<ReturnType<typeof seedCreators>>,
) {
  const links = [];
  const active = campaigns.filter((c) => c.status === 'ACTIVE');

  for (const campaign of active) {
    // Each active campaign gets links from a rotating subset of publishers.
    const participants = creators.filter((_, index) => (index + campaigns.indexOf(campaign)) % 3 === 0);

    for (const { creator } of participants) {
      const link = await prisma.trackingLink.create({
        data: {
          code: trackingCode(),
          campaignId: campaign.id,
          creatorId: creator.id,
          subId: Math.random() > 0.6 ? `post-${Math.floor(Math.random() * 50)}` : null,
          termsVersion: 1,
          termsAcceptedAt: daysAgo(Math.floor(Math.random() * 25) + 1),
        },
      });
      links.push({ link, campaign, creatorId: creator.id });
    }
  }

  console.log(`  ${links.length} tracking links created`);
  return links;
}

/**
 * Generates realistic traffic through raw inserts rather than the redirect path,
 * because running thousands of requests through fraud scoring would take minutes
 * and the point is to populate dashboards, not to test the engine.
 */
async function seedTraffic(
  campaigns: Campaign[],
  creators: Awaited<ReturnType<typeof seedCreators>>,
  links: Awaited<ReturnType<typeof seedLinks>>,
): Promise<void> {
  const { accrue } = await import('../src/lib/billing/earnings');
  const { grossFromNet } = await import('../src/lib/billing/fees');

  const DEVICES = ['desktop', 'mobile', 'tablet'];
  const BROWSERS = ['Chrome', 'Safari', 'Firefox', 'Edge'];
  const COUNTRIES = ['US', 'US', 'US', 'CA', 'GB'];
  const REFERRERS = ['tiktok.com', 'youtube.com', 'instagram.com', 'google.com', null];

  let clickCount = 0;
  let earningCount = 0;
  let conversionCount = 0;

  for (const { link, campaign, creatorId } of links) {
    // Between 40 and 260 clicks per link, spread over 30 days.
    const total = 40 + Math.floor(Math.random() * 220);
    const clickRows: string[] = [];
    const values: unknown[] = [];
    let position = 1;

    for (let i = 0; i < total; i += 1) {
      const createdAt = daysAgo(Math.random() * 30);
      // Roughly 8% of traffic fails screening, which is realistic.
      const roll = Math.random();
      const eligibility = roll < 0.04 ? 'REJECTED' : roll < 0.08 ? 'DUPLICATE' : 'ELIGIBLE';
      const isBot = eligibility === 'REJECTED';
      const fraudScore = eligibility === 'ELIGIBLE' ? Math.floor(Math.random() * 20) : 60 + Math.floor(Math.random() * 40);
      const billable = eligibility === 'ELIGIBLE' && campaign.payoutModel === 'CPC';

      clickRows.push(
        `($${position++}::uuid, $${position++}, $${position++}::uuid, $${position++}::uuid, $${position++}::uuid, $${position++}::uuid, $${position++}, $${position++}, $${position++}, $${position++}, $${position++}, $${position++}, $${position++}, $${position++}, $${position++}, $${position++}::"ClickEligibility", $${position++}, $${position++})`,
      );
      values.push(
        randomUUID(),
        createdAt,
        link.id,
        campaign.id,
        creatorId,
        campaign.brandId,
        `seedhash${i}`,
        `seedprefix${i % 40}`,
        pick(COUNTRIES),
        pick(DEVICES),
        pick(BROWSERS),
        'macOS',
        isBot,
        pick(REFERRERS),
        link.subId,
        eligibility,
        billable,
        `seedfp${i % 120}`,
      );
    }

    if (clickRows.length > 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "clicks" (id, "createdAt", "linkId", "campaignId", "creatorId", "brandId",
           "ipHash", "ipPrefixHash", country, "deviceType", browser, os, "isBot",
           "referrerHost", "subId", eligibility, billable, "sessionFp")
         VALUES ${clickRows.join(', ')}`,
        ...values,
      );
      clickCount += clickRows.length;
    }

    // Earnings for CPC campaigns, through the real accrual path so the ledger
    // and budgets stay consistent.
    if (campaign.payoutModel === 'CPC') {
      const billableClicks = Math.min(Math.floor(total * 0.9), 60);
      const breakdown = grossFromNet(campaign.payoutMicros, {
        feeBps: 2000,
        flatMicros: 0n,
        source: 'platform',
      });

      // Each earning points at the click that produced it, exactly as the live
      // redirect path records it — that link is what per-link earnings read.
      const billableIds = (
        await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "clicks"
          WHERE "linkId" = ${link.id}::uuid AND billable = true
          -- Sampled at random rather than newest-first: earnings inherit the
          -- date of the click they came from, so taking the most recent ones
          -- would pile a month of earnings onto the last two days.
          ORDER BY random()
          LIMIT ${Math.max(billableClicks, 1)}
        `
      ).map((row) => row.id);

      for (let i = 0; i < billableClicks; i += 1) {
        const result = await accrue({
          creatorId,
          campaignId: campaign.id,
          eventType: 'CLICK',
          grossMicros: breakdown.grossMicros,
          feeMicros: breakdown.feeMicros,
          netMicros: breakdown.netMicros,
          idempotencyKey: `seed:click:${link.id}:${i}`,
          clickId: billableIds[i] ?? null,
        });
        if (result.ok) earningCount += 1;
        else break; // Budget exhausted — realistic, and worth showing.
      }
    }

    // Conversions for the other models.
    if (campaign.payoutModel !== 'CPC' && campaign.payoutModel !== 'CPM') {
      const conversions = Math.floor(total * (0.01 + Math.random() * 0.03));

      // Real conversions are attributed to a specific click, and the dashboards
      // read that attribution. Seeded ones borrow ids from the clicks just
      // inserted for this link so the figures add up the same way.
      const clickIds = (
        await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "clicks"
          WHERE "linkId" = ${link.id}::uuid
          ORDER BY random()
          LIMIT ${Math.max(conversions, 1)}
        `
      ).map((row) => row.id);

      for (let i = 0; i < conversions; i += 1) {
        const clickId = clickIds[i] ?? null;
        const revenue = parseAmount(String(40 + Math.floor(Math.random() * 200)));
        const payout =
          campaign.payoutModel === 'REVSHARE'
            ? (revenue * BigInt(campaign.revshareBps)) / 10_000n
            : campaign.payoutMicros;
        if (payout <= 0n) continue;

        const breakdown = grossFromNet(payout, { feeBps: 2000, flatMicros: 0n, source: 'platform' });
        const conversionId = randomUUID();

        await prisma.conversion.create({
          data: {
            id: conversionId,
            campaignId: campaign.id,
            creatorId,
            linkId: link.id,
            clickId,
            externalId: `seed-order-${link.id.slice(0, 8)}-${i}`,
            idempotencyKey: `seed:conv:${link.id}:${i}`,
            eventType: 'SALE',
            revenueMicros: revenue,
            payoutMicros: breakdown.netMicros,
            feeMicros: breakdown.feeMicros,
            status: Math.random() > 0.15 ? 'APPROVED' : 'PENDING',
            source: 's2s',
            createdAt: daysAgo(Math.random() * 30),
          },
        });

        const result = await accrue({
          creatorId,
          campaignId: campaign.id,
          eventType: 'SALE',
          grossMicros: breakdown.grossMicros,
          feeMicros: breakdown.feeMicros,
          netMicros: breakdown.netMicros,
          idempotencyKey: `seed:convearn:${link.id}:${i}`,
          conversionId,
          // The real conversion path records the click an earning came from;
          // seeded data has to as well, or the per-link figures on a publisher's
          // dashboard read zero against links that plainly earned.
          clickId,
        });
        if (result.ok) earningCount += 1;
        conversionCount += 1;
      }
    }
  }

  void campaigns;
  void creators;
  console.log(
    `  ${clickCount} clicks, ${conversionCount} conversions, ${earningCount} earnings generated`,
  );
}

/** Builds the hourly rollups so dashboards are populated immediately. */
async function seedRollups(): Promise<void> {
  // Earnings accrue through the real ledger path, which stamps them with the
  // moment they were posted — so every seeded earning would otherwise read
  // "a minute ago" and every chart would be one spike at the right edge. The
  // rows are dated to the click or conversion that produced them, which is what
  // a real month of activity looks like. Ledger transactions keep their true
  // timestamps: those are the append-only record and are not touched.
  await prisma.$executeRaw`
    UPDATE "earnings" e
    SET "createdAt" = c."createdAt"
    FROM "clicks" c
    WHERE c.id = e."clickId"
  `;
  await prisma.$executeRaw`
    UPDATE "earnings" e
    SET "createdAt" = v."createdAt"
    FROM "conversions" v
    WHERE v.id = e."conversionId" AND e."clickId" IS NULL
  `;

  const { backfill } = await import('../src/lib/analytics/rollup');
  const rows = await backfill(new Date(Date.now() - 31 * 86_400_000), new Date());
  console.log(`  ${rows} rollup rows built`);
}

// ---------------------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
  const { hashPassword: hash } = await import('../src/lib/crypto/hash');
  return hash(password);
}

function slug(input: string, withSuffix = true): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return withSuffix ? `${base}-${Math.random().toString(36).slice(2, 7)}` : base;
}

function trackingCode(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return Array.from({ length: 10 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function parseAmount(value: string): bigint {
  const [whole = '0', frac = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0').slice(0, 6) || '0');
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
