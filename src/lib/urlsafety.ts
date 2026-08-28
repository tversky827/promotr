import { integrations } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

/**
 * Destination URL validation.
 *
 * The platform redirects real people to URLs supplied by advertisers, which
 * makes it an open-redirect and a malware-distribution vector if unguarded.
 * Three layers, applied in order:
 *
 *   1. Structural validation — scheme, host shape, no credentials, no internal
 *      addresses. This is the SSRF/private-network guard.
 *   2. Reputation screening via Google Safe Browsing, when configured. When it
 *      is not configured the campaign is flagged for manual review rather than
 *      being waved through — the check is never silently skipped.
 *   3. Domain ownership verification (see verified_domains), required before a
 *      campaign can go live if the operator enables it.
 */

export interface UrlValidationResult {
  ok: boolean;
  normalized?: string;
  errors: string[];
  warnings: string[];
}

/**
 * Hostnames and IP ranges that must never be redirect targets. Redirecting to
 * these would let an advertiser probe our own infrastructure.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

const PRIVATE_IPV4 =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

export function validateDestinationUrl(
  input: string,
  options: { requireHttps?: boolean } = {},
): UrlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const trimmed = input.trim();

  if (!trimmed) return { ok: false, errors: ['A destination URL is required'], warnings };
  if (trimmed.length > 2048) {
    return { ok: false, errors: ['The destination URL is too long (max 2048 characters)'], warnings };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, errors: ['That is not a valid URL. Include https:// at the start.'], warnings };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      errors: [`Only http and https URLs are allowed (got "${url.protocol.replace(':', '')}")`],
      warnings,
    };
  }

  const requireHttps = options.requireHttps ?? true;
  if (requireHttps && url.protocol !== 'https:') {
    errors.push('The destination must use https. Visitors are sent here directly.');
  }

  if (url.username || url.password) {
    errors.push('The destination URL must not contain embedded credentials');
  }

  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    errors.push('The destination must be a publicly reachable address');
  }

  if (PRIVATE_IPV4.test(host)) {
    errors.push('The destination must not be a private or loopback address');
  }

  // IPv6 loopback / unique-local / link-local.
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1' || /^f[cd][0-9a-f]{2}:/i.test(v6) || /^fe80:/i.test(v6)) {
      errors.push('The destination must not be a private or loopback address');
    }
  }

  if (!host.includes('.') && !host.startsWith('[')) {
    errors.push('The destination must use a fully qualified domain name');
  }

  // A bare IP is legal but unusual for an advertiser; worth a human look.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    warnings.push('The destination is a raw IP address rather than a domain name');
  }

  if (url.port && url.port !== '80' && url.port !== '443') {
    warnings.push(`The destination uses a non-standard port (${url.port})`);
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  return { ok: true, normalized: url.toString(), errors, warnings };
}

export interface SafeBrowsingResult {
  checked: boolean;
  safe: boolean;
  threats: string[];
  /** Set when screening could not run, so the caller can require manual review. */
  unavailableReason?: string;
}

/**
 * Screen a URL against Google Safe Browsing.
 *
 * Returns `checked: false` when no API key is configured. Callers must treat
 * that as "unknown", not "safe" — moderation flags the campaign for a human.
 */
export async function screenUrl(url: string): Promise<SafeBrowsingResult> {
  if (!integrations.safeBrowsing.configured) {
    return {
      checked: false,
      safe: false,
      threats: [],
      unavailableReason:
        'SAFE_BROWSING_API_KEY is not configured, so this URL was not screened for malware or phishing.',
    };
  }

  try {
    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(
        integrations.safeBrowsing.apiKey,
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'audicents', clientVersion: '1.0.0' },
          threatInfo: {
            threatTypes: [
              'MALWARE',
              'SOCIAL_ENGINEERING',
              'UNWANTED_SOFTWARE',
              'POTENTIALLY_HARMFUL_APPLICATION',
            ],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url }],
          },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn('safebrowsing.request_failed', { status: response.status, body: body.slice(0, 200) });
      return {
        checked: false,
        safe: false,
        threats: [],
        unavailableReason: `Safe Browsing returned HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as { matches?: Array<{ threatType: string }> };
    const threats = (data.matches ?? []).map((m) => m.threatType);
    return { checked: true, safe: threats.length === 0, threats };
  } catch (error) {
    logger.warn('safebrowsing.unavailable', { error: (error as Error).message });
    return {
      checked: false,
      safe: false,
      threats: [],
      unavailableReason: `Safe Browsing could not be reached: ${(error as Error).message}`,
    };
  }
}

export function registrableDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Whether a redirect target still matches the domain the campaign was approved
 * with. Enforced at redirect time so an approved campaign cannot be silently
 * re-pointed at a different site after review.
 */
export function sameRegistrableDomain(a: string, b: string): boolean {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // Allow subdomains of the approved domain (shop.brand.com vs brand.com).
  return da.endsWith(`.${db}`) || db.endsWith(`.${da}`);
}
