import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { currentCsrfToken } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/guards';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: true } };

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect(
      session.user.mfaEnabled && !session.mfaSatisfied
        ? '/login/mfa'
        : homePathFor(session.user.role),
    );
  }

  const csrfToken = await currentCsrfToken();

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Sign in</h1>
        <p className="mt-1.5 text-md text-fg-muted">
          New here?{' '}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </div>

      <div className="card p-6">
        <LoginForm csrfToken={csrfToken} />
      </div>
    </div>
  );
}
