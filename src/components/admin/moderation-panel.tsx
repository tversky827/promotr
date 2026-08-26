'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, Card, CardHeader } from '@/components/ui/primitives';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { moderateCampaignDecision } from '@/server/actions/admin';

/**
 * Campaign moderation decision.
 *
 * A rejection requires a reason because the brand receives it verbatim and
 * needs to know what to change. Approval does not, since there is nothing to
 * act on.
 */
export function ModerationPanel({
  campaignId,
  status,
  csrfToken,
}: {
  campaignId: string;
  status: string;
  csrfToken: string;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const decide = (decision: 'APPROVED' | 'REJECTED' | 'SUSPENDED') => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('campaignId', campaignId);
      formData.set('decision', decision);
      formData.set('notes', notes);

      const result = await moderateCampaignDecision(formData);
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
        title="Moderation decision"
        description="The brand is emailed your decision and any notes."
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
        rows={4}
        placeholder="Required for a rejection. Explain specifically what needs to change — the brand sees this verbatim."
        aria-label="Moderation notes"
        className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      />

      <div className="mt-3 space-y-2">
        {status !== 'APPROVED' && status !== 'ACTIVE' ? (
          <Button fullWidth variant="success" loading={pending} onClick={() => decide('APPROVED')}>
            Approve campaign
          </Button>
        ) : null}
        {status !== 'REJECTED' ? (
          <Button
            fullWidth
            variant="danger"
            loading={pending}
            disabled={notes.trim().length < 5}
            onClick={() => decide('REJECTED')}
          >
            Reject
          </Button>
        ) : null}
        {status === 'ACTIVE' || status === 'APPROVED' ? (
          <Button
            fullWidth
            variant="secondary"
            loading={pending}
            disabled={notes.trim().length < 5}
            onClick={() => decide('SUSPENDED')}
          >
            Suspend
          </Button>
        ) : null}
      </div>

      <p className="mt-3 text-2xs text-fg-subtle text-pretty">
        Approving does not launch the campaign — the brand still funds and launches it. Suspending
        stops live traffic immediately.
      </p>
    </Card>
  );
}
