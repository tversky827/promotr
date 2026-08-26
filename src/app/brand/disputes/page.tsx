import type { Metadata } from 'next';

import { DisputeList } from '@/components/disputes/list';
import { NewDisputeDialog } from '@/components/disputes/new-dispute';
import { PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageBrand } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { listDisputes } from '@/lib/disputes';

export const metadata: Metadata = { title: 'Disputes' };
export const dynamic = 'force-dynamic';

export default async function BrandDisputesPage() {
  const { brand } = await pageBrand();
  const csrfToken = await currentCsrfToken();

  const [disputes, campaigns] = await Promise.all([
    listDisputes({ brandId: brand.id }),
    prisma.campaign.findMany({
      where: { brandId: brand.id },
      select: { id: true, name: true },
      take: 50,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Disputes"
        description="Raise invalid traffic or duplicate conversions. Publishers can also open disputes about your campaigns, and those appear here."
        action={<NewDisputeDialog csrfToken={csrfToken} campaigns={campaigns} role="brand" />}
      />

      <DisputeList
        disputes={disputes}
        basePath="/brand/disputes"
        emptyTitle="No disputes"
        emptyDescription="If you were charged for traffic you believe is invalid, open a dispute with the specific click or conversion IDs and we will investigate."
      />
    </>
  );
}
