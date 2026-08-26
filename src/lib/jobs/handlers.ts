import { brand } from '@/lib/brand';
import { releaseMaturedEarnings } from '@/lib/billing/earnings';
import * as budgetLib from '@/lib/billing/budget';
import { reconcileAll, verifyGlobalBalance } from '@/lib/billing/ledger';
import { processPayout } from '@/lib/billing/payouts';
import { prisma } from '@/lib/db';
import { sendEmail, EmailNotConfiguredError } from '@/lib/email/provider';
import * as templates from '@/lib/email/templates';
import { recomputeCreatorRisk } from '@/lib/fraud/engine';
import { rollupRecent } from '@/lib/analytics/rollup';
import { logger } from '@/lib/observability/logger';
import { notifyBrand, notifyCreator, notifyAdmins } from '@/lib/notify';
import { env } from '@/lib/env';
import { formatMicros } from '@/lib/money';
import { getSettings } from '@/lib/settings';
import { attemptDelivery, dispatch } from '@/lib/webhooks/outbound';
import { generateExport } from '@/lib/analytics/exports';

import type { Job } from '@prisma/client';

/**
 * Job handlers.
 *
 * Each handler is idempotent: the queue guarantees at-least-once delivery, so a
 * handler that ran partially before a crash must be safe to run again. Where
 * that requires state (payouts, webhook deliveries) the underlying operation
 * carries its own idempotency key.
 */

type Payload = Record<string, unknown>;

export type JobHandler = (payload: Payload, job: Job) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  'email.send': sendEmailJob,
  'webhook.dispatch': dispatchWebhookJob,
  'webhook.retry': retryWebhookJob,
  'analytics.rollup': rollupJob,
  'fraud.recompute': recomputeFraudJob,
  'export.generate': exportJob,
  'payout.process': processPayoutJob,
  'payout.reconcile': reconcilePayoutsJob,
  'budget.alert': budgetAlertJob,
  'earnings.release': releaseEarningsJob,
  'conversions.autoapprove': autoApproveConversionsJob,
  'campaign.moderate': moderateCampaignJob,
  'campaign.complete': completeCampaignsJob,
  'notify.creator.earning': notifyCreatorEarningJob,
  'notify.generic': notifyGenericJob,
  'retention.prune': retentionJob,
  'partitions.ensure': ensurePartitionsJob,
  'ledger.reconcile': ledgerReconcileJob,
  'domain.verify': verifyDomainJob,
};

export function handlerFor(type: string): JobHandler | null {
  return handlers[type] ?? null;
}

// ---------------------------------------------------------------------------

async function sendEmailJob(payload: Payload): Promise<void> {
  const userId = payload.userId as string;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, status: true },
  });
  if (!user) return;
  // Never email a deleted account.
  if (user.status === 'DELETED') return;

  const rendered = renderTemplate(
    payload.template as string,
    { name: user.name, ...(payload.params as Payload) },
  );

  try {
    const result = await sendEmail({
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: { template: String(payload.template) },
    });
    if (payload.notificationId) {
      await prisma.notification.update({
        where: { id: payload.notificationId as string },
        data: { emailedAt: new Date() },
      });
    }
    logger.info('email.sent', { to: redactEmail(user.email), messageId: result.id });
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      // Not a failure worth retrying forever — the operator has not set email
      // up. The in-app notification already exists, so the user is not left
      // uninformed.
      logger.warn('email.skipped_unconfigured', { userId });
      return;
    }
    throw error;
  }
}

function renderTemplate(name: string, params: Payload): templates.RenderedEmail {
  switch (name) {
    case 'verifyEmail':
      return templates.verifyEmailTemplate({
        name: String(params.name),
        url: String(params.url),
      });
    case 'passwordReset':
      return templates.passwordResetTemplate({
        name: String(params.name),
        url: String(params.url),
      });
    case 'magicLink':
      return templates.magicLinkTemplate({ url: String(params.url) });
    case 'earning':
      return templates.earningTemplate({
        name: String(params.name),
        amountMicros: BigInt(String(params.amountMicros ?? '0')),
        campaignName: String(params.campaignName),
        url: String(params.url),
      });
    case 'payoutSent':
      return templates.payoutSentTemplate({
        name: String(params.name),
        amountMicros: BigInt(String(params.amountMicros ?? '0')),
        url: String(params.url),
      });
    case 'payoutFailed':
      return templates.payoutFailedTemplate({
        name: String(params.name),
        amountMicros: BigInt(String(params.amountMicros ?? '0')),
        reason: String(params.reason),
        url: String(params.url),
      });
    case 'trafficWarning':
      return templates.trafficWarningTemplate({
        name: String(params.name),
        campaignName: String(params.campaignName),
        reason: String(params.reason),
        url: String(params.url),
      });
    case 'campaignApproved':
      return templates.campaignApprovedTemplate({
        campaignName: String(params.campaignName),
        url: String(params.url),
      });
    case 'campaignRejected':
      return templates.campaignRejectedTemplate({
        campaignName: String(params.campaignName),
        reason: String(params.reason),
        url: String(params.url),
      });
    case 'budgetLow':
      return templates.budgetLowTemplate({
        campaignName: String(params.campaignName),
        remainingMicros: BigInt(String(params.remainingMicros ?? '0')),
        percentRemaining: Number(params.percentRemaining ?? 0),
        url: String(params.url),
      });
    case 'paymentFailed':
      return templates.paymentFailedTemplate({
        reason: String(params.reason),
        url: String(params.url),
      });
    case 'disputeOpened':
      return templates.disputeOpenedTemplate({
        reference: String(params.reference),
        subject: String(params.subject),
        url: String(params.url),
      });
    default:
      return templates.genericTemplate({
        heading: String(params.heading ?? 'Notification'),
        body: String(params.body ?? ''),
        cta: params.cta as { label: string; url: string } | undefined,
      });
  }
}

function redactEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${(local ?? '').slice(0, 2)}***@${domain ?? ''}`;
}

// ---------------------------------------------------------------------------

async function dispatchWebhookJob(payload: Payload): Promise<void> {
  await dispatch({
    brandId: payload.brandId as string,
    eventType: payload.eventType as string,
    data: (payload.data ?? {}) as Record<string, unknown>,
  });
}

async function retryWebhookJob(payload: Payload): Promise<void> {
  await attemptDelivery(payload.deliveryId as string);
}

async function rollupJob(payload: Payload): Promise<void> {
  const hours = Number(payload.hours ?? 3);
  const rows = await rollupRecent(hours);
  logger.info('analytics.rollup_complete', { hours, rows });
}

async function recomputeFraudJob(payload: Payload): Promise<void> {
  if (payload.creatorId) {
    await recomputeCreatorRisk(payload.creatorId as string);
    return;
  }
  // Sweep every publisher with recent activity.
  const active = await prisma.$queryRaw<Array<{ creatorId: string }>>`
    SELECT DISTINCT "creatorId" FROM "clicks"
    WHERE "createdAt" >= now() - interval '7 days'
    LIMIT 5000
  `;
  for (const { creatorId } of active) {
    await recomputeCreatorRisk(creatorId).catch((error) =>
      logger.warn('fraud.recompute_failed', { creatorId, error: (error as Error).message }),
    );
  }
  logger.info('fraud.recompute_complete', { publishers: active.length });
}

async function exportJob(payload: Payload): Promise<void> {
  await generateExport(payload.exportJobId as string);
}

async function processPayoutJob(payload: Payload): Promise<void> {
  const result = await processPayout(payload.payoutId as string);
  if (!result.ok) {
    // Already recorded as failed by processPayout; throwing would retry a
    // payout that legitimately failed, so we stop here.
    logger.warn('payout.process_job_noop', { payoutId: payload.payoutId, error: result.error });
  }
}

/**
 * Safety net for payouts whose Stripe webhook never arrived. Without this a
 * transfer could sit in PROCESSING forever after a dropped webhook.
 */
async function reconcilePayoutsJob(): Promise<void> {
  const stale = await prisma.payout.findMany({
    where: {
      status: 'PROCESSING',
      processedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
      stripeTransferId: { not: null },
    },
    take: 100,
  });

  if (stale.length === 0) return;

  const { getStripe, stripeConfigured } = await import('@/lib/stripe');
  if (!stripeConfigured()) return;
  const { settlePayout, failPayout } = await import('@/lib/billing/payouts');
  const stripe = getStripe('reconcile payouts');

  for (const payout of stale) {
    try {
      const transfer = await stripe.transfers.retrieve(payout.stripeTransferId!);
      if (transfer.reversed) {
        await failPayout(payout.id, 'transfer_reversed', 'The transfer was reversed by Stripe');
      } else {
        await settlePayout({ payoutId: payout.id, stripeTransferId: transfer.id });
      }
    } catch (error) {
      logger.error('payout.reconcile_failed', {
        payoutId: payout.id,
        error: (error as Error).message,
      });
    }
  }
  logger.info('payout.reconcile_complete', { checked: stale.length });
}

async function budgetAlertJob(): Promise<void> {
  const low = await budgetLib.campaignsNeedingLowBalanceAlert();

  for (const item of low) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: item.campaignId },
      select: { id: true, name: true, brandId: true },
    });
    if (!campaign) continue;

    const percent =
      item.fundedMicros > 0n ? Number((item.remainingMicros * 10_000n) / item.fundedMicros) / 100 : 0;

    await notifyBrand(campaign.brandId, {
      type: 'campaign.budget.low',
      title: `${campaign.name} is running low on budget`,
      body: `${formatMicros(item.remainingMicros)} remains (about ${percent.toFixed(0)}%). Add funds to keep the campaign accruing billable activity.`,
      actionPath: `/brand/campaigns/${campaign.id}/funding`,
      emailTemplate: {
        name: 'budgetLow',
        params: {
          campaignName: campaign.name,
          remainingMicros: item.remainingMicros.toString(),
          percentRemaining: percent,
          url: `${brand.appUrl}/brand/campaigns/${campaign.id}/funding`,
        },
      },
    });

    await prisma.campaignBudget.update({
      where: { campaignId: campaign.id },
      data: { lowBalanceNotifiedAt: new Date() },
    });

    await dispatch({
      brandId: campaign.brandId,
      eventType: 'campaign.budget.low',
      data: {
        campaignId: campaign.id,
        remainingMicros: item.remainingMicros.toString(),
        percentRemaining: percent,
      },
    });

    await maybeAutoRefill(campaign.brandId, campaign.id);
  }

  if (low.length > 0) logger.info('budget.alerts_sent', { count: low.length });
}

/** Top a campaign up automatically when the brand has opted in. */
async function maybeAutoRefill(brandId: string, campaignId: string): Promise<void> {
  const brandRecord = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brandRecord?.autoRefillEnabled || !brandRecord.autoRefillAmountMicros) return;

  const method = await prisma.brandPaymentMethod.findFirst({
    where: { brandId, isDefault: true },
  });
  if (!method) {
    logger.warn('budget.autorefill_no_method', { brandId });
    return;
  }

  const { createDeposit } = await import('@/lib/billing/funding');
  const owner = await prisma.brandMember.findFirst({
    where: { brandId, role: 'BRAND_OWNER' },
    select: { userId: true },
  });

  try {
    await createDeposit({
      brandId,
      campaignId,
      amountMicros: brandRecord.autoRefillAmountMicros,
      actorUserId: owner?.userId ?? '',
      paymentMethodId: method.stripePaymentMethodId,
    });
    logger.info('budget.autorefill_initiated', { brandId, campaignId });
  } catch (error) {
    logger.error('budget.autorefill_failed', { brandId, error: (error as Error).message });
    await notifyBrand(brandId, {
      type: 'payment.failed',
      title: 'Automatic top-up failed',
      body: `We could not automatically add funds to a campaign. ${(error as Error).message}`,
      actionPath: '/brand/billing',
    });
  }
}

async function releaseEarningsJob(): Promise<void> {
  const released = await releaseMaturedEarnings(1000);
  if (released > 0) logger.info('earnings.released', { count: released });
}

/**
 * Auto-approve conversions that have sat pending past the configured window,
 * so a brand that never explicitly approves does not strand publisher earnings
 * indefinitely.
 */
async function autoApproveConversionsJob(): Promise<void> {
  const settings = await getSettings();
  if (!settings.conversionAutoApproveEnabled) return;

  const cutoff = new Date(Date.now() - settings.conversionAutoApproveDays * 24 * 60 * 60 * 1000);
  const pending = await prisma.conversion.findMany({
    where: { status: 'PENDING', createdAt: { lt: cutoff } },
    select: { id: true },
    take: 500,
  });

  const { approveConversion } = await import('@/lib/conversions/record');
  for (const { id } of pending) {
    await approveConversion(id, {
      reason: `Automatically approved after ${settings.conversionAutoApproveDays} days`,
    }).catch((error) =>
      logger.error('conversion.autoapprove_failed', { conversionId: id, error: (error as Error).message }),
    );
  }
  if (pending.length > 0) logger.info('conversions.autoapproved', { count: pending.length });
}

async function moderateCampaignJob(payload: Payload): Promise<void> {
  const { moderateCampaign } = await import('@/lib/moderation');
  await moderateCampaign(payload.campaignId as string);
}

/** Mark campaigns complete once their end date passes, returning unspent funds. */
async function completeCampaignsJob(): Promise<void> {
  const ended = await prisma.campaign.findMany({
    where: { status: 'ACTIVE', endsAt: { lt: new Date() } },
    select: { id: true, brandId: true, name: true },
    take: 200,
  });

  const { withSerializableTransaction } = await import('@/lib/db');

  for (const campaign of ended) {
    try {
      await withSerializableTransaction(async (tx) => {
        await budgetLib.defundCampaign(tx, {
          campaignId: campaign.id,
          brandId: campaign.brandId,
          idempotencyKey: `complete:defund:${campaign.id}`,
          reason: 'Campaign reached its end date',
        });
        await tx.campaign.update({
          where: { id: campaign.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      });
      await dispatch({
        brandId: campaign.brandId,
        eventType: 'campaign.completed',
        data: { campaignId: campaign.id },
      });
      await notifyBrand(campaign.brandId, {
        type: 'generic',
        title: `${campaign.name} has finished`,
        body: 'The campaign reached its end date. Any unspent budget has been returned to your balance.',
        actionPath: `/brand/campaigns/${campaign.id}`,
      });
    } catch (error) {
      logger.error('campaign.complete_failed', {
        campaignId: campaign.id,
        error: (error as Error).message,
      });
    }
  }
}

async function notifyCreatorEarningJob(payload: Payload): Promise<void> {
  const earning = await prisma.earning.findUnique({
    where: { id: payload.earningId as string },
    include: { campaign: { select: { name: true } }, creator: { include: { user: true } } },
  });
  if (!earning) return;

  await notifyCreator(earning.creatorId, {
    type: 'earning.created',
    title: `You earned ${formatMicros(earning.netMicros)}`,
    body: `From ${earning.campaign.name}.`,
    actionPath: '/creator/earnings',
    emailTemplate: {
      name: 'earning',
      params: {
        amountMicros: earning.netMicros.toString(),
        campaignName: earning.campaign.name,
        url: `${brand.appUrl}/creator/earnings`,
      },
    },
  });
}

async function notifyGenericJob(payload: Payload): Promise<void> {
  const kind = payload.kind as string;

  if (kind === 'payout.sent' || kind === 'payout.failed') {
    const payout = await prisma.payout.findUnique({
      where: { id: payload.payoutId as string },
      include: { creator: { include: { user: true } } },
    });
    if (!payout) return;

    const sent = kind === 'payout.sent';
    await notifyCreator(payout.creatorId, {
      type: sent ? 'payout.sent' : 'payout.failed',
      title: sent
        ? `${formatMicros(payout.amountMicros)} is on its way`
        : 'Your payout could not be completed',
      body: sent
        ? 'Funds typically arrive within 1–3 business days.'
        : `${payout.failureMessage ?? 'The transfer failed.'} Your balance has been returned in full.`,
      actionPath: '/creator/payouts',
      emailTemplate: {
        name: sent ? 'payoutSent' : 'payoutFailed',
        params: {
          amountMicros: payout.amountMicros.toString(),
          reason: payout.failureMessage ?? 'The transfer failed.',
          url: `${brand.appUrl}/creator/payouts`,
        },
      },
    });
    return;
  }

  if (payload.userId) {
    const { notify } = await import('@/lib/notify');
    await notify({
      userId: payload.userId as string,
      type: 'generic',
      title: String(payload.title ?? 'Notification'),
      body: String(payload.body ?? ''),
      actionPath: payload.actionPath as string | undefined,
    });
  }
}

/**
 * Data retention. Raw click and impression rows are dropped by partition once
 * past the retention horizon; the aggregated statistics that dashboards use are
 * kept indefinitely, so history is preserved without keeping per-visitor rows.
 */
async function retentionJob(): Promise<void> {
  const days = env.clickRetentionDays;

  const dropped = await prisma.$queryRaw<Array<{ dropped: string }>>`
    SELECT * FROM drop_old_partitions('clicks', ${days})
  `;
  const droppedImpressions = await prisma.$queryRaw<Array<{ dropped: string }>>`
    SELECT * FROM drop_old_partitions('impressions', ${days})
  `;

  const sessions = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
  });
  const tokens = await prisma.emailToken.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 30 * 86_400_000) } },
  });
  const { pruneCompletedJobs } = await import('@/lib/jobs/queue');
  const jobs = await pruneCompletedJobs(7);

  logger.info('retention.complete', {
    retentionDays: days,
    clickPartitionsDropped: dropped.map((d) => d.dropped),
    impressionPartitionsDropped: droppedImpressions.map((d) => d.dropped),
    sessionsPruned: sessions.count,
    tokensPruned: tokens.count,
    jobsPruned: jobs,
  });
}

/** Provision future partitions ahead of time so an insert never has to wait. */
async function ensurePartitionsJob(): Promise<void> {
  const clicks = await prisma.$queryRaw<Array<{ ensure_time_partitions: number }>>`
    SELECT ensure_time_partitions('clicks', 0, 6)
  `;
  const impressions = await prisma.$queryRaw<Array<{ ensure_time_partitions: number }>>`
    SELECT ensure_time_partitions('impressions', 0, 6)
  `;
  logger.info('partitions.ensured', {
    clicks: clicks[0]?.ensure_time_partitions ?? 0,
    impressions: impressions[0]?.ensure_time_partitions ?? 0,
  });
}

/**
 * Nightly proof that the ledger is internally consistent. Any drift is a
 * correctness bug and is escalated to administrators immediately rather than
 * being auto-corrected, which would hide the cause.
 */
async function ledgerReconcileJob(): Promise<void> {
  const global = await verifyGlobalBalance();
  const { checked, drifted } = await reconcileAll();

  if (!global.balanced || drifted.length > 0) {
    logger.error('ledger.reconciliation_failed', {
      globalBalanced: global.balanced,
      debits: global.debits.toString(),
      credits: global.credits.toString(),
      driftedAccounts: drifted.length,
    });
    await notifyAdmins({
      type: 'generic',
      title: 'Ledger reconciliation found a discrepancy',
      body: `${drifted.length} account(s) drifted from their entries${
        global.balanced ? '' : '; global debits and credits do not match'
      }. Investigate before processing further payouts.`,
      actionPath: '/admin/system',
    });
    return;
  }

  logger.info('ledger.reconciled', { accounts: checked, balanced: true });
}

async function verifyDomainJob(payload: Payload): Promise<void> {
  const { verifyDomain } = await import('@/lib/domains');
  await verifyDomain(payload.domainId as string);
}
