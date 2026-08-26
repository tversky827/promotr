import { integrations } from '@/lib/env';

/**
 * Google sign-in.
 *
 * Renders nothing at all when the integration is not configured — a button that
 * leads to "not configured" is worse than no button, and this is a server
 * component so the check costs nothing at render time.
 */
export function GoogleButton({
  next,
  label,
  note,
}: {
  next?: string;
  label: string;
  /** Shown under the button, e.g. to say what kind of account it creates. */
  note?: string;
}) {
  if (!integrations.google.configured) return null;

  const href = next ? `/api/auth/google?next=${encodeURIComponent(next)}` : '/api/auth/google';

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-fg-subtle">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <a
        href={href}
        className="mt-5 inline-flex h-9.5 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-base font-medium text-fg shadow-xs transition-colors hover:border-border-strong hover:bg-surface-sunken"
      >
        <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
          <path fill="#FBBC05" d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z" />
        </svg>
        {label}
      </a>

      {note ? <p className="mt-2 text-center text-xs text-fg-subtle text-pretty">{note}</p> : null}
    </div>
  );
}
