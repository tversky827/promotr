'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Input } from '@/components/ui/form';
import { login } from '@/server/actions/auth';

export function LoginForm({ csrfToken, next }: { csrfToken: string; next?: string }) {
  const router = useRouter();

  return (
    <ActionForm
      action={login}
      csrfToken={csrfToken}
      onSuccess={(data) => {
        // MFA-enabled accounts land on the challenge; the session exists but
        // privileged actions stay blocked until the code is verified.
        if (data.mfaRequired) {
          router.push('/login/mfa');
          return;
        }
        router.push(
          next ??
            (data.role === 'ADMIN' ? '/admin' : data.role === 'CREATOR' ? '/creator' : '/brand'),
        );
        router.refresh();
      }}
    >
      <FormBody className="space-y-4">
        <EmailField />
        <PasswordField />

        <SubmitButton fullWidth size="lg" pendingLabel="Signing in…">
          Sign in
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

function PasswordField() {
  return (
    <Input
      name="password"
      type="password"
      label="Password"
      autoComplete="current-password"
      required
      error={useFieldError('password')}
      hint={
        <Link href="/forgot-password" className="text-primary hover:underline">
          Forgot password?
        </Link>
      }
    />
  );
}
