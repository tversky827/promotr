import Link from 'next/link';
import type { Metadata } from 'next';

import { ActionFormClient } from './form';
import { currentCsrfToken } from '@/lib/auth/csrf';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } };

export default async function ForgotPasswordPage() {
  const csrfToken = await currentCsrfToken();

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Reset your password</h1>
        <p className="mt-1.5 text-md text-fg-muted text-pretty">
          Enter your email address and we will send you a link to choose a new password.
        </p>
      </div>

      <div className="card p-6">
        <ActionFormClient csrfToken={csrfToken} />
      </div>

      <p className="mt-5 text-center text-sm text-fg-muted">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
