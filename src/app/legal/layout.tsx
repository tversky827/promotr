import Link from 'next/link';

import { MarketingFooter, MarketingNav } from '@/components/marketing/nav';
import { homePathFor } from '@/lib/auth/guards';
import { getSession } from '@/lib/auth/session';

const DOCUMENTS = [
  { href: '/legal/terms', label: 'Terms of Service' },
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/cookies', label: 'Cookie Policy' },
  { href: '/legal/creator-agreement', label: 'Creator Agreement' },
  { href: '/legal/brand-agreement', label: 'Brand Agreement' },
  { href: '/legal/acceptable-use', label: 'Acceptable Use Policy' },
  { href: '/legal/campaign-rules', label: 'Campaign Rules' },
  { href: '/legal/security', label: 'Security' },
];

export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <>
      <MarketingNav
        signedIn={Boolean(session)}
        homePath={session ? homePathFor(session.user.role) : '/login'}
      />
      <main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
          <nav aria-label="Legal documents" className="lg:sticky lg:top-20 lg:self-start">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              Documents
            </h2>
            <ul className="space-y-0.5">
              {DOCUMENTS.map((doc) => (
                <li key={doc.href}>
                  <Link
                    href={doc.href}
                    className="block rounded-md px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
                  >
                    {doc.label}
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
