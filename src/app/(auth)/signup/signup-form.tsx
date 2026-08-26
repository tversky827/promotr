'use client';

import { useState } from 'react';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Checkbox, Input } from '@/components/ui/form';
import { signup } from '@/server/actions/auth';

/**
 * Signup.
 *
 * The account type is chosen up front because the two paths diverge completely
 * afterwards — a brand needs billing and business verification, a publisher
 * needs a payout account. Asking later would mean a second onboarding step.
 */
export function SignupForm({
  csrfToken,
  defaultType,
}: {
  csrfToken: string;
  defaultType: 'creator' | 'brand';
}) {
  const [accountType, setAccountType] = useState<'creator' | 'brand'>(defaultType);

  return (
    <ActionForm
      action={signup}
      csrfToken={csrfToken}
      redirectTo={() => (accountType === 'brand' ? '/onboarding/brand' : '/onboarding/creator')}
    >
      <FormBody className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">I am joining as a…</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: 'creator', label: 'Creator or publisher', hint: 'I can drive traffic' },
                { value: 'brand', label: 'Brand', hint: 'I want traffic' },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-lg border p-3 text-center transition-colors ${
                  accountType === option.value
                    ? 'border-primary bg-primary-soft/50 ring-1 ring-primary/30'
                    : 'border-border hover:border-border-strong'
                }`}
              >
                <input
                  type="radio"
                  name="accountType"
                  value={option.value}
                  checked={accountType === option.value}
                  onChange={() => setAccountType(option.value)}
                  className="sr-only"
                />
                <span className="block text-sm font-medium text-fg">{option.label}</span>
                <span className="mt-0.5 block text-xs text-fg-subtle">{option.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <NameField />
        <EmailField />
        <PasswordField />

        <div className="space-y-2.5 pt-1">
          <Checkbox
            name="acceptTerms"
            label={
              <span className="text-sm">
                I agree to the Terms of Service and Privacy Policy
              </span>
            }
          />
          <TermsError />
          <Checkbox
            name="marketingOptIn"
            label={<span className="text-sm">Send me occasional product updates</span>}
          />
        </div>

        <SubmitButton fullWidth size="lg" pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </FormBody>
    </ActionForm>
  );
}

function NameField() {
  return (
    <Input
      name="name"
      label="Your name"
      autoComplete="name"
      required
      error={useFieldError('name')}
      placeholder="Alex Rivera"
    />
  );
}

function EmailField() {
  return (
    <Input
      name="email"
      type="email"
      label="Email address"
      autoComplete="email"
      required
      error={useFieldError('email')}
      placeholder="you@example.com"
    />
  );
}

function PasswordField() {
  return (
    <Input
      name="password"
      type="password"
      label="Password"
      autoComplete="new-password"
      required
      error={useFieldError('password')}
      description="At least 10 characters. Longer is better than more complicated."
    />
  );
}

function TermsError() {
  const error = useFieldError('acceptTerms');
  if (!error) return null;
  return (
    <p className="text-xs font-medium text-danger" role="alert">
      {error}
    </p>
  );
}
