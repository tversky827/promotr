import { AppShell, type NavSection } from '@/components/app/shell';
import { Icons } from '@/components/app/icons';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/primitives';
import { pageBrand } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { stripeConfigured } from '@/lib/stripe';

export default async function BrandLayout({ children }: { children: React.ReactNode }) {
  const { brand, user, membershipRole } = await pageBrand();

  const [unread, pendingApplications, openDisputes] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.campaignApplication.count({
      where: { campaign: { brandId: brand.id }, status: 'PENDING' },
    }),
    prisma.dispute.count({
      where: { brandId: brand.id, status: { in: ['OPEN', 'INVESTIGATING'] } },
    }),
  ]);

  const isOwner = membershipRole === 'BRAND_OWNER' || user.role === 'ADMIN';

  const sections: NavSection[] = [
    {
      items: [
        { href: '/brand', label: 'Overview', icon: Icons.dashboard, exact: true },
        { href: '/brand/campaigns', label: 'Campaigns', icon: Icons.campaigns },
        {
          href: '/brand/publishers',
          label: 'Publishers',
          icon: Icons.users,
          badge: pendingApplications,
        },
        { href: '/brand/reports', label: 'Reports', icon: Icons.analytics },
      ],
    },
    {
      title: 'Account',
      items: [
        ...(isOwner
          ? [{ href: '/brand/billing', label: 'Billing', icon: Icons.receipt }]
          : []),
        { href: '/brand/disputes', label: 'Disputes', icon: Icons.scale, badge: openDisputes },
        ...(isOwner
          ? [{ href: '/brand/developers', label: 'Developers', icon: Icons.code }]
          : []),
        { href: '/brand/settings', label: 'Settings', icon: Icons.settings },
      ],
    },
  ];

  // Configuration states are surfaced, never hidden behind a broken button.
  const notice = !stripeConfigured() ? (
    <Alert tone="warning" title="Payments are not configured on this deployment">
      Campaigns cannot be funded until an administrator configures the payment provider. You can
      still build campaigns and submit them for review.
    </Alert>
  ) : brand.verification !== 'VERIFIED' ? (
    <Alert
      tone={brand.verification === 'REJECTED' ? 'danger' : 'info'}
      title={
        brand.verification === 'REJECTED'
          ? 'Business verification was not approved'
          : 'Business verification in progress'
      }
      action={
        <ButtonLink href="/brand/settings" size="sm" variant="secondary">
          Review details
        </ButtonLink>
      }
    >
      {brand.verification === 'REJECTED'
        ? (brand.verificationNotes ??
          'Update your business details and contact support to be re-reviewed.')
        : 'You can build and fund campaigns now. Verification is required before they go live.'}
    </Alert>
  ) : null;

  return (
    <AppShell
      sections={sections}
      contextLabel="Brand"
      contextName={brand.displayName}
      user={{ name: user.name, email: user.email, role: user.role, unread }}
      notice={notice}
    >
      {children}
    </AppShell>
  );
}
