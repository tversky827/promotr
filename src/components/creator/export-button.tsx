'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { requestCreatorExport } from '@/server/actions/creator';

/**
 * Requests an asynchronous CSV export. Large exports are generated in the
 * background rather than streamed inline, so a ninety-day pull cannot hit a
 * gateway timeout.
 */
export function ExportButton({
  kind,
  csrfToken,
  campaignId,
}: {
  kind: 'clicks' | 'conversions' | 'earnings' | 'payouts';
  csrfToken: string;
  campaignId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'queued' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const request = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('kind', kind);
      if (campaignId) formData.set('campaignId', campaignId);

      const result = await requestCreatorExport(formData);
      if (result.ok) {
        setState('queued');
        setMessage(result.message ?? 'Export started.');
      } else {
        setState('error');
        setMessage(result.error);
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {message ? (
        <span
          className={state === 'error' ? 'text-xs text-danger' : 'text-xs text-success'}
          role="status"
        >
          {message}
        </span>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={request}
        disabled={state === 'queued'}
      >
        {state === 'queued' ? 'Export queued' : 'Export CSV'}
      </Button>
    </div>
  );
}
