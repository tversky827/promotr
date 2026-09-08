import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';

import { DemoBar } from '@/components/demo/demo-bar';
import { brand } from '@/lib/brand';
import { demoReady } from '@/lib/demo/mode';

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
  // One value rather than a prefers-color-scheme pair: the page defaults to
  // light for everyone, so tinting a dark-mode phone's chrome to match a theme
  // it will not render would be the mismatch, not the fix.
  themeColor: '#f8f6f2',
};

/**
 * Applies the stored theme before first paint.
 *
 * Light is the default: warm paper with deep forest ink. The dark forest ground
 * is the more striking of the two, but a marketplace is read for minutes at a
 * time in daylight, and that is the condition to design the default for. Dark
 * stays a click away in the sidebar.
 *
 * The OS preference is deliberately not consulted. Someone whose laptop is in
 * dark mode would otherwise land on the dark theme, which is precisely what the
 * default is choosing not to do; the in-app toggle is the way to ask for it.
 *
 * Wrapped in try/catch because localStorage throws in private-browsing modes in
 * some browsers — where the fallback is the light default, not an exception.
 */
const THEME_SCRIPT = `
try {
  if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
} catch (e) {}
`.trim();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * The demo bar is sticky and sits above everything, so the sticky headers
   * underneath it need to know how tall it is. The `demo-mode` class sets
   * --app-top; without it the headers fall back to 0px and nothing about the
   * layout changes. demoReady() short-circuits when DEMO_MODE is off, so a
   * normal deployment does not query for this on every request.
   */
  const showDemoBar = await demoReady();
  return (
    <html
      lang="en"
      className={`${sans.variable}${showDemoBar ? ' demo-mode' : ''}`}
      suppressHydrationWarning
    >
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
        {showDemoBar ? <DemoBar /> : null}
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
