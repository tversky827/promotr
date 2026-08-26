import type { Metadata, Viewport } from 'next';

import { brand } from '@/lib/brand';

import './globals.css';

/**
 * Root layout.
 *
 * The brand accent is injected as a CSS variable at render time, which is what
 * lets NEXT_PUBLIC_BRAND_PRIMARY_HSL re-theme the whole product without a
 * rebuild. The theme script runs before paint to avoid a flash of the wrong
 * theme; it is the only inline script in the application.
 */

export const metadata: Metadata = {
  metadataBase: new URL(brand.appUrl),
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description:
    'A performance marketplace where brands pay creators and publishers for measurable results. Discover campaigns, get a tracking link, promote, and earn.',
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
      'Brands pay creators and publishers for measurable performance. Discover campaigns, get your tracking link, promote, and earn.',
    url: brand.appUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${brand.name} — ${brand.tagline}`,
    description: 'Brands pay creators and publishers for measurable performance.',
  },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafbfd' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1016' },
  ],
};

/**
 * Applies the stored theme before first paint. Wrapped in try/catch because
 * localStorage throws in private-browsing modes in some browsers.
 */
const THEME_SCRIPT = `
try {
  var stored = localStorage.getItem('theme');
  var dark = stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <style
          dangerouslySetInnerHTML={{
            __html: `:root{--primary:${brand.primaryHsl};}`,
          }}
        />
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
