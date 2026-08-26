import type { Metadata } from 'next';

import { CreatorProfileForm } from '@/components/creator/profile-form';
import { PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageCreator } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

export default async function CreatorProfilePage() {
  const { creator } = await pageCreator();
  const csrfToken = await currentCsrfToken();

  const [profile, socials] = await Promise.all([
    prisma.creatorProfile.findUnique({ where: { creatorId: creator.id } }),
    prisma.socialAccount.findMany({ where: { creatorId: creator.id }, orderBy: { createdAt: 'asc' } }),
  ]);

  return (
    <>
      <PageHeader
        title="Profile"
        description="What brands see when they look you up, and what we use to surface relevant campaigns."
      />
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
    </>
  );
}
