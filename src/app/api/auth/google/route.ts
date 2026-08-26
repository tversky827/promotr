import { cookies } from 'next/headers';

import { integrations } from '@/lib/env';
import {
  googleAuthorizeUrl,
  newOAuthState,
  oauthStateCookieOptions,
  OAUTH_STATE_COOKIE,
} from '@/lib/auth/oauth';

/** Starts Google sign-in. Linked from the sign-in and sign-up pages. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!integrations.google.configured) {
    return new Response('Google sign-in is not configured on this deployment.', { status: 503 });
  }

  const next = new URL(request.url).searchParams.get('next') ?? undefined;
  const state = newOAuthState(next && next.startsWith('/') ? next : undefined);

  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions());

  return Response.redirect(googleAuthorizeUrl(state), 302);
}
