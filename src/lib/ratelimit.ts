import { kv } from '@/lib/redis';

/**
 * Fixed-window rate limiting.
 *
 * A fixed window can admit up to 2x the limit across a window boundary. That is
 * an acceptable trade for these use cases (abuse suppression, not quota billing)
 * and it costs one atomic INCR rather than the multi-command dance a sliding
 * window needs — which matters on the redirect hot path.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/** Named policies, so limits are declared in one place and reviewable. */
export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 900 },
  loginPerAccount: { limit: 8, windowSeconds: 900 },
  signup: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
  emailVerification: { limit: 6, windowSeconds: 3600 },
  api: { limit: 600, windowSeconds: 60 },
  apiWrite: { limit: 120, windowSeconds: 60 },
  conversionIngest: { limit: 1200, windowSeconds: 60 },
  redirect: { limit: 300, windowSeconds: 60 },
  linkGeneration: { limit: 60, windowSeconds: 3600 },
  payoutRequest: { limit: 10, windowSeconds: 3600 },
  export: { limit: 20, windowSeconds: 3600 },
  disputeCreate: { limit: 20, windowSeconds: 3600 },
  mutation: { limit: 240, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export async function checkRateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];
  return consume(`rl:${name}:${identifier}`, rule);
}

export async function consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const bucketKey = `${key}:${windowStart}`;

  let count: number;
  try {
    count = await kv.incr(bucketKey, rule.windowSeconds);
  } catch {
    // Fail open: a rate-limiter outage should degrade protection, not deny
    // service. Abuse is still bounded by the other controls in the stack.
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit,
      resetAt: new Date(windowStart + windowMs),
      retryAfterSeconds: 0,
    };
  }

  const resetAt = new Date(windowStart + windowMs);
  const allowed = count <= rule.limit;
  return {
    allowed,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt,
    retryAfterSeconds: allowed ? 0 : Math.ceil((resetAt.getTime() - Date.now()) / 1000),
  };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)),
  };
  if (!result.allowed) headers['Retry-After'] = String(result.retryAfterSeconds);
  return headers;
}

export class RateLimitExceededError extends Error {
  constructor(public readonly result: RateLimitResult) {
    super('Rate limit exceeded');
    this.name = 'RateLimitExceededError';
  }
}

export async function enforceRateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const result = await checkRateLimit(name, identifier);
  if (!result.allowed) throw new RateLimitExceededError(result);
  return result;
}
