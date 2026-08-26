import { authenticateApiKey } from '@/lib/api/apikey';
import { apiError, apiRateLimited, apiSuccess, withApiErrorHandling } from '@/lib/api/response';
import { derive, timeSeries, totals } from '@/lib/analytics/queries';
import { prisma } from '@/lib/db';
import { checkRateLimit } from '@/lib/ratelimit';

/** Aggregated performance for one campaign, read from the hourly rollups. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandling(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const auth = await authenticateApiKey(request, 'reports:read');
    if (!auth.ok) return apiError('UNAUTHORIZED', auth.message);

    const limit = await checkRateLimit('api', auth.auth.brand.id);
    if (!limit.allowed) return apiRateLimited(limit);

    const { id } = await context.params;

    // Scope check: the campaign must belong to the authenticating brand.
    const campaign = await prisma.campaign.findFirst({
      where: { id, brandId: auth.auth.brand.id },
      select: { id: true, name: true },
    });
    if (!campaign) {
      return apiError('NOT_FOUND', 'No campaign with that id exists on this account.');
    }

    const url = new URL(request.url);
    const from = url.searchParams.get('from')
      ? new Date(url.searchParams.get('from')!)
      : new Date(Date.now() - 30 * 86_400_000);
    const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : new Date();

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return apiError('VALIDATION_ERROR', 'from and to must be valid ISO dates.');
    }

    const range = { from, to };
    const [metrics, series] = await Promise.all([
      totals({ campaignId: campaign.id }, range).then(derive),
      timeSeries({ campaignId: campaign.id }, range, 'day'),
    ]);

    return apiSuccess({
      campaign: { id: campaign.id, name: campaign.name },
      range: { from, to },
      totals: {
        clicks: metrics.clicks,
        qualified_clicks: metrics.qualifiedClicks,
        unique_visitors: metrics.uniqueVisitors,
        impressions: metrics.impressions,
        conversions: metrics.conversions,
        spend: metrics.grossMicros,
        publisher_payouts: metrics.netMicros,
        platform_fees: metrics.feeMicros,
        reported_revenue: metrics.revenueMicros,
        conversion_rate: Number(metrics.conversionRate.toFixed(4)),
        cost_per_click: metrics.cpcMicros,
        cost_per_acquisition: metrics.cpaMicros,
        roas: metrics.roas,
      },
      daily: series.map((point) => ({
        date: point.bucket,
        clicks: point.clicks,
        qualified_clicks: point.qualifiedClicks,
        conversions: point.conversions,
        spend: point.grossMicros,
        revenue: point.revenueMicros,
      })),
      // Stated explicitly so a client knows how live these numbers are.
      freshness: 'Aggregated hourly; the current hour is recomputed continuously.',
    });
  },
);
