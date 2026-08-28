import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';

import { brand } from '@/lib/brand';

import './globals.css';

/**
 * Root layout.
 *
 * A brand accent override is injected as a CSS variable at render time, which
 * is what lets NEXT_PUBLIC_BRAND_PRIMARY_HSL re-theme the whole product without
 * a rebuild. It is only emitted when set, so that by default the designed light
 * and dark palettes in globals.css can carry different accents. The theme
 * script runs before paint to avoid a flash of the wrong theme; it is the only
 * inline script in the application.
 */

/**
 * Manrope: a modern grotesque with the confidence a money product needs and
 * enough warmth for a consumer marketplace. Self-hosted by next/font, so there
 * is no third-party request on any page load.
 */
const sans = Manrope({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-brand-sans',
});

export const metadata: Metadata = {
  metadataBase: new URL(brand.appUrl),
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description:
    'Where attention gets paid. Brands pay creators for measurable results — find a campaign, get your tracking link, promote it, and earn on what it delivers.',
  applicationName: brand.name,
  keywords: [
    'performance marketing',
    'affiliate marketplace',
    'creator monetisation',
    'CPA network',
    'publisher network',
  ],
  authors: [{ name: brand.legalName }],
  openGraph: {
    type: 'website',
    siteName: brand.name,
    title: `${brand.name} — ${brand.tagline}`,
    description:
      'Brands pay creators for measurable performance. Find a campaign, get your tracking link, promote it, and earn on what it delivers.',
    url: brand.appUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${brand.name} — ${brand.tagline}`,
    description: 'Where attention gets paid.',
  },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f6f2' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1613' },
  ],
};

/**
 * Applies the stored theme before first paint. Dark is the default — the deep
 * forest ground is the brand — so only an explicit choice of light opts out.
 * Wrapped in try/catch because localStorage throws in private-browsing modes in
 * some browsers.
 */
const THEME_SCRIPT = `
try {
  if (localStorage.getItem('theme') !== 'light') document.documentElement.classList.add('dark');
} catch (e) { document.documentElement.classList.add('dark'); }
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {brand.primaryHslOverride ? (
          <style
            dangerouslySetInnerHTML={{
              __html: `:root,.dark{--primary:${brand.primaryHslOverride};}`,
            }}
          />
        ) : null}
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
