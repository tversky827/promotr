import { getSession } from '@/lib/auth/session';
import { DEMO_ROLES, type DemoRole } from '@/lib/demo/mode';
import { presentationMode } from '@/lib/demo/presentation';

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
  const [session, presenting] = await Promise.all([getSession(), presentationMode()]);
  const active: DemoRole | null =
    session?.user.isDemo === true
      ? session.user.role === 'CREATOR'
        ? 'creator'
        : 'brand'
      : null;

  return (
    <div className="sticky top-0 z-50 border-b border-accent/25 bg-accent-soft">
      <div className="mx-auto flex h-9 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
        {/* The word is dropped on a narrow screen; the dot and the pills next
            to it already say what this bar is, and the controls need the room. */}
        <span className="flex shrink-0 items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
          <span className="hidden sm:inline">Demo</span>
        </span>
        <DemoSwitcher active={active} roles={[...DEMO_ROLES]} presenting={presenting} />
      </div>
    </div>
  );
}
