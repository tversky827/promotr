import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { DisputeThread } from '@/components/disputes/thread';
import { Badge, Breadcrumb, Card, CardHeader, DescriptionList, Field, PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageBrand } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { loadDispute } from '@/lib/disputes';
import { formatDateTime, humanize, statusTone } from '@/lib/format';

export const metadata: Metadata = { title: 'Dispute' };
export const dynamic = 'force-dynamic';

export default async function BrandDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { brand, user } = await pageBrand();
  const csrfToken = await currentCsrfToken();

  const loaded = await loadDispute(id, user.id, false);
  if (!loaded) notFound();

  // A brand sees disputes it raised, and disputes publishers raised about its
  // campaigns — but nothing else.
  const ownCampaign = loaded.dispute.campaignId
    ? await prisma.campaign.count({ where: { id: loaded.dispute.campaignId, brandId: brand.id } })
    : 0;
  if (loaded.dispute.brandId !== brand.id && ownCampaign === 0) notFound();

  const { dispute, messages } = loaded;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[{ label: 'Disputes', href: '/brand/disputes' }, { label: dispute.reference }]}
          />
        }
        title={dispute.subject}
        description={`Dispute ${dispute.reference}`}
        action={<Badge tone={statusTone(dispute.status)}>{humanize(dispute.status)}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <DisputeThread
            disputeId={dispute.id}
            status={dispute.status}
            messages={messages}
            csrfToken={csrfToken}
            isAdmin={false}
          />
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="Details" />
            <DescriptionList columns={1} className="mt-4">
              <Field label="Reference">{dispute.reference}</Field>
              <Field label="Type">{humanize(dispute.kind)}</Field>
              <Field label="Raised by">
                {dispute.openedBy === 'BRAND' ? 'Your team' : humanize(dispute.openedBy)}
              </Field>
              <Field label="Opened">{formatDateTime(dispute.createdAt)}</Field>
              {dispute.campaign ? <Field label="Campaign">{dispute.campaign.name}</Field> : null}
            </DescriptionList>
          </Card>
        </div>
      </div>
    </>
  );
}
