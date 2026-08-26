import { MarketingFooter, MarketingNav } from '@/components/marketing/nav';
import { homePathFor } from '@/lib/auth/guards';
import { getSession } from '@/lib/auth/session';

export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <>
      <MarketingNav
        signedIn={Boolean(session)}
        homePath={session ? homePathFor(session.user.role) : '/login'}
      />
      <main id="main" className="min-h-[70vh]">
        {children}
      </main>
      <MarketingFooter />
    </>
  );
}
