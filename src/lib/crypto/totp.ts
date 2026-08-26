import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP, used for administrator multi-factor authentication.
 * Implemented directly rather than pulled from a dependency: the algorithm is
 * thirty lines, and MFA verification is not a place to inherit supply-chain risk.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Accept the neighbouring windows to tolerate clock skew (±30s). */
const WINDOW = 1;

export function generateTotpSecret(): string {
  const bytes = randomBytes(20); // 160 bits, the RFC 4226 recommendation
  return base32Encode(bytes);
}

export function totpUri(secret: string, account: string, issuer: string): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${params}`;
}

export function generateTotp(secret: string, atSeconds = Math.floor(Date.now() / 1000)): string {
  return generateForCounter(secret, Math.floor(atSeconds / PERIOD_SECONDS));
}

export function verifyTotp(
  secret: string,
  code: string,
  atSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const cleaned = code.replace(/\D/g, '');
  if (cleaned.length !== DIGITS) return false;

  const counter = Math.floor(atSeconds / PERIOD_SECONDS);
  let matched = false;
  // Check every window unconditionally so timing does not reveal which matched.
  for (let offset = -WINDOW; offset <= WINDOW; offset += 1) {
    const candidate = generateForCounter(secret, counter + offset);
    if (safeEqual(candidate, cleaned)) matched = true;
  }
  return matched;
}

function generateForCounter(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.max(0, counter)));

  const digest = createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Single-use recovery codes, shown once at enrolment. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(10)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}
