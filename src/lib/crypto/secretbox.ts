import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from '@/lib/env';

/**
 * Authenticated encryption for secrets held at rest: TOTP seeds, webhook signing
 * secrets, OAuth tokens, tax identifiers.
 *
 * Format: v1.<iv-base64url>.<tag-base64url>.<ciphertext-base64url>
 * The version prefix allows the key/algorithm to be rotated without ambiguity.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard

function key(): Buffer {
  const k = Buffer.from(env.encryptionKey, 'base64');
  if (k.length < 32) {
    throw new Error('APP_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return k.subarray(0, 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretDecryptionError('Unrecognised ciphertext format');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key(),
      Buffer.from(ivB64 ?? '', 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64 ?? '', 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64 ?? '', 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (cause) {
    // A failure here means either tampering or a rotated key.
    throw new SecretDecryptionError('Unable to decrypt secret', { cause });
  }
}

/** Decrypt without throwing — for display paths where a stale value is tolerable. */
export function tryDecryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decryptSecret(payload);
  } catch {
    return null;
  }
}

export class SecretDecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SecretDecryptionError';
  }
}
