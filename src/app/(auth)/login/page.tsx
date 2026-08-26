import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { currentCsrfToken } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/guards';

import { GoogleButton } from '@/components/auth/google-button';
import { Alert } from '@/components/ui/primitives';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: true } };

/**
 * Accepts a post-sign-in destination only if it is a path on this site. A
 * `next` parameter that could carry a scheme or a host is an open redirect, and
 * an open redirect on a sign-in page is a phishing primitive.
 */
function safeNext(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const session = await getSession();
  if (session) {
    redirect(
      session.user.mfaEnabled && !session.mfaSatisfied
        ? '/login/mfa'
        : (safeNext(next) ?? homePathFor(session.user.role)),
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

      {error ? (
        <Alert tone="danger" className="mb-4">
          {error.slice(0, 200)}
        </Alert>
      ) : null}

      <div className="card p-6">
        <LoginForm csrfToken={csrfToken} next={safeNext(next)} />
        <GoogleButton next={safeNext(next)} label="Continue with Google" />
      </div>
    </div>
  );
}
