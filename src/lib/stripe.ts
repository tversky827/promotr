import Stripe from 'stripe';

import { integrations } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

/**
 * Stripe client.
 *
 * There is no mock, no stub and no simulated success path. If
 * STRIPE_SECRET_KEY is absent every money operation throws
 * `StripeNotConfiguredError`, the UI renders a "Stripe is not configured"
 * state, and nothing is recorded as paid. A payments integration that
 * pretends to work is worse than one that is obviously switched off.
 */

export class StripeNotConfiguredError extends Error {
  readonly code = 'STRIPE_NOT_CONFIGURED';
  readonly userMessage =
    'Payments are not configured on this deployment. An administrator must set STRIPE_SECRET_KEY.';

  constructor(operation: string) {
    super(`Stripe is not configured; cannot ${operation}`);
    this.name = 'StripeNotConfiguredError';
  }
}

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return integrations.stripe.configured;
}

export function getStripe(operation = 'perform this operation'): Stripe {
  if (!integrations.stripe.configured) {
    throw new StripeNotConfiguredError(operation);
  }
  if (!client) {
    client = new Stripe(integrations.stripe.secretKey, {
      // Pinning the API version means a Stripe-side upgrade cannot silently
      // change response shapes under a running deployment.
      apiVersion: '2026-07-29.dahlia',
      typescript: true,
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: 'Promotr', version: '1.0.0' },
    });
  }
  return client;
}

/**
 * Verify an inbound webhook signature. Never process an unverified event: the
 * webhook endpoint is public, so the signature is the only thing distinguishing
 * Stripe from an attacker who wants to mark a payout as paid.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
): Stripe.Event {
  const stripe = getStripe('verify a webhook signature');
  return stripe.webhooks.constructEvent(payload, signature, secret);
}

/** Stripe works in the currency's smallest unit; ours is micros. */
export function microsToStripeAmount(micros: bigint): number {
  return Number(micros / 10_000n);
}

export function stripeAmountToMicros(amount: number): bigint {
  return BigInt(Math.round(amount)) * 10_000n;
}

export interface StripeHealth {
  configured: boolean;
  liveMode: boolean;
  reachable: boolean;
  availableCents?: number;
  pendingCents?: number;
  connectEnabled?: boolean;
  error?: string;
}

/**
 * Used by the admin system-health screen.
 *
 * `balance.retrieve` is the cheapest call that proves three things at once: the
 * secret key is valid, Stripe is reachable, and the account can transact. It
 * needs no account id, which the platform's own key implies.
 */
export async function checkStripeHealth(): Promise<StripeHealth> {
  if (!integrations.stripe.configured) {
    return { configured: false, liveMode: false, reachable: false };
  }
  try {
    const balance = await getStripe().balance.retrieve();
    return {
      configured: true,
      liveMode: integrations.stripe.liveMode,
      reachable: true,
      availableCents: balance.available.reduce((sum, b) => sum + b.amount, 0),
      pendingCents: balance.pending.reduce((sum, b) => sum + b.amount, 0),
      connectEnabled: Boolean(balance.connect_reserved),
    };
  } catch (error) {
    logger.error('stripe.health_check_failed', { error: (error as Error).message });
    return {
      configured: true,
      liveMode: integrations.stripe.liveMode,
      reachable: false,
      error: (error as Error).message,
    };
  }
}

/** Normalise a Stripe error into something safe to show a user. */
export function describeStripeError(error: unknown): { message: string; code?: string } {
  if (error instanceof StripeNotConfiguredError) {
    return { message: error.userMessage, code: error.code };
  }
  if (error && typeof error === 'object' && 'type' in error) {
    const e = error as Stripe.StripeRawError;
    switch (e.type) {
      case 'card_error':
        return { message: e.message ?? 'The card was declined.', code: e.code };
      case 'rate_limit_error':
        return { message: 'Too many requests to the payment provider. Try again shortly.' };
      case 'invalid_request_error':
        // Never surface the raw message: it can contain internal identifiers.
        logger.error('stripe.invalid_request', { message: e.message, code: e.code });
        return { message: 'The payment request was rejected. Please contact support.' };
      case 'authentication_error':
        logger.error('stripe.auth_error', { message: e.message });
        return { message: 'Payments are misconfigured on this deployment.' };
      default:
        return { message: 'The payment provider returned an error. Please try again.' };
    }
  }
  return { message: 'An unexpected payment error occurred.' };
}
