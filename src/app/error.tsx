'use client';

import { useEffect } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';

/**
 * Application error boundary.
 *
 * Shows a stable reference (Next.js supplies a digest for server errors) rather
 * than a stack trace. The user gets something they can quote to support; the
 * detail goes to the server log and to error monitoring.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server has already reported this via instrumentation's
    // onRequestError. This is the client-side half.
    console.error('Application error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-danger-soft text-danger">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden="true">
            <path
              d="M12 8v5m0 3.5v.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-fg text-balance">
          Something went wrong
        </h1>
        <p className="mt-3 text-md text-fg-muted text-pretty">
          This is our fault, not yours. The problem has been reported and nothing you were doing has
          been lost.
        </p>

        {error.digest ? (
          <p className="mt-4 text-sm text-fg-subtle">
            Reference:{' '}
            <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-xs text-fg-muted">
              {error.digest}
            </code>
          </p>
        ) : null}

        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/" variant="secondary">
            Go home
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
