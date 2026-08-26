'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader } from '@/components/ui/primitives';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { runAction } from '@/lib/client/submit';
import { addDisputeMessage, resolveDispute } from '@/server/actions/disputes';

export interface ThreadMessage {
  id: string;
  body: string;
  internal: boolean;
  createdAt: string;
  authorName: string;
  authorRole: string;
  isYou: boolean;
}

/**
 * Dispute thread.
 *
 * Participants see the conversation and can reply. Administrators additionally
 * get internal notes (never shown to participants) and the status controls —
 * a counterparty must not be able to close a dispute against themselves.
 */
export function DisputeThread({
  disputeId,
  status,
  messages,
  csrfToken,
  isAdmin,
}: {
  disputeId: string;
  status: string;
  messages: ThreadMessage[];
  csrfToken: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const closed = status === 'RESOLVED' || status === 'REJECTED';

  const send = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('disputeId', disputeId);
      formData.set('body', body);
      if (internal) formData.set('internal', 'on');

      const result = await runAction(addDisputeMessage, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody('');
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="p-5">
          <CardHeader title="Conversation" description={`${messages.length} message(s)`} />
        </div>

        <ol className="divide-y divide-border border-t border-border">
          {messages.map((message) => (
            <li
              key={message.id}
              className={message.internal ? 'bg-warning-soft/25 p-5' : 'p-5'}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-fg">
                  {message.isYou ? 'You' : message.authorName}
                </span>
                <Badge tone={message.authorRole === 'ADMIN' ? 'primary' : 'neutral'}>
                  {message.authorRole === 'ADMIN'
                    ? 'Platform'
                    : message.authorRole === 'CREATOR'
                      ? 'Publisher'
                      : 'Brand'}
                </Badge>
                {message.internal ? <Badge tone="warning">Internal note</Badge> : null}
                <span className="text-2xs text-fg-subtle">{message.createdAt}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted text-pretty">
                {message.body}
              </p>
            </li>
          ))}
        </ol>
      </Card>

      {closed ? (
        <Alert tone={status === 'RESOLVED' ? 'success' : 'neutral' as 'info'}>
          This dispute is {status.toLowerCase()}. Reply below if you have new information — an
          administrator will reopen it if warranted.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Reply" />
        {error ? (
          <Alert tone="danger" className="mt-3">
            {error}
          </Alert>
        ) : null}
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          disabled={pending}
          placeholder="Add evidence, timestamps, screenshots links, or anything else that helps resolve this."
          aria-label="Your reply"
          className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-base leading-relaxed text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {isAdmin ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={internal}
                onChange={(event) => setInternal(event.target.checked)}
                className="size-3.5 rounded border-border-strong accent-[hsl(var(--primary))]"
              />
              Internal note — not visible to participants
            </label>
          ) : (
            <span />
          )}
          <Button loading={pending} disabled={body.trim() === ''} onClick={send}>
            Send
          </Button>
        </div>
      </Card>

      {isAdmin ? <AdminControls disputeId={disputeId} status={status} csrfToken={csrfToken} /> : null}
    </div>
  );
}

function AdminControls({
  disputeId,
  status,
  csrfToken,
}: {
  disputeId: string;
  status: string;
  csrfToken: string;
}) {
  const router = useRouter();
  const [resolution, setResolution] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const apply = (next: string) => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('disputeId', disputeId);
      formData.set('status', next);
      formData.set('resolution', resolution);

      const result = await runAction(resolveDispute, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setResolution('');
      router.refresh();
    });
  };

  const tooShort = resolution.trim().length < 10;

  return (
    <Card className="border-primary/25">
      <CardHeader
        title="Resolve"
        description="Both parties see this explanation and are notified."
      />
      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}
      <textarea
        value={resolution}
        onChange={(event) => setResolution(event.target.value)}
        rows={3}
        placeholder="We reviewed the click logs for the period in question. The traffic pattern is consistent with a legitimate newsletter send, so the earnings have been released."
        aria-label="Resolution"
        className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-base leading-relaxed text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="success" loading={pending} disabled={tooShort} onClick={() => apply('RESOLVED')}>
          Resolve in favour
        </Button>
        <Button size="sm" variant="danger" loading={pending} disabled={tooShort} onClick={() => apply('REJECTED')}>
          Reject
        </Button>
        {status !== 'AWAITING_INFORMATION' ? (
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            disabled={tooShort}
            onClick={() => apply('AWAITING_INFORMATION')}
          >
            Request information
          </Button>
        ) : null}
        {status === 'OPEN' ? (
          <Button
            size="sm"
            variant="ghost"
            loading={pending}
            disabled={tooShort}
            onClick={() => apply('INVESTIGATING')}
          >
            Mark investigating
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-2xs text-fg-subtle">
        Resolving a dispute does not itself move money. Use the fraud console or a ledger adjustment
        to make the corresponding financial change, which is separately audited.
      </p>
    </Card>
  );
}
