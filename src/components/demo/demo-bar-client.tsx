'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { CSRF_FIELD } from '@/lib/auth/constants';
import { runAction } from '@/lib/client/submit';
import { cn } from '@/lib/cn';
import type { DemoRole } from '@/lib/demo/mode';
import { exitDemo, switchDemoRole } from '@/server/actions/demo';

/**
 * The role switcher. Two pills, one request, no sign-in screen: the action
 * swaps the session server-side and this refreshes the tree so the next paint
 * is the other side of the marketplace.
 */
export function DemoSwitcher({
  active,
  roles,
  csrfToken,
}: {
  active: DemoRole | null;
  roles: DemoRole[];
  csrfToken: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<DemoRole | 'exit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    key: DemoRole | 'exit',
    action: (formData: FormData) => Promise<Awaited<ReturnType<typeof switchDemoRole>>>,
    body: Record<string, string>,
  ) => {
    setBusy(key);
    setError(null);
    const formData = new FormData();
    formData.set(CSRF_FIELD, csrfToken);
    for (const [name, value] of Object.entries(body)) formData.set(name, value);

    const result = await runAction(action, formData);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    startTransition(() => {
      router.push(result.data.path);
      router.refresh();
    });
  };

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div
        className="flex items-center gap-0.5 rounded-full border border-accent/25 bg-surface/60 p-0.5"
        role="group"
        aria-label="Demo role"
      >
        {roles.map((role) => {
          const selected = active === role;
          return (
            <button
              key={role}
              type="button"
              aria-pressed={selected}
              disabled={busy !== null || pending}
              onClick={() => void run(role, switchDemoRole, { role })}
              className={cn(
                'rounded-full px-3 py-1 text-2xs font-semibold uppercase tracking-[0.12em] transition-colors disabled:opacity-60',
                selected
                  ? 'bg-primary text-primary-fg'
                  : 'text-fg-muted hover:bg-surface hover:text-fg',
              )}
            >
              {busy === role ? '…' : role}
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 items-center gap-3">
        {error ? (
          <p className="truncate text-2xs text-danger" role="alert">
            {error}
          </p>
        ) : (
          <p className="hidden truncate text-2xs text-fg-muted sm:block">
            Sample data. No real money moves.
          </p>
        )}
        {active ? (
          <button
            type="button"
            disabled={busy !== null || pending}
            onClick={() => void run('exit', exitDemo, {})}
            className="shrink-0 text-2xs font-medium text-fg-muted underline-offset-2 transition-colors hover:text-fg hover:underline disabled:opacity-60"
          >
            {busy === 'exit' ? 'Leaving…' : 'Exit demo'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
