import { AppShell, type NavSection } from '@/components/app/shell';
import { Icons } from '@/components/app/icons';
import { Alert } from '@/components/ui/primitives';
import { ButtonLink } from '@/components/ui/button';
import { pageCreator } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';

export default async function CreatorLayout({ children }: { children: React.ReactNode }) {
  const { creator, user } = await pageCreator();

  const [profile, unread] = await Promise.all([
    prisma.creatorProfile.findUnique({
      where: { creatorId: creator.id },
      select: { displayName: true },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  const sections: NavSection[] = [
    {
      items: [
        { href: '/', label: 'Browse', icon: Icons.campaigns },
        { href: '/creator', label: 'Overview', icon: Icons.dashboard, exact: true },
        { href: '/creator/earnings', label: 'Earnings', icon: Icons.earnings },
        { href: '/creator/settings', label: 'Settings', icon: Icons.settings },
      ],
    },
  ];

  // Verification gates money, not access — the banner says exactly that rather
  // than blocking the dashboard.
  const notice = !user.emailVerifiedAt ? (
    <Alert
      tone="warning"
      title="Confirm your email address"
      action={
        <ButtonLink href="/verify-email" size="sm" variant="secondary">
          Resend
        </ButtonLink>
      }
    >
      You can browse campaigns and generate links now. Confirming your email is required before you
      can receive a payout.
    </Alert>
  ) : null;

  return (
    <AppShell
      sections={sections}
      contextLabel="Publisher"
      contextName={profile?.displayName ?? creator.handle}
      user={{ name: user.name, email: user.email, role: user.role, unread }}
      notice={notice}
    >
      {children}
    </AppShell>
  );
}
