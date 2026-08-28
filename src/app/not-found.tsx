import Link from 'next/link';

import { ButtonLink } from '@/components/ui/button';
import { Logo } from '@/components/marketing/nav';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="max-w-md text-center">
          <p className="text-sm font-medium text-fg-subtle">404</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg text-balance">
            We could not find that page
          </h1>
          <p className="mt-3 text-md text-fg-muted text-pretty">
            The link may be broken, or the page may have moved. If you followed a tracking link that
            no longer works, the campaign has probably ended.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
            <ButtonLink href="/">Browse campaigns</ButtonLink>
            <ButtonLink href="/" variant="secondary">
              Go home
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm text-fg-subtle">
            <Link href="/login" className="hover:text-fg-muted">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
