'use server';

import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth/guards';
import { slugify } from '@/lib/crypto/ids';
import { encryptSecret } from '@/lib/crypto/secretbox';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { notifyAdmins } from '@/lib/notify';

import { action, actionError, actionOk, stringArraySchema } from './shared';

/**
 * Onboarding.
 *
 * Collects the minimum needed to participate, and nothing more. A brand needs a
 * legal identity because money moves to publishers on its behalf; a publisher
 * needs a display name and a country. Everything else is optional and can be
 * filled in later from the profile page.
 */

const brandSchema = z.object({
  legalName: z.string().trim().min(2, 'Enter the registered business name').max(200),
  displayName: z.string().trim().min(2, 'Enter a public brand name').max(120),
  website: z
    .string()
    .trim()
    .min(1, 'Enter your website')
    .max(300)
    .refine((v) => /^https?:\/\/[^\s.]+\.[^\s]+$/.test(v), 'Enter a full URL starting with https://'),
  category: z.string().trim().min(1, 'Choose a category').max(60),
  country: z.string().trim().length(2, 'Use a two-letter country code'),
  contactEmail: z.string().trim().email('Enter a valid contact email'),
  contactPhone: z.string().trim().max(40).optional().or(z.literal('')),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  addressLine1: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(100).optional().or(z.literal('')),
  region: z.string().trim().max(100).optional().or(z.literal('')),
  postalCode: z.string().trim().max(20).optional().or(z.literal('')),
  taxId: z.string().trim().max(60).optional().or(z.literal('')),
});

export const createBrandProfile = action(brandSchema, async (input, context) => {
  const session = await requireSession();

  const existing = await prisma.brandMember.findFirst({
    where: { userId: session.user.id },
    select: { brandId: true },
  });
  if (existing) {
    return actionOk({ brandId: existing.brandId }, 'You already belong to a brand.');
  }

  const brandRecord = await prisma.brand.create({
    data: {
      slug: slugify(input.displayName),
      legalName: input.legalName,
      displayName: input.displayName,
      website: input.website,
      category: input.category,
      country: input.country.toUpperCase(),
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone || null,
      description: input.description || null,
      addressLine1: input.addressLine1 || null,
      city: input.city || null,
      region: input.region || null,
      postalCode: input.postalCode || null,
      // Tax identifiers are encrypted at rest and never rendered back in full.
      taxId: input.taxId ? encryptSecret(input.taxId) : null,
      verification: 'PENDING',
      members: { create: { userId: session.user.id, role: 'BRAND_OWNER' } },
    },
  });

  // A user who signed up as a creator but is creating a brand gets the right role.
  if (session.user.role === 'CREATOR') {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { role: 'BRAND_OWNER' },
    });
  }

  await notifyAdmins({
    type: 'generic',
    title: 'A brand needs verification',
    body: `${brandRecord.displayName} (${brandRecord.legalName}) completed onboarding.`,
    actionPath: `/admin/brands/${brandRecord.id}`,
    email: false,
  });

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'BRAND_OWNER',
    actorIp: context.ip,
    action: 'brand.created',
    entityKind: 'brand',
    entityId: brandRecord.id,
  });

  logger.info('brand.created', { brandId: brandRecord.id, userId: session.user.id });
  return actionOk({ brandId: brandRecord.id }, 'Brand profile created.');
});

const creatorSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter a display name').max(80),
  handle: z
    .string()
    .trim()
    .min(3, 'Handles need at least 3 characters')
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Use lowercase letters, numbers and dashes only'),
  publisherType: z.enum([
    'CREATOR', 'WEBSITE', 'NEWSLETTER', 'COMMUNITY', 'APP', 'PODCAST', 'MEDIA_COMPANY',
  ]),
  country: z.string().trim().length(2, 'Use a two-letter country code'),
  channels: stringArraySchema,
  categories: stringArraySchema,
  bio: z.string().trim().max(1000).optional().or(z.literal('')),
  website: z.string().trim().max(300).optional().or(z.literal('')),
});

export const createCreatorProfile = action(creatorSchema, async (input, context) => {
  const session = await requireSession();

  const existing = await prisma.creator.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  const taken = await prisma.creator.findUnique({
    where: { handle: input.handle },
    select: { id: true },
  });
  if (taken && taken.id !== existing?.id) {
    return actionError('That handle is already taken.', { handle: 'Already taken' });
  }

  if (existing) {
    await prisma.$transaction([
      prisma.creator.update({
        where: { id: existing.id },
        data: {
          handle: input.handle,
          publisherType: input.publisherType,
          country: input.country.toUpperCase(),
        },
      }),
      prisma.creatorProfile.upsert({
        where: { creatorId: existing.id },
        create: {
          creatorId: existing.id,
          displayName: input.displayName,
          bio: input.bio || null,
          website: input.website || null,
          categories: input.categories,
          channels: input.channels as never,
        },
        update: {
          displayName: input.displayName,
          bio: input.bio || null,
          website: input.website || null,
          categories: input.categories,
          channels: input.channels as never,
        },
      }),
    ]);

    return actionOk({ creatorId: existing.id }, 'Profile saved.');
  }

  const creator = await prisma.creator.create({
    data: {
      userId: session.user.id,
      handle: input.handle,
      publisherType: input.publisherType,
      country: input.country.toUpperCase(),
      profile: {
        create: {
          displayName: input.displayName,
          bio: input.bio || null,
          website: input.website || null,
          categories: input.categories,
          channels: input.channels as never,
        },
      },
    },
  });

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'CREATOR',
    actorIp: context.ip,
    action: 'creator.created',
    entityKind: 'creator',
    entityId: creator.id,
  });

  logger.info('creator.created', { creatorId: creator.id, userId: session.user.id });
  return actionOk({ creatorId: creator.id }, 'Profile created.');
});

/** Suggests an available handle from a display name. */
export async function suggestHandle(displayName: string): Promise<string> {
  const base = slugify(displayName, 0);
  const taken = await prisma.creator.findUnique({ where: { handle: base }, select: { id: true } });
  return taken ? slugify(displayName, 4) : base;
}
