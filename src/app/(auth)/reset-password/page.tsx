import Link from 'next/link';
import type { Metadata } from 'next';

import { Alert } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';

import { ResetPasswordForm } from './form';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const csrfToken = await currentCsrfToken();

  if (!token) {
    return (
      <div>
        <Alert tone="danger" title="This link is not valid">
          The reset link is missing its token. Request a new one from the sign-in page.
        </Alert>
        <p className="mt-5 text-center text-sm">
          <Link href="/forgot-password" className="text-primary hover:underline">
            Request a new reset link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Choose a new password</h1>
        <p className="mt-1.5 text-md text-fg-muted text-pretty">
          Setting a new password signs you out of every other device.
        </p>
      </div>

      <div className="card p-6">
        <ResetPasswordForm csrfToken={csrfToken} token={token} />
      </div>
    </div>
  );
}
