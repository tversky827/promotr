'use client';

import { useRouter } from 'next/navigation';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Input } from '@/components/ui/form';
import { verifyMfa } from '@/server/actions/auth';

export function MfaForm({ csrfToken, role }: { csrfToken: string; role: string }) {
  const router = useRouter();

  return (
    <ActionForm
      action={verifyMfa}
      csrfToken={csrfToken}
      onSuccess={() => {
        router.push(role === 'ADMIN' ? '/admin' : role === 'CREATOR' ? '/creator' : '/brand');
        router.refresh();
      }}
    >
      <FormBody className="space-y-4">
        <CodeField />
        <SubmitButton fullWidth size="lg" pendingLabel="Verifying…">
          Verify
        </SubmitButton>
      </FormBody>
    </ActionForm>
  );
}

function CodeField() {
  return (
    <Input
      name="code"
      label="Authentication code"
      // `one-time-code` lets mobile browsers offer the code from SMS/keychain.
      autoComplete="one-time-code"
      inputMode="numeric"
      autoFocus
      required
      maxLength={20}
      placeholder="000000"
      className="text-center font-mono text-lg tracking-[0.3em]"
      error={useFieldError('code')}
    />
  );
}
