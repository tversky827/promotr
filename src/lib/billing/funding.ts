import { accounts, post } from '@/lib/billing/ledger';
import * as budget from '@/lib/billing/budget';
import { prisma, withSerializableTransaction } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';
import { assertNotDemo } from '@/lib/demo/mode';
import { getStripe, microsToStripeAmount, stripeConfigured } from '@/lib/stripe';
import { splitToCents } from '@/lib/money';
import { recordAudit } from '@/lib/audit';

import type { BrandDeposit } from '@prisma/client';

/**
 * Brand funding.
 *
 * Money enters the platform only here, and only in response to a Stripe
 * PaymentIntent that Stripe itself has confirmed via a signed webhook. The
 * deposit row is created up front in a `requires_payment_method` state and is
 * credited to the brand's ledger balance only when `payment_intent.succeeded`
 * arrives. Nothing is ever credited optimistically.
 */

export interface CreateDepositResult {
  deposit: BrandDeposit;
  clientSecret: string;
  publishableKey: string;
}

export async function createDeposit(params: {
  brandId: string;
  amountMicros: bigint;
  campaignId?: string;
  actorUserId: string;
  paymentMethodId?: string;
}): Promise<CreateDepositResult> {
  const brandRecord = await prisma.brand.findUniqueOrThrow({ where: { id: params.brandId } });
  assertNotDemo(brandRecord, 'add real funds');

  const stripe = getStripe('fund a campaign');

  const { cents, remainderMicros } = splitToCents(params.amountMicros);
  if (remainderMicros !== 0n) {
    // Card networks settle in whole cents. Rather than silently rounding a
    // brand's money, refuse amounts that cannot be charged exactly.
    throw new Error('Funding amounts must be a whole number of cents');
  }
  if (cents < 50n) {
    throw new Error('The minimum funding amount is $0.50');
  }

  const customerId = brandRecord.stripeCustomerId ?? (await createCustomer(params.brandId));

  const deposit = await prisma.brandDeposit.create({
    data: {
      brandId: params.brandId,
      amountMicros: params.amountMicros,
      campaignId: params.campaignId ?? null,
      status: 'requires_payment_method',
    },
  });

  const intent = await stripe.paymentIntents.create(
    {
      amount: Number(cents),
      currency: 'usd',
      customer: customerId,
      ...(params.paymentMethodId
        ? { payment_method: params.paymentMethodId, confirm: true, off_session: true }
        : { automatic_payment_methods: { enabled: true } }),
      description: `Campaign funding — ${brandRecord.displayName}`,
      metadata: {
        depositId: deposit.id,
        brandId: params.brandId,
        campaignId: params.campaignId ?? '',
      },
      // The return URL matters for 3DS redirects.
      ...(params.paymentMethodId ? { return_url: `${env.appUrl}/brand/billing` } : {}),
    },
    // Stripe-side idempotency: a double-submitted form creates one intent.
    { idempotencyKey: `deposit:${deposit.id}` },
  );

  const updated = await prisma.brandDeposit.update({
    where: { id: deposit.id },
    data: { stripePaymentIntentId: intent.id, status: intent.status },
  });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: 'brand.deposit.created',
    entityKind: 'brand_deposit',
    entityId: deposit.id,
    metadata: {
      amountMicros: params.amountMicros.toString(),
      campaignId: params.campaignId,
      paymentIntentId: intent.id,
    },
  });

  return {
    deposit: updated,
    clientSecret: intent.client_secret ?? '',
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  };
}

async function createCustomer(brandId: string): Promise<string> {
  const stripe = getStripe('create a customer');
  const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId } });

  const customer = await stripe.customers.create(
    {
      name: brand.legalName,
      email: brand.contactEmail,
      metadata: { brandId },
      ...(brand.website ? { url: brand.website } : {}),
    },
    { idempotencyKey: `customer:${brandId}` },
  );

  await prisma.brand.update({ where: { id: brandId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/**
 * Credit a confirmed deposit. Called only from the Stripe webhook handler.
 *
 * Idempotent at three levels: the deposit's status guard, the ledger posting
 * key, and the StripeEvent table that records processed event ids. A webhook
 * replayed ten times credits the brand once.
 */
export async function settleDeposit(params: {
  paymentIntentId: string;
  amountReceivedCents: number;
}): Promise<{ credited: boolean; depositId?: string }> {
  return withSerializableTransaction(async (tx) => {
    const deposit = await tx.brandDeposit.findUnique({
      where: { stripePaymentIntentId: params.paymentIntentId },
    });
    if (!deposit) {
      logger.warn('funding.unknown_payment_intent', { paymentIntentId: params.paymentIntentId });
      return { credited: false };
    }
    if (deposit.status === 'succeeded') {
      return { credited: false, depositId: deposit.id };
    }

    const amountMicros = BigInt(params.amountReceivedCents) * 10_000n;

    await post(tx, {
      kind: 'BRAND_DEPOSIT',
      idempotencyKey: `deposit:settle:${deposit.id}`,
      description: `Deposit settled for brand ${deposit.brandId}`,
      metadata: { depositId: deposit.id, paymentIntentId: params.paymentIntentId },
      lines: [
        { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros },
        { account: accounts.brandDeposit(deposit.brandId), direction: 'CREDIT', amountMicros },
      ],
    });

    await tx.brandDeposit.update({
      where: { id: deposit.id },
      data: { status: 'succeeded', amountMicros },
    });

    // A deposit raised for a specific campaign flows straight into its budget,
    // so "fund campaign" is one action for the brand rather than two.
    if (deposit.campaignId) {
      await budget.fundCampaign(tx, {
        campaignId: deposit.campaignId,
        brandId: deposit.brandId,
        amountMicros,
        idempotencyKey: `deposit:tocampaign:${deposit.id}`,
        reason: 'Campaign funded by card payment',
      });
    }

    logger.info('funding.deposit_settled', {
      depositId: deposit.id,
      brandId: deposit.brandId,
      amountMicros: amountMicros.toString(),
    });

    return { credited: true, depositId: deposit.id };
  });
}

export async function markDepositFailed(
  paymentIntentId: string,
  failureMessage: string,
): Promise<void> {
  await prisma.brandDeposit.updateMany({
    where: { stripePaymentIntentId: paymentIntentId },
    data: { status: 'failed', failureMessage: failureMessage.slice(0, 500) },
  });
}

/**
 * Refund a deposit, in whole or in part.
 *
 * Funds are pulled back from the brand's unallocated deposit balance. If the
 * brand has already committed the money to campaigns, the shortfall is
 * recovered by de-funding campaigns with unspent budget — never by clawing back
 * money already owed to publishers, whose earnings stand regardless.
 */
export async function refundDeposit(params: {
  depositId: string;
  amountMicros: bigint;
  reason: string;
  actorUserId: string;
}): Promise<{ refundedMicros: bigint; stripeRefundId: string | null }> {
  const deposit = await prisma.brandDeposit.findUniqueOrThrow({ where: { id: params.depositId } });

  const remaining = deposit.amountMicros - deposit.refundedMicros;
  const amount = params.amountMicros > remaining ? remaining : params.amountMicros;
  if (amount <= 0n) return { refundedMicros: 0n, stripeRefundId: null };

  let stripeRefundId: string | null = null;
  if (stripeConfigured() && deposit.stripePaymentIntentId) {
    const stripe = getStripe('issue a refund');
    const refund = await stripe.refunds.create(
      {
        payment_intent: deposit.stripePaymentIntentId,
        amount: microsToStripeAmount(amount),
        metadata: { depositId: deposit.id, reason: params.reason },
      },
      { idempotencyKey: `refund:${deposit.id}:${amount}` },
    );
    stripeRefundId = refund.id;
  }

  await withSerializableTransaction(async (tx) => {
    // Recover from campaign escrow first if the deposit balance is short.
    const brandBalance = await tx.ledgerAccount.findUnique({
      where: {
        type_ownerKind_ownerId_currency: {
          type: 'BRAND_DEPOSIT',
          ownerKind: 'brand',
          ownerId: deposit.brandId,
          currency: 'usd',
        },
      },
    });
    let shortfall = amount - (brandBalance?.balanceMicros ?? 0n);

    if (shortfall > 0n) {
      const campaigns = await tx.campaign.findMany({
        where: { brandId: deposit.brandId },
        select: { id: true },
      });
      for (const campaign of campaigns) {
        if (shortfall <= 0n) break;
        const { returnedMicros } = await budget.defundCampaign(tx, {
          campaignId: campaign.id,
          brandId: deposit.brandId,
          amountMicros: shortfall,
          idempotencyKey: `refund:defund:${deposit.id}:${campaign.id}`,
          actorUserId: params.actorUserId,
          reason: `Recovering unspent budget for refund: ${params.reason}`,
        });
        shortfall -= returnedMicros;
      }
    }

    if (shortfall > 0n) {
      throw new Error(
        `Cannot refund ${amount} micros: ${shortfall} is already committed to publisher earnings and cannot be reclaimed`,
      );
    }

    await post(tx, {
      kind: 'REFUND',
      idempotencyKey: `refund:${deposit.id}:${amount}`,
      description: `Refund deposit ${deposit.id}`,
      actorUserId: params.actorUserId,
      reason: params.reason,
      metadata: { depositId: deposit.id, stripeRefundId },
      lines: [
        { account: accounts.brandDeposit(deposit.brandId), direction: 'DEBIT', amountMicros: amount },
        { account: accounts.externalSettlement(), direction: 'CREDIT', amountMicros: amount },
      ],
    });

    await tx.brandDeposit.update({
      where: { id: deposit.id },
      data: {
        refundedMicros: { increment: amount },
        status: deposit.refundedMicros + amount >= deposit.amountMicros ? 'refunded' : deposit.status,
      },
    });
  });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: 'brand.deposit.refunded',
    entityKind: 'brand_deposit',
    entityId: deposit.id,
    reason: params.reason,
    before: { refundedMicros: deposit.refundedMicros.toString() },
    after: { refundedMicros: (deposit.refundedMicros + amount).toString() },
    metadata: { stripeRefundId },
  });

  logger.info('funding.refunded', {
    depositId: deposit.id,
    amountMicros: amount.toString(),
    stripeRefundId,
  });

  return { refundedMicros: amount, stripeRefundId };
}

/**
 * Chargeback handling. The brand's money is gone, so the platform absorbs it
 * against the campaign's remaining escrow where possible. Publisher earnings
 * already accrued are NOT reversed — the publisher delivered the traffic and
 * had no part in the dispute.
 */
export async function handleChargeback(params: {
  paymentIntentId: string;
  amountCents: number;
  disputeId: string;
}): Promise<void> {
  const deposit = await prisma.brandDeposit.findUnique({
    where: { stripePaymentIntentId: params.paymentIntentId },
  });
  if (!deposit) {
    logger.warn('funding.chargeback_unknown_deposit', { paymentIntentId: params.paymentIntentId });
    return;
  }

  const amountMicros = BigInt(params.amountCents) * 10_000n;

  await withSerializableTransaction(async (tx) => {
    let shortfall = amountMicros;
    const brandBalance = await tx.ledgerAccount.findUnique({
      where: {
        type_ownerKind_ownerId_currency: {
          type: 'BRAND_DEPOSIT',
          ownerKind: 'brand',
          ownerId: deposit.brandId,
          currency: 'usd',
        },
      },
    });
    shortfall -= brandBalance?.balanceMicros ?? 0n;

    if (shortfall > 0n) {
      const campaigns = await tx.campaign.findMany({
        where: { brandId: deposit.brandId },
        select: { id: true },
      });
      for (const campaign of campaigns) {
        if (shortfall <= 0n) break;
        const { returnedMicros } = await budget.defundCampaign(tx, {
          campaignId: campaign.id,
          brandId: deposit.brandId,
          amountMicros: shortfall,
          idempotencyKey: `chargeback:defund:${params.disputeId}:${campaign.id}`,
          reason: `Chargeback ${params.disputeId}`,
        });
        shortfall -= returnedMicros;
      }
    }

    // Whatever could be recovered goes back out; any remainder is a platform
    // loss recorded against platform revenue, which is the honest place for it.
    const recovered = amountMicros - (shortfall > 0n ? shortfall : 0n);
    const lines = [];
    if (recovered > 0n) {
      lines.push(
        { account: accounts.brandDeposit(deposit.brandId), direction: 'DEBIT' as const, amountMicros: recovered },
      );
    }
    if (shortfall > 0n) {
      lines.push({
        account: accounts.platformRevenue(),
        direction: 'DEBIT' as const,
        amountMicros: shortfall,
      });
    }
    lines.push({
      account: accounts.externalSettlement(),
      direction: 'CREDIT' as const,
      amountMicros,
    });

    await post(tx, {
      kind: 'CHARGEBACK',
      idempotencyKey: `chargeback:${params.disputeId}`,
      description: `Chargeback on deposit ${deposit.id}`,
      reason: `Stripe dispute ${params.disputeId}`,
      metadata: {
        depositId: deposit.id,
        stripeDisputeId: params.disputeId,
        unrecoveredMicros: (shortfall > 0n ? shortfall : 0n).toString(),
      },
      lines,
    });

    // A brand that charges back is suspended pending review; it must not be
    // able to keep accruing liability the platform cannot collect on.
    await tx.brand.update({
      where: { id: deposit.brandId },
      data: {
        verification: 'SUSPENDED',
        suspendedReason: `Payment chargeback (Stripe dispute ${params.disputeId})`,
      },
    });
    await tx.campaign.updateMany({
      where: { brandId: deposit.brandId, status: 'ACTIVE' },
      data: { status: 'SUSPENDED', pausedAt: new Date() },
    });
  });

  logger.error('funding.chargeback', {
    depositId: deposit.id,
    brandId: deposit.brandId,
    amountMicros: amountMicros.toString(),
    stripeDisputeId: params.disputeId,
  });
}
