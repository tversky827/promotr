import type { Metadata } from 'next';

import {
  DataCard,
  MfaCard,
  PasswordCard,
  SessionsCard,
  type SessionView,
} from '@/components/account/security';
import {
  BrandProfileForm,
  CloseAccountCard,
  DomainsCard,
  TeamCard,
  type DomainView,
  type MemberView,
} from '@/components/brand/settings-forms';
import { PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageBrand } from '@/lib/auth/guards';
import { brand as branding } from '@/lib/brand';
import { prisma } from '@/lib/db';
import { verificationRecord } from '@/lib/domains';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function BrandSettingsPage() {
  const { brand, user, sessionId, membershipRole } = await pageBrand();
  const csrfToken = await currentCsrfToken();
  const isOwner = membershipRole === 'BRAND_OWNER';

  const [members, domains, sessions] = await Promise.all([
    prisma.brandMember.findMany({
      where: { brandId: brand.id },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.verifiedDomain.findMany({
      where: { brandId: brand.id },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your brand details, who can act for it, and your own sign-in security."
      />

      <div className="space-y-6">
        <BrandProfileForm
          csrfToken={csrfToken}
          canEdit={isOwner}
          brand={{
            displayName: brand.displayName,
            legalName: brand.legalName,
            website: brand.website,
            category: brand.category,
            contactEmail: brand.contactEmail,
            contactPhone: brand.contactPhone,
            description: brand.description,
            addressLine1: brand.addressLine1,
            city: brand.city,
            region: brand.region,
            postalCode: brand.postalCode,
            country: brand.country,
            verification: brand.verification,
          }}
        />

        <TeamCard
          csrfToken={csrfToken}
          canManage={isOwner}
          members={members.map(
            (member): MemberView => ({
              userId: member.userId,
              name: member.user.name,
              email: member.user.email,
              role: member.role,
              isYou: member.userId === user.id,
              joinedAt: member.createdAt.toISOString(),
            }),
          )}
        />

        <DomainsCard
          csrfToken={csrfToken}
          canManage={isOwner}
          domains={domains.map(
            (domain): DomainView => ({
              id: domain.id,
              domain: domain.domain,
              verifiedAt: domain.verifiedAt?.toISOString() ?? null,
              lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
              ...verificationRecord(domain.domain, domain.token),
            }),
          )}
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

        <CloseAccountCard supportEmail={branding.supportEmail} />
      </div>
    </>
  );
}
