import { authenticateApiKey } from '@/lib/api/apikey';
import { recordConversion } from '@/lib/conversions/record';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { tryParseAmount } from '@/lib/money';
import { checkRateLimit } from '@/lib/ratelimit';

/**
 * Conversion pixel.
 *
 *   <img src="https://…/px/c?k=pk_live_…&c=<campaign>&id=<order>&v=12.34" …>
 *
 * The no-JavaScript option, for brands whose only integration point is a
 * thank-you page template or an email receipt. It always returns a 1×1 GIF with
 * HTTP 200, whatever happens internally: an <img> that 404s produces a broken
 * image icon on the advertiser's own confirmation page, which is a worse
 * outcome for them than a silently-unrecorded conversion.
 *
 * Failures are logged and visible in the brand's dashboard instead.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Smallest valid transparent GIF. */
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

function pixelResponse(status: string): Response {
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      // Lets a brand debug their integration from the browser network tab
      // without the pixel ever failing visibly on their page.
      'X-Audicents-Status': status,
      'Access-Control-Allow-Origin': '*',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;

    const key = params.get('k') ?? params.get('key');
    const campaignId = params.get('c') ?? params.get('campaign_id');
    const conversionId = params.get('id') ?? params.get('conversion_id');
    const clickId = params.get('click') ?? params.get('adc_click');
    const value = params.get('v') ?? params.get('value');

    if (!key || !campaignId || !conversionId) {
      logger.info('pixel.missing_params', { hasKey: Boolean(key), campaignId, conversionId });
      return pixelResponse('missing-parameters');
    }

    const authRequest = new Request(request.url, {
      headers: { authorization: `Bearer ${key}` },
    });
    const auth = await authenticateApiKey(authRequest, 'conversions:write');
    if (!auth.ok) {
      logger.warn('pixel.unauthorized', { reason: auth.reason, campaignId });
      return pixelResponse('unauthorized');
    }

    const limit = await checkRateLimit('conversionIngest', auth.auth.brand.id);
    if (!limit.allowed) return pixelResponse('rate-limited');

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, brandId: auth.auth.brand.id },
      select: { id: true },
    });
    if (!campaign) return pixelResponse('campaign-not-found');

    const result = await recordConversion({
      campaignId,
      clickId,
      externalId: conversionId,
      revenueMicros: value ? (tryParseAmount(value) ?? 0n) : 0n,
      currency: params.get('cur')?.toLowerCase(),
      source: 'pixel',
    });

    if (!result.ok) {
      logger.info('pixel.rejected', { campaignId, conversionId, reason: result.code });
      return pixelResponse(`rejected:${result.code}`);
    }

    return pixelResponse(result.duplicate ? 'duplicate' : 'recorded');
  } catch (error) {
    logger.error('pixel.error', { error: (error as Error).message });
    return pixelResponse('error');
  }
}
