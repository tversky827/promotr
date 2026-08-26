'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Alert, Card, CardHeader } from '@/components/ui/primitives';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { fundCampaign } from '@/server/actions/campaigns';

/**
 * Campaign funding.
 *
 * Two paths: allocate existing account balance (instant, no payment), or take a
 * new card payment. The card path mounts Stripe's own Payment Element, so card
 * details never touch this application — they go directly from the browser to
 * Stripe. We only ever hold a PaymentIntent client secret.
 *
 * Crucially, a successful client-side confirmation does NOT credit the ledger.
 * That happens only when Stripe's signed webhook arrives, which is why the
 * success state says "confirming" rather than claiming the funds have landed.
 */

const PRESETS = ['500', '1000', '2500', '5000', '10000'];

declare global {
  interface Window {
    Stripe?: (key: string) => StripeInstance;
  }
}

interface StripeInstance {
  elements: (options: { clientSecret: string; appearance?: unknown }) => StripeElements;
  confirmPayment: (options: {
    elements: StripeElements;
    confirmParams: { return_url: string };
    redirect: 'if_required';
  }) => Promise<{ error?: { message?: string }; paymentIntent?: { status: string } }>;
}

interface StripeElements {
  create: (type: string, options?: unknown) => StripeElement;
  getElement: (type: string) => StripeElement | null;
  submit: () => Promise<{ error?: { message?: string } }>;
}

interface StripeElement {
  mount: (selector: string | HTMLElement) => void;
  unmount: () => void;
}

export function FundingPanel({
  campaignId,
  campaignName,
  csrfToken,
  accountBalanceMicros,
  minimumFundingMicros,
  currentlyFundedMicros,
  stripeConfigured,
  publishableKey,
}: {
  campaignId: string;
  campaignName: string;
  csrfToken: string;
  accountBalanceMicros: string;
  minimumFundingMicros: string;
  currentlyFundedMicros: string;
  stripeConfigured: boolean;
  publishableKey: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<'card' | 'balance'>('card');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  const balance = BigInt(accountBalanceMicros);
  const minimum = BigInt(minimumFundingMicros);
  const alreadyFunded = BigInt(currentlyFundedMicros);
  const isFirstFunding = alreadyFunded === 0n;

  // Load Stripe.js only when a card payment is actually started. Loading it on
  // every page view would add ~200KB for most visits that never pay.
  useEffect(() => {
    if (!clientSecret || !publishableKey) return;
    let cancelled = false;

    const setup = async () => {
      if (!window.Stripe) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://js.stripe.com/v3/';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Stripe.js could not be loaded'));
          document.head.appendChild(script);
        }).catch(() => {
          setError('The payment form could not be loaded. Check your connection and try again.');
        });
      }
      if (cancelled || !window.Stripe) return;

      const stripe = window.Stripe(publishableKey);
      stripeRef.current = stripe;

      const elements = stripe.elements({
        clientSecret,
        appearance: { theme: document.documentElement.classList.contains('dark') ? 'night' : 'stripe' },
      });
      elementsRef.current = elements;

      const paymentElement = elements.create('payment');
      if (mountRef.current) paymentElement.mount(mountRef.current);
    };

    void setup();
    return () => {
      cancelled = true;
      elementsRef.current?.getElement('payment')?.unmount();
    };
  }, [clientSecret, publishableKey]);

  const start = () => {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('campaignId', campaignId);
      formData.set('amount', amount);
      if (source === 'balance') formData.set('fromBalance', 'on');

      const result = await fundCampaign(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (!result.data.needsPayment) {
        setSuccess(result.message ?? 'Campaign funded.');
        setAmount('');
        router.refresh();
        return;
      }

      setClientSecret(result.data.clientSecret);
    });
  };

  const confirm = async () => {
    if (!stripeRef.current || !elementsRef.current) return;
    setError(null);
    setConfirming(true);

    const submitResult = await elementsRef.current.submit();
    if (submitResult.error) {
      setError(submitResult.error.message ?? 'Check your card details.');
      setConfirming(false);
      return;
    }

    const result = await stripeRef.current.confirmPayment({
      elements: elementsRef.current,
      confirmParams: { return_url: `${window.location.origin}/brand/campaigns/${campaignId}/funding` },
      redirect: 'if_required',
    });

    setConfirming(false);

    if (result.error) {
      setError(result.error.message ?? 'The payment could not be completed.');
      return;
    }

    // Deliberately worded as "confirming": the ledger is credited by the Stripe
    // webhook, not by this response. Claiming the funds had landed would be a
    // lie for the seconds before the webhook arrives — and permanently wrong if
    // it never does.
    setClientSecret(null);
    setSuccess(
      'Payment accepted. Funds appear on the campaign as soon as the payment provider confirms — usually within a few seconds.',
    );
    setAmount('');
    router.refresh();
  };

  if (!stripeConfigured && balance <= 0n) {
    return (
      <Card>
        <CardHeader title="Add funds" />
        <Alert tone="warning" className="mt-4" title="Payments are not configured">
          This deployment has no payment provider configured, so campaigns cannot be funded. An
          administrator needs to set STRIPE_SECRET_KEY.
        </Alert>
      </Card>
    );
  }

  if (clientSecret) {
    return (
      <Card>
        <CardHeader
          title="Complete payment"
          description={`Funding ${campaignName}${amount ? ` with $${amount}` : ''}.`}
        />
        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}
        {/* Stripe's Payment Element mounts here. Card data never reaches our
            servers — it goes straight from the browser to Stripe. */}
        <div ref={mountRef} className="mt-4 min-h-[180px]" />
        <div className="mt-4 flex gap-2">
          <Button fullWidth loading={confirming} onClick={confirm}>
            Pay and fund campaign
          </Button>
          <Button variant="ghost" onClick={() => setClientSecret(null)} disabled={confirming}>
            Cancel
          </Button>
        </div>
        <p className="mt-3 text-2xs text-fg-subtle text-pretty">
          Payment is processed by Stripe. We never see or store your card details.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Add funds" description={`For ${campaignName}.`} />

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

      <div className="mt-4 space-y-4">
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset)}
                className={`rounded-md border px-2.5 py-1 text-sm transition-colors ${
                  amount === preset
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-border text-fg-muted hover:border-border-strong hover:text-fg'
                }`}
              >
                ${Number(preset).toLocaleString()}
              </button>
            ))}
          </div>
          <Input
            label="Amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            prefix="$"
            placeholder="1000.00"
            inputMode="decimal"
            description={
              isFirstFunding
                ? `Minimum initial funding is ${money(minimum)}.`
                : 'Added on top of the campaign’s current budget.'
            }
          />
        </div>

        {balance > 0n ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg">Pay with</legend>
            <div className="space-y-2">
              <SourceOption
                selected={source === 'balance'}
                onSelect={() => setSource('balance')}
                title="Account balance"
                subtitle={`${money(balance)} available — allocated instantly, no payment needed`}
              />
              <SourceOption
                selected={source === 'card'}
                onSelect={() => setSource('card')}
                title="New card payment"
                subtitle={stripeConfigured ? 'Processed securely by Stripe' : 'Unavailable — payments not configured'}
                disabled={!stripeConfigured}
              />
            </div>
          </fieldset>
        ) : null}

        <Button
          fullWidth
          size="lg"
          loading={pending}
          disabled={amount.trim() === ''}
          onClick={start}
        >
          {source === 'balance' ? 'Allocate to campaign' : 'Continue to payment'}
        </Button>
      </div>
    </Card>
  );
}

function SourceOption({
  selected,
  onSelect,
  title,
  subtitle,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? 'border-primary bg-primary-soft/40 ring-1 ring-primary/25'
          : 'border-border hover:border-border-strong'
      }`}
    >
      <span
        className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
          selected ? 'border-primary' : 'border-border-strong'
        }`}
        aria-hidden="true"
      >
        {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-xs text-fg-muted text-pretty">{subtitle}</span>
      </span>
    </button>
  );
}

function money(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const cents = (micros % 1_000_000n) / 10_000n;
  return `$${new Intl.NumberFormat('en-US').format(whole)}.${cents.toString().padStart(2, '0')}`;
}
