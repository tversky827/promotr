'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Card, CardHeader } from '@/components/ui/primitives';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { runAction } from '@/lib/client/submit';
import { openDispute } from '@/server/actions/disputes';

/**
 * Dispute form.
 *
 * The available dispute kinds differ by role: a brand disputes traffic it was
 * charged for, a publisher disputes a decision that cost them earnings.
 * Offering the wrong list to either side would be confusing at best.
 */
const PUBLISHER_KINDS = [
  { value: 'REJECTED_EARNING', label: 'An earning was rejected or held' },
  { value: 'INVALID_TRAFFIC', label: 'My traffic was marked invalid' },
  { value: 'PAYOUT_DECISION', label: 'A payout decision' },
  { value: 'OTHER', label: 'Something else' },
];

const BRAND_KINDS = [
  { value: 'FRAUDULENT_CLICKS', label: 'Clicks I was charged for look fraudulent' },
  { value: 'FRAUDULENT_CONVERSIONS', label: 'Conversions look fraudulent' },
  { value: 'DUPLICATE_CONVERSION', label: 'A conversion was counted twice' },
  { value: 'INVALID_TRAFFIC', label: 'Invalid traffic' },
  { value: 'OTHER', label: 'Something else' },
];

export function NewDisputeDialog({
  csrfToken,
  campaigns,
  role,
}: {
  csrfToken: string;
  campaigns: Array<{ id: string; name: string }>;
  role: 'publisher' | 'brand';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const kinds = role === 'publisher' ? PUBLISHER_KINDS : BRAND_KINDS;
  const [kind, setKind] = useState(kinds[0]!.value);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [targetIds, setTargetIds] = useState('');

  const submit = () => {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('kind', kind);
      formData.set('subject', subject);
      formData.set('body', body);
      if (campaignId) formData.set('campaignId', campaignId);
      if (targetIds) {
        formData.set('targetIds', targetIds);
        formData.set('targetKind', role === 'publisher' ? 'earning' : 'conversion');
      }

      const result = await runAction(openDispute, formData);
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setOpen(false);
      router.push(
        role === 'publisher'
          ? `/creator/disputes/${result.data.disputeId}`
          : `/brand/disputes/${result.data.disputeId}`,
      );
      router.refresh();
    });
  };

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Open a dispute</Button>;
  }

  return (
    <Card className="w-full max-w-2xl lg:min-w-[36rem]">
      <CardHeader
        title="Open a dispute"
        description="An administrator reviews every dispute. The more specific you are, the faster it resolves."
        action={
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
      />

      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <div className="mt-4 space-y-4">
        <Select
          label="What is this about?"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          options={kinds}
          error={fieldErrors.kind}
        />

        {campaigns.length > 0 ? (
          <Select
            label="Campaign"
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
            placeholder="Not campaign-specific"
            options={campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name }))}
            error={fieldErrors.campaignId}
          />
        ) : null}

        <Input
          label="Subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Earnings from 14 March rejected as invalid traffic"
          required
          error={fieldErrors.subject}
        />

        <Textarea
          label="What happened?"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={6}
          required
          placeholder="Include dates, amounts, and anything that supports your case. If you have screenshots or analytics, link to them."
          error={fieldErrors.body}
        />

        <Input
          label="Specific IDs"
          value={targetIds}
          onChange={(event) => setTargetIds(event.target.value)}
          placeholder="Optional. Paste earning, conversion or click IDs, separated by commas."
          error={fieldErrors.targetIds}
          description="Referencing exact records means we can look at precisely what you mean."
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button loading={pending} onClick={submit}>
            Open dispute
          </Button>
        </div>
      </div>
    </Card>
  );
}
