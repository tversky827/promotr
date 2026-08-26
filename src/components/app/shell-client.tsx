'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Logo } from '@/components/marketing/nav';
import { cn } from '@/lib/cn';
import { logout } from '@/server/actions/auth';

import type { NavItem, NavSection } from './shell';

/** Interactive parts of the shell. Kept minimal so the shell stays server-rendered. */

export function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = item.exact ?? false ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-base transition-colors',
        active
          ? 'bg-primary-soft font-medium text-primary'
          : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
      )}
    >
      <span className="shrink-0" aria-hidden="true">
        {item.icon}
      </span>
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge !== undefined && item.badge !== 0 ? (
        <span className="shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-2xs font-semibold text-white">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

export function MobileNav({
  sections,
  contextLabel,
  contextName,
}: {
  sections: NavSection[];
  contextLabel: string;
  contextName: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on navigation, so a link tap does not leave the drawer covering the page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes; body scroll is locked while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
      >
        <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden="true">
          <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/45 animate-fade-in"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-xl animate-slide-up"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <Logo />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-sunken hover:text-fg"
              >
                <svg viewBox="0 0 20 20" className="size-4.5" fill="none" aria-hidden="true">
                  <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </button>
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
                        <NavLink item={item} onNavigate={() => setOpen(false)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>

            <div className="shrink-0 border-t border-border p-3">
              <ThemeToggle />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function UserMenu({
  user,
}: {
  user: { name: string; email: string; role: string; unread: number };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const settingsPath =
    user.role === 'ADMIN'
      ? '/admin/settings'
      : user.role === 'CREATOR'
        ? '/creator/settings'
        : '/brand/settings';

  return (
    <div className="relative flex items-center gap-1" ref={ref}>
      <Link
        href={user.role === 'CREATOR' ? '/creator/notifications' : '/notifications'}
        className="relative grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
        aria-label={
          user.unread > 0 ? `Notifications, ${user.unread} unread` : 'Notifications'
        }
      >
        <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden="true">
          <path
            d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3-1 4-1.5 4.5h12c-.5-.5-1.5-1.5-1.5-4.5A4.5 4.5 0 0 0 10 3ZM8.5 15a1.5 1.5 0 0 0 3 0"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {user.unread > 0 ? (
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-danger ring-2 ring-bg" />
        ) : null}
      </Link>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-sunken"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
          {initials(user.name)}
        </span>
        <svg viewBox="0 0 20 20" className="size-4 text-fg-subtle" fill="none" aria-hidden="true">
          <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-lg animate-slide-up"
        >
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-sm font-medium text-fg">{user.name}</p>
            <p className="truncate text-xs text-fg-subtle">{user.email}</p>
          </div>

          <div className="p-1">
            <Link
              href={settingsPath}
              role="menuitem"
              className="block rounded px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
            >
              Account settings
            </Link>
            <Link
              href="/campaigns"
              role="menuitem"
              className="block rounded px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
            >
              Browse campaigns
            </Link>
            <Link
              href="/docs/api"
              role="menuitem"
              className="block rounded px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
            >
              API documentation
            </Link>
          </div>

          <form action={logout} className="border-t border-border p-1">
            <button
              type="submit"
              role="menuitem"
              className="w-full rounded px-2.5 py-1.5 text-left text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const apply = (next: 'light' | 'dark') => {
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Private browsing can block storage; the toggle still works for the session.
    }
  };

  return (
    <div
      className="flex items-center gap-1 rounded-md bg-surface-sunken p-0.5"
      role="group"
      aria-label="Colour theme"
    >
      {(['light', 'dark'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => apply(option)}
          aria-pressed={theme === option}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors',
            theme === option ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
          )}
        >
          {option === 'light' ? (
            <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M10 2v1.5M10 16.5V18M18 10h-1.5M3.5 10H2M15.7 4.3l-1 1M5.3 14.7l-1 1M15.7 15.7l-1-1M5.3 5.3l-1-1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden="true">
              <path
                d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <span className="capitalize">{option}</span>
        </button>
      ))}
    </div>
  );
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
