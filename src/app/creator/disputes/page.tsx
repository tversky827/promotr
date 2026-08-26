import type { Metadata } from 'next';

import { NewDisputeDialog } from '@/components/disputes/new-dispute';
import { DisputeList } from '@/components/disputes/list';
import { PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageCreator } from '@/lib/auth/guards';
import { listDisputes } from '@/lib/disputes';
import { prisma } from '@/lib/db';

export const metadata: Metadata = { title: 'Disputes' };
export const dynamic = 'force-dynamic';

export default async function CreatorDisputesPage() {
  const { creator } = await pageCreator();
  const csrfToken = await currentCsrfToken();

  const [disputes, campaigns] = await Promise.all([
    listDisputes({ creatorId: creator.id }),
    prisma.trackingLink
      .findMany({
        where: { creatorId: creator.id },
        distinct: ['campaignId'],
        select: { campaign: { select: { id: true, name: true } } },
        take: 50,
      })
      .then((rows) => rows.map((row) => row.campaign)),
  ]);

  return (
    <>
      <PageHeader
        title="Disputes"
        description="Disagree with a decision on your traffic, earnings, or a payout? Raise it here and an administrator will review it."
        action={
          <NewDisputeDialog
            csrfToken={csrfToken}
            campaigns={campaigns}
            role="publisher"
          />
        }
      />

      <DisputeList
        disputes={disputes}
        basePath="/creator/disputes"
        emptyTitle="No disputes"
        emptyDescription="If earnings are rejected or held and you believe the decision is wrong, open a dispute. Include dates, campaign names and anything else that helps."
      />
    </>
  );
}
