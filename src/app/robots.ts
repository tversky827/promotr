import type { MetadataRoute } from 'next';

import { brand } from '@/lib/brand';

/**
 * robots.txt.
 *
 * Tracking links, the API, and every authenticated surface are excluded.
 * Indexing /r/ would be actively harmful: a crawler following tracking links
 * generates clicks that publishers do not benefit from and that we then have to
 * screen out.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/campaigns', '/legal/', '/docs/'],
        disallow: [
          '/r/',
          // The previous path, still served for links already in the wild.
          '/go/',
          '/px/',
          '/api/',
          '/sdk/',
          '/admin/',
          '/brand/',
          '/creator/',
          '/onboarding/',
          '/login',
          '/signup',
          '/verify-email',
          '/reset-password',
          '/forgot-password',
        ],
      },
    ],
    sitemap: `${brand.appUrl}/sitemap.xml`,
    host: brand.appUrl,
  };
}
