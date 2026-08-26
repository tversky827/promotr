import { cookies } from 'next/headers';

import { CSRF_COOKIE, SESSION_COOKIE } from '@/lib/auth/constants';
import { checkOrigin } from '@/lib/auth/csrf';
import { generateCsrfToken } from '@/lib/crypto/ids';
import { hashToken } from '@/lib/crypto/hash';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

/**
 * Re-issues the CSRF token for the current session.
 *
 * The token lives in a cookie that the browser can lose independently of the
 * session cookie — privacy tooling, a per-cookie clear, a browser's storage
 * limits. When that happens every form on the site fails a check the user
 * cannot fix by refreshing, because a server component cannot set a cookie.
 *
 * This endpoint can. It requires a valid session and a same-origin request,
 * rotates the secret stored on that session, and returns the new token so the
 * page can retry the submission the user already made.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!checkOrigin(request.headers)) {
    return Response.json({ error: 'Bad origin' }, { status: 403 });
  }

  const jar = await cookies();
  const sessionToken = jar.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return Response.json({ error: 'No session' }, { status: 401 });
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(sessionToken) },
    select: { id: true, revokedAt: true, expiresAt: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    return Response.json({ error: 'No session' }, { status: 401 });
  }

  const token = generateCsrfToken();
  await prisma.session.update({
    where: { id: session.id },
    data: { csrfSecretHash: hashToken(token) },
  });

  jar.set(CSRF_COOKIE, token, {
    httpOnly: false, // The double-submit pattern requires the page to read it.
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });

  logger.debug('auth.csrf_reissued', { sessionId: session.id });
  return Response.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
}
