import Link from 'next/link';

import { ButtonLink } from '@/components/ui/button';
import { brand } from '@/lib/brand';

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className="size-7 rounded-md" width={28} height={28} />
      ) : (
        <span
          className="grid size-7 place-items-center rounded-md bg-primary text-primary-fg"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none">
            <path
              d="M5 14.5 10.5 9l4 4L20 7"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M15 7h5v5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      <span className="text-md font-semibold tracking-tight text-fg">{brand.name}</span>
    </Link>
  );
}

export function MarketingNav({ signedIn, homePath }: { signedIn: boolean; homePath: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/85 backdrop-blur-md">
      <nav
        className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
        aria-label="Main"
      >
        <div className="flex items-center gap-7">
          <Logo />
          <div className="hidden items-center gap-6 md:flex">
            <Link href="/campaigns" className="text-base text-fg-muted transition-colors hover:text-fg">
              Browse campaigns
            </Link>
            <Link href="/#how-it-works" className="text-base text-fg-muted transition-colors hover:text-fg">
              How it works
            </Link>
            <Link href="/#pricing" className="text-base text-fg-muted transition-colors hover:text-fg">
              Pricing
            </Link>
            <Link href="/docs/api" className="text-base text-fg-muted transition-colors hover:text-fg">
              Developers
            </Link>
          </div>
        </div>

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
  const groups: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
    {
      title: 'Product',
      links: [
        { label: 'Browse campaigns', href: '/campaigns' },
        { label: 'For creators', href: '/#creators' },
        { label: 'For brands', href: '/#brands' },
        { label: 'Pricing', href: '/#pricing' },
      ],
    },
    {
      title: 'Developers',
      links: [
        { label: 'API reference', href: '/docs/api' },
        { label: 'Conversion tracking', href: '/docs/tracking' },
        { label: 'Webhooks', href: '/docs/webhooks' },
        { label: 'Status', href: '/status' },
      ],
    },
    {
      title: 'Trust',
      links: [
        { label: 'Fraud protection', href: '/#fraud' },
        { label: 'Security', href: '/legal/security' },
        { label: 'Acceptable use', href: '/legal/acceptable-use' },
        { label: 'Campaign rules', href: '/legal/campaign-rules' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { label: 'Terms of service', href: '/legal/terms' },
        { label: 'Privacy policy', href: '/legal/privacy' },
        { label: 'Cookie policy', href: '/legal/cookies' },
        { label: 'Creator agreement', href: '/legal/creator-agreement' },
        { label: 'Brand agreement', href: '/legal/brand-agreement' },
      ],
    },
  ];

  return (
    <footer className="border-t border-border bg-surface-sunken/50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-fg-muted text-pretty">
              A performance marketplace connecting brands with creators and publishers who drive
              measurable results.
            </p>
          </div>

          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                {group.title}
              </h3>
              <ul className="mt-3 space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-fg-muted transition-colors hover:text-fg"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-fg-subtle">
            © {new Date().getFullYear()} {brand.legalName}. All rights reserved.
          </p>
          <p className="text-xs text-fg-subtle">
            {brand.name} is an advertising technology platform. It is not a bank, a broker, or an
            investment product, and it does not offer financial or tax advice.
          </p>
        </div>
      </div>
    </footer>
  );
}
