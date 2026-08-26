'use server';

import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requireBrand } from '@/lib/auth/guards';
import { createApiKey, revokeApiKey, API_SCOPES, type ApiScope } from '@/lib/api/apikey';
import { prisma } from '@/lib/db';
import { requestVerification, verifyDomain } from '@/lib/domains';
import { logger } from '@/lib/observability/logger';
import { enforceRateLimit } from '@/lib/ratelimit';
import { createEndpoint, redeliver, revealSecret, WEBHOOK_EVENTS } from '@/lib/webhooks/outbound';

import { action, actionError, actionOk, stringArraySchema } from './shared';

/**
 * Brand account management: profile, team, destination domains, API keys and
 * webhook endpoints.
 *
 * Two rules run through all of it. Authorisation is the RBAC permission the
 * guard is given, never a role compared inline — a member holds `brand:read`
 * and can see these screens, but only an owner holds `brand:apikeys:manage`,
 * so only an owner can mint a key. And an API key is shown exactly once, at
 * the moment it is created: only its hash is stored, so "show me the key
 * again" is a request we cannot serve.
 */

const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter a public brand name').max(120),
  legalName: z.string().trim().min(2, 'Enter the registered business name').max(200),
  website: z
    .string()
    .trim()
    .min(1, 'Enter your website')
    .max(300)
    .refine((v) => /^https?:\/\/[^\s.]+\.[^\s]+$/.test(v), 'Enter a full URL starting with https://'),
  category: z.string().trim().min(1, 'Choose a category').max(60),
  contactEmail: z.string().trim().email('Enter a valid contact email'),
  contactPhone: z.string().trim().max(40).optional().or(z.literal('')),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  addressLine1: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(100).optional().or(z.literal('')),
  region: z.string().trim().max(100).optional().or(z.literal('')),
  postalCode: z.string().trim().max(20).optional().or(z.literal('')),
});

export const updateBrandProfile = action(profileSchema, async (input, context) => {
  const { brand, user } = await requireBrand('brand:update');

  const before = {
    displayName: brand.displayName,
    legalName: brand.legalName,
    website: brand.website,
    contactEmail: brand.contactEmail,
  };

  await prisma.brand.update({
    where: { id: brand.id },
    data: {
      displayName: input.displayName,
      legalName: input.legalName,
      website: input.website,
      category: input.category,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone || null,
      description: input.description || null,
      addressLine1: input.addressLine1 || null,
      city: input.city || null,
      region: input.region || null,
      postalCode: input.postalCode || null,
    },
  });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'brand.profile_updated',
    entityKind: 'brand',
    entityId: brand.id,
    before,
    after: {
      displayName: input.displayName,
      legalName: input.legalName,
      website: input.website,
      contactEmail: input.contactEmail,
    },
  });

  // A verified brand that changes its legal identity is no longer the entity
  // that was verified, so verification is withdrawn rather than carried over.
  if (brand.verification === 'VERIFIED' && input.legalName !== brand.legalName) {
    await prisma.brand.update({
      where: { id: brand.id },
      data: { verification: 'PENDING', verifiedAt: null },
    });
    return actionOk(
      undefined,
      'Details saved. Because the legal name changed, your account returns to pending verification.',
    );
  }

  return actionOk(undefined, 'Details saved.');
});

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

const memberSchema = z.object({
  email: z.string().trim().email('Enter the email address of an existing account'),
  role: z.enum(['BRAND_OWNER', 'BRAND_MEMBER']),
});

/**
 * Adds a colleague to the brand.
 *
 * Deliberately requires them to have an account already. Creating one on their
 * behalf would mean provisioning a credential for someone who has not agreed to
 * the terms, and an invitation flow that emails a signup link is not something
 * to fake with a button that quietly does nothing.
 */
export const addBrandMember = action(memberSchema, async (input, context) => {
  const { brand, user } = await requireBrand('brand:members:manage');

  const invitee = await prisma.user.findUnique({
    where: { emailNormalized: input.email.toLowerCase() },
    select: { id: true, name: true, role: true, status: true },
  });

  if (!invitee) {
    return actionError(
      `No account exists for ${input.email}. Ask them to sign up first, then add them here.`,
      { email: 'No account with this email' },
    );
  }
  if (invitee.status !== 'ACTIVE') {
    return actionError('That account is not active.');
  }
  if (invitee.role === 'CREATOR' || invitee.role === 'ADMIN') {
    return actionError(
      'That account is registered as a publisher or an administrator, so it cannot also act for a brand.',
    );
  }

  const existing = await prisma.brandMember.findFirst({
    where: { userId: invitee.id },
    select: { brandId: true },
  });
  if (existing && existing.brandId !== brand.id) {
    return actionError('That account already belongs to another brand.');
  }
  if (existing) {
    return actionError('They are already on your team.');
  }

  await prisma.$transaction([
    prisma.brandMember.create({
      data: { brandId: brand.id, userId: invitee.id, role: input.role },
    }),
    prisma.user.update({ where: { id: invitee.id }, data: { role: input.role } }),
  ]);

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'brand.member_added',
    entityKind: 'brand',
    entityId: brand.id,
    metadata: { memberUserId: invitee.id, role: input.role },
  });

  return actionOk(undefined, `${invitee.name} now has access to this brand.`);
});

const removeMemberSchema = z.object({ userId: z.string().uuid() });

export const removeBrandMember = action(removeMemberSchema, async (input, context) => {
  const { brand, user } = await requireBrand('brand:members:manage');
  if (input.userId === user.id) {
    return actionError('You cannot remove yourself from your own brand.');
  }

  const owners = await prisma.brandMember.count({
    where: { brandId: brand.id, role: 'BRAND_OWNER' },
  });
  const target = await prisma.brandMember.findUnique({
    where: { brandId_userId: { brandId: brand.id, userId: input.userId } },
    select: { role: true },
  });
  if (!target) return actionError('They are not on your team.');
  if (target.role === 'BRAND_OWNER' && owners <= 1) {
    return actionError('A brand must keep at least one owner.');
  }

  await prisma.brandMember.delete({
    where: { brandId_userId: { brandId: brand.id, userId: input.userId } },
  });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'brand.member_removed',
    entityKind: 'brand',
    entityId: brand.id,
    metadata: { memberUserId: input.userId },
  });

  return actionOk(undefined, 'Access removed.');
});

// ---------------------------------------------------------------------------
// Destination domains
// ---------------------------------------------------------------------------

const domainSchema = z.object({
  domain: z.string().trim().min(3, 'Enter the domain your campaigns send traffic to').max(253),
});

export const addBrandDomain = action(domainSchema, async (input, context) => {
  const { brand, user } = await requireBrand('brand:update');

  const result = await requestVerification({ brandId: brand.id, domain: input.domain });
  if ('error' in result) return actionError(result.error, { domain: result.error });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'brand.domain_requested',
    entityKind: 'brand',
    entityId: brand.id,
    metadata: { domain: input.domain },
  });

  return actionOk(
    { recordName: result.recordName, recordValue: result.recordValue },
    'Add the TXT record below to your DNS, then check it here.',
  );
});

const domainIdSchema = z.object({ domainId: z.string().uuid() });

export const checkBrandDomain = action(domainIdSchema, async (input) => {
  const { brand } = await requireBrand('brand:update');
  await enforceRateLimit('domainCheck', brand.id);

  const owned = await prisma.verifiedDomain.count({
    where: { id: input.domainId, brandId: brand.id },
  });
  if (owned === 0) return actionError('That domain was not found on your account.');

  const result = await verifyDomain(input.domainId);
  return result.verified
    ? actionOk(undefined, 'Domain verified.')
    : actionError(result.reason ?? 'The DNS record was not found yet.');
});

export const removeBrandDomain = action(domainIdSchema, async (input) => {
  const { brand } = await requireBrand('brand:update');
  const deleted = await prisma.verifiedDomain.deleteMany({
    where: { id: input.domainId, brandId: brand.id },
  });
  return deleted.count > 0
    ? actionOk(undefined, 'Domain removed.')
    : actionError('That domain was not found on your account.');
});

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

const apiKeySchema = z.object({
  name: z.string().trim().min(2, 'Name this key so you know where it is used').max(80),
  scopes: stringArraySchema,
});

export const issueApiKey = action(apiKeySchema, async (input, context) => {
  const { brand, user } = await requireBrand('brand:apikeys:manage');

  const scopes = input.scopes.filter((scope): scope is ApiScope =>
    (API_SCOPES as readonly string[]).includes(scope),
  );
  if (scopes.length === 0) {
    return actionError('Choose at least one scope.', { scopes: 'Choose at least one scope' });
  }

  const active = await prisma.apiKey.count({ where: { brandId: brand.id, revokedAt: null } });
  if (active >= 20) {
    return actionError('You already have 20 active keys. Revoke one before issuing another.');
  }

  const created = await createApiKey({ brandId: brand.id, name: input.name, scopes });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'brand.api_key_issued',
    entityKind: 'api_key',
    entityId: created.id,
    metadata: { brandId: brand.id, name: input.name, scopes },
  });

  // The only time this value exists outside a hash.
  return actionOk(
    { key: created.key, prefix: created.prefix },
    'Key created. Copy it now — it is not shown again.',
  );
});

const apiKeyIdSchema = z.object({ apiKeyId: z.string().uuid() });

export const revokeBrandApiKey = action(apiKeyIdSchema, async (input, context) => {
  const { brand, user } = await requireBrand('brand:apikeys:manage');

  const revoked = await revokeApiKey(brand.id, input.apiKeyId);
  if (!revoked) return actionError('That key was not found, or is already revoked.');

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'brand.api_key_revoked',
    entityKind: 'api_key',
    entityId: input.apiKeyId,
    metadata: { brandId: brand.id },
  });

  return actionOk(undefined, 'Key revoked. Requests using it now fail immediately.');
});

// ---------------------------------------------------------------------------
// Webhook endpoints
// ---------------------------------------------------------------------------

const endpointSchema = z.object({
  url: z.string().trim().min(1, 'Enter the URL to receive events'),
  events: stringArraySchema,
});

export const addWebhookEndpoint = action(endpointSchema, async (input, context) => {
  const { brand, user } = await requireBrand('brand:webhooks:manage');

  const events = input.events.filter(
    (event) => event === '*' || (WEBHOOK_EVENTS as readonly string[]).includes(event),
  );
  if (events.length === 0) {
    return actionError('Choose at least one event.', { events: 'Choose at least one event' });
  }

  const result = await createEndpoint({ brandId: brand.id, url: input.url, events });
  if ('error' in result) return actionError(result.error, { url: result.error });

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'brand.webhook_created',
    entityKind: 'webhook_endpoint',
    entityId: result.endpointId,
    metadata: { brandId: brand.id, events },
  });

  return actionOk(
    { secret: result.secret },
    'Endpoint added. Copy the signing secret now — it is not shown again.',
  );
});

const endpointIdSchema = z.object({ endpointId: z.string().uuid() });

export const toggleWebhookEndpoint = action(
  endpointIdSchema.extend({ active: z.enum(['true', 'false']) }),
  async (input, context) => {
    const { brand, user } = await requireBrand('brand:webhooks:manage');

    const active = input.active === 'true';
    const updated = await prisma.webhookEndpoint.updateMany({
      where: { id: input.endpointId, brandId: brand.id },
      // Re-enabling clears the failure counter, so an endpoint that was
      // auto-disabled after an outage starts from a clean slate.
      data: active
        ? { active: true, failureCount: 0, disabledAt: null }
        : { active: false, disabledAt: new Date() },
    });
    if (updated.count === 0) return actionError('That endpoint was not found.');

    await recordAudit({
      actorUserId: user.id,
      actorIp: context.ip,
      action: active ? 'brand.webhook_enabled' : 'brand.webhook_disabled',
      entityKind: 'webhook_endpoint',
      entityId: input.endpointId,
      metadata: { brandId: brand.id },
    });

    return actionOk(undefined, active ? 'Endpoint enabled.' : 'Endpoint disabled.');
  },
);

export const deleteWebhookEndpoint = action(endpointIdSchema, async (input, context) => {
  const { brand, user } = await requireBrand('brand:webhooks:manage');

  const deleted = await prisma.webhookEndpoint.deleteMany({
    where: { id: input.endpointId, brandId: brand.id },
  });
  if (deleted.count === 0) return actionError('That endpoint was not found.');

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'brand.webhook_deleted',
    entityKind: 'webhook_endpoint',
    entityId: input.endpointId,
    metadata: { brandId: brand.id },
  });

  return actionOk(undefined, 'Endpoint deleted.');
});

/**
 * Reveals a signing secret to the brand owner.
 *
 * Unlike an API key this is recoverable, because it is stored encrypted rather
 * than hashed — the delivery worker needs the plaintext to sign each payload.
 * Revealing it is therefore possible, and audited every time.
 */
export const revealWebhookSecret = action(endpointIdSchema, async (input, context) => {
  const { brand, user } = await requireBrand('brand:webhooks:manage');

  const secret = await revealSecret(input.endpointId, brand.id);
  if (!secret) return actionError('That endpoint was not found.');

  await recordAudit({
    actorUserId: user.id,
    actorIp: context.ip,
    action: 'brand.webhook_secret_revealed',
    entityKind: 'webhook_endpoint',
    entityId: input.endpointId,
    metadata: { brandId: brand.id },
  });
  logger.info('webhook.secret_revealed', { brandId: brand.id, endpointId: input.endpointId });

  return actionOk({ secret });
});

const deliverySchema = z.object({ deliveryId: z.string().uuid() });

export const redeliverWebhook = action(deliverySchema, async (input) => {
  const { brand } = await requireBrand('brand:webhooks:manage');

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: input.deliveryId },
    select: { endpoint: { select: { brandId: true } } },
  });
  if (!delivery || delivery.endpoint.brandId !== brand.id) {
    return actionError('That delivery was not found.');
  }

  const delivered = await redeliver(input.deliveryId);
  return delivered
    ? actionOk(undefined, 'Delivered.')
    : actionError('The endpoint did not accept the retry. See the response below.');
});
