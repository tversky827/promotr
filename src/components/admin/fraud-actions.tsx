'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { resolveFraudEvent, setPayoutHold } from '@/server/actions/admin';

/**
 * Fraud decision controls.
 *
 * A note is mandatory before any decision: it becomes the audit record and, for
 * a rejection, the explanation the publisher receives. Requiring it in the UI
 * (as well as in the action) makes the expectation obvious rather than a
 * surprise validation error.
 */
export function FraudActions({
  fraudEventId,
  creatorId,
  csrfToken,
}: {
  fraudEventId: string;
  creatorId: string | null;
  csrfToken: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const noteTooShort = note.trim().length < 10;

  const decide = (resolution: 'approved' | 'rejected' | 'investigating') => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('fraudEventId', fraudEventId);
      formData.set('resolution', resolution);
      formData.set('note', note);

      const result = await resolveFraudEvent(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? 'Resolved.');
      router.refresh();
    });
  };

  const holdPayouts = () => {
    if (!creatorId) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('creatorId', creatorId);
      formData.set('hold', 'true');
      formData.set('reason', note.trim() || 'Payouts held pending traffic quality investigation');

      const result = await setPayoutHold(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage('Payout hold placed.');
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-border bg-surface-sunken/40 p-3">
      <label htmlFor={`note-${fraudEventId}`} className="text-xs font-medium text-fg">
        Decision note
      </label>
      <textarea
        id={`note-${fraudEventId}`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        placeholder="Reviewed the click pattern; traffic is consistent with the publisher's newsletter send."
        className="mt-1.5 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      />
      <p className="mt-1 text-2xs text-fg-subtle">
        Recorded in the audit log. A rejection note is shown to the publisher.
      </p>

      {error ? (
        <p className="mt-2 text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-2 text-xs font-medium text-success" role="status">
          {message}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant="success"
          loading={pending}
          disabled={noteTooShort}
          onClick={() => decide('approved')}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="danger"
          loading={pending}
          disabled={noteTooShort}
          onClick={() => decide('rejected')}
        >
          Reject
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={noteTooShort}
          onClick={() => decide('investigating')}
        >
          Investigate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={pending}
          disabled={!creatorId}
          onClick={holdPayouts}
        >
          Hold payouts
        </Button>
      </div>

      {noteTooShort ? (
        <p className="mt-2 text-2xs text-fg-subtle">Write at least 10 characters to decide.</p>
      ) : null}
    </div>
  );
}
