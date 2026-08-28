'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Input, Select } from '@/components/ui/form';
import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { ActionResult } from '@/server/actions/shared';

/**
 * Export request form and job list.
 *
 * Exports run in a background job, so the list polls while anything is still
 * queued or running and stops as soon as everything has settled. Polling only
 * while there is something to wait for keeps an idle reports page from issuing
 * a request every few seconds forever.
 */

export interface ExportJobView {
  id: string;
  kind: string;
  status: string;
  rowCount: number | null;
  fileUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export function ExportsPanel({
  kinds,
  campaigns,
  jobs,
  action,
  csrfToken,
  title = 'Export data',
  description,
}: {
  kinds: Array<{ value: string; label: string }>;
  campaigns: Array<{ id: string; name: string }>;
  jobs: ExportJobView[];
  action: (formData: FormData) => Promise<ActionResult<{ exportJobId: string }>>;
  csrfToken: string;
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const pending = jobs.some((job) => job.status === 'queued' || job.status === 'running');

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [pending, router]);

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={title}
          description={
            description ??
            'Exports are generated in the background and delivered as CSV. Nothing is truncated below one million rows.'
          }
        />
        <ActionForm action={action} csrfToken={csrfToken} className="mt-4" resetOnSuccess>
          <FormBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ExportKindField kinds={kinds} />
            <CampaignField campaigns={campaigns} />
            <DateField name="from" label="From" defaultValue={monthAgo} max={today} />
            <DateField name="to" label="To" defaultValue={today} max={today} />
          </FormBody>
          <div className="mt-4">
            <SubmitButton>Start export</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      {/* The list appears once there is something in it. An empty box below
          the form is furniture, not information. */}
      {jobs.length === 0 ? null : (
        <Card padded={false}>
          <div className="p-5">
            <CardHeader
              title="Recent exports"
              description="Files are available for seven days, then removed."
            />
          </div>

          <div className="scroll-x border-t border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-sunken">
                <tr>
                  <Th>Data</Th>
                  <Th>Requested</Th>
                  <Th>Status</Th>
                  <Th>Rows</Th>
                  <Th>File</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map((job) => {
                  const expired =
                    job.expiresAt !== null && new Date(job.expiresAt).getTime() < Date.now();
                  return (
                    <tr key={job.id}>
                      <td className="px-3.5 py-2.5 font-medium capitalize text-fg">{job.kind}</td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-fg-muted">
                        {formatDateTime(new Date(job.createdAt))}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <StatusBadge status={job.status} />
                        {job.errorMessage ? (
                          <p className="mt-1 text-xs text-danger">{job.errorMessage}</p>
                        ) : null}
                      </td>
                      <td className="px-3.5 py-2.5 tabular-nums text-fg-muted">
                        {job.rowCount === null ? '—' : formatNumber(job.rowCount)}
                      </td>
                      <td className="px-3.5 py-2.5">
                        {job.status === 'ready' && job.fileUrl && !expired ? (
                          <a
                            href={job.fileUrl}
                            className="font-medium text-primary hover:underline"
                            download
                          >
                            Download CSV
                          </a>
                        ) : (
                          <span className="text-fg-subtle">{expired ? 'Expired' : '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ExportKindField({ kinds }: { kinds: Array<{ value: string; label: string }> }) {
  return (
    <Select
      label="Data"
      name="kind"
      defaultValue={kinds[0]?.value}
      error={useFieldError('kind')}
      options={kinds}
    />
  );
}

function CampaignField({ campaigns }: { campaigns: Array<{ id: string; name: string }> }) {
  return (
    <Select
      label="Campaign"
      name="campaignId"
      hint="Optional"
      defaultValue=""
      error={useFieldError('campaignId')}
      options={[
        { value: '', label: 'All campaigns' },
        ...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name })),
      ]}
    />
  );
}

function DateField({
  name,
  label,
  defaultValue,
  max,
}: {
  name: string;
  label: string;
  defaultValue: string;
  max: string;
}) {
  return (
    <Input
      type="date"
      label={label}
      name={name}
      defaultValue={defaultValue}
      max={max}
      error={useFieldError(name)}
    />
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
      {children}
    </th>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'ready':
      return <Badge tone="success">Ready</Badge>;
    case 'failed':
      return <Badge tone="danger">Failed</Badge>;
    case 'running':
      return <Badge tone="info">Generating</Badge>;
    default:
      return <Badge tone="neutral">Queued</Badge>;
  }
}
