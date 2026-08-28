/**
 * Branding. Every user-visible name, colour and legal entity lives here and is
 * driven by environment variables, so re-skinning the product is a config
 * change rather than a code change.
 *
 * The defaults below are Audicents: AUDI (audience) + CENTS (value).
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
  name: pub('NEXT_PUBLIC_BRAND_NAME', 'Audicents'),
  tagline: pub('NEXT_PUBLIC_BRAND_TAGLINE', 'Turn your audience into income.'),
  legalName: pub('NEXT_PUBLIC_BRAND_LEGAL_NAME', 'Audicents, Inc.'),
  supportEmail: pub('NEXT_PUBLIC_BRAND_SUPPORT_EMAIL', 'support@audicents.com'),
  logoUrl: pub('NEXT_PUBLIC_BRAND_LOGO_URL', ''),
  /**
   * A white-label deployment can force one accent colour. When it is unset the
   * designed palette in globals.css applies, which is the only way the light
   * and dark themes can carry different accents.
   */
  primaryHslOverride: pub('NEXT_PUBLIC_BRAND_PRIMARY_HSL', ''),
  /** The accent to draw the generated favicon with. */
  markHsl: pub('NEXT_PUBLIC_BRAND_PRIMARY_HSL', '154 46% 20%'),
  appUrl: pub('NEXT_PUBLIC_APP_URL', 'http://localhost:3000').replace(/\/$/, ''),
  trackingUrl: (
    pub('NEXT_PUBLIC_TRACKING_URL', '') || pub('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
  ).replace(/\/$/, ''),
} as const;

/**
 * A publisher's tracking link.
 *
 * Codes are stored and matched in upper-case Crockford base32, but they are
 * shown lower-case: the link is read off a screen and typed by hand more often
 * than it is clicked, and a shouted URL looks like an error message. Resolution
 * normalises case, so both forms reach the same link.
 */
export function trackingLinkUrl(code: string): string {
  return `${brand.trackingUrl}/r/${code.toLowerCase()}`;
}
