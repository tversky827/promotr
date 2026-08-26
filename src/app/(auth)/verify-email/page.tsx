import Link from 'next/link';
import type { Metadata } from 'next';

import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/guards';
import { verifyEmailToken } from '@/server/actions/auth';

export const metadata: Metadata = { title: 'Verify your email', robots: { index: false } };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const session = await getSession();

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Check your email</h1>
        <p className="mt-2 text-md text-fg-muted text-pretty">
          We sent a verification link to your address. Click it to confirm your account.
        </p>
        <div className="mt-6">
          <ButtonLink href={session ? homePathFor(session.user.role) : '/login'}>
            {session ? 'Go to dashboard' : 'Sign in'}
          </ButtonLink>
        </div>
        <p className="mt-4 text-sm text-fg-subtle text-pretty">
          You can keep using your account while you wait — verification is only required before
          launching a campaign or receiving a payout.
        </p>
      </div>
    );
  }

  const result = await verifyEmailToken(token);

  if (!result.ok) {
    return (
      <div>
        <Alert tone="danger" title="This link did not work">
          {result.error}
        </Alert>
        <p className="mt-5 text-center text-sm text-fg-muted">
          {session ? (
            <Link href={homePathFor(session.user.role)} className="text-primary hover:underline">
              Go to your dashboard to request a new link
            </Link>
          ) : (
            <Link href="/login" className="text-primary hover:underline">
              Sign in to request a new link
            </Link>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-success-soft text-success">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden="true">
          <path
            d="m5 12.5 4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Email verified</h1>
      <p className="mt-2 text-md text-fg-muted">Your account is fully activated.</p>
      <div className="mt-6">
        <ButtonLink href={homePathFor(result.data.role as never)} size="lg">
          Continue to your dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
