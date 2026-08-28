import { headers } from 'next/headers';

import { env } from '@/lib/env';

/**
 * Client IP resolution.
 *
 * X-Forwarded-For is attacker-controlled unless a trusted proxy overwrites it.
 * When TRUST_PROXY is on we take the LEFTMOST entry (the original client as
 * recorded by the first proxy); when it is off we ignore the header entirely and
 * fall back to the socket address the platform exposes. Getting this backwards
 * is how click-fraud systems get bypassed, so it is deliberate and documented.
 */

export function clientIpFrom(headerBag: Headers): string {
  if (env.trustProxy) {
    // Platform-specific single-value headers are set by the proxy itself and
    // cannot be spoofed by the client, so they are preferred.
    const platform =
      headerBag.get('cf-connecting-ip') ??
      headerBag.get('true-client-ip') ??
      headerBag.get('x-real-ip');
    if (platform) return normalizeIp(platform.trim());

    const forwarded = headerBag.get('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return normalizeIp(first);
    }
  }
  return '0.0.0.0';
}

function normalizeIp(ip: string): string {
  // Strip an IPv6-mapped IPv4 prefix and any :port suffix.
  const stripped = ip.replace(/^::ffff:/i, '');
  if (!stripped.includes(':') && stripped.includes('.')) {
    return stripped.split(':')[0] ?? stripped;
  }
  return stripped;
}

export function geoFrom(headerBag: Headers): {
  country?: string;
  region?: string;
  city?: string;
} {
  // Both Vercel and Cloudflare inject geo headers at the edge. Without either,
  // geo is simply unknown — we never guess.
  const country =
    headerBag.get('x-vercel-ip-country') ?? headerBag.get('cf-ipcountry') ?? undefined;
  const region =
    headerBag.get('x-vercel-ip-country-region') ?? headerBag.get('cf-region-code') ?? undefined;
  const city = decodeHeader(
    headerBag.get('x-vercel-ip-city') ?? headerBag.get('cf-ipcity') ?? undefined,
  );
  return {
    country: country ? country.toUpperCase().slice(0, 2) : undefined,
    region: region ?? undefined,
    city,
  };
}

function decodeHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Server-component/action helper: the current request's IP. */
export async function currentIp(): Promise<string> {
  return clientIpFrom(await headers());
}

export async function currentUserAgent(): Promise<string> {
  return (await headers()).get('user-agent') ?? '';
}

export async function currentOrigin(): Promise<string | null> {
  const h = await headers();
  return h.get('origin');
}

/**
 * The origin this request was actually made to.
 *
 * A deployment is frequently reachable on a host nobody configured: a preview
 * URL, the platform's default domain, a custom domain added later. Deriving it
 * from the request means those all work without a rebuild.
 *
 * `x-forwarded-host` is only read when the deployment says it sits behind a
 * proxy it controls, because a directly exposed server lets a client set it.
 */
export function requestOrigin(headerBag: Headers): string | null {
  const forwarded = env.trustProxy ? headerBag.get('x-forwarded-host') : null;
  const host = (forwarded ?? headerBag.get('host'))?.split(',')[0]?.trim();
  if (!host) return null;

  const proto =
    (env.trustProxy ? headerBag.get('x-forwarded-proto')?.split(',')[0]?.trim() : null) ??
    (env.isProduction ? 'https' : 'http');

  return `${proto}://${host}`;
}
