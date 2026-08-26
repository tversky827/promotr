import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Public identifiers.
 *
 * Tracking codes and API keys are the only database identifiers that appear in
 * URLs or are handed to third parties. They are generated from a CSPRNG rather
 * than derived from database ids, so they leak no information about record
 * counts, creation order, or internal structure.
 */

/**
 * Crockford base32 without I, L, O and U: unambiguous when read aloud or typed,
 * and case-insensitive, which matters because tracking links get transcribed by
 * hand from video descriptions and podcast show notes.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomFromAlphabet(length: number): string {
  const out: string[] = [];
  // Reject values that would bias the modulo, then map into the alphabet.
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out.push(ALPHABET[byte % ALPHABET.length]!);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** Tracking link code: 10 chars ≈ 50 bits of entropy. */
export function generateTrackingCode(): string {
  return randomFromAlphabet(10);
}

export function normalizeTrackingCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

/** Opaque bearer token (session cookie, email link). 256 bits. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Shorter token for CSRF, where the value is bound to an existing session. */
export function generateCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export function generateUuid(): string {
  return randomUUID();
}

/**
 * API key. `prefix` is stored in plaintext so the dashboard can show which key
 * is which; only the full key's hash is stored.
 */
export function generateApiKey(live: boolean): { key: string; prefix: string } {
  const env = live ? 'live' : 'test';
  const body = randomBytes(24).toString('base64url');
  const prefix = `pk_${env}_${body.slice(0, 8)}`;
  return { key: `${prefix}_${body.slice(8)}`, prefix };
}

/** Human-facing reference, e.g. dispute "DSP-7F2K9Q". */
export function generateReference(prefix: string): string {
  return `${prefix}-${randomFromAlphabet(6)}`;
}

/** URL-safe slug with a random suffix guaranteeing uniqueness. */
export function slugify(input: string, suffixLength = 6): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const stem = base || 'item';
  return suffixLength > 0 ? `${stem}-${randomFromAlphabet(suffixLength).toLowerCase()}` : stem;
}
