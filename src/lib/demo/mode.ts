import type { UserRole } from '@prisma/client';

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Demo mode.
 *
 * The product can be walked through end to end without anyone creating an
 * account: one demo creator and one demo brand exist as ordinary rows, and a
 * switcher signs the visitor in as either. Every screen they land on is the
 * real screen, backed by the real tracking, ledger and budget code — the point
 * of the walkthrough is that it is not a mock-up.
 *
 * Two rules keep that honest:
 *
 *   1. The switcher hands out a session without a password, so it exists only
 *      where DEMO_MODE is on. A deployment carrying real accounts leaves it off
 *      and the switcher does not render, the action refuses, and nothing about
 *      the product changes.
 *   2. Demo accounts never reach a payment provider. `assertNotDemo` is called
 *      by the payout and funding rails; a demo balance moves through the
 *      double-entry ledger exactly as a real one does, and stops at the point
 *      where real money would leave the platform.
 */

export const demoEnabled = env.demoMode;

export type DemoRole = 'creator' | 'brand';

export const DEMO_ROLES: readonly DemoRole[] = ['creator', 'brand'] as const;

const ROLE_FOR: Record<DemoRole, UserRole> = {
  creator: 'CREATOR',
  brand: 'BRAND_OWNER',
};

export const DEMO_HOME: Record<DemoRole, string> = {
  creator: '/creator',
  brand: '/brand',
};

export function isDemoRole(value: unknown): value is DemoRole {
  return value === 'creator' || value === 'brand';
}

/**
 * The demo account for a role, or null when the demo data has not been loaded.
 * A missing account is a configuration state, not an error: the switcher tells
 * the visitor to run the demo seed rather than failing silently.
 */
export async function demoUserFor(role: DemoRole) {
  if (!demoEnabled) return null;
  return prisma.user.findFirst({
    where: { isDemo: true, role: ROLE_FOR[role], status: 'ACTIVE', deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
}

/** Whether the demo accounts exist, for deciding if the switcher renders. */
export async function demoReady(): Promise<boolean> {
  if (!demoEnabled) return false;
  const count = await prisma.user.count({
    where: {
      isDemo: true,
      status: 'ACTIVE',
      deletedAt: null,
      role: { in: ['CREATOR', 'BRAND_OWNER'] },
    },
  });
  return count >= 2;
}

/**
 * Raised when a demo account reaches a real-money rail. Carries a message
 * written for the person reading the screen, in the same shape as the
 * integration-not-configured errors, so the action layer surfaces it as-is.
 */
export class DemoRestrictionError extends Error {
  readonly code = 'DEMO_ACCOUNT';
  readonly userMessage: string;

  constructor(what: string) {
    const message = `Demo accounts cannot ${what}. This is a walkthrough of the product, not a live money movement.`;
    super(message);
    this.name = 'DemoRestrictionError';
    this.userMessage = message;
  }
}

/** Guard for every code path that can move real money. */
export function assertNotDemo(entity: { isDemo: boolean }, what: string): void {
  if (entity.isDemo) throw new DemoRestrictionError(what);
}
