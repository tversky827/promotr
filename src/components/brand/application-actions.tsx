'use client';

import { useState } from 'react';

import { ActionForm, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { decideApplication } from '@/server/actions/campaigns';

/**
 * Approve or decline a publisher's application to a campaign.
 *
 * Declining asks for a reason before it will submit. A publisher who is told
 * "no" with no explanation cannot fix anything, and unexplained rejections are
 * what make a marketplace lose the supply side.
 */
export function ApplicationActions({
  applicationId,
  csrfToken,
}: {
  applicationId: string;
  csrfToken: string;
}) {
  const [declining, setDeclining] = useState(false);

  if (declining) {
    return (
      <ActionForm action={decideApplication} csrfToken={csrfToken} className="w-full sm:w-80">
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="decision" value="REJECTED" />
        <NoteField />
        <div className="mt-2 flex gap-2">
          <SubmitButton variant="danger" size="sm">
            Decline
          </SubmitButton>
          <Button variant="ghost" size="sm" type="button" onClick={() => setDeclining(false)}>
            Cancel
          </Button>
        </div>
      </ActionForm>
    );
  }

  return (
    <div className="flex gap-2">
      <ActionForm action={decideApplication} csrfToken={csrfToken}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="decision" value="APPROVED" />
        <SubmitButton size="sm">Approve</SubmitButton>
      </ActionForm>
      <Button variant="secondary" size="sm" onClick={() => setDeclining(true)}>
        Decline
      </Button>
    </div>
  );
}

function NoteField() {
  return (
    <Textarea
      name="note"
      label="Why are you declining?"
      placeholder="Their audience does not match this campaign's target market."
      rows={2}
      required
      hint="Sent to the publisher"
      error={useFieldError('note')}
    />
  );
}
