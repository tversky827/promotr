import { hashToken } from '@/lib/crypto/hash';
import { generateApiKey } from '@/lib/crypto/ids';
import { prisma } from '@/lib/db';
import { integrations } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

import type { ApiKey, Brand } from '@prisma/client';

/**
 * API key authentication.
 *
 * Keys are presented as `Authorization: Bearer pk_live_...`. Only the SHA-256
 * hash is stored, so a database compromise does not yield usable credentials.
 * The `prefix` is stored in plaintext purely so the dashboard can show which
 * key is which.
 */

export const API_SCOPES = [
  'conversions:write',
  'campaigns:read',
  'campaigns:write',
  'reports:read',
  'publishers:read',
  'payouts:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export interface AuthenticatedApiKey {
  apiKey: ApiKey;
  brand: Brand;
}

export type ApiAuthResult =
  | { ok: true; auth: AuthenticatedApiKey }
  | { ok: false; reason: 'MISSING' | 'INVALID' | 'REVOKED' | 'SUSPENDED' | 'SCOPE'; message: string };

export async function authenticateApiKey(
  request: Request,
  requiredScope?: ApiScope,
): Promise<ApiAuthResult> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());

  // Also accept the key in a header, which some server-side pixel integrations
  // find easier than constructing an Authorization header.
  const raw = match?.[1]?.trim() ?? request.headers.get('x-api-key')?.trim();

  if (!raw) {
    return {
      ok: false,
      reason: 'MISSING',
      message: 'Provide your API key as "Authorization: Bearer <key>".',
    };
  }

  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashToken(raw) },
    include: { brand: true },
  });

  if (!record) {
    return { ok: false, reason: 'INVALID', message: 'That API key is not valid.' };
  }
  if (record.revokedAt) {
    return { ok: false, reason: 'REVOKED', message: 'That API key has been revoked.' };
  }
  if (record.brand.verification === 'SUSPENDED') {
    return { ok: false, reason: 'SUSPENDED', message: 'This account is suspended.' };
  }
  if (requiredScope && !record.scopes.includes(requiredScope) && !record.scopes.includes('*')) {
    return {
      ok: false,
      reason: 'SCOPE',
      message: `This key does not have the "${requiredScope}" scope.`,
    };
  }

  // Last-used is a fire-and-forget write: it must not add latency to the
  // request, and losing one update is inconsequential.
  void prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { ok: true, auth: { apiKey: record, brand: record.brand } };
}

export async function createApiKey(params: {
  brandId: string;
  name: string;
  scopes: ApiScope[];
}): Promise<{ key: string; prefix: string; id: string }> {
  // Live/test is inferred from the Stripe key so a test-mode deployment cannot
  // mint keys that look production-grade.
  const { key, prefix } = generateApiKey(integrations.stripe.liveMode);

  const record = await prisma.apiKey.create({
    data: {
      brandId: params.brandId,
      name: params.name,
      prefix,
      keyHash: hashToken(key),
      scopes: params.scopes,
    },
  });

  logger.info('apikey.created', { brandId: params.brandId, apiKeyId: record.id, prefix });
  // The full key is returned exactly once and is not recoverable afterwards.
  return { key, prefix, id: record.id };
}

export async function revokeApiKey(brandId: string, apiKeyId: string): Promise<boolean> {
  const result = await prisma.apiKey.updateMany({
    where: { id: apiKeyId, brandId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}
