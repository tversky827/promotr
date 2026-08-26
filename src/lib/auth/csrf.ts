import { cookies, headers } from 'next/headers';

import { constantTimeEqual } from '@/lib/crypto/hash';
import { CSRF_COOKIE } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * CSRF defence, two independent layers:
 *
 *  1. Origin/Referer check — rejects cross-site form posts outright. This alone
 *     stops the classic attack in every modern browser.
 *  2. Double-submit token — the request must echo the CSRF cookie in the
 *     `x-csrf-token` header or a `_csrf` form field. This covers the case where
 *     the Origin header is absent.
 *
 * SameSite=Lax on the session cookie is a third layer, but is not relied upon
 * alone because it does not cover top-level POST navigations in every browser.
 */

export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_FIELD = '_csrf';

export class CsrfError extends Error {
  constructor(message = 'Request failed a cross-site request forgery check') {
    super(message);
    this.name = 'CsrfError';
  }
}

function allowedOrigins(): string[] {
  const origins = new Set<string>([env.appUrl]);
  if (env.trackingUrl) origins.add(env.trackingUrl);
  return [...origins];
}

/** Layer 1. Returns true when the request demonstrably came from our own site. */
export function checkOrigin(headerBag: Headers): boolean {
  const origin = headerBag.get('origin');
  const allowed = allowedOrigins();

  if (origin) {
    // `null` origins come from sandboxed iframes and opaque contexts — never ours.
    if (origin === 'null') return false;
    return allowed.some((a) => sameOrigin(a, origin));
  }

  // No Origin header: fall back to Referer.
  const referer = headerBag.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return allowed.some((a) => sameOrigin(a, url.origin));
    } catch {
      return false;
    }
  }

  // Neither header present. Browsers always send at least one on cross-site
  // POSTs, so this is a non-browser client; the token check must carry it.
  return false;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.host === ub.host;
  } catch {
    return false;
  }
}

/** Layer 2. */
export async function verifyCsrfToken(submitted: string | null | undefined): Promise<boolean> {
  if (!submitted) return false;
  const cookieValue = (await cookies()).get(CSRF_COOKIE)?.value;
  if (!cookieValue) return false;
  return constantTimeEqual(cookieValue, submitted);
}

/**
 * Enforce both layers for a server action. `formData` is optional; when present
 * the hidden `_csrf` field is accepted in place of the header.
 */
export async function assertCsrf(formData?: FormData): Promise<void> {
  const headerBag = await headers();

  if (!checkOrigin(headerBag)) {
    throw new CsrfError('Request origin is not allowed');
  }

  const fromForm = formData?.get(CSRF_FIELD);
  const submitted =
    headerBag.get(CSRF_HEADER) ?? (typeof fromForm === 'string' ? fromForm : null);

  if (!(await verifyCsrfToken(submitted))) {
    throw new CsrfError();
  }
}

/** Route-handler variant operating on a Request. */
export async function assertCsrfForRequest(request: Request): Promise<void> {
  if (!checkOrigin(request.headers)) {
    throw new CsrfError('Request origin is not allowed');
  }
  const submitted = request.headers.get(CSRF_HEADER);
  if (!(await verifyCsrfToken(submitted))) {
    throw new CsrfError();
  }
}

export async function currentCsrfToken(): Promise<string> {
  return (await cookies()).get(CSRF_COOKIE)?.value ?? '';
}
