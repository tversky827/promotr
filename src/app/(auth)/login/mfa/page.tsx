import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { currentCsrfToken } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/guards';

import { MfaForm } from './mfa-form';

export const metadata: Metadata = {
  title: 'Two-factor authentication',
  robots: { index: false, follow: false },
};

export default async function MfaPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.user.mfaEnabled || session.mfaSatisfied) {
    redirect(homePathFor(session.user.role));
  }

  const csrfToken = await currentCsrfToken();

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Two-factor authentication</h1>
        <p className="mt-1.5 text-md text-fg-muted text-pretty">
          Enter the 6-digit code from your authenticator app, or one of your recovery codes.
        </p>
      </div>

      <div className="card p-6">
        <MfaForm csrfToken={csrfToken} role={session.user.role} />
      </div>
    </div>
  );
}
