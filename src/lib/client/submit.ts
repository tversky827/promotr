'use client';

import { CSRF_FIELD } from '@/lib/auth/constants';
import type { ActionResult } from '@/server/actions/shared';

/**
 * Calls a server action, recovering from a lost CSRF token.
 *
 * The CSRF cookie can disappear while the session cookie survives — privacy
 * tooling, a per-cookie clear, a browser evicting storage. Every mutation on
 * the site then fails a check the user cannot fix by refreshing, because
 * rendering a page cannot set a cookie.
 *
 * This asks the server for a fresh token, which requires a valid session, and
 * replays the submission once. Every component that calls an action goes
 * through here so the recovery cannot be implemented in one place and forgotten
 * in the next.
 */
export async function runAction<T>(
  action: (formData: FormData) => Promise<ActionResult<T>>,
  formData: FormData,
): Promise<ActionResult<T>> {
  const result = await action(formData);
  if (result.ok || result.code !== 'CSRF') return result;

  const refreshed = await fetch('/api/auth/csrf', { method: 'POST' })
    .then((response) => (response.ok ? (response.json() as Promise<{ token?: string }>) : null))
    .catch(() => null);

  if (!refreshed?.token) return result;

  formData.set(CSRF_FIELD, refreshed.token);
  return action(formData);
}
