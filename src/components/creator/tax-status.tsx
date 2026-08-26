'use client';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Checkbox, Select } from '@/components/ui/form';
import { Alert, Badge, Card, CardHeader } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { declareTaxStatus } from '@/server/actions/creator';

/**
 * Tax declaration.
 *
 * This records *which* form applies, nothing more. The form itself — and every
 * identification number on it — is collected by the payout provider during
 * onboarding, so this application never holds a taxpayer identification number.
 * The wording is deliberately descriptive rather than advisory: telling a
 * publisher which form they should file would be tax advice.
 */
export function TaxStatusCard({
  csrfToken,
  taxFormKind,
  taxFormStatus,
  submittedAt,
  country,
}: {
  csrfToken: string;
  taxFormKind: string | null;
  taxFormStatus: string | null;
  submittedAt: string | null;
  country: string | null;
}) {
  const declared = taxFormKind !== null && taxFormStatus !== null;

  return (
    <Card>
      <CardHeader
        title="Tax status"
        description="Which tax form applies to you. Payouts are gated on this being declared."
        action={
          declared ? (
            <Badge tone="success">{taxFormKind}</Badge>
          ) : (
            <Badge tone="warning">Not declared</Badge>
          )
        }
      />

      {declared ? (
        <p className="mt-4 text-sm text-fg-muted text-pretty">
          You declared <span className="font-medium text-fg">{taxFormKind}</span>
          {submittedAt ? ` on ${formatDateTime(new Date(submittedAt))}` : null}. Complete the form
          itself in your payout provider onboarding — we do not collect or store tax identification
          numbers. To change your declaration, submit a new one below.
        </p>
      ) : null}

      <ActionForm action={declareTaxStatus} csrfToken={csrfToken} className="mt-4">
        <FormBody className="grid max-w-md gap-4">
          <TaxFormField country={country} defaultValue={taxFormKind} />
          <Checkbox
            name="confirm"
            label="The information I provide is accurate"
            description="You are responsible for your own tax position. We report payments as required by law and cannot advise you on which form applies."
          />
        </FormBody>
        <div className="mt-4">
          <SubmitButton>{declared ? 'Update declaration' : 'Declare tax status'}</SubmitButton>
        </div>
      </ActionForm>

      <Alert tone="info" title="This is not tax advice" className="mt-4">
        If you are unsure which form applies to you, speak to a tax professional in your country.
      </Alert>
    </Card>
  );
}

function TaxFormField({
  country,
  defaultValue,
}: {
  country: string | null;
  defaultValue: string | null;
}) {
  return (
    <Select
      name="taxFormKind"
      label="Tax form"
      defaultValue={defaultValue ?? (country === 'US' ? 'W9' : '')}
      placeholder="Choose the form that applies"
      required
      error={useFieldError('taxFormKind')}
      options={[
        { value: 'W9', label: 'W-9 — US person or US-registered entity' },
        { value: 'W8BEN', label: 'W-8BEN — non-US individual' },
        { value: 'W8BENE', label: 'W-8BEN-E — non-US entity' },
      ]}
    />
  );
}
