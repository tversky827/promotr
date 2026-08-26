import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/constants';

/**
 * Signed-out gate for the application areas.
 *
 * This is a convenience, not the authorisation boundary. It checks only that a
 * session cookie is *present* — middleware cannot reach the database, so it
 * cannot know whether the session is valid, whose it is, or what it may do.
 * Every page still calls its own guard, and those remain the enforcement point.
 *
 * What it buys is a correct HTTP redirect. Without it, a signed-out request to
 * a dashboard renders far enough for Next.js to flush a 200 response and then
 * redirect on the client — which means no data leaks, but a crawler sees 200
 * for a private page and a visitor without JavaScript sees a blank one.
 */

const PROTECTED_PREFIXES = ['/brand', '/creator', '/admin', '/onboarding'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (!PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const login = new URL('/login', request.url);
  // Carry the destination so signing in lands where they were going. Only the
  // path is preserved — an absolute URL here would be an open redirect.
  login.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(login, 307);
}

export const config = {
  matcher: ['/brand/:path*', '/creator/:path*', '/admin/:path*', '/onboarding/:path*'],
};
