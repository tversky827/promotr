'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, Card, CardHeader } from '@/components/ui/primitives';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { decideBrandVerification } from '@/server/actions/admin';

/** Brand verification decision. Notes reach the brand verbatim. */
export function BrandAdminPanel({
  brandId,
  verification,
  csrfToken,
}: {
  brandId: string;
  verification: string;
  csrfToken: string;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const decide = (decision: 'VERIFIED' | 'REJECTED' | 'SUSPENDED') => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('brandId', brandId);
      formData.set('decision', decision);
      formData.set('notes', notes);

      const result = await decideBrandVerification(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? 'Done.');
      setNotes('');
      router.refresh();
    });
  };

  return (
    <Card className="border-primary/25">
      <CardHeader
        title="Verification"
        description="Check the business is real and the website matches before verifying."
      />

      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}
      {message ? (
        <Alert tone="success" className="mt-3">
          {message}
        </Alert>
      ) : null}

      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={3}
        placeholder="Notes shown to the brand. Required for a rejection."
        aria-label="Verification notes"
        className="mt-3 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      />

      <div className="mt-3 space-y-2">
        {verification !== 'VERIFIED' ? (
          <Button fullWidth variant="success" loading={pending} onClick={() => decide('VERIFIED')}>
            Verify business
          </Button>
        ) : null}
        {verification !== 'REJECTED' ? (
          <Button
            fullWidth
            variant="secondary"
            loading={pending}
            disabled={notes.trim().length < 5}
            onClick={() => decide('REJECTED')}
          >
            Reject verification
          </Button>
        ) : null}
        {verification !== 'SUSPENDED' ? (
          <Button
            fullWidth
            variant="danger"
            loading={pending}
            disabled={notes.trim().length < 5}
            onClick={() => decide('SUSPENDED')}
          >
            Suspend account
          </Button>
        ) : null}
      </div>

      <p className="mt-3 text-2xs text-fg-subtle text-pretty">
        Suspending pauses every live campaign immediately. Publisher earnings already accrued are
        unaffected — they delivered the traffic.
      </p>
    </Card>
  );
}
