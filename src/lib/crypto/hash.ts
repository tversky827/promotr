import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

import { env } from '@/lib/env';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt parameters. N=2^16 with r=8 costs roughly 100ms and 64MB per hash on
 * commodity hardware, which is the OWASP-recommended floor for interactive
 * logins. maxmem must be raised above Node's 32MB default to permit N=65536.
 */
const SCRYPT = { N: 65_536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;
const KEY_LENGTH = 64;

/**
 * Hash a password. Output format:
 *   scrypt$N$r$p$<salt-base64>$<hash-base64>
 * The parameters are embedded so they can be raised later without invalidating
 * existing hashes — see `needsRehash`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(normalize(password), salt, KEY_LENGTH, SCRYPT);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = await scrypt(normalize(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash used weaker parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < SCRYPT.N || Number(parts[2]) < SCRYPT.r;
}

/** Unicode-normalise so visually identical passwords compare equal. */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

/**
 * Hash an opaque bearer token (session cookie, API key, email token) for storage.
 * Tokens are already 256 bits of entropy, so a fast hash is correct here: there
 * is nothing to brute-force, and a slow KDF would make every request expensive.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still perform a comparison so timing does not leak the length.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Pseudonymous identifier for an IP address. Raw IPs are never persisted; this
 * keyed HMAC is stored instead. It supports the operational needs (rate
 * limiting, burst detection, duplicate suppression) while being non-reversible
 * without the key, and rotating IP_HASH_SECRET severs the link entirely.
 */
export function hashIp(ip: string): string {
  return createHmac('sha256', Buffer.from(env.ipHashSecret, 'base64'))
    .update(`ip:${ip}`)
    .digest('base64url')
    .slice(0, 32);
}

/**
 * Hash of the IP's network prefix (/24 for IPv4, /48 for IPv6). Lets the fraud
 * engine spot bursts from one network without identifying individual visitors.
 */
export function hashIpPrefix(ip: string): string {
  return createHmac('sha256', Buffer.from(env.ipHashSecret, 'base64'))
    .update(`prefix:${ipPrefix(ip)}`)
    .digest('base64url')
    .slice(0, 32);
}

export function ipPrefix(ip: string): string {
  if (ip.includes(':')) {
    // IPv6 — keep the first three hextets (/48), the typical site allocation.
    return ip.split(':').slice(0, 3).join(':');
  }
  return ip.split('.').slice(0, 3).join('.');
}

/** Keyed fingerprint over stable, non-identifying request attributes. */
export function fingerprint(parts: (string | undefined | null)[]): string {
  return createHmac('sha256', Buffer.from(env.ipHashSecret, 'base64'))
    .update(parts.map((p) => p ?? '').join('|'))
    .digest('base64url')
    .slice(0, 32);
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacHex(key: string | Buffer, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}
