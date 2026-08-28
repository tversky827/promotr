import Link from 'next/link';

import { Logo } from '@/components/identity/logo';
import { ButtonLink } from '@/components/ui/button';
import { brand } from '@/lib/brand';

export function MarketingNav({ signedIn, homePath }: { signedIn: boolean; homePath: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/85 backdrop-blur-md">
      <nav
        className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6"
        aria-label="Main"
      >
        <Logo />

        <div className="flex items-center gap-2">
          {signedIn ? (
            <ButtonLink href={homePath} size="sm">
              Dashboard
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm">
                Sign in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Get started
              </ButtonLink>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  const links = [
    { label: 'Terms', href: '/legal/terms' },
    { label: 'Privacy', href: '/legal/privacy' },
    { label: 'Security', href: '/legal/security' },
    { label: 'Acceptable use', href: '/legal/acceptable-use' },
    { label: 'API', href: '/docs/api' },
    { label: 'Status', href: '/status' },
  ];

  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs text-fg-subtle">
          © {new Date().getFullYear()} {brand.legalName}. {brand.name} is an advertising platform,
          not an investment or a guarantee of income.
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-xs text-fg-subtle transition-colors hover:text-fg-muted"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
