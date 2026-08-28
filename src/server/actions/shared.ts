import { headers } from 'next/headers';
import { z } from 'zod';

import { assertCsrf, CsrfError } from '@/lib/auth/csrf';
import { EmailNotConfiguredError } from '@/lib/email/provider';
import { DemoRestrictionError } from '@/lib/demo/mode';
import { captureException } from '@/lib/observability/sentry';
import { RateLimitExceededError } from '@/lib/ratelimit';
import { AuthenticationError, AuthorizationError } from '@/lib/rbac';
import { clientIpFrom } from '@/lib/request';
import { StorageNotConfiguredError } from '@/lib/storage/s3';
import { StripeNotConfiguredError } from '@/lib/stripe';

/**
 * Server-action plumbing.
 *
 * Every mutation in the product goes through `action()`, which guarantees four
 * things uniformly:
 *
 *   1. CSRF is verified (origin check plus double-submit token).
 *   2. Input is parsed by a Zod schema — an action never sees raw FormData.
 *   3. Errors become a typed result rather than being thrown, so the UI can
 *      render a field error instead of tripping an error boundary.
 *   4. Unexpected errors are reported and replaced with a generic message. A
 *      stack trace is never shown to a user.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; code?: string };

export function actionError(
  error: string,
  fieldErrors?: Record<string, string>,
  code?: string,
): ActionResult<never> {
  return { ok: false, error, fieldErrors, code };
}

export function actionOk<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export interface ActionContext {
  ip: string;
  userAgent: string;
}

/**
 * Wrap a mutation. `schema` parses the FormData; `handler` receives the parsed
 * value and a request context.
 */
export function action<TSchema extends z.ZodTypeAny, TResult>(
  schema: TSchema,
  handler: (input: z.infer<TSchema>, context: ActionContext) => Promise<ActionResult<TResult>>,
  options: { skipCsrf?: boolean } = {},
): (formData: FormData) => Promise<ActionResult<TResult>> {
  return async (formData: FormData) => {
    try {
      if (!options.skipCsrf) {
        await assertCsrf(formData);
      }

      const parsed = schema.safeParse(formDataToObject(formData));
      if (!parsed.success) {
        return actionError('Please correct the highlighted fields.', fieldErrorsFrom(parsed.error));
      }

      const headerBag = await headers();
      return await handler(parsed.data, {
        ip: clientIpFrom(headerBag),
        userAgent: headerBag.get('user-agent') ?? '',
      });
    } catch (error) {
      return translateError(error);
    }
  };
}

/** Same guarantees, for actions taking a typed object rather than a form. */
export function objectAction<TSchema extends z.ZodTypeAny, TResult>(
  schema: TSchema,
  handler: (input: z.infer<TSchema>, context: ActionContext) => Promise<ActionResult<TResult>>,
): (input: unknown) => Promise<ActionResult<TResult>> {
  return async (input: unknown) => {
    try {
      await assertCsrf();
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return actionError('Please correct the highlighted fields.', fieldErrorsFrom(parsed.error));
      }
      const headerBag = await headers();
      return await handler(parsed.data, {
        ip: clientIpFrom(headerBag),
        userAgent: headerBag.get('user-agent') ?? '',
      });
    } catch (error) {
      return translateError(error);
    }
  };
}

function translateError(error: unknown): ActionResult<never> {
  if (error instanceof CsrfError) {
    return actionError(
      'Your session could not be verified. Refresh the page and try again.',
      undefined,
      'CSRF',
    );
  }
  if (error instanceof AuthenticationError) {
    return actionError('Please sign in to continue.', undefined, 'UNAUTHENTICATED');
  }
  if (error instanceof AuthorizationError) {
    return actionError(error.message, undefined, 'FORBIDDEN');
  }
  if (error instanceof RateLimitExceededError) {
    return actionError(
      `Too many attempts. Try again in ${Math.ceil(error.result.retryAfterSeconds / 60)} minute(s).`,
      undefined,
      'RATE_LIMITED',
    );
  }

  // Integration-not-configured errors carry a message already written for the
  // user, and are surfaced rather than swallowed — that is the whole point.
  if (error instanceof StripeNotConfiguredError) {
    return actionError(error.userMessage, undefined, error.code);
  }
  // Same treatment for a demo account reaching a real-money rail: the message
  // explains the boundary rather than looking like a failure.
  if (error instanceof DemoRestrictionError) {
    return actionError(error.userMessage, undefined, error.code);
  }
  if (error instanceof EmailNotConfiguredError) {
    return actionError(error.message, undefined, error.code);
  }
  if (error instanceof StorageNotConfiguredError) {
    return actionError(error.message, undefined, error.code);
  }

  // Anything else is a bug. Report it, and tell the user nothing specific.
  captureException(error, { route: 'server-action' });
  return actionError('Something went wrong on our side. The team has been notified.');
}

function formDataToObject(formData: FormData): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key);
    // Repeated keys (checkbox groups) become arrays; single keys stay scalar.
    object[key] = values.length > 1 ? values : values[0];
  }
  return object;
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (path && !fields[path]) fields[path] = issue.message;
  }
  return fields;
}

/** Coerces an HTML checkbox ("on" / absent) into a boolean. */
export const checkboxSchema = z
  .union([z.literal('on'), z.literal('true'), z.literal('false'), z.undefined(), z.null()])
  .transform((v) => v === 'on' || v === 'true');

/** Normalises a multi-select that may arrive as a scalar, an array, or absent. */
export const stringArraySchema = z
  .union([z.string(), z.array(z.string()), z.undefined(), z.null()])
  .transform((v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]))
  .pipe(z.array(z.string()));
