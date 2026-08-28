import type { Metadata } from 'next';

import {
  DataCard,
  DeleteAccountCard,
  MfaCard,
  PasswordCard,
  SessionsCard,
  type SessionView,
} from '@/components/account/security';
import { CreatorProfileForm } from '@/components/creator/profile-form';
import { TaxStatusCard } from '@/components/creator/tax-status';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageCreator } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, formatRelative } from '@/lib/format';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function CreatorSettingsPage() {
  const { creator, user, sessionId } = await pageCreator();
  const csrfToken = await currentCsrfToken();

  const [sessions, profile, socials, openDisputes] = await Promise.all([
    prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    }),
    prisma.creatorProfile.findUnique({ where: { creatorId: creator.id } }),
    prisma.socialAccount.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.dispute.count({
      where: { creatorId: creator.id, status: { in: ['OPEN', 'INVESTIGATING'] } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your public profile, how you get paid, and your sign-in security."
      />

      <div className="space-y-6">
        {/* Profile first: it is the part brands see, and the part that decides
            which campaigns are surfaced. */}
        <CreatorProfileForm
          csrfToken={csrfToken}
          creator={{
            handle: creator.handle,
            publisherType: creator.publisherType,
            country: creator.country ?? 'US',
          }}
          profile={{
            displayName: profile?.displayName ?? creator.handle,
            bio: profile?.bio ?? '',
            website: profile?.website ?? '',
            categories: profile?.categories ?? [],
            audienceCountries: profile?.audienceCountries ?? [],
            channels: (profile?.channels ?? []) as string[],
            isPublic: profile?.isPublic ?? true,
          }}
          socials={socials.map((social) => ({
            id: social.id,
            platform: social.platform,
            handle: social.handle,
            followers: social.followers,
          }))}
        />

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
              lastSeenLabel: formatRelative(session.lastSeenAt),
              signedInLabel: formatDateTime(session.createdAt),
            }),
          )}
        />

        <DataCard />

        <Card>
          <CardHeader
            title="Disputes"
            description="Disagree with a decision on your traffic or a payout? Open a dispute and an administrator reviews it."
            action={
              <ButtonLink href="/creator/disputes" variant="secondary" size="sm">
                {openDisputes > 0 ? `${openDisputes} open` : 'Open a dispute'}
              </ButtonLink>
            }
          />
        </Card>

        <DeleteAccountCard csrfToken={csrfToken} />
      </div>
    </>
  );
}
