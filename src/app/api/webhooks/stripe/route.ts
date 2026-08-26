import type Stripe from 'stripe';

import { handleChargeback, markDepositFailed, settleDeposit } from '@/lib/billing/funding';
import { failPayout, settlePayout, syncConnectAccount } from '@/lib/billing/payouts';
import { prisma } from '@/lib/db';
import { integrations } from '@/lib/env';
import { logger } from '@/lib/observability/logger';
import { captureException } from '@/lib/observability/sentry';
import { notifyBrand } from '@/lib/notify';
import { stripeConfigured, verifyWebhookSignature } from '@/lib/stripe';

/**
 * Stripe webhook handler.
 *
 * This endpoint is the only place money enters or leaves the ledger. Four
 * properties are non-negotiable:
 *
 *  1. **Signature verification first.** The endpoint is public; the signature is
 *     the only thing distinguishing Stripe from an attacker who would very much
 *     like to mark a payout as paid.
 *  2. **Exactly-once processing.** Stripe retries aggressively and delivers
 *     out of order. Every event id is recorded in `stripe_events` before the
 *     handler runs, so a replay is a no-op.
 *  3. **Acknowledge fast.** Stripe times out at 20 seconds and treats a slow
 *     response as a failure. Handlers stay short; anything slow is queued.
 *  4. **Never 500 on an event we simply do not handle.** A 500 makes Stripe
 *     retry forever and eventually disable the endpoint.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Events this handler acts on. Anything else is acknowledged and ignored. */
const HANDLED = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'transfer.created',
  'transfer.reversed',
  'payout.paid',
  'payout.failed',
  'account.updated',
  'capability.updated',
]);

export async function POST(request: Request): Promise<Response> {
  if (!stripeConfigured()) {
    // Not an error condition worth retrying: the deployment has no Stripe.
    logger.warn('stripe.webhook_unconfigured');
    return Response.json({ received: false, reason: 'stripe_not_configured' }, { status: 503 });
  }

  const secret = integrations.stripe.webhookSecret;
  if (!secret) {
    logger.error('stripe.webhook_secret_missing');
    return Response.json({ received: false, reason: 'webhook_secret_missing' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  // The raw body is required: the signature covers the exact bytes, so parsing
  // and re-serialising would invalidate it.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(payload, signature, secret);
  } catch (error) {
    // A bad signature is either misconfiguration or an attack. 400 tells Stripe
    // not to retry, and the log line is what an operator needs to tell them apart.
    logger.error('stripe.webhook_signature_invalid', { error: (error as Error).message });
    return Response.json({ error: 'Signature verification failed' }, { status: 400 });
  }

  // Idempotency gate. The insert succeeds exactly once per event id; a
  // duplicate delivery conflicts and returns immediately without side effects.
  const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "stripe_events" (id, type, "processedAt", payload)
    VALUES (${event.id}, ${event.type}, now(), ${JSON.stringify({ id: event.id, type: event.type })}::jsonb)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;

  if (inserted.length === 0) {
    logger.info('stripe.webhook_duplicate', { eventId: event.id, type: event.type });
    return Response.json({ received: true, duplicate: true });
  }

  if (!HANDLED.has(event.type)) {
    logger.debug('stripe.webhook_ignored', { eventId: event.id, type: event.type });
    return Response.json({ received: true, handled: false });
  }

  try {
    await handleEvent(event);
    logger.info('stripe.webhook_processed', { eventId: event.id, type: event.type });
    return Response.json({ received: true });
  } catch (error) {
    captureException(error, {
      route: '/api/webhooks/stripe',
      extra: { eventId: event.id, eventType: event.type },
    });

    // Delete the idempotency record so Stripe's retry can process it again —
    // otherwise a transient failure would permanently skip a real payment.
    await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => undefined);

    logger.error('stripe.webhook_failed', {
      eventId: event.id,
      type: event.type,
      error: (error as Error).message,
    });
    return Response.json({ error: 'Processing failed; retry expected' }, { status: 500 });
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const result = await settleDeposit({
        paymentIntentId: intent.id,
        amountReceivedCents: intent.amount_received,
      });
      if (result.credited && intent.metadata?.brandId) {
        await notifyBrand(intent.metadata.brandId, {
          type: 'campaign.funded',
          title: 'Funds added',
          body: `Your payment of ${formatCents(intent.amount_received)} has been applied.`,
          actionPath: intent.metadata.campaignId
            ? `/brand/campaigns/${intent.metadata.campaignId}`
            : '/brand/billing',
          email: false,
        });
      }
      return;
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const message = intent.last_payment_error?.message ?? 'The payment was declined.';
      await markDepositFailed(intent.id, message);

      if (intent.metadata?.brandId) {
        await notifyBrand(intent.metadata.brandId, {
          type: 'payment.failed',
          title: 'A payment could not be completed',
          body: message,
          actionPath: '/brand/billing',
          emailTemplate: {
            name: 'paymentFailed',
            params: { reason: message, url: '/brand/billing' },
          },
        });
      }
      return;
    }

    case 'payment_intent.canceled': {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markDepositFailed(intent.id, 'The payment was cancelled.');
      return;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      // Refunds initiated from the Stripe dashboard arrive here. Refunds we
      // initiate have already posted their ledger entries, so this reconciles
      // the deposit record either way.
      const paymentIntentId =
        typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (!paymentIntentId) return;

      const deposit = await prisma.brandDeposit.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      });
      if (!deposit) return;

      const refundedMicros = BigInt(charge.amount_refunded) * 10_000n;
      if (refundedMicros > deposit.refundedMicros) {
        logger.warn('stripe.dashboard_refund_detected', {
          depositId: deposit.id,
          refundedMicros: refundedMicros.toString(),
          recordedMicros: deposit.refundedMicros.toString(),
        });
        await prisma.brandDeposit.update({
          where: { id: deposit.id },
          data: {
            refundedMicros,
            status: refundedMicros >= deposit.amountMicros ? 'refunded' : deposit.status,
          },
        });
      }
      return;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId =
        typeof dispute.payment_intent === 'string'
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
      if (!paymentIntentId) return;

      await handleChargeback({
        paymentIntentId,
        amountCents: dispute.amount,
        disputeId: dispute.id,
      });
      return;
    }

    case 'charge.dispute.closed': {
      const dispute = event.data.object as Stripe.Dispute;
      logger.info('stripe.dispute_closed', { disputeId: dispute.id, status: dispute.status });
      // A won dispute returns the money; reinstating the brand is a deliberate
      // administrative decision, so it is surfaced rather than automated.
      if (dispute.status === 'won') {
        const { notifyAdmins } = await import('@/lib/notify');
        await notifyAdmins({
          type: 'generic',
          title: 'A chargeback was won',
          body: `Stripe dispute ${dispute.id} was resolved in our favour. Review whether the brand account should be reinstated.`,
          actionPath: '/admin/brands',
          email: false,
        });
      }
      return;
    }

    case 'transfer.created': {
      const transfer = event.data.object as Stripe.Transfer;
      // Transfers to Connect accounts settle immediately in most regions.
      await settlePayout({
        payoutId: transfer.metadata?.payoutId,
        stripeTransferId: transfer.id,
      });
      return;
    }

    case 'transfer.reversed': {
      const transfer = event.data.object as Stripe.Transfer;
      const payout = await prisma.payout.findUnique({
        where: { stripeTransferId: transfer.id },
        select: { id: true },
      });
      if (payout) {
        await failPayout(payout.id, 'transfer_reversed', 'The transfer was reversed by Stripe.');
      }
      return;
    }

    case 'payout.paid': {
      const payout = event.data.object as Stripe.Payout;
      logger.info('stripe.connect_payout_paid', { stripePayoutId: payout.id });
      return;
    }

    case 'payout.failed': {
      const stripePayout = event.data.object as Stripe.Payout;
      logger.warn('stripe.connect_payout_failed', {
        stripePayoutId: stripePayout.id,
        failureMessage: stripePayout.failure_message,
      });
      return;
    }

    case 'account.updated':
    case 'capability.updated': {
      // A publisher completed (or broke) their Connect onboarding.
      const accountId =
        event.type === 'account.updated'
          ? (event.data.object as Stripe.Account).id
          : (event.data.object as Stripe.Capability).account;
      const id = typeof accountId === 'string' ? accountId : accountId?.id;
      if (id) await syncConnectAccount(id);
      return;
    }

    default:
      return;
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
