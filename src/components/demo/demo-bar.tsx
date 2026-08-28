import { getSession } from '@/lib/auth/session';
import { DEMO_ROLES, type DemoRole } from '@/lib/demo/mode';

import { DemoSwitcher } from './demo-bar-client';

/**
 * The demo bar.
 *
 * Mounted by the root layout only where DEMO_MODE is on and the demo accounts
 * exist, so a deployment that has not opted in never pays for the check and
 * never shows the control. It is the one place in the product that advertises
 * itself as a walkthrough, which is deliberate: someone looking at these
 * screens should never be in doubt about whether the money on them is real.
 */
export async function DemoBar() {
  const session = await getSession();
  const active: DemoRole | null =
    session?.user.isDemo === true
      ? session.user.role === 'CREATOR'
        ? 'creator'
        : 'brand'
      : null;

  return (
    <div className="sticky top-0 z-50 border-b border-accent/25 bg-accent-soft">
      <div className="mx-auto flex h-9 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
          Demo
        </span>
        <DemoSwitcher active={active} roles={[...DEMO_ROLES]} csrfToken={session?.csrfToken ?? ''} />
      </div>
    </div>
  );
}
