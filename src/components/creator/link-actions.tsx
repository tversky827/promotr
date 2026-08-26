'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { runAction } from '@/lib/client/submit';
import { deactivateTrackingLink } from '@/server/actions/links';

/**
 * Per-row link actions: copy and deactivate.
 *
 * Deactivation asks for confirmation because it silently stops a link that may
 * be embedded in already-published content.
 */
export function LinkRowActions({
  linkId,
  url,
  active,
  csrfToken,
}: {
  linkId: string;
  url: string;
  active: boolean;
  csrfToken: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copying failed. Select the link text and copy manually.');
    }
  };

  const deactivate = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('linkId', linkId);
      const result = await runAction(deactivateTrackingLink, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-end gap-1.5">
      {error ? (
        <span className="text-2xs text-danger" role="alert">
          {error}
        </span>
      ) : null}

      <Button size="xs" variant={copied ? 'success' : 'secondary'} onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </Button>

      {active ? (
        confirming ? (
          <>
            <Button size="xs" variant="danger" loading={pending} onClick={deactivate}>
              Confirm
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="xs" variant="ghost" onClick={() => setConfirming(true)}>
            Deactivate
          </Button>
        )
      ) : null}
    </div>
  );
}
