import type { Metadata } from 'next';

import {
  DataCard,
  DeleteAccountCard,
  MfaCard,
  PasswordCard,
  SessionsCard,
  type SessionView,
} from '@/components/account/security';
import { TaxStatusCard } from '@/components/creator/tax-status';
import { PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageCreator } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function CreatorSettingsPage() {
  const { creator, user, sessionId } = await pageCreator();
  const csrfToken = await currentCsrfToken();

  const sessions = await prisma.session.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your sign-in security, tax declaration and account data."
      />

      <div className="space-y-6">
        <TaxStatusCard
          csrfToken={csrfToken}
          taxFormKind={creator.taxFormKind}
          taxFormStatus={creator.taxFormStatus}
          submittedAt={creator.taxFormSubmittedAt?.toISOString() ?? null}
          country={creator.country}
        />

        <PasswordCard csrfToken={csrfToken} hasPassword={user.passwordHash !== null} />

        <MfaCard csrfToken={csrfToken} enabled={user.mfaEnabled} required={false} />

        <SessionsCard
          csrfToken={csrfToken}
          sessions={sessions.map(
            (session): SessionView => ({
              id: session.id,
              current: session.id === sessionId,
              userAgent: session.userAgent,
              createdAt: session.createdAt.toISOString(),
              lastSeenAt: session.lastSeenAt.toISOString(),
              expiresAt: session.expiresAt.toISOString(),
            }),
          )}
        />

        <DataCard />

        <DeleteAccountCard csrfToken={csrfToken} />
      </div>
    </>
  );
}
