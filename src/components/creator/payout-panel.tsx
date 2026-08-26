'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader } from '@/components/ui/primitives';
import { CSRF_FIELD } from '@/lib/auth/constants';
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
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const available = BigInt(availableMicros);
  const minimum = BigInt(minimumMicros);
  const progress = minimum > 0n ? Number((available * 100n) / minimum) : 100;

  const withdraw = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      const result = await withdrawEarnings(formData);
      if (result.ok) {
        setSuccess(result.message ?? 'Payout requested.');
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
  if (!stripeConfigured) {
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
          payoutsEnabled ? (
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
        {!hasConnectAccount ? (
          <>
            <Button fullWidth loading={pending} onClick={connect}>
              Set up payouts
            </Button>
            <p className="mt-2 text-xs text-fg-subtle text-pretty">
              Identity and bank details are collected by our payment provider, not by us. You will
              be taken to their secure onboarding.
            </p>
          </>
        ) : !payoutsEnabled ? (
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
        ) : eligible ? (
          <Button fullWidth size="lg" loading={pending} onClick={withdraw}>
            Withdraw {formatAmount(available)}
          </Button>
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

      {payoutsEnabled ? (
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
