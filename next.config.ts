import type { NextConfig } from 'next';

/**
 * Security headers applied to every response. The CSP is intentionally strict:
 * the app ships no inline scripts except the theme bootstrap, which carries a
 * per-request nonce injected by middleware.
 */
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  serverExternalPackages: ['@prisma/client'],
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/.prisma/client/**'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      // Redirect responses must not leak our URL — which contains the
      // publisher's tracking code — to the advertiser. These rules are listed
      // after the global one so they override the site-wide Referrer-Policy,
      // and they cover both the current path and the one still in the wild.
      ...['/r/:code*', '/go/:code*'].map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
        ],
      })),
      {
        // The embeddable tracking SDK must be loadable cross-origin by brands.
        source: '/sdk/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600' },
        ],
      },
    ];
  },
};

export default config;
