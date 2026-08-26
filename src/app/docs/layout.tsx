import Link from 'next/link';

import { MarketingFooter, MarketingNav } from '@/components/marketing/nav';
import { homePathFor } from '@/lib/auth/guards';
import { getSession } from '@/lib/auth/session';

const PAGES = [
  { href: '/docs/tracking', label: 'Conversion tracking' },
  { href: '/docs/api', label: 'REST API' },
  { href: '/docs/webhooks', label: 'Webhooks' },
];

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <>
      <MarketingNav
        signedIn={Boolean(session)}
        homePath={session ? homePathFor(session.user.role) : '/login'}
      />
      <main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[200px_1fr]">
          <nav aria-label="Documentation" className="lg:sticky lg:top-20 lg:self-start">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              Developers
            </h2>
            <ul className="space-y-0.5">
              {PAGES.map((page) => (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    className="block rounded-md px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
                  >
                    {page.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <article className="min-w-0 max-w-3xl">{children}</article>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
