import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { currentCsrfToken } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';

import { BrandOnboardingForm } from './form';

export const metadata: Metadata = { title: 'Set up your brand', robots: { index: false } };

export default async function BrandOnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const membership = await prisma.brandMember.findFirst({
    where: { userId: session.user.id },
    select: { brandId: true },
  });
  if (membership) redirect('/brand');

  const csrfToken = await currentCsrfToken();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-fg text-balance">
          Tell us about your business
        </h1>
        <p className="mt-2 text-md text-fg-muted text-pretty">
          Because money moves to publishers on your behalf, we verify who you are before campaigns
          go live. This takes a couple of minutes.
        </p>
      </div>

      <BrandOnboardingForm csrfToken={csrfToken} defaultEmail={session.user.email} />
    </div>
  );
}
