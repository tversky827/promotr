import { accounts, post } from '@/lib/billing/ledger';
import * as budget from '@/lib/billing/budget';
import { createApiKey } from '@/lib/api/apikey';
import { generateTrackingCode, slugify } from '@/lib/crypto/ids';
import { hashPassword } from '@/lib/crypto/hash';
import { prisma } from '@/lib/db';

/**
 * Builds a complete, funded campaign with a publisher link and a live API key.
 * Used by the end-to-end HTTP test to exercise the real request path.
 */
export async function seedLoop(fundMicros = 100_000_000n) {
  const stamp = Date.now().toString(36);

  const owner = await prisma.user.create({
    data: {
      email: `brand-${stamp}@example.test`,
      emailNormalized: `brand-${stamp}@example.test`,
      passwordHash: await hashPassword('CorrectHorseBattery9!'),
      role: 'BRAND_OWNER',
      name: 'Loop Brand Owner',
      emailVerifiedAt: new Date(),
    },
  });

  const brandRecord = await prisma.brand.create({
    data: {
      slug: slugify('Loop Brand'),
      legalName: 'Loop Brand LLC',
      displayName: 'Loop Brand',
      website: 'https://example.com',
      category: 'ecommerce',
      country: 'US',
      contactEmail: owner.email,
      verification: 'VERIFIED',
      verifiedAt: new Date(),
      members: { create: { userId: owner.id, role: 'BRAND_OWNER' } },
    },
  });

  const creatorUser = await prisma.user.create({
    data: {
      email: `pub-${stamp}@example.test`,
      emailNormalized: `pub-${stamp}@example.test`,
      passwordHash: await hashPassword('CorrectHorseBattery9!'),
      role: 'CREATOR',
      name: 'Loop Publisher',
      emailVerifiedAt: new Date(),
    },
  });

  const creator = await prisma.creator.create({
    data: {
      userId: creatorUser.id,
      handle: `loop-${stamp}`,
      verification: 'VERIFIED',
      country: 'US',
      profile: { create: { displayName: 'Loop Publisher' } },
    },
  });

  const campaign = await prisma.campaign.create({
    data: {
      brandId: brandRecord.id,
      slug: slugify('Loop Campaign'),
      name: 'Loop Campaign',
      objective: 'sales',
      category: 'ecommerce',
      description: 'End-to-end loop campaign.',
      offerSummary: 'Drive sales.',
      destinationUrl: 'https://example.com/landing',
      status: 'ACTIVE',
      payoutModel: 'CPA',
      payoutMicros: 10_000_000n, // $10 per sale
      termsBody: 'Loop campaign terms.',
      launchedAt: new Date(),
      budget: { create: { totalBudgetMicros: fundMicros, fundedMicros: 0n } },
    },
  });

  await prisma.$transaction(async (tx) => {
    await post(tx, {
      kind: 'BRAND_DEPOSIT',
      idempotencyKey: `loop-dep-${stamp}`,
      description: 'Loop deposit',
      lines: [
        { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: fundMicros },
        { account: accounts.brandDeposit(brandRecord.id), direction: 'CREDIT', amountMicros: fundMicros },
      ],
    });
    await budget.fundCampaign(tx, {
      campaignId: campaign.id,
      brandId: brandRecord.id,
      amountMicros: fundMicros,
      idempotencyKey: `loop-fund-${stamp}`,
    });
  });

  const link = await prisma.trackingLink.create({
    data: {
      code: generateTrackingCode(),
      campaignId: campaign.id,
      creatorId: creator.id,
      termsVersion: 1,
      termsAcceptedAt: new Date(),
    },
  });

  const apiKey = await createApiKey({
    brandId: brandRecord.id,
    name: 'Loop test key',
    scopes: ['conversions:write', 'campaigns:read'],
  });

  return { owner, brand: brandRecord, creatorUser, creator, campaign, link, apiKey };
}
