'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader } from '@/components/ui/primitives';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { runAction } from '@/lib/client/submit';
import { startPayoutSetup, withdrawEarnings } from '@/server/actions/creator';

/**
 * Payout panel.
 *
 * Its job is to tell a publisher exactly what stands between them and their
 * money, and give them the one button that resolves it. Every blocked state
 * names its cause and its remedy — a disabled button with no explanation is
 * how a marketplace loses trust with the people it owes money to.
 */
export function PayoutPanel({
  csrfToken,
  availableMicros,
  minimumMicros,
  eligible,
  blockReason,
  blockCode,
  stripeConfigured,
  payoutsEnabled,
  hasConnectAccount,
  requirementsDue,
  taxFormStatus,
  demoRail = false,
}: {
  csrfToken: string;
  availableMicros: string;
  minimumMicros: string;
  eligible: boolean;
  blockReason: string | null;
  blockCode: string | null;
  stripeConfigured: boolean;
  payoutsEnabled: boolean;
  hasConnectAccount: boolean;
  requirementsDue: string[];
  taxFormStatus: string | null;
  /**
   * A demo account is paid over an internal rail: the ledger movement is real,
   * but nothing leaves the platform, so there is no payment provider to connect
   * and the destination is asked for rather than looked up.
   */
  demoRail?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | null>(null);

  const available = BigInt(availableMicros);
  const minimum = BigInt(minimumMicros);
  const progress = minimum > 0n ? Number((available * 100n) / minimum) : 100;

  const withdraw = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      const result = await runAction(withdrawEarnings, formData);
      if (result.ok) {
        setDestination(null);
        setSuccess(result.message ?? 'Withdrawal initiated.');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  const connect = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await startPayoutSetup();
        if (result.ok) {
          // Stripe-hosted onboarding; a full navigation, not an iframe.
          window.location.href = result.data.url;
        } else {
          setError(result.error);
        }
      } catch {
        setError('Payout setup could not be started. Try again shortly.');
      }
    });
  };

  // The integration is genuinely unavailable. Say so plainly rather than
  // showing a button that cannot work.
  if (!stripeConfigured && !demoRail) {
    return (
      <Card>
        <CardHeader title="Payouts" />
        <Alert tone="warning" className="mt-4" title="Payouts are not available">
          This deployment has no payment provider configured, so withdrawals cannot be processed.
          Your balance is safe and continues to accrue. Contact support for a timeline.
        </Alert>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Withdraw"
        action={
          demoRail ? (
            <Badge tone="neutral">Demo payout</Badge>
          ) : payoutsEnabled ? (
            <Badge tone="success" dot>
              Connected
            </Badge>
          ) : (
            <Badge tone="warning">Setup needed</Badge>
          )
        }
      />

      <div className="mt-4">
        <p className="text-2xl font-semibold tabular-nums tracking-tight text-fg">
          {formatAmount(available)}
        </p>
        <p className="mt-0.5 text-sm text-fg-muted">available to withdraw</p>
      </div>

      {available < minimum ? (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-fg-subtle">
            <span>Progress to minimum</span>
            <span className="tabular-nums">
              {formatAmount(available)} / {formatAmount(minimum)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.max(Math.min(progress, 100), 2)}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}
      {success ? (
        <Alert tone="success" className="mt-4">
          {success}
        </Alert>
      ) : null}

      <div className="mt-5">
        {eligible ? (
          <Button fullWidth size="lg" loading={pending} onClick={() => setDestination('bank')}>
            Withdraw {formatAmount(available)}
          </Button>
        ) : !hasConnectAccount && !demoRail ? (
          <>
            <Button fullWidth loading={pending} onClick={connect}>
              Set up payouts
            </Button>
            <p className="mt-2 text-xs text-fg-subtle text-pretty">
              Identity and bank details are collected by our payment provider, not by us. You will
              be taken to their secure onboarding.
            </p>
          </>
        ) : !payoutsEnabled && !demoRail ? (
          <>
            <Button fullWidth loading={pending} onClick={connect}>
              Finish payout setup
            </Button>
            {requirementsDue.length > 0 ? (
              <div className="mt-3 rounded-md border border-warning/30 bg-warning-soft/40 p-3">
                <p className="text-xs font-medium text-warning">Still needed</p>
                <ul className="mt-1 space-y-0.5">
                  {requirementsDue.slice(0, 6).map((requirement) => (
                    <li key={requirement} className="text-xs text-fg-muted">
                      {humanizeRequirement(requirement)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <Button fullWidth disabled>
              Withdraw
            </Button>
            {blockReason ? (
              <Alert
                tone={blockCode === 'PAYOUT_HOLD' || blockCode === 'SUSPENDED' ? 'warning' : 'info'}
                className="mt-3"
              >
                {blockReason}
              </Alert>
            ) : null}
            {blockCode === 'NO_TAX_FORM' ? (
              <p className="mt-2 text-xs text-fg-subtle text-pretty">
                Tax information is collected during payout onboarding. We do not provide tax advice
                — consult a professional about your own obligations.
              </p>
            ) : null}
          </>
        )}
      </div>

      {destination !== null ? (
        <WithdrawDialog
          amount={formatAmount(available)}
          destination={destination}
          onDestination={setDestination}
          onConfirm={withdraw}
          onCancel={() => setDestination(null)}
          pending={pending}
          demoRail={demoRail}
        />
      ) : null}

      {payoutsEnabled || demoRail ? (
        <dl className="mt-5 space-y-2 border-t border-border pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-fg-muted">Payout minimum</dt>
            <dd className="text-xs tabular-nums text-fg">{formatAmount(minimum)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-fg-muted">Tax status</dt>
            <dd className="text-xs text-fg">
              {taxFormStatus === 'verified'
                ? 'On file'
                : taxFormStatus === 'submitted'
                  ? 'Submitted'
                  : 'Not submitted'}
            </dd>
          </div>
        </dl>
      ) : null}
    </Card>
  );
}

const DESTINATIONS = [
  { value: 'bank', label: 'Bank transfer', detail: 'Two to three business days' },
  { value: 'paypal', label: 'PayPal', detail: 'Usually within a day' },
  { value: 'other', label: 'Somewhere else', detail: 'Wise, Payoneer, and others' },
] as const;

/**
 * The withdrawal confirmation.
 *
 * A withdrawal is the one action in the product a publisher cannot undo, so it
 * asks once, in a dialog that states the amount and where it is going. On a
 * demo account it also says plainly that no money moves — the ledger entries it
 * writes are real, and the destination is not.
 */
function WithdrawDialog({
  amount,
  destination,
  onDestination,
  onConfirm,
  onCancel,
  pending,
  demoRail,
}: {
  amount: string;
  destination: string;
  onDestination: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
  demoRail: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-shadow/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-heading"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md animate-slide-up rounded-xl border border-border bg-surface-raised p-5 shadow-xl">
        <h2 id="withdraw-heading" className="text-lg font-semibold tracking-tight text-fg">
          Withdraw {amount}
        </h2>
        <p className="mt-1 text-sm text-fg-muted text-pretty">
          {demoRail
            ? 'This is a demo account, so no money leaves the platform. The balance moves through the same ledger entries a real withdrawal writes, and the payout is recorded as a demo payment.'
            : 'Your whole available balance will be sent to your connected payout account.'}
        </p>

        <fieldset className="mt-4">
          <legend className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">
            Where should it go
          </legend>
          <div className="mt-2 space-y-1.5">
            {DESTINATIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                  destination === option.value
                    ? 'border-primary bg-primary-soft/40'
                    : 'border-border hover:border-border-strong'
                }`}
              >
                <input
                  type="radio"
                  name="withdraw-destination"
                  value={option.value}
                  checked={destination === option.value}
                  onChange={() => onDestination(option.value)}
                  className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{option.label}</span>
                  <span className="block text-xs text-fg-subtle">{option.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={pending}>
            Withdraw {amount}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Formats micros without importing the money module, which pulls in
 * server-oriented code. The logic is identical: integer arithmetic, no floats.
 */
function formatAmount(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / 1_000_000n;
  const cents = (abs % 1_000_000n) / 10_000n;
  const formatted = `$${new Intl.NumberFormat('en-US').format(whole)}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${formatted}` : formatted;
}

/** Stripe requirement keys are machine-readable; make them human. */
function humanizeRequirement(key: string): string {
  return key
    .replace(/^individual\./, '')
    .replace(/^company\./, 'Company ')
    .replace(/_/g, ' ')
    .replace(/\./g, ' — ')
    .replace(/^./, (c) => c.toUpperCase());
}
