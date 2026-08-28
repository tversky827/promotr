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
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageBrand } from '@/lib/auth/guards';
import { brand as branding } from '@/lib/brand';
import { prisma } from '@/lib/db';
import { formatDateTime, formatRelative } from '@/lib/format';
import { verificationRecord } from '@/lib/domains';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function BrandSettingsPage() {
  const { brand, user, sessionId, membershipRole } = await pageBrand();
  const csrfToken = await currentCsrfToken();
  const isOwner = membershipRole === 'BRAND_OWNER';

  const [members, domains, sessions, openDisputes] = await Promise.all([
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
    prisma.dispute.count({
      where: { brandId: brand.id, status: { in: ['OPEN', 'INVESTIGATING'] } },
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
              lastSeenLabel: formatRelative(session.lastSeenAt),
              signedInLabel: formatDateTime(session.createdAt),
            }),
          )}
        />

        <DataCard />

        <Card>
          <CardHeader
            title="Developers"
            description="API keys for reporting conversions, and webhook endpoints for receiving events."
            action={
              <ButtonLink href="/brand/developers" variant="secondary" size="sm">
                Open
              </ButtonLink>
            }
          />
        </Card>

        <Card>
          <CardHeader
            title="Disputes"
            description="Raise invalid traffic or a duplicate conversion, and answer disputes publishers open about your campaigns."
            action={
              <ButtonLink href="/brand/disputes" variant="secondary" size="sm">
                {openDisputes > 0 ? `${openDisputes} open` : 'Open a dispute'}
              </ButtonLink>
            }
          />
        </Card>

        <CloseAccountCard supportEmail={branding.supportEmail} />
      </div>
    </>
  );
}
