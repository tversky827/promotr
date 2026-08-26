import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { DisputeThread } from '@/components/disputes/thread';
import { Badge, Breadcrumb, Card, CardHeader, DescriptionList, Field, PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageAdmin } from '@/lib/auth/guards';
import { loadDispute } from '@/lib/disputes';
import { formatDateTime, humanize, statusTone } from '@/lib/format';

export const metadata: Metadata = { title: 'Dispute' };
export const dynamic = 'force-dynamic';

export default async function AdminDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await pageAdmin();
  const csrfToken = await currentCsrfToken();

  // Administrators see internal notes; participants never do.
  const loaded = await loadDispute(id, session.user.id, true);
  if (!loaded) notFound();

  const { dispute, messages } = loaded;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[{ label: 'Disputes', href: '/admin/disputes' }, { label: dispute.reference }]}
          />
        }
        title={dispute.subject}
        description={`Dispute ${dispute.reference} · ${humanize(dispute.kind)}`}
        action={<Badge tone={statusTone(dispute.status)}>{humanize(dispute.status)}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <DisputeThread
            disputeId={dispute.id}
            status={dispute.status}
            messages={messages}
            csrfToken={csrfToken}
            isAdmin
          />
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="Parties" />
            <DescriptionList columns={1} className="mt-4">
              <Field label="Raised by">{humanize(dispute.openedBy)}</Field>
              {dispute.brand ? (
                <Field label="Brand">
                  <Link
                    href={`/admin/brands/${dispute.brand.id}`}
                    className="text-primary hover:underline"
                  >
                    {dispute.brand.displayName}
                  </Link>
                </Field>
              ) : null}
              {dispute.creator ? (
                <Field label="Publisher">
                  <Link
                    href={`/admin/creators/${dispute.creator.id}`}
                    className="text-primary hover:underline"
                  >
                    {dispute.creator.profile?.displayName ?? dispute.creator.handle}
                  </Link>
                </Field>
              ) : null}
              {dispute.campaign ? (
                <Field label="Campaign">
                  <Link
                    href={`/admin/campaigns/${dispute.campaign.id}`}
                    className="text-primary hover:underline"
                  >
                    {dispute.campaign.name}
                  </Link>
                </Field>
              ) : null}
              <Field label="Opened">{formatDateTime(dispute.createdAt)}</Field>
            </DescriptionList>
          </Card>

          {dispute.targetIds.length > 0 ? (
            <Card>
              <CardHeader
                title="Records referenced"
                description={`${dispute.targetIds.length} ${dispute.targetKind ?? 'record'}(s)`}
              />
              <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
                {dispute.targetIds.map((targetId) => (
                  <li key={targetId} className="break-all font-mono text-2xs text-fg-muted">
                    {targetId}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
