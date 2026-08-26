'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, Card, CardHeader, Separator } from '@/components/ui/primitives';
import { CSRF_FIELD } from '@/lib/auth/constants';
import {
  adjustCreatorBalance,
  setCreatorStatus,
  setPayoutHold,
  suspendUser,
  reactivateUser,
} from '@/server/actions/admin';

/**
 * Publisher administration.
 *
 * Every control here requires a written reason, because every one of them is
 * recorded permanently and several of them affect someone's money. The balance
 * adjustment states plainly that it posts a ledger transaction, so an operator
 * understands it is auditable rather than a quiet override.
 */
export function CreatorAdminPanel({
  creatorId,
  userId,
  verification,
  payoutHold,
  userStatus,
  csrfToken,
}: {
  creatorId: string;
  userId: string;
  verification: string;
  payoutHold: boolean;
  userStatus: string;
  csrfToken: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reasonTooShort = reason.trim().length < 10;

  const run = (
    fn: (formData: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>,
    fields: Record<string, string>,
  ) => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('reason', reason);
      for (const [key, value] of Object.entries(fields)) formData.set(key, value);

      const result = await fn(formData);
      if (!result.ok) {
        setError(result.error ?? 'That did not work.');
        return;
      }
      setMessage(result.message ?? 'Done.');
      setReason('');
      setAmount('');
      router.refresh();
    });
  };

  return (
    <Card className="border-primary/25">
      <CardHeader
        title="Administration"
        description="Every action here is recorded with your identity and reason."
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

      <div className="mt-4">
        <label htmlFor="admin-reason" className="text-xs font-medium text-fg">
          Reason (required)
        </label>
        <textarea
          id="admin-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder="Reviewed click logs following a brand dispute; traffic pattern is consistent with bot activity."
          className="mt-1.5 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
        />
        {reasonTooShort ? (
          <p className="mt-1 text-2xs text-fg-subtle">At least 10 characters.</p>
        ) : null}
      </div>

      <Separator className="my-4" />

      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Account status
      </h3>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {verification !== 'VERIFIED' ? (
          <Button
            size="sm"
            variant="success"
            loading={pending}
            disabled={reasonTooShort}
            onClick={() => run(setCreatorStatus, { creatorId, decision: 'VERIFIED' })}
          >
            Verify
          </Button>
        ) : null}
        {verification !== 'RESTRICTED' ? (
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            disabled={reasonTooShort}
            onClick={() => run(setCreatorStatus, { creatorId, decision: 'RESTRICTED' })}
          >
            Restrict
          </Button>
        ) : null}
        {verification !== 'SUSPENDED' ? (
          <Button
            size="sm"
            variant="danger"
            loading={pending}
            disabled={reasonTooShort}
            onClick={() => run(setCreatorStatus, { creatorId, decision: 'SUSPENDED' })}
          >
            Suspend publisher
          </Button>
        ) : null}
        {userStatus === 'SUSPENDED' ? (
          <Button
            size="sm"
            variant="success"
            loading={pending}
            disabled={reasonTooShort}
            onClick={() => run(reactivateUser, { userId })}
          >
            Reactivate login
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            loading={pending}
            disabled={reasonTooShort}
            onClick={() => run(suspendUser, { userId })}
          >
            Suspend login
          </Button>
        )}
      </div>

      <Separator className="my-4" />

      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Payouts</h3>
      <div className="mt-2">
        <Button
          size="sm"
          fullWidth
          variant={payoutHold ? 'success' : 'secondary'}
          loading={pending}
          disabled={reasonTooShort}
          onClick={() => run(setPayoutHold, { creatorId, hold: payoutHold ? 'false' : 'true' })}
        >
          {payoutHold ? 'Release payout hold' : 'Hold payouts'}
        </Button>
        <p className="mt-1.5 text-2xs text-fg-subtle text-pretty">
          A hold stops withdrawals without touching the balance. The publisher is told why.
        </p>
      </div>

      <Separator className="my-4" />

      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Balance adjustment
      </h3>
      <div className="mt-2 space-y-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">
            $
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            aria-label="Adjustment amount"
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-6 pr-3 text-sm text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            variant="success"
            loading={pending}
            disabled={reasonTooShort || amount.trim() === ''}
            onClick={() => run(adjustCreatorBalance, { creatorId, direction: 'credit', amount })}
          >
            Credit
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={pending}
            disabled={reasonTooShort || amount.trim() === ''}
            onClick={() => run(adjustCreatorBalance, { creatorId, direction: 'debit', amount })}
          >
            Debit
          </Button>
        </div>
        <p className="text-2xs text-fg-subtle text-pretty">
          Posts a double-entry ledger transaction against platform revenue. The publisher is
          notified, and the before/after balance is recorded in the audit log.
        </p>
      </div>
    </Card>
  );
}
