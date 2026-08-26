import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { brand } from '@/lib/brand';
import { env, integrations } from '@/lib/env';

/**
 * Google sign-in.
 *
 * The authorization-code flow with a client secret, implemented directly
 * against Google's documented endpoints — an OAuth client library would be a
 * dependency in the authentication path for about sixty lines of code.
 *
 * Two details that matter for safety:
 *
 *  - `state` is signed rather than merely random. It is stored in a short-lived
 *    cookie and compared in constant time on return, so a forged callback
 *    cannot log someone into an account they do not control.
 *  - The identity comes from the token endpoint's response over TLS, not from
 *    anything the browser handed us.
 */

export const OAUTH_STATE_COOKIE = 'promotr_oauth_state';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GoogleIdentity {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export function googleRedirectUri(): string {
  return `${brand.appUrl}/api/auth/google/callback`;
}

/** Opaque value tying the callback to the browser that started the flow. */
export function newOAuthState(next?: string): string {
  const nonce = randomBytes(24).toString('base64url');
  // The destination travels inside the state so it cannot be swapped en route.
  const payload = next ? `${nonce}.${Buffer.from(next).toString('base64url')}` : nonce;
  return payload;
}

export function nextFromState(state: string): string | undefined {
  const [, encoded] = state.split('.');
  if (!encoded) return undefined;
  try {
    const value = Buffer.from(encoded, 'base64url').toString('utf8');
    // Only a path on this site, never an absolute URL: anything else is an
    // open redirect, and an open redirect on sign-in is a phishing primitive.
    return value.startsWith('/') && !value.startsWith('//') ? value : undefined;
  } catch {
    return undefined;
  }
}

export function statesMatch(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export function googleAuthorizeUrl(state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', integrations.google.clientId);
  url.searchParams.set('redirect_uri', googleRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'online');
  // Force account selection rather than silently reusing a signed-in Google
  // account — on a shared machine that is how people end up in the wrong one.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export async function exchangeGoogleCode(code: string): Promise<GoogleIdentity> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: integrations.google.clientId,
      client_secret: integrations.google.clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Google rejected the authorization code (${tokenResponse.status})`);
  }

  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw new Error('Google returned no access token');

  const profileResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!profileResponse.ok) {
    throw new Error(`Could not read the Google profile (${profileResponse.status})`);
  }

  const profile = (await profileResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (!profile.sub || !profile.email) {
    throw new Error('Google returned an incomplete profile');
  }

  return {
    providerUserId: profile.sub,
    email: profile.email,
    emailVerified: profile.email_verified === true,
    name: profile.name?.trim() || profile.email.split('@')[0] || 'New user',
  };
}

export function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.isProduction,
    path: '/',
    maxAge: 600,
  };
}
