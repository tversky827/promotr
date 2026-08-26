import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { currentCsrfToken } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';

import { CreatorOnboardingForm } from './form';

export const metadata: Metadata = { title: 'Set up your publisher profile', robots: { index: false } };

export default async function CreatorOnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const existing = await prisma.creator.findUnique({
    where: { userId: session.user.id },
    include: { profile: true },
  });

  // A publisher who already has a display name has finished onboarding.
  if (existing?.profile?.displayName && existing.profile.displayName !== session.user.name) {
    redirect('/creator');
  }

  const csrfToken = await currentCsrfToken();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-fg text-balance">
          Set up your publisher profile
        </h1>
        <p className="mt-2 text-md text-fg-muted text-pretty">
          Two minutes. This is what brands see and how we know which campaigns fit you. You can
          change any of it later.
        </p>
      </div>

      <CreatorOnboardingForm
        csrfToken={csrfToken}
        defaultName={existing?.profile?.displayName ?? session.user.name}
        defaultHandle={existing?.handle ?? ''}
      />
    </div>
  );
}
