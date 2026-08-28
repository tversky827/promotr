'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { runAction } from '@/lib/client/submit';
import { cn } from '@/lib/cn';
import type { DemoRole } from '@/lib/demo/mode';
import type { ActionResult } from '@/server/actions/shared';
import { exitDemo, setPresentationMode, switchDemoRole } from '@/server/actions/demo';
import {
  simulateClicks,
  simulateConversion,
  simulateEarnings,
} from '@/server/actions/demo-simulate';

/**
 * The demo bar's controls: switch role, simulate traffic, present.
 *
 * Everything here posts to a server action and then refreshes the tree, so what
 * appears afterwards is what the database actually holds — none of these
 * buttons edit the screen they are on.
 */
export function DemoSwitcher({
  active,
  roles,
  presenting,
}: {
  active: DemoRole | null;
  roles: DemoRole[];
  presenting: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const call = async <T,>(
    key: string,
    act: (formData: FormData) => Promise<ActionResult<T>>,
    body: Record<string, string> = {},
  ): Promise<ActionResult<T> | null> => {
    setBusy(key);
    setMessage(null);
    const formData = new FormData();
    for (const [name, value] of Object.entries(body)) formData.set(name, value);

    const result = await runAction(act, formData);
    setBusy(null);

    if (!result.ok) {
      setMessage({ text: result.error, tone: 'error' });
      return result;
    }
    if (result.message) setMessage({ text: result.message, tone: 'ok' });
    return result;
  };

  /*
   * A full navigation rather than a client-side push. The switch replaces the
   * session, so every server component on the next screen has to be rendered
   * for a different user; a soft navigation would race the router cache against
   * a cookie that changed underneath it. This is one deliberate reload at a
   * moment the viewer expects the whole app to change.
   */
  const switchTo = async (role: DemoRole) => {
    const result = await call(role, switchDemoRole, { role });
    if (result?.ok) window.location.assign((result.data as { path: string }).path);
  };

  const simulate = async (
    key: string,
    act: (formData: FormData) => Promise<ActionResult<unknown>>,
    body: Record<string, string> = {},
  ) => {
    const result = await call(key, act, body);
    if (result?.ok) startTransition(() => router.refresh());
  };

  const working = busy !== null || pending;

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <div
          className="flex shrink-0 items-center gap-0.5 rounded-full border border-accent/25 bg-surface/60 p-0.5"
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
                disabled={working}
                onClick={() => void switchTo(role)}
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

        {active === 'creator' ? (
          <SimulateMenu
            busy={busy}
            disabled={working}
            onClicks={() => void simulate('clicks', simulateClicks, { count: '100' })}
            onConversion={() => void simulate('conversion', simulateConversion)}
            onEarnings={() => void simulate('earnings', simulateEarnings, { amount: '100' })}
          />
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <p
          role="status"
          className={cn(
            'hidden min-w-0 truncate text-2xs sm:block',
            message?.tone === 'error' ? 'text-danger' : message ? 'text-fg' : 'text-fg-muted',
          )}
        >
          {message?.text ?? 'Sample data. No real money moves.'}
        </p>

        <button
          type="button"
          disabled={working}
          aria-pressed={presenting}
          title="Hide exports, developer panels and secondary breakdowns"
          onClick={() =>
            void call('present', setPresentationMode, { on: presenting ? '0' : '1' }).then(
              (result) => {
                if (result?.ok) startTransition(() => router.refresh());
              },
            )
          }
          className={cn(
            // Presenting is a laptop activity; the button is not worth the
            // width it costs on a phone.
            'hidden shrink-0 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors disabled:opacity-60 sm:inline-flex',
            presenting
              ? 'border-accent bg-accent text-bg'
              : 'border-accent/30 text-fg-muted hover:text-fg',
          )}
        >
          {presenting ? 'Presenting' : 'Present'}
        </button>

        {active ? (
          <button
            type="button"
            disabled={working}
            onClick={() =>
              void call('exit', exitDemo).then((result) => {
                if (result?.ok) window.location.assign('/');
              })
            }
            className="shrink-0 text-2xs font-medium text-fg-muted underline-offset-2 transition-colors hover:text-fg hover:underline disabled:opacity-60"
          >
            {busy === 'exit' ? 'Leaving…' : <><span className="sm:hidden">Exit</span><span className="hidden sm:inline">Exit demo</span></>}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Traffic controls, behind a menu rather than on the bar: three buttons that
 * take seconds to run do not belong on a strip the whole product sits under.
 */
function SimulateMenu({
  busy,
  disabled,
  onClicks,
  onConversion,
  onEarnings,
}: {
  busy: string | null;
  disabled: boolean;
  onClicks: () => void;
  onConversion: () => void;
  onEarnings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const running = busy === 'clicks' || busy === 'conversion' || busy === 'earnings';

  return (
    <div ref={container} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded-full border border-accent/30 px-2.5 py-1 text-2xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-60"
      >
        {running ? <><span className="sm:hidden">…</span><span className="hidden sm:inline">Simulating…</span></> : 'Simulate'}
        <svg viewBox="0 0 20 20" className="size-3" fill="none" aria-hidden="true">
          <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1.5 w-[min(18rem,calc(100vw-1.5rem))] animate-slide-up rounded-lg border border-border bg-surface-raised p-1 shadow-lg"
        >
          <MenuItem
            onClick={() => run(onClicks)}
            title="Simulate 100 clicks"
            detail="Sends 100 visits through your best-paying link. Screened for duplicates and bots, exactly as live traffic is."
          />
          <MenuItem
            onClick={() => run(onConversion)}
            title="Simulate a conversion"
            detail="Reports a $120 order against a real click on a campaign that pays per conversion."
          />
          <MenuItem
            onClick={() => run(onEarnings)}
            title="Simulate $100 of earnings"
            detail="Sends as much qualified traffic as it takes to earn $100 — and stops if the campaign's budget runs out."
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  title,
  detail,
}: {
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none"
    >
      <span className="block text-sm font-medium text-fg">{title}</span>
      <span className="mt-0.5 block text-2xs leading-relaxed text-fg-subtle">{detail}</span>
    </button>
  );
}
