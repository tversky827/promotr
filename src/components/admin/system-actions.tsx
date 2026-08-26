'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { retryJob, runReconciliation } from '@/server/actions/admin';

/** Operational controls: force a reconciliation, or re-queue a dead job. */
export function SystemActions({
  csrfToken,
  retryJobId,
  compact,
}: {
  csrfToken: string;
  retryJobId?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const reconcile = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      const result = await runReconciliation(formData);
      setMessage(result.ok ? (result.message ?? 'Done.') : result.error);
      router.refresh();
    });
  };

  const retry = () => {
    if (!retryJobId) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('jobId', retryJobId);
      const result = await retryJob(formData);
      setMessage(result.ok ? 'Re-queued.' : result.error);
      router.refresh();
    });
  };

  if (compact) {
    return (
      <Button size="xs" variant="secondary" loading={pending} onClick={retry}>
        Re-queue
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {message ? <span className="text-xs text-fg-muted">{message}</span> : null}
      <Button variant="secondary" size="sm" loading={pending} onClick={reconcile}>
        Run reconciliation
      </Button>
    </div>
  );
}
