import { prisma } from '@/lib/db';
import { formatDateTime } from '@/lib/format';

import type { ThreadMessage } from '@/components/disputes/thread';
import type { DisputeRow } from '@/components/disputes/list';

/**
 * Dispute read helpers shared by the publisher, brand, and admin views.
 *
 * `includeInternal` is the only difference between what an administrator sees
 * and what a participant sees, and it is a parameter rather than a filter
 * applied at render time — so a participant view cannot accidentally leak an
 * internal note by forgetting to filter.
 */

export async function listDisputes(where: {
  brandId?: string;
  creatorId?: string;
  status?: string;
}): Promise<DisputeRow[]> {
  const disputes = await prisma.dispute.findMany({
    where: {
      ...(where.brandId ? { brandId: where.brandId } : {}),
      ...(where.creatorId ? { creatorId: where.creatorId } : {}),
      ...(where.status ? { status: where.status as never } : {}),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    include: {
      campaign: { select: { name: true } },
      _count: { select: { messages: true } },
    },
  });

  return disputes.map((dispute) => ({
    id: dispute.id,
    reference: dispute.reference,
    kind: dispute.kind,
    status: dispute.status,
    subject: dispute.subject,
    openedBy: dispute.openedBy,
    createdAt: dispute.createdAt,
    campaignName: dispute.campaign?.name ?? null,
    messageCount: dispute._count.messages,
  }));
}

export async function loadDispute(
  disputeId: string,
  viewerUserId: string,
  includeInternal: boolean,
) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      campaign: { select: { id: true, name: true, slug: true } },
      brand: { select: { id: true, displayName: true } },
      creator: { select: { id: true, handle: true, profile: { select: { displayName: true } } } },
      messages: {
        where: includeInternal ? {} : { internal: false },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, role: true } } },
      },
    },
  });

  if (!dispute) return null;

  const messages: ThreadMessage[] = dispute.messages.map((message) => ({
    id: message.id,
    body: message.body,
    internal: message.internal,
    createdAt: formatDateTime(message.createdAt),
    authorName: message.author.name,
    authorRole: message.author.role,
    isYou: message.author.id === viewerUserId,
  }));

  return { dispute, messages };
}
