import Link from 'next/link';

import { Logo } from '@/components/marketing/nav';
import { brand } from '@/lib/brand';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Link href="/campaigns" className="text-sm text-fg-muted transition-colors hover:text-fg">
            Browse campaigns
          </Link>
        </div>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="border-t border-border py-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2 px-4 text-xs text-fg-subtle sm:px-6">
          <span>
            © {new Date().getFullYear()} {brand.legalName}
          </span>
          <Link href="/legal/terms" className="hover:text-fg-muted">
            Terms
          </Link>
          <Link href="/legal/privacy" className="hover:text-fg-muted">
            Privacy
          </Link>
          <Link href={`mailto:${brand.supportEmail}`} className="hover:text-fg-muted">
            Support
          </Link>
        </div>
      </footer>
    </div>
  );
}
