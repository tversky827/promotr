'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { runAction } from '@/lib/client/submit';
import { updatePlatformSetting } from '@/server/actions/admin';

/**
 * A single platform setting.
 *
 * Each saves independently rather than as one large form, so a typo in one
 * field cannot block an unrelated urgent change — and so the audit log records
 * exactly which setting changed.
 */
export function SettingsEditor({
  settingKey,
  label,
  description,
  value,
  kind,
  csrfToken,
}: {
  settingKey: string;
  label: string;
  description: string;
  value: string;
  kind: 'boolean' | 'number' | 'list' | 'text';
  csrfToken: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(value);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const dirty = draft !== value;

  const save = (override?: string) => {
    const next = override ?? draft;
    setState('idle');
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('key', settingKey);
      formData.set('value', next);

      const result = await runAction(updatePlatformSetting, formData);
      if (!result.ok) {
        setState('error');
        setError(result.error);
        return;
      }
      setState('saved');
      router.refresh();
      setTimeout(() => setState('idle'), 2500);
    });
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <label htmlFor={`setting-${settingKey}`} className="font-mono text-sm font-medium text-fg">
          {label}
        </label>
        <p className="mt-0.5 text-xs text-fg-muted text-pretty">{description}</p>
        {error ? (
          <p className="mt-1 text-xs font-medium text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:w-80">
        {kind === 'boolean' ? (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              id={`setting-${settingKey}`}
              type="checkbox"
              checked={draft === 'true'}
              disabled={pending}
              onChange={(event) => {
                const next = event.target.checked ? 'true' : 'false';
                setDraft(next);
                save(next);
              }}
              className="size-4 rounded border-border-strong accent-[hsl(var(--primary))]"
            />
            <span className="text-sm text-fg-muted">{draft === 'true' ? 'Enabled' : 'Disabled'}</span>
          </label>
        ) : (
          <>
            <input
              id={`setting-${settingKey}`}
              type={kind === 'number' ? 'text' : 'text'}
              inputMode={kind === 'number' ? 'numeric' : 'text'}
              value={draft}
              disabled={pending}
              onChange={(event) => setDraft(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-sm text-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
            <Button
              size="sm"
              variant={dirty ? 'primary' : 'secondary'}
              loading={pending}
              disabled={!dirty}
              onClick={() => save()}
            >
              Save
            </Button>
          </>
        )}

        {state === 'saved' ? (
          <span className="text-xs font-medium text-success" role="status">
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
