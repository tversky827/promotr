import { apiErrorCodeFor, authenticateApiKey } from '@/lib/api/apikey';
import { apiError, apiRateLimited, apiSuccess, withApiErrorHandling } from '@/lib/api/response';
import { availableMicros } from '@/lib/billing/budget';
import { prisma } from '@/lib/db';
import { checkRateLimit } from '@/lib/ratelimit';

/** Lists the authenticating brand's campaigns with live budget position. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandling(async (request: Request) => {
  const auth = await authenticateApiKey(request, 'campaigns:read');
  if (!auth.ok) return apiError(apiErrorCodeFor(auth.reason), auth.message);

  const limit = await checkRateLimit('api', auth.auth.brand.id);
  if (!limit.allowed) return apiRateLimited(limit);

  const url = new URL(request.url);
  const status = url.searchParams.get('status');

  const campaigns = await prisma.campaign.findMany({
    where: {
      brandId: auth.auth.brand.id,
      ...(status ? { status: status as never } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(url.searchParams.get('limit') ?? '50') || 50, 200),
    include: { budget: true },
  });

  return apiSuccess({
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      slug: campaign.slug,
      status: campaign.status,
      payout_model: campaign.payoutModel,
      publisher_payout: campaign.payoutMicros,
      revshare_bps: campaign.revshareBps,
      category: campaign.category,
      destination_url: campaign.destinationUrl,
      requires_approval: campaign.requiresApproval,
      attribution_window_hours: campaign.attributionWindowHours,
      budget: campaign.budget
        ? {
            funded: campaign.budget.fundedMicros,
            available: availableMicros(campaign.budget),
            committed: campaign.budget.reservedMicros,
            spent: campaign.budget.spentMicros,
          }
        : null,
      created_at: campaign.createdAt,
      launched_at: campaign.launchedAt,
    })),
  });
});
