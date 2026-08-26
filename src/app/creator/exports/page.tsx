import type { Metadata } from 'next';

import { ExportsPanel, type ExportJobView } from '@/components/exports/panel';
import { PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageCreator } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { requestCreatorExport } from '@/server/actions/creator';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

/**
 * Publisher reports.
 *
 * Everything here is the publisher's own data, exported in full. A publisher
 * who wants to reconcile our numbers against their own analytics can take the
 * raw rows and do it — earnings you cannot audit are earnings you cannot trust.
 */
export default async function CreatorExportsPage() {
  const { creator, user } = await pageCreator();
  const csrfToken = await currentCsrfToken();

  const [jobs, campaigns] = await Promise.all([
    prisma.exportJob.findMany({
      where: { userId: user.id, scopeKind: 'creator' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.trackingLink
      .findMany({
        where: { creatorId: creator.id },
        select: { campaign: { select: { id: true, name: true } } },
        distinct: ['campaignId'],
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      .then((links) => links.map((link) => link.campaign)),
  ]);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Export your clicks, conversions, earnings and payouts as CSV."
      />

      <ExportsPanel
        csrfToken={csrfToken}
        action={requestCreatorExport}
        campaigns={campaigns}
        jobs={jobs.map(toView)}
        kinds={[
          { value: 'clicks', label: 'Clicks' },
          { value: 'conversions', label: 'Conversions' },
          { value: 'earnings', label: 'Earnings' },
          { value: 'payouts', label: 'Payouts' },
        ]}
        description="Clicks and conversions include the eligibility decision for each row, so a rejected event shows you why it was rejected."
      />
    </>
  );
}

function toView(job: {
  id: string;
  kind: string;
  status: string;
  rowCount: number | null;
  fileUrl: string | null;
  errorMessage: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}): ExportJobView {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    rowCount: job.rowCount,
    fileUrl: job.fileUrl,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt?.toISOString() ?? null,
  };
}
