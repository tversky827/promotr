import { after } from 'next/server';
import type { NextRequest } from 'next/server';

import { brand } from '@/lib/brand';
import { logger } from '@/lib/observability/logger';
import { checkRateLimit } from '@/lib/ratelimit';
import { clientIpFrom, geoFrom } from '@/lib/request';
import { recordClick, resolveRedirect } from '@/lib/tracking/redirect';

/**
 * The redirect endpoint.
 *
 * This is the hottest path in the product and the one with the strictest
 * latency budget: a visitor is waiting, and every millisecond here is a
 * millisecond of drop-off for the publisher and the advertiser.
 *
 * The design keeps the response path to exactly two operations — resolve the
 * link (usually a cache hit) and build the destination URL. Everything else,
 * including fraud scoring, click persistence and earning accrual, runs in
 * `after()`, which Next.js executes once the response has been flushed.
 *
 * Node runtime rather than edge: the fraud engine and ledger need Prisma and
 * the Node crypto primitives. Running the redirect at the edge would move the
 * database round trip further away, not closer.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fallback when a code does not resolve. Never a 404 page for a visitor. */
const NOT_FOUND_DESTINATION = `${brand.appUrl}/campaigns?from=expired-link`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const startedAt = Date.now();
  const { code } = await params;

  const ip = clientIpFrom(request.headers);
  const geo = geoFrom(request.headers);

  // Cheap abuse ceiling. Deliberately generous: a genuinely viral post can send
  // a lot of traffic from one mobile carrier NAT, and throttling that would
  // punish the publisher. Real fraud detection happens after the response.
  const limit = await checkRateLimit('redirect', `${code}:${ip}`);
  if (!limit.allowed) {
    logger.warn('redirect.rate_limited', { code, retryAfter: limit.retryAfterSeconds });
    return redirectResponse(NOT_FOUND_DESTINATION, { 'Retry-After': String(limit.retryAfterSeconds) });
  }

  const url = new URL(request.url);

  const redirectRequest = {
    code,
    ip,
    userAgent: request.headers.get('user-agent'),
    referrer: request.headers.get('referer'),
    country: geo.country ?? null,
    region: geo.region ?? null,
    city: geo.city ?? null,
    query: url.searchParams,
  };

  let resolved;
  try {
    resolved = await resolveRedirect(redirectRequest);
  } catch (error) {
    // A database problem must not strand the visitor on an error page. Send
    // them somewhere sensible and record the failure.
    logger.error('redirect.resolve_failed', { code, error: (error as Error).message });
    return redirectResponse(NOT_FOUND_DESTINATION);
  }

  const { outcome, link, clickId } = resolved;

  if (outcome.kind === 'not_found') {
    return redirectResponse(NOT_FOUND_DESTINATION);
  }

  if (outcome.kind === 'inactive') {
    // The campaign is paused or the link was deactivated. The visitor gets a
    // page explaining it rather than a broken destination.
    return redirectResponse(
      `${brand.appUrl}/campaigns?from=inactive&reason=${encodeURIComponent(outcome.reason)}`,
    );
  }

  const latencyMs = Date.now() - startedAt;

  // Scoring, persistence and monetisation happen after the response is sent.
  if (link) {
    after(async () => {
      await recordClick({ clickId, link, request: redirectRequest, latencyMs });
    });
  }

  return redirectResponse(outcome.url, {
    // Tracking links must never be cached: every visit is a distinct event.
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    // Do not leak our URL (which contains the tracking code) to the advertiser.
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  });
}

/**
 * HEAD is used by link previews and security scanners. It resolves and
 * redirects without recording a click, so a Slack unfurl does not bill anyone.
 */
export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;
  try {
    const { outcome } = await resolveRedirect({
      code,
      ip: clientIpFrom(request.headers),
      userAgent: request.headers.get('user-agent'),
      referrer: null,
      country: null,
      region: null,
      city: null,
      query: new URL(request.url).searchParams,
    });
    return new Response(null, {
      status: outcome.kind === 'redirect' ? 302 : 302,
      headers: {
        Location: outcome.kind === 'redirect' ? outcome.url : NOT_FOUND_DESTINATION,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(null, { status: 302, headers: { Location: NOT_FOUND_DESTINATION } });
  }
}

function redirectResponse(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    // 302 rather than 301: a permanent redirect would be cached by browsers and
    // intermediaries, and subsequent visits would never reach us to be counted.
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      ...headers,
    },
  });
}
