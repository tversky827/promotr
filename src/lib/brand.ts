/**
 * Branding. Every user-visible name, colour and legal entity lives here and is
 * driven by environment variables, so re-skinning the product is a config
 * change rather than a code change.
 */

function pub(key: string, fallback: string): string {
  // NEXT_PUBLIC_* are inlined at build time, so they must be referenced literally.
  const map: Record<string, string | undefined> = {
    NEXT_PUBLIC_BRAND_NAME: process.env.NEXT_PUBLIC_BRAND_NAME,
    NEXT_PUBLIC_BRAND_TAGLINE: process.env.NEXT_PUBLIC_BRAND_TAGLINE,
    NEXT_PUBLIC_BRAND_LEGAL_NAME: process.env.NEXT_PUBLIC_BRAND_LEGAL_NAME,
    NEXT_PUBLIC_BRAND_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL,
    NEXT_PUBLIC_BRAND_LOGO_URL: process.env.NEXT_PUBLIC_BRAND_LOGO_URL,
    NEXT_PUBLIC_BRAND_PRIMARY_HSL: process.env.NEXT_PUBLIC_BRAND_PRIMARY_HSL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_TRACKING_URL: process.env.NEXT_PUBLIC_TRACKING_URL,
  };
  const v = map[key];
  return v === undefined || v === '' ? fallback : v;
}

export const brand = {
  name: pub('NEXT_PUBLIC_BRAND_NAME', 'Promotr'),
  tagline: pub('NEXT_PUBLIC_BRAND_TAGLINE', 'Get paid to drive traffic.'),
  legalName: pub('NEXT_PUBLIC_BRAND_LEGAL_NAME', 'Promotr, Inc.'),
  supportEmail: pub('NEXT_PUBLIC_BRAND_SUPPORT_EMAIL', 'support@example.com'),
  logoUrl: pub('NEXT_PUBLIC_BRAND_LOGO_URL', ''),
  primaryHsl: pub('NEXT_PUBLIC_BRAND_PRIMARY_HSL', '243 75% 59%'),
  appUrl: pub('NEXT_PUBLIC_APP_URL', 'http://localhost:3000').replace(/\/$/, ''),
  trackingUrl: (
    pub('NEXT_PUBLIC_TRACKING_URL', '') || pub('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
  ).replace(/\/$/, ''),
} as const;

export function trackingLinkUrl(code: string): string {
  return `${brand.trackingUrl}/go/${code}`;
}
