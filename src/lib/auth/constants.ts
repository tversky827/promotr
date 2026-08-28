/**
 * Auth constants shared between server and client code.
 *
 * Kept in their own module with no imports: `csrf.ts` and `session.ts` both
 * pull in `next/headers` and Prisma, so a client component importing a constant
 * from them would drag the entire server runtime into the browser bundle.
 */

export const SESSION_COOKIE = 'audicents_session';
export const CSRF_COOKIE = 'audicents_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_FIELD = '_csrf';
