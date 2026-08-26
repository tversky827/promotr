import { hashPassword } from '@/lib/crypto/hash';
import { generateTrackingCode, slugify } from '@/lib/crypto/ids';
import { testDb } from './db';

import type { Campaign, Creator, PayoutModel, User } from '@prisma/client';

/**
 * Test data builders. Each returns fully-formed, valid records so a test only
 * has to state what it actually cares about.
 */

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter += 1)}`;

export async function createUser(
  overrides: Partial<{ email: string; role: User['role']; password: string; status: User['status'] }> = {},
): Promise<User> {
  const email = overrides.email ?? `user-${uniq()}@example.test`;
  return testDb.user.create({
    data: {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: await hashPassword(overrides.password ?? 'CorrectHorseBattery9!'),
      role: overrides.role ?? 'CREATOR',
      status: overrides.status ?? 'ACTIVE',
      name: 'Test User',
      emailVerifiedAt: new Date(),
    },
  });
}

export async function createBrand(overrides: Partial<{ defaultFeeBps: number | null; verification: 'VERIFIED' | 'UNVERIFIED' }> = {}) {
  const owner = await createUser({ role: 'BRAND_OWNER' });
  const brand = await testDb.brand.create({
    data: {
      slug: slugify('Test Brand'),
      legalName: 'Test Brand LLC',
      displayName: 'Test Brand',
      website: 'https://brand.example.com',
      category: 'ecommerce',
      country: 'US',
      contactEmail: owner.email,
      verification: overrides.verification ?? 'VERIFIED',
      verifiedAt: new Date(),
      defaultFeeBps: overrides.defaultFeeBps ?? null,
      members: { create: { userId: owner.id, role: 'BRAND_OWNER' } },
    },
  });
  return { brand, owner };
}

export async function createCreator(
  overrides: Partial<{ verification: Creator['verification']; feeBpsOverride: number | null; payoutHold: boolean }> = {},
): Promise<{ creator: Creator; user: User }> {
  const user = await createUser({ role: 'CREATOR' });
  const creator = await testDb.creator.create({
    data: {
      userId: user.id,
      handle: `pub-${uniq()}`,
      verification: overrides.verification ?? 'VERIFIED',
      country: 'US',
      feeBpsOverride: overrides.feeBpsOverride ?? null,
      payoutHold: overrides.payoutHold ?? false,
      stripePayoutsEnabled: true,
      taxFormStatus: 'verified',
      profile: {
        create: { displayName: 'Test Publisher', isPublic: true, categories: ['tech'] },
      },
    },
  });
  return { creator, user };
}

export async function createCampaign(
  brandId: string,
  overrides: Partial<{
    payoutModel: PayoutModel;
    payoutMicros: bigint;
    revshareBps: number;
    status: Campaign['status'];
    fundedMicros: bigint;
    platformFeeBps: number | null;
    requiresApproval: boolean;
    allowedCountries: string[];
  }> = {},
): Promise<Campaign> {
  const campaign = await testDb.campaign.create({
    data: {
      brandId,
      slug: slugify('Test Campaign'),
      name: 'Test Campaign',
      objective: 'traffic',
      category: 'ecommerce',
      description: 'A campaign used in tests.',
      offerSummary: 'Drive qualified traffic.',
      destinationUrl: 'https://brand.example.com/landing',
      status: overrides.status ?? 'ACTIVE',
      payoutModel: overrides.payoutModel ?? 'CPC',
      payoutMicros: overrides.payoutMicros ?? 200_000n, // $0.20
      revshareBps: overrides.revshareBps ?? 0,
      platformFeeBps: overrides.platformFeeBps ?? null,
      requiresApproval: overrides.requiresApproval ?? false,
      allowedCountries: overrides.allowedCountries ?? [],
      termsBody: 'Test campaign terms.',
      termsVersion: 1,
      launchedAt: new Date(),
      budget: {
        create: {
          totalBudgetMicros: overrides.fundedMicros ?? 1_000_000_000n,
          fundedMicros: 0n,
        },
      },
    },
  });
  return campaign;
}

export async function createTrackingLink(campaignId: string, creatorId: string) {
  return testDb.trackingLink.create({
    data: {
      code: generateTrackingCode(),
      campaignId,
      creatorId,
      termsVersion: 1,
      termsAcceptedAt: new Date(),
    },
  });
}
