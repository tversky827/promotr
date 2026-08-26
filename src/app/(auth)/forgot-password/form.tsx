'use client';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Input } from '@/components/ui/form';
import { requestPasswordReset } from '@/server/actions/auth';

export function ActionFormClient({ csrfToken }: { csrfToken: string }) {
  return (
    <ActionForm action={requestPasswordReset} csrfToken={csrfToken} refresh={false} resetOnSuccess>
      <FormBody className="space-y-4">
        <EmailField />
        <SubmitButton fullWidth size="lg" pendingLabel="Sending…">
          Send reset link
        </SubmitButton>
      </FormBody>
    </ActionForm>
  );
}

function EmailField() {
  return (
    <Input
      name="email"
      type="email"
      label="Email address"
      autoComplete="email"
      autoFocus
      required
      error={useFieldError('email')}
    />
  );
}
