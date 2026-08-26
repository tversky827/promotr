import { cookies } from 'next/headers';

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { hashIp, hashToken } from '@/lib/crypto/hash';
import { generateCsrfToken, generateToken } from '@/lib/crypto/ids';
import { logger } from '@/lib/observability/logger';

import type { User } from '@prisma/client';

export const SESSION_COOKIE = 'promotr_session';
export const CSRF_COOKIE = 'promotr_csrf';

/** Idle-agnostic absolute lifetime. Sessions are also refreshed on activity. */
const SESSION_TTL_DAYS = 30;
const SESSION_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface SessionContext {
  sessionId: string;
  user: User;
  mfaSatisfied: boolean;
  csrfToken: string;
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // `lax` allows the cookie on top-level navigations (needed for email links
    // and OAuth returns) while blocking it on cross-site subrequests.
    sameSite: 'lax' as const,
    secure: env.isProduction,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/**
 * Create a session and set its cookies.
 *
 * The raw token only ever exists in the cookie; the database stores its SHA-256
 * hash, so a database leak cannot be replayed as a live session.
 */
export async function createSession(
  userId: string,
  options: { userAgent?: string; ip?: string; mfaSatisfied?: boolean } = {},
): Promise<{ token: string; csrfToken: string; sessionId: string }> {
  const token = generateToken();
  const csrfToken = generateCsrfToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      csrfSecretHash: hashToken(csrfToken),
      userAgent: options.userAgent?.slice(0, 500),
      ipHash: options.ip ? hashIp(options.ip) : null,
      mfaSatisfied: options.mfaSatisfied ?? false,
      expiresAt,
    },
  });

  const jar = await cookies();
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;
  jar.set(SESSION_COOKIE, token, cookieOptions(maxAge));
  // The CSRF cookie is deliberately readable by JavaScript: the double-submit
  // pattern requires the page to echo it back in a header or form field.
  jar.set(CSRF_COOKIE, csrfToken, { ...cookieOptions(maxAge), httpOnly: false });

  return { token, csrfToken, sessionId: session.id };
}

/**
 * Resolve the current session. Returns null for missing, expired, revoked or
 * suspended-user sessions. Suspension takes effect immediately because it is
 * checked here on every request rather than being baked into a signed token.
 */
export async function getSession(): Promise<SessionContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt <= new Date()) return null;

  const { user } = session;
  if (user.status === 'SUSPENDED' || user.status === 'DELETED' || user.deletedAt) return null;

  // Refresh lastSeenAt at most once a day to avoid a write on every request.
  if (Date.now() - session.lastSeenAt.getTime() > SESSION_REFRESH_THRESHOLD_MS) {
    void prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch((error) => logger.warn('session.touch_failed', { error: (error as Error).message }));
  }

  return {
    sessionId: session.id,
    user,
    mfaSatisfied: session.mfaSatisfied,
    csrfToken: jar.get(CSRF_COOKIE)?.value ?? '',
  };
}

export async function markSessionMfaSatisfied(sessionId: string): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { mfaSatisfied: true } });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session
      .updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

/** "Log out everywhere" — revokes every session, including the current one. */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      userAgent: true,
      lastSeenAt: true,
      createdAt: true,
      expiresAt: true,
    },
  });
}

export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/** Housekeeping: drop rows for sessions that expired long ago. */
export async function pruneExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return result.count;
}
