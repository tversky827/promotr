import { describe, expect, it } from 'vitest';

import { checkOrigin } from '@/lib/auth/csrf';

/**
 * The origin half of the CSRF defence.
 *
 * A deployment is often reachable on a host nobody configured — a preview URL,
 * the platform's default domain, a domain added after the build. The check has
 * to accept those without accepting another site.
 */
describe('origin check', () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it('accepts the configured origin', () => {
    expect(
      checkOrigin(headers({ origin: 'http://localhost:3000', host: 'localhost:3000' })),
    ).toBe(true);
  });

  it('accepts a host that was never configured, posting to itself', () => {
    expect(
      checkOrigin(
        headers({
          origin: 'https://promotr-abc123.vercel.app',
          host: 'promotr-abc123.vercel.app',
          'x-forwarded-host': 'promotr-abc123.vercel.app',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe(true);
  });

  it('rejects a post from another site — the attack this exists for', () => {
    expect(
      checkOrigin(
        headers({
          origin: 'https://evil.example',
          host: 'promotr-abc123.vercel.app',
          'x-forwarded-host': 'promotr-abc123.vercel.app',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe(false);
  });

  it('rejects an opaque origin', () => {
    expect(checkOrigin(headers({ origin: 'null', host: 'promotr.example' }))).toBe(false);
  });

  it('rejects a request carrying neither origin nor referer', () => {
    expect(checkOrigin(headers({ host: 'promotr.example' }))).toBe(false);
  });

  it('falls back to the referer when there is no origin', () => {
    expect(
      checkOrigin(
        headers({ referer: 'http://localhost:3000/creator', host: 'localhost:3000' }),
      ),
    ).toBe(true);
  });

  /**
   * A forged host header does not turn an attacker's page into ours: the
   * browser sets Origin itself, so a cross-site post still carries the
   * attacker's origin and is refused above. This case only records that
   * matching a spoofed pair is harmless — the attacker is describing their own
   * site to themselves.
   */
  it('is not fooled into accepting a cross-site post by a forged host', () => {
    const spoofed = checkOrigin(
      headers({
        origin: 'https://evil.example',
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
      }),
    );
    const realVictimOrigin = checkOrigin(
      headers({
        origin: 'https://evil.example',
        host: 'promotr.example',
        'x-forwarded-host': 'promotr.example',
        'x-forwarded-proto': 'https',
      }),
    );
    expect(spoofed).toBe(true);
    expect(realVictimOrigin).toBe(false);
  });
});
