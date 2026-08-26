'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { runAction } from '@/lib/client/submit';
import { decidePayout, runPayoutNow } from '@/server/actions/admin';

/**
 * Payout approval.
 *
 * Approving is a two-step interaction because it moves real money: the reason
 * field appears first, and only then does the confirm button.
 */
export function PayoutRowActions({
  payoutId,
  status,
  csrfToken,
  stripeConfigured,
}: {
  payoutId: string;
  status: string;
  csrfToken: string;
  stripeConfigured: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decidable = status === 'REQUESTED' || status === 'ON_HOLD';
  const runnable = status === 'APPROVED';

  const decide = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('payoutId', payoutId);
      formData.set('decision', mode === 'approve' ? 'approve' : 'reject');
      formData.set('reason', reason);

      const result = await runAction(decidePayout, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMode('idle');
      setReason('');
      router.refresh();
    });
  };

  const runNow = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('payoutId', payoutId);
      const result = await runAction(runPayoutNow, formData);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  };

  if (mode !== 'idle') {
    return (
      <div className="w-64 text-left">
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          placeholder={
            mode === 'approve'
              ? 'Reason for approval (audit record)'
              : 'Reason shown to the publisher'
          }
          aria-label="Reason"
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none"
        />
        {error ? <p className="mt-1 text-2xs text-danger">{error}</p> : null}
        <div className="mt-1.5 flex gap-1.5">
          <Button
            size="xs"
            variant={mode === 'approve' ? 'success' : 'danger'}
            loading={pending}
            disabled={reason.trim().length < 10}
            onClick={decide}
          >
            Confirm
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setMode('idle')}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {error ? <span className="text-2xs text-danger">{error}</span> : null}
      {decidable ? (
        <>
          <Button size="xs" variant="success" onClick={() => setMode('approve')}>
            Approve
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setMode('reject')}>
            Reject
          </Button>
        </>
      ) : runnable && stripeConfigured ? (
        <Button size="xs" variant="secondary" loading={pending} onClick={runNow}>
          Send now
        </Button>
      ) : (
        <span className="text-2xs text-fg-subtle">—</span>
      )}
    </div>
  );
}
