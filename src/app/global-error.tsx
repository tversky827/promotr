'use client';

import { useEffect } from 'react';

/**
 * Last-resort error boundary.
 *
 * `error.tsx` catches everything that happens inside the layout. This catches
 * failures *of* the root layout itself, which is why it renders its own
 * `<html>` and its own styles: at this point nothing from the application can
 * be relied on, including the stylesheet.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Root layout error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem 1rem',
          background: '#fafbfd',
          color: '#0d1016',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.01em' }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: '0.75rem', lineHeight: 1.6, color: '#4b5563' }}>
            The page could not be loaded. This has been reported. Nothing you were doing was
            charged or paid — money only moves once an action completes.
          </p>
          {error.digest ? (
            <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#6b7280' }}>
              Reference <code>{error.digest}</code>
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              height: '2.375rem',
              padding: '0 1rem',
              borderRadius: '0.375rem',
              border: 0,
              background: '#4f46e5',
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
