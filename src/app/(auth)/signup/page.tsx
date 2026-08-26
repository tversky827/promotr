import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { currentCsrfToken } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/guards';
import { brand } from '@/lib/brand';

import { GoogleButton } from '@/components/auth/google-button';

import { SignupForm } from './signup-form';

export const metadata: Metadata = {
  title: 'Create your account',
  description: `Join ${brand.name} as a creator, publisher, or brand.`,
  robots: { index: true, follow: true },
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await getSession();
  if (session) redirect(homePathFor(session.user.role));

  const { type } = await searchParams;
  const csrfToken = await currentCsrfToken();

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Create your account</h1>
        <p className="mt-1.5 text-md text-fg-muted">
          Already have one?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>

      <div className="card p-6">
        <SignupForm csrfToken={csrfToken} defaultType={type === 'brand' ? 'brand' : 'creator'} />
        <GoogleButton
          label="Continue with Google"
          note="Creates a publisher account. Brands sign up with the form above, because a brand account names the legal entity we contract with."
        />
      </div>

      <p className="mt-5 text-center text-xs text-fg-subtle text-pretty">
        By creating an account you agree to our{' '}
        <Link href="/legal/terms" className="underline hover:text-fg-muted">
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link href="/legal/privacy" className="underline hover:text-fg-muted">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
