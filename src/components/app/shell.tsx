import Link from 'next/link';
import type { ReactNode } from 'react';

import { Logo } from '@/components/identity/logo';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

import { MobileNav, NavLink, ThemeToggle, UserMenu } from './shell-client';

/**
 * Application shell.
 *
 * One layout serves the brand, publisher, and admin apps: a fixed sidebar on
 * desktop, a slide-over on mobile. Navigation is passed in rather than derived,
 * so each app owns its own information architecture.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Rendered on the right of the item — unread counts, alert badges. */
  badge?: number | string;
  /** Match child routes too. Defaults to true for everything but the root. */
  exact?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export function AppShell({
  sections,
  children,
  user,
  contextLabel,
  contextName,
  notice,
}: {
  sections: NavSection[];
  children: ReactNode;
  user: { name: string; email: string; role: string; unread: number };
  /** e.g. "Brand" or "Publisher" — shown above the account name. */
  contextLabel: string;
  contextName: string;
  /** Persistent banner, e.g. "verify your email" or "Stripe not configured". */
  notice?: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
          <Logo />
        </div>

        <div className="border-b border-border px-4 py-3">
          <p className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">
            {contextLabel}
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-fg">{contextName}</p>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
          {sections.map((section, index) => (
            <div key={section.title ?? index}>
              {section.title ? (
                <h2 className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
                  {section.title}
                </h2>
              ) : null}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border p-3">
          <ThemeToggle />
        </div>
      </aside>

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur-md lg:pl-60">
        <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            <MobileNav sections={sections} contextLabel={contextLabel} contextName={contextName} />
            <Logo />
          </div>

          <div className="hidden lg:block" />

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="hidden text-sm text-fg-muted transition-colors hover:text-fg sm:block"
            >
              Marketplace
            </Link>
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      <main id="main" className="lg:pl-60">
        {notice ? <div className="border-b border-border px-4 py-3 sm:px-6">{notice}</div> : null}
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </main>
    </div>
  );
}

/** Tabbed sub-navigation for detail pages. */
export function TabNav({
  tabs,
  current,
}: {
  tabs: Array<{ href: string; label: string; count?: number }>;
  current: string;
}) {
  return (
    <div className="scroll-x mb-6 border-b border-border">
      <nav className="flex gap-1" aria-label="Section">
        {tabs.map((tab) => {
          const active = current === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative whitespace-nowrap px-3 py-2.5 text-base font-medium transition-colors',
                active ? 'text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {tab.label}
              {tab.count !== undefined ? (
                <Badge tone="neutral" className="ml-1.5">
                  {tab.count}
                </Badge>
              ) : null}
              {active ? (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
