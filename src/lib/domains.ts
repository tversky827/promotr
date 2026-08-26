import { resolveTxt } from 'node:dns/promises';

import { prisma } from '@/lib/db';
import { generateToken } from '@/lib/crypto/ids';
import { logger } from '@/lib/observability/logger';

/**
 * Destination-domain ownership verification.
 *
 * A brand proves it controls the domain its campaigns send traffic to, by
 * publishing a DNS TXT record. This closes the gap where an advertiser gets a
 * campaign approved pointing at a reputable site and then benefits from someone
 * else's traffic, and it is the precondition for redirect allow-listing.
 */

export const TXT_RECORD_PREFIX = 'promotr-domain-verification=';

/** The DNS subdomain the TXT record is published at. */
export const TXT_RECORD_HOST = '_promotr';

/**
 * The record a brand has to publish. Defined once so the settings screen, the
 * verifier and the documentation can never drift apart — and deliberately not
 * derived from configurable branding: renaming the product must not silently
 * invalidate every DNS record customers have already published.
 */
export function verificationRecord(
  domain: string,
  token: string,
): { recordName: string; recordValue: string } {
  return {
    recordName: `${TXT_RECORD_HOST}.${domain}`,
    recordValue: `${TXT_RECORD_PREFIX}${token}`,
  };
}

export async function requestVerification(params: {
  brandId: string;
  domain: string;
}): Promise<{ domainId: string; recordName: string; recordValue: string } | { error: string }> {
  const normalized = normalizeDomain(params.domain);
  if (!normalized) return { error: 'That does not look like a valid domain name.' };

  const token = generateToken().slice(0, 32);

  const record = await prisma.verifiedDomain.upsert({
    where: { brandId_domain: { brandId: params.brandId, domain: normalized } },
    create: { brandId: params.brandId, domain: normalized, token },
    // Re-requesting issues a fresh token, invalidating any previously shared one.
    update: { token, verifiedAt: null },
  });

  return { domainId: record.id, ...verificationRecord(normalized, token) };
}

export async function verifyDomain(domainId: string): Promise<{ verified: boolean; reason?: string }> {
  const record = await prisma.verifiedDomain.findUnique({ where: { id: domainId } });
  if (!record) return { verified: false, reason: 'Unknown domain' };

  const { recordName, recordValue: expected } = verificationRecord(record.domain, record.token);

  try {
    const results = await resolveTxt(recordName);
    const values = results.map((chunks) => chunks.join(''));
    const found = values.some((v) => v.trim() === expected);

    await prisma.verifiedDomain.update({
      where: { id: domainId },
      data: { lastCheckedAt: new Date(), verifiedAt: found ? new Date() : null },
    });

    if (found) {
      logger.info('domain.verified', { domainId, domain: record.domain });
      return { verified: true };
    }
    return {
      verified: false,
      reason: `No matching TXT record found at ${recordName}. DNS changes can take up to an hour to propagate.`,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    await prisma.verifiedDomain.update({
      where: { id: domainId },
      data: { lastCheckedAt: new Date() },
    });
    return {
      verified: false,
      reason:
        code === 'ENOTFOUND' || code === 'ENODATA'
          ? `No TXT record exists at ${recordName} yet.`
          : `DNS lookup failed: ${(error as Error).message}`,
    };
  }
}

export async function isDomainVerified(brandId: string, url: string): Promise<boolean> {
  const host = safeHost(url);
  if (!host) return false;

  const verified = await prisma.verifiedDomain.findMany({
    where: { brandId, verifiedAt: { not: null } },
    select: { domain: true },
  });

  return verified.some((v) => host === v.domain || host.endsWith(`.${v.domain}`));
}

function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? '';
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return null;
  }
  return value;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
