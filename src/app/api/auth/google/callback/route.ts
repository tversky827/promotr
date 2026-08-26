import { cookies } from 'next/headers';

import { recordAudit } from '@/lib/audit';
import {
  exchangeGoogleCode,
  nextFromState,
  statesMatch,
  OAUTH_STATE_COOKIE,
} from '@/lib/auth/oauth';
import { homePathFor } from '@/lib/auth/guards';
import { createSession } from '@/lib/auth/session';
import { brand } from '@/lib/brand';
import { slugify } from '@/lib/crypto/ids';
import { prisma } from '@/lib/db';
import { integrations } from '@/lib/env';
import { logger } from '@/lib/observability/logger';
import { enforceRateLimit } from '@/lib/ratelimit';
import { clientIpFrom } from '@/lib/request';

/**
 * Google sign-in callback.
 *
 * Accounts are matched on the verified email address. An unverified Google
 * address is refused outright: accepting one would let anyone who can create a
 * Google account claiming someone else's address take over their account here.
 *
 * A new account created this way is a publisher. Brands go through the normal
 * sign-up, because a brand account carries a legal entity we contract with and
 * that is not something to infer from an OAuth profile.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const failure = (reason: string) =>
    Response.redirect(`${brand.appUrl}/login?error=${encodeURIComponent(reason)}`, 302);

  if (!integrations.google.configured) {
    return new Response('Google sign-in is not configured on this deployment.', { status: 503 });
  }

  const jar = await cookies();
  const expectedState = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);

  const providedState = url.searchParams.get('state');
  const code = url.searchParams.get('code');

  if (url.searchParams.get('error')) {
    // The user pressed cancel on Google's screen. Not an error worth a page.
    return Response.redirect(`${brand.appUrl}/login`, 302);
  }
  if (!code || !providedState || !expectedState || !statesMatch(providedState, expectedState)) {
    logger.warn('auth.oauth_state_mismatch', { hasCode: Boolean(code) });
    return failure('Sign-in could not be completed. Please try again.');
  }

  const headerBag = request.headers;
  const ip = clientIpFrom(headerBag);
  await enforceRateLimit('login', ip);

  let identity;
  try {
    identity = await exchangeGoogleCode(code);
  } catch (error) {
    logger.warn('auth.oauth_exchange_failed', { error: (error as Error).message });
    return failure('Google sign-in failed. Please try again or use your password.');
  }

  if (!identity.emailVerified) {
    return failure('That Google account has an unverified email address.');
  }

  const emailNormalized = identity.email.trim().toLowerCase();

  const existingLink = await prisma.oAuthAccount.findUnique({
    where: { provider_providerUserId: { provider: 'google', providerUserId: identity.providerUserId } },
    select: { userId: true },
  });

  let userId = existingLink?.userId ?? null;

  if (!userId) {
    const existingUser = await prisma.user.findUnique({
      where: { emailNormalized },
      select: { id: true, status: true },
    });

    if (existingUser) {
      if (existingUser.status !== 'ACTIVE') {
        return failure('That account is not active. Contact support.');
      }
      // Same verified address: link the provider to the existing account
      // rather than creating a second one.
      await prisma.oAuthAccount.create({
        data: {
          userId: existingUser.id,
          provider: 'google',
          providerUserId: identity.providerUserId,
          email: identity.email,
        },
      });
      userId = existingUser.id;
    } else {
      const created = await prisma.user.create({
        data: {
          email: identity.email.trim(),
          emailNormalized,
          role: 'CREATOR',
          name: identity.name,
          // Google has verified the address; making them verify it again is
          // friction with no security value.
          emailVerifiedAt: new Date(),
          creator: {
            create: {
              handle: slugify(identity.name),
              profile: { create: { displayName: identity.name } },
            },
          },
          oauthAccounts: {
            create: {
              provider: 'google',
              providerUserId: identity.providerUserId,
              email: identity.email,
            },
          },
        },
        select: { id: true },
      });
      userId = created.id;

      await recordAudit({
        actorUserId: userId,
        actorRole: 'CREATOR',
        actorIp: ip,
        action: 'auth.signup',
        entityKind: 'user',
        entityId: userId,
        metadata: { provider: 'google' },
      });
    }
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, role: true, status: true, mfaEnabled: true },
  });

  if (user.status !== 'ACTIVE') {
    return failure('That account is not active. Contact support.');
  }

  await createSession(user.id, {
    ip,
    userAgent: headerBag.get('user-agent') ?? '',
    // A federated sign-in does not satisfy this platform's own second factor.
    mfaSatisfied: false,
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    actorIp: ip,
    action: 'auth.login',
    entityKind: 'user',
    entityId: user.id,
    metadata: { provider: 'google' },
  });

  logger.info('auth.oauth_login', { userId: user.id, provider: 'google' });

  const destination = user.mfaEnabled
    ? '/login/mfa'
    : (nextFromState(providedState) ?? homePathFor(user.role));

  return Response.redirect(`${brand.appUrl}${destination}`, 302);
}
