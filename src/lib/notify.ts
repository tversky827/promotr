import { brand } from '@/lib/brand';
import { prisma } from '@/lib/db';
import { integrations } from '@/lib/env';
import { enqueue } from '@/lib/jobs/queue';
import { logger } from '@/lib/observability/logger';

/**
 * Notifications.
 *
 * Every notification is written to the in-app inbox synchronously, then queued
 * for email delivery. The split matters: the user sees it immediately in the
 * product even if the mail provider is down or unconfigured, and the email is
 * retried independently.
 */

export type NotificationType =
  // Publisher
  | 'account.verified'
  | 'campaign.application.approved'
  | 'campaign.application.rejected'
  | 'campaign.paused'
  | 'campaign.ending'
  | 'earning.created'
  | 'payout.available'
  | 'payout.sent'
  | 'payout.failed'
  | 'traffic.flagged'
  // Brand
  | 'campaign.approved'
  | 'campaign.rejected'
  | 'campaign.funded'
  | 'campaign.launched'
  | 'campaign.budget.low'
  | 'conversion.received'
  | 'payment.failed'
  | 'dispute.opened'
  | 'dispute.resolved'
  // Both
  | 'generic';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  actionPath?: string;
  /** Set false for high-volume events that should stay in-app only. */
  email?: boolean;
  emailTemplate?: { name: string; params: Record<string, unknown> };
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        actionUrl: input.actionPath ? `${brand.appUrl}${input.actionPath}` : null,
      },
    });

    if (input.email !== false) {
      await enqueue('email.send', {
        notificationId: notification.id,
        userId: input.userId,
        template: input.emailTemplate?.name ?? 'generic',
        params: {
          heading: input.title,
          body: input.body,
          ...(input.actionPath
            ? { cta: { label: 'Open', url: `${brand.appUrl}${input.actionPath}` } }
            : {}),
          ...(input.emailTemplate?.params ?? {}),
        },
      });
    }
  } catch (error) {
    // A notification failure must never break the action that triggered it.
    logger.error('notify.failed', {
      userId: input.userId,
      type: input.type,
      error: (error as Error).message,
    });
  }
}

/** Notify every member of a brand (used for campaign and billing events). */
export async function notifyBrand(
  brandId: string,
  input: Omit<NotifyInput, 'userId'>,
): Promise<void> {
  const members = await prisma.brandMember.findMany({
    where: { brandId },
    select: { userId: true },
  });
  await Promise.all(members.map((m) => notify({ ...input, userId: m.userId })));
}

export async function notifyCreator(
  creatorId: string,
  input: Omit<NotifyInput, 'userId'>,
): Promise<void> {
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { userId: true },
  });
  if (!creator) return;
  await notify({ ...input, userId: creator.userId });
}

export async function notifyAdmins(input: Omit<NotifyInput, 'userId'>): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  await Promise.all(admins.map((a) => notify({ ...input, userId: a.id })));
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/** Surfaced in the UI so users know whether email will actually arrive. */
export function emailDeliveryStatus(): { configured: boolean; provider: string; note: string } {
  const configured = integrations.email.configured;
  const provider = integrations.email.provider;
  return {
    configured,
    provider,
    note: configured
      ? provider === 'console'
        ? 'Email is in development mode: messages are written to the server log, not sent.'
        : `Email is delivered through ${provider}.`
      : 'Email is not configured. Notifications appear in-app only until EMAIL_PROVIDER and EMAIL_API_KEY are set.',
  };
}
