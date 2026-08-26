import { NextResponse } from 'next/server';

import { logger } from '@/lib/observability/logger';
import { captureException } from '@/lib/observability/sentry';
import { rateLimitHeaders, type RateLimitResult } from '@/lib/ratelimit';

/**
 * API response envelope.
 *
 * One shape for every endpoint so clients can handle errors uniformly:
 *
 *   success: { "data": { ... } }
 *   failure: { "error": { "code": "...", "message": "...", "details": {...} } }
 *
 * Codes are stable strings clients can branch on; messages are for humans and
 * may change. Internal details never cross this boundary.
 */

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'NOT_CONFIGURED'
  | 'INTERNAL_ERROR'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE';

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  DUPLICATE: 200, // A duplicate is a successful no-op, not a client error.
  NOT_CONFIGURED: 503,
  INTERNAL_ERROR: 500,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
};

export function apiSuccess<T>(
  data: T,
  options: { status?: number; headers?: Record<string, string> } = {},
): NextResponse {
  return NextResponse.json(
    { data: serialize(data) },
    { status: options.status ?? 200, headers: options.headers },
  );
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  options: {
    details?: Record<string, unknown>;
    status?: number;
    headers?: Record<string, string>;
  } = {},
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(options.details ? { details: options.details } : {}) } },
    { status: options.status ?? STATUS[code], headers: options.headers },
  );
}

export function apiRateLimited(result: RateLimitResult): NextResponse {
  return apiError('RATE_LIMITED', 'Too many requests. Slow down and try again.', {
    headers: rateLimitHeaders(result),
    details: { retryAfterSeconds: result.retryAfterSeconds },
  });
}

/**
 * Wraps a handler so an unexpected throw becomes a clean 500 with a reference
 * the caller can quote to support — never a stack trace.
 *
 * The context parameter is generic so the wrapper composes with both plain
 * routes and dynamic-segment routes, whose context shape Next.js derives.
 */
export function withApiErrorHandling<TContext>(
  handler: (request: Request, context: TContext) => Promise<Response>,
): (request: Request, context: TContext) => Promise<Response> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      const reference = crypto.randomUUID().slice(0, 8);
      captureException(error, {
        route: new URL(request.url).pathname,
        method: request.method,
        extra: { reference },
      });
      logger.error('api.unhandled_error', {
        reference,
        path: new URL(request.url).pathname,
        error: (error as Error).message,
      });
      return apiError(
        'INTERNAL_ERROR',
        `An unexpected error occurred. Quote reference ${reference} if you contact support.`,
      );
    }
  };
}

/** bigints become strings; Dates become ISO 8601. */
function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serialize(v)]),
    );
  }
  return value;
}

/** Permissive CORS for the endpoints brands call from their own websites. */
export const PUBLIC_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
  'Access-Control-Max-Age': '86400',
};

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/** Guards against oversized request bodies before parsing them. */
export async function readJsonBody<T = unknown>(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<{ ok: true; body: T } | { ok: false; response: NextResponse }> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > maxBytes) {
    return {
      ok: false,
      response: apiError('PAYLOAD_TOO_LARGE', `Request bodies are limited to ${maxBytes} bytes.`),
    };
  }

  const text = await request.text();
  if (text.length > maxBytes) {
    return {
      ok: false,
      response: apiError('PAYLOAD_TOO_LARGE', `Request bodies are limited to ${maxBytes} bytes.`),
    };
  }
  if (text.trim() === '') return { ok: true, body: {} as T };

  try {
    return { ok: true, body: JSON.parse(text) as T };
  } catch {
    return { ok: false, response: apiError('VALIDATION_ERROR', 'The request body is not valid JSON.') };
  }
}
