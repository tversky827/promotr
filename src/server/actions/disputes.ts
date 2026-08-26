'use server';

import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth/guards';
import { generateReference } from '@/lib/crypto/ids';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { notifyAdmins, notifyBrand, notifyCreator } from '@/lib/notify';
import { enforceRateLimit } from '@/lib/ratelimit';

import { action, actionError, actionOk } from './shared';

/**
 * Disputes.
 *
 * Both sides of the marketplace can raise one, which matters: a system where
 * only brands can dispute is a system where publishers have no recourse when
 * their traffic is rejected, and that is how a marketplace loses its supply.
 *
 * A dispute is a conversation with an audit trail, not a form submission. Every
 * message is retained, participants are notified, and only an administrator can
 * resolve it — the counterparty cannot close a dispute against themselves.
 */

const DISPUTE_KINDS = [
  'FRAUDULENT_CLICKS',
  'FRAUDULENT_CONVERSIONS',
  'DUPLICATE_CONVERSION',
  'INVALID_TRAFFIC',
  'REJECTED_EARNING',
  'PAYOUT_DECISION',
  'OTHER',
] as const;

const createSchema = z.object({
  kind: z.enum(DISPUTE_KINDS),
  subject: z.string().trim().min(5, 'Summarise the issue').max(200),
  body: z
    .string()
    .trim()
    .min(30, 'Describe what happened in at least 30 characters — detail speeds up resolution')
    .max(5000),
  campaignId: z.string().uuid().optional().or(z.literal('')),
  targetKind: z.enum(['click', 'conversion', 'earning', 'payout']).optional().or(z.literal('')),
  targetIds: z.string().trim().max(4000).optional().or(z.literal('')),
});

export const openDispute = action(createSchema, async (input, context) => {
  const session = await requireSession();
  await enforceRateLimit('disputeCreate', session.user.id);

  const [creator, membership] = await Promise.all([
    prisma.creator.findUnique({ where: { userId: session.user.id }, select: { id: true } }),
    prisma.brandMember.findFirst({
      where: { userId: session.user.id },
      select: { brandId: true },
    }),
  ]);

  const openedBy =
    session.user.role === 'ADMIN' ? 'ADMIN' : creator ? 'PUBLISHER' : membership ? 'BRAND' : null;

  if (!openedBy) {
    return actionError('Only brands and publishers can open a dispute.');
  }

  // A campaign referenced in a dispute must be one the opener is party to.
  if (input.campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: input.campaignId },
      select: { id: true, brandId: true },
    });
    if (!campaign) return actionError('That campaign was not found.');

    if (openedBy === 'BRAND' && campaign.brandId !== membership?.brandId) {
      return actionError('You can only dispute campaigns on your own account.');
    }
    if (openedBy === 'PUBLISHER' && creator) {
      const hasLink = await prisma.trackingLink.count({
        where: { campaignId: campaign.id, creatorId: creator.id },
      });
      if (hasLink === 0) {
        return actionError('You can only dispute campaigns you have promoted.');
      }
    }
  }

  const targetIds = (input.targetIds ?? '')
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 200);

  const dispute = await prisma.dispute.create({
    data: {
      reference: generateReference('DSP'),
      kind: input.kind,
      openedBy,
      openedByUserId: session.user.id,
      brandId: openedBy === 'BRAND' ? (membership?.brandId ?? null) : null,
      creatorId: openedBy === 'PUBLISHER' ? (creator?.id ?? null) : null,
      campaignId: input.campaignId || null,
      subject: input.subject,
      body: input.body,
      targetKind: input.targetKind || null,
      targetIds,
      messages: {
        create: { authorUserId: session.user.id, body: input.body },
      },
    },
  });

  await notifyAdmins({
    type: 'dispute.opened',
    title: `Dispute ${dispute.reference} opened`,
    body: `${openedBy === 'BRAND' ? 'A brand' : 'A publisher'} raised: ${input.subject}`,
    actionPath: `/admin/disputes/${dispute.id}`,
    email: false,
  });

  // Notify the counterparty so they can respond, if there is one.
  if (input.campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: input.campaignId },
      select: { brandId: true, name: true },
    });
    if (campaign && openedBy === 'PUBLISHER') {
      await notifyBrand(campaign.brandId, {
        type: 'dispute.opened',
        title: `A publisher opened dispute ${dispute.reference}`,
        body: `Regarding ${campaign.name}: ${input.subject}`,
        actionPath: `/brand/disputes/${dispute.id}`,
        emailTemplate: {
          name: 'disputeOpened',
          params: {
            reference: dispute.reference,
            subject: input.subject,
            url: `/brand/disputes/${dispute.id}`,
          },
        },
      });
    }
  }

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: session.user.role,
    actorIp: context.ip,
    action: 'dispute.opened',
    entityKind: 'dispute',
    entityId: dispute.id,
    metadata: { kind: input.kind, openedBy, targetCount: targetIds.length },
  });

  logger.info('dispute.opened', {
    disputeId: dispute.id,
    reference: dispute.reference,
    openedBy,
    kind: input.kind,
  });

  return actionOk(
    { disputeId: dispute.id, reference: dispute.reference },
    `Dispute ${dispute.reference} opened. We will review it and respond here.`,
  );
});

const messageSchema = z.object({
  disputeId: z.string().uuid(),
  body: z.string().trim().min(1, 'Write a message').max(5000),
  internal: z.union([z.literal('on'), z.literal('true'), z.undefined()]).optional(),
});

export const addDisputeMessage = action(messageSchema, async (input, context) => {
  const session = await requireSession();

  const dispute = await prisma.dispute.findUnique({ where: { id: input.disputeId } });
  if (!dispute) return actionError('That dispute was not found.');

  if (!(await canAccessDispute(session.user.id, session.user.role, dispute))) {
    return actionError('You do not have access to this dispute.');
  }

  // Internal notes are admin-only and never shown to participants.
  const internal = session.user.role === 'ADMIN' && (input.internal === 'on' || input.internal === 'true');

  await prisma.disputeMessage.create({
    data: {
      disputeId: dispute.id,
      authorUserId: session.user.id,
      body: input.body,
      internal,
    },
  });

  // A reply from a participant moves an awaiting-information dispute forward.
  if (dispute.status === 'AWAITING_INFORMATION' && session.user.role !== 'ADMIN') {
    await prisma.dispute.update({
      where: { id: dispute.id },
      data: { status: 'INVESTIGATING' },
    });
  }

  if (!internal) {
    await notifyDisputeParticipants(dispute, session.user.id, {
      title: `New message on dispute ${dispute.reference}`,
      body: input.body.slice(0, 160),
    });
  }

  await recordAudit({
    actorUserId: session.user.id,
    actorIp: context.ip,
    action: 'dispute.message_added',
    entityKind: 'dispute',
    entityId: dispute.id,
    metadata: { internal },
  });

  return actionOk(undefined, internal ? 'Internal note added.' : 'Message sent.');
});

const resolveSchema = z.object({
  disputeId: z.string().uuid(),
  status: z.enum(['INVESTIGATING', 'AWAITING_INFORMATION', 'RESOLVED', 'REJECTED']),
  resolution: z
    .string()
    .trim()
    .min(10, 'Explain the decision — this is what both parties will see')
    .max(2000),
});

/** Only administrators can change a dispute's status. */
export const resolveDispute = action(resolveSchema, async (input, context) => {
  const session = await requireSession();
  if (session.user.role !== 'ADMIN') {
    return actionError('Only an administrator can resolve a dispute.');
  }

  const dispute = await prisma.dispute.findUnique({ where: { id: input.disputeId } });
  if (!dispute) return actionError('That dispute was not found.');

  const terminal = input.status === 'RESOLVED' || input.status === 'REJECTED';

  await prisma.$transaction([
    prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        status: input.status,
        resolution: input.resolution,
        resolvedByUserId: terminal ? session.user.id : null,
        resolvedAt: terminal ? new Date() : null,
      },
    }),
    prisma.disputeMessage.create({
      data: {
        disputeId: dispute.id,
        authorUserId: session.user.id,
        body: input.resolution,
      },
    }),
  ]);

  await notifyDisputeParticipants(dispute, null, {
    title: `Dispute ${dispute.reference} is ${input.status.toLowerCase().replace('_', ' ')}`,
    body: input.resolution.slice(0, 200),
  });

  await recordAudit({
    actorUserId: session.user.id,
    actorRole: 'ADMIN',
    actorIp: context.ip,
    action: `dispute.${input.status.toLowerCase()}`,
    entityKind: 'dispute',
    entityId: dispute.id,
    reason: input.resolution,
    before: { status: dispute.status },
    after: { status: input.status },
  });

  return actionOk(undefined, `Dispute marked ${input.status.toLowerCase().replace('_', ' ')}.`);
});

/**
 * Access control for a dispute.
 *
 * A user may see a dispute if they opened it, are the brand or publisher it
 * concerns, or are an administrator. Nothing else — a dispute contains the
 * counterparty's account details and evidence.
 */
async function canAccessDispute(
  userId: string,
  role: string,
  dispute: { openedByUserId: string; brandId: string | null; creatorId: string | null },
): Promise<boolean> {
  if (role === 'ADMIN') return true;
  if (dispute.openedByUserId === userId) return true;

  if (dispute.brandId) {
    const member = await prisma.brandMember.count({
      where: { userId, brandId: dispute.brandId },
    });
    if (member > 0) return true;
  }

  if (dispute.creatorId) {
    const creator = await prisma.creator.count({ where: { id: dispute.creatorId, userId } });
    if (creator > 0) return true;
  }

  return false;
}

export async function assertDisputeAccess(disputeId: string): Promise<boolean> {
  const session = await requireSession();
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) return false;
  return canAccessDispute(session.user.id, session.user.role, dispute);
}

async function notifyDisputeParticipants(
  dispute: { id: string; reference: string; brandId: string | null; creatorId: string | null },
  excludeUserId: string | null,
  message: { title: string; body: string },
): Promise<void> {
  if (dispute.brandId) {
    await notifyBrand(dispute.brandId, {
      type: 'generic',
      title: message.title,
      body: message.body,
      actionPath: `/brand/disputes/${dispute.id}`,
      email: false,
    });
  }
  if (dispute.creatorId) {
    await notifyCreator(dispute.creatorId, {
      type: 'generic',
      title: message.title,
      body: message.body,
      actionPath: `/creator/disputes/${dispute.id}`,
      email: false,
    });
  }
  void excludeUserId;
}
