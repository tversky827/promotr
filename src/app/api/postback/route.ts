import { apiErrorCodeFor, authenticateApiKey } from '@/lib/api/apikey';
import { apiError, apiRateLimited, apiSuccess, withApiErrorHandling } from '@/lib/api/response';
import { recordConversion } from '@/lib/conversions/record';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { tryParseAmount } from '@/lib/money';
import { checkRateLimit } from '@/lib/ratelimit';

/**
 * Server-to-server postback.
 *
 *   GET /api/postback?campaign_id=…&click_id=…&conversion_id=…&value=12.34
 *
 * A GET with query parameters rather than a JSON POST, because that is what
 * affiliate and ad platforms overwhelmingly emit — most can only be configured
 * with a URL template. Supporting the shape the ecosystem actually speaks
 * matters more than protocol purity here.
 *
 * Authentication accepts the API key as a query parameter in addition to a
 * header, again because many platforms cannot set headers. That is a real
 * trade-off: keys in query strings can end up in access logs. It is documented
 * in docs/API.md, the header form is recommended, and postback keys should be
 * scoped to `conversions:write` only.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandling(async (request: Request) => {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Allow the key in the query string for platforms that cannot set headers.
  const queryKey = params.get('key') ?? params.get('api_key');
  const authRequest = queryKey
    ? new Request(request.url, {
        headers: { ...Object.fromEntries(request.headers), authorization: `Bearer ${queryKey}` },
      })
    : request;

  const auth = await authenticateApiKey(authRequest, 'conversions:write');
  if (!auth.ok) {
    // Postback senders rarely surface response bodies, so the status code
    // carries the meaning. The body is logged for the brand's own debugging.
    logger.warn('postback.unauthorized', { reason: auth.reason });
    return apiError(apiErrorCodeFor(auth.reason), auth.message);
  }

  const limit = await checkRateLimit('conversionIngest', auth.auth.brand.id);
  if (!limit.allowed) return apiRateLimited(limit);

  const campaignId = params.get('campaign_id') ?? params.get('cid');
  const clickId = params.get('click_id') ?? params.get('pmtr_click') ?? params.get('clickid');
  const conversionId =
    params.get('conversion_id') ?? params.get('order_id') ?? params.get('txid');
  const value = params.get('value') ?? params.get('amount') ?? params.get('revenue');
  const eventType = params.get('event_type')?.toUpperCase();

  if (!campaignId || !conversionId) {
    return apiError('VALIDATION_ERROR', 'campaign_id and conversion_id are required.');
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, brandId: auth.auth.brand.id },
    select: { id: true },
  });
  if (!campaign) {
    return apiError('NOT_FOUND', 'No campaign with that id exists on this account.');
  }

  const revenueMicros = value ? (tryParseAmount(value) ?? 0n) : 0n;

  const result = await recordConversion({
    campaignId,
    clickId,
    externalId: conversionId,
    eventType:
      eventType && ['CLICK', 'IMPRESSION', 'LEAD', 'SALE', 'CUSTOM'].includes(eventType)
        ? (eventType as never)
        : undefined,
    revenueMicros: revenueMicros < 0n ? 0n : revenueMicros,
    currency: params.get('currency')?.toLowerCase(),
    source: 's2s',
    metadata: { sub_id: params.get('subid') ?? undefined },
  });

  if (!result.ok) {
    logger.info('postback.rejected', { campaignId, conversionId, reason: result.code });
    return apiError('VALIDATION_ERROR', result.message, { details: { reason: result.code } });
  }

  return apiSuccess({
    status: result.conversion.status,
    duplicate: result.duplicate,
    conversion_id: result.conversion.externalId,
  });
});
