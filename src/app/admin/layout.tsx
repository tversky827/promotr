import { AppShell, type NavSection } from '@/components/app/shell';
import { Icons } from '@/components/app/icons';
import { Alert } from '@/components/ui/primitives';
import { pageAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await pageAdmin();

  const [unread, pendingCampaigns, openFraud, openDisputes, pendingPayouts] = await Promise.all([
    prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
    prisma.campaign.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.fraudEvent.count({ where: { resolution: null, band: { in: ['SUSPICIOUS', 'HIGH'] } } }),
    prisma.dispute.count({ where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }),
    prisma.payout.count({ where: { status: { in: ['REQUESTED', 'ON_HOLD'] } } }),
  ]);

  // Nine entries, not fifteen. The pages that were removed from here are
  // investigation tools rather than daily work, and the overview links to all
  // of them — an operator reaches them when a case sends them there.
  const sections: NavSection[] = [
    {
      items: [
        { href: '/admin', label: 'Overview', icon: Icons.dashboard, exact: true },
        {
          href: '/admin/campaigns',
          label: 'Campaigns',
          icon: Icons.campaigns,
          badge: pendingCampaigns,
        },
        { href: '/admin/fraud', label: 'Fraud', icon: Icons.shield, badge: openFraud },
      ],
    },
    {
      title: 'Accounts',
      items: [
        { href: '/admin/brands', label: 'Brands', icon: Icons.building },
        { href: '/admin/creators', label: 'Publishers', icon: Icons.users },
      ],
    },
    {
      title: 'Money',
      items: [
        { href: '/admin/payouts', label: 'Payouts', icon: Icons.payouts, badge: pendingPayouts },
        { href: '/admin/disputes', label: 'Disputes', icon: Icons.scale, badge: openDisputes },
        { href: '/admin/transactions', label: 'Ledger', icon: Icons.receipt },
      ],
    },
    {
      items: [{ href: '/admin/settings', label: 'Settings', icon: Icons.settings }],
    },
  ];

  // Administrator accounts without MFA are a standing risk: they can move money.
  const notice = !session.user.mfaEnabled ? (
    <Alert tone="warning" title="Multi-factor authentication is not enabled on your account">
      Administrator accounts can move money and change platform settings. Enable MFA in your account
      settings.
    </Alert>
  ) : null;

  return (
    <AppShell
      sections={sections}
      contextLabel="Administration"
      contextName="Platform operator"
      user={{
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        unread,
      }}
      notice={notice}
    >
      {children}
    </AppShell>
  );
}
