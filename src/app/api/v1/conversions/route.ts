import { z } from 'zod';

import { apiErrorCodeFor, authenticateApiKey } from '@/lib/api/apikey';
import {
  apiError,
  apiRateLimited,
  apiSuccess,
  corsPreflight,
  PUBLIC_CORS_HEADERS,
  readJsonBody,
  withApiErrorHandling,
} from '@/lib/api/response';
import { recordConversion, type ConversionRejection } from '@/lib/conversions/record';
import { prisma } from '@/lib/db';
import { tryParseAmount } from '@/lib/money';
import { checkRateLimit } from '@/lib/ratelimit';

/**
 * Conversion reporting API.
 *
 *   POST /api/v1/conversions
 *   Authorization: Bearer pk_live_...
 *   {
 *     "campaign_id": "…",
 *     "click_id": "…",          // the adc_click value from your landing page
 *     "conversion_id": "order-1042",
 *     "value": "129.99",         // optional; drives revenue-share payouts
 *     "currency": "usd",
 *     "event_type": "SALE"
 *   }
 *
 * De-duplication is on `conversion_id` within a campaign, so retrying a failed
 * request or firing the pixel twice cannot double-charge the advertiser. The
 * duplicate response is a 200 with `duplicate: true` — a retry is a success,
 * not an error.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const conversionSchema = z.object({
  campaign_id: z.string().uuid('campaign_id must be a campaign UUID'),
  click_id: z.string().uuid('click_id must be the adc_click value').optional().nullable(),
  conversion_id: z
    .string()
    .trim()
    .min(1, 'conversion_id is required so duplicates can be detected')
    .max(190, 'conversion_id is too long'),
  event_type: z.enum(['CLICK', 'IMPRESSION', 'LEAD', 'SALE', 'CUSTOM']).optional(),
  /** Accepts a number or a decimal string; parsed exactly, never via float. */
  value: z.union([z.string(), z.number()]).optional().nullable(),
  currency: z.string().length(3).optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const POST = withApiErrorHandling(async (request: Request) => {
  const auth = await authenticateApiKey(request, 'conversions:write');
  if (!auth.ok) {
    return apiError(
      apiErrorCodeFor(auth.reason),
      auth.message,
      { headers: PUBLIC_CORS_HEADERS },
    );
  }

  const limit = await checkRateLimit('conversionIngest', auth.auth.brand.id);
  if (!limit.allowed) return apiRateLimited(limit);

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = conversionSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'The request body did not validate.', {
      details: {
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
      headers: PUBLIC_CORS_HEADERS,
    });
  }

  const input = parsed.data;

  // The campaign must belong to the authenticating brand. Without this an API
  // key could report conversions against a competitor's campaign.
  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaign_id, brandId: auth.auth.brand.id },
    select: { id: true },
  });
  if (!campaign) {
    return apiError('NOT_FOUND', 'No campaign with that id exists on this account.', {
      headers: PUBLIC_CORS_HEADERS,
    });
  }

  let revenueMicros = 0n;
  if (input.value !== undefined && input.value !== null && input.value !== '') {
    const parsedValue = tryParseAmount(String(input.value));
    if (parsedValue === null || parsedValue < 0n) {
      return apiError('VALIDATION_ERROR', 'value must be a non-negative decimal amount.', {
        headers: PUBLIC_CORS_HEADERS,
      });
    }
    revenueMicros = parsedValue;
  }

  // An explicit Idempotency-Key header lets a client make retries safe even
  // when it cannot guarantee a stable conversion_id.
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || undefined;

  const result = await recordConversion({
    campaignId: input.campaign_id,
    clickId: input.click_id ?? null,
    externalId: input.conversion_id,
    eventType: input.event_type,
    revenueMicros,
    quantity: input.quantity,
    currency: input.currency?.toLowerCase(),
    source: 'api',
    metadata: input.metadata,
    idempotencyKey,
  });

  if (!result.ok) {
    return apiError(rejectionCode(result.code), result.message, {
      details: { reason: result.code },
      headers: PUBLIC_CORS_HEADERS,
    });
  }

  return apiSuccess(
    {
      id: result.conversion.id,
      conversion_id: result.conversion.externalId,
      status: result.conversion.status,
      duplicate: result.duplicate,
      publisher_payout: result.conversion.payoutMicros,
      platform_fee: result.conversion.feeMicros,
      currency: result.conversion.currency,
      recorded_at: result.conversion.createdAt,
    },
    { status: result.duplicate ? 200 : 201, headers: PUBLIC_CORS_HEADERS },
  );
});

/** Look up a previously reported conversion. */
export const GET = withApiErrorHandling(async (request: Request) => {
  const auth = await authenticateApiKey(request, 'campaigns:read');
  if (!auth.ok) {
    return apiError(apiErrorCodeFor(auth.reason), auth.message, {
      headers: PUBLIC_CORS_HEADERS,
    });
  }

  const url = new URL(request.url);
  const conversionId = url.searchParams.get('conversion_id');
  const campaignId = url.searchParams.get('campaign_id');

  if (!conversionId || !campaignId) {
    return apiError('VALIDATION_ERROR', 'Both campaign_id and conversion_id are required.', {
      headers: PUBLIC_CORS_HEADERS,
    });
  }

  const conversion = await prisma.conversion.findFirst({
    where: {
      externalId: conversionId,
      campaignId,
      campaign: { brandId: auth.auth.brand.id },
    },
  });

  if (!conversion) {
    return apiError('NOT_FOUND', 'No conversion with that id was found.', {
      headers: PUBLIC_CORS_HEADERS,
    });
  }

  return apiSuccess(
    {
      id: conversion.id,
      conversion_id: conversion.externalId,
      status: conversion.status,
      status_reason: conversion.statusReason,
      revenue: conversion.revenueMicros,
      publisher_payout: conversion.payoutMicros,
      platform_fee: conversion.feeMicros,
      currency: conversion.currency,
      event_type: conversion.eventType,
      source: conversion.source,
      recorded_at: conversion.createdAt,
      approved_at: conversion.approvedAt,
    },
    { headers: PUBLIC_CORS_HEADERS },
  );
});

export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

function rejectionCode(reason: ConversionRejection) {
  switch (reason) {
    case 'CAMPAIGN_NOT_FOUND':
      return 'NOT_FOUND' as const;
    case 'CAMPAIGN_INACTIVE':
    case 'PUBLISHER_SUSPENDED':
    case 'BUDGET_EXHAUSTED':
      return 'CONFLICT' as const;
    case 'NO_ATTRIBUTION':
    case 'ATTRIBUTION_EXPIRED':
    case 'INVALID_INPUT':
    default:
      return 'VALIDATION_ERROR' as const;
  }
}
