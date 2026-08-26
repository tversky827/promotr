import type { MetadataRoute } from 'next';

import { brand } from '@/lib/brand';
import { prisma } from '@/lib/db';

/**
 * Sitemap.
 *
 * Includes public campaign pages, which is the point: a campaign page ranking
 * for "<product> affiliate program" is how publishers discover the marketplace.
 * Campaigns the brand marked unlisted are excluded.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${brand.appUrl}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${brand.appUrl}/campaigns`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${brand.appUrl}/signup`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${brand.appUrl}/docs/tracking`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${brand.appUrl}/docs/api`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${brand.appUrl}/docs/webhooks`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${brand.appUrl}/legal/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${brand.appUrl}/legal/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${brand.appUrl}/legal/cookies`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${brand.appUrl}/legal/acceptable-use`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${brand.appUrl}/legal/campaign-rules`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${brand.appUrl}/legal/creator-agreement`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${brand.appUrl}/legal/brand-agreement`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${brand.appUrl}/legal/security`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  try {
    const campaigns = await prisma.campaign.findMany({
      where: { status: 'ACTIVE', isPublic: true },
      select: { slug: true, updatedAt: true },
      orderBy: { launchedAt: 'desc' },
      take: 5000,
    });

    return [
      ...staticPages,
      ...campaigns.map((campaign) => ({
        url: `${brand.appUrl}/campaigns/${campaign.slug}`,
        lastModified: campaign.updatedAt,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ];
  } catch {
    // A database problem must not break the sitemap entirely.
    return staticPages;
  }
}
