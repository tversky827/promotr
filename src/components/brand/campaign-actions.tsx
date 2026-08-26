'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { CSRF_FIELD } from '@/lib/auth/constants';
import {
  completeCampaign,
  launchCampaign,
  pauseCampaign,
  submitForReview,
} from '@/server/actions/campaigns';

/**
 * Campaign lifecycle controls.
 *
 * Which button appears depends on the campaign's state, so there is never a
 * control that cannot work. Ending a campaign is destructive and asks first.
 */
export function CampaignActions({
  campaignId,
  status,
  canManage,
  hasFunds,
  csrfToken,
  publicSlug,
}: {
  campaignId: string;
  status: string;
  canManage: boolean;
  hasFunds: boolean;
  csrfToken: string;
  publicSlug: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const run = (
    fn: (formData: FormData) => Promise<{ ok: boolean; error?: string }>,
    extra: Record<string, string> = {},
  ) => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('campaignId', campaignId);
      for (const [key, value] of Object.entries(extra)) formData.set(key, value);

      const result = await fn(formData);
      if (!result.ok) {
        setError(result.error ?? 'That did not work.');
        return;
      }
      setConfirmEnd(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === 'ACTIVE' ? (
          <ButtonLink href={`/campaigns/${publicSlug}`} variant="ghost" size="sm">
            View public page
          </ButtonLink>
        ) : null}

        {canManage && (status === 'DRAFT' || status === 'REJECTED') ? (
          <Button size="sm" loading={pending} onClick={() => run(submitForReview)}>
            Submit for review
          </Button>
        ) : null}

        {canManage && (status === 'APPROVED' || status === 'PAUSED') ? (
          <Button size="sm" loading={pending} onClick={() => run(launchCampaign)} disabled={!hasFunds}>
            {status === 'PAUSED' ? 'Resume campaign' : 'Launch campaign'}
          </Button>
        ) : null}

        {canManage && status === 'ACTIVE' ? (
          <Button size="sm" variant="secondary" loading={pending} onClick={() => run(pauseCampaign)}>
            Pause
          </Button>
        ) : null}

        {canManage && ['ACTIVE', 'PAUSED', 'APPROVED'].includes(status) ? (
          confirmEnd ? (
            <>
              <Button size="sm" variant="danger" loading={pending} onClick={() => run(completeCampaign)}>
                Yes, end it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(true)}>
              End campaign
            </Button>
          )
        ) : null}

        <ButtonLink href={`/brand/campaigns/${campaignId}/funding`} size="sm" variant="secondary">
          {hasFunds ? 'Add funds' : 'Fund campaign'}
        </ButtonLink>
      </div>

      {confirmEnd ? (
        <p className="max-w-xs text-right text-xs text-fg-muted text-pretty">
          Ending the campaign stops all links and returns unspent budget to your balance. Earnings
          already accrued are unaffected.
        </p>
      ) : null}

      {error ? (
        <p className="max-w-sm text-right text-xs font-medium text-danger text-pretty" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
