'use client';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Input } from '@/components/ui/form';
import { resetPassword } from '@/server/actions/auth';

export function ResetPasswordForm({ csrfToken, token }: { csrfToken: string; token: string }) {
  return (
    <ActionForm action={resetPassword} csrfToken={csrfToken} redirectTo="/login" refresh={false}>
      <input type="hidden" name="token" value={token} />
      <FormBody className="space-y-4">
        <PasswordField />
        <ConfirmField />
        <SubmitButton fullWidth size="lg" pendingLabel="Updating…">
          Update password
        </SubmitButton>
      </FormBody>
    </ActionForm>
  );
}

function PasswordField() {
  return (
    <Input
      name="password"
      type="password"
      label="New password"
      autoComplete="new-password"
      autoFocus
      required
      error={useFieldError('password')}
      description="At least 10 characters."
    />
  );
}

function ConfirmField() {
  return (
    <Input
      name="confirmPassword"
      type="password"
      label="Confirm new password"
      autoComplete="new-password"
      required
      error={useFieldError('confirmPassword')}
    />
  );
}
