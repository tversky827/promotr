'use server';

import { z } from 'zod';

import { getSession, createSession, destroySession } from '@/lib/auth/session';
import { DEMO_HOME, demoEnabled, demoUserFor, isDemoRole, type DemoRole } from '@/lib/demo/mode';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

import { action, actionError, actionOk } from './shared';

/**
 * The demo role switcher.
 *
 * Switching does not fake a session: it ends the current one and opens a real
 * one for the demo account, so every guard, every query and every screen after
 * the switch is the production path. What makes that safe is that the action
 * refuses unless DEMO_MODE is on, and will only ever open a session for a user
 * flagged isDemo — it cannot be pointed at a real account.
 */

const switchSchema = z.object({
  role: z.string().refine(isDemoRole, 'Choose creator or brand'),
});

export const switchDemoRole = action(switchSchema, async (input, context) => {
  if (!demoEnabled) {
    return actionError('Demo mode is not enabled on this deployment.', undefined, 'DEMO_OFF');
  }

  const role = input.role as DemoRole;
  const user = await demoUserFor(role);
  if (!user) {
    return actionError(
      `The demo ${role} account has not been loaded. Run \`npm run db:seed:demo\` to create it.`,
      undefined,
      'DEMO_NOT_SEEDED',
    );
  }

  // Belt and braces: demoUserFor already filters on isDemo, but this is the one
  // place in the product that issues a session without a password.
  if (!user.isDemo) {
    return actionError('That account is not a demo account.', undefined, 'DEMO_OFF');
  }

  const current = await getSession();
  if (current?.user.id === user.id) {
    return actionOk({ path: DEMO_HOME[role] });
  }

  await destroySession();
  await createSession(user.id, {
    userAgent: context.userAgent,
    ip: context.ip,
    // The demo account has no second factor to satisfy, and prompting for one
    // would strand the walkthrough.
    mfaSatisfied: true,
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  logger.info('demo.role_switched', { role, userId: user.id });

  return actionOk({ path: DEMO_HOME[role] });
});

/** Ends the demo session and returns to the marketplace. */
export const exitDemo = action(z.object({}), async () => {
  if (!demoEnabled) {
    return actionError('Demo mode is not enabled on this deployment.', undefined, 'DEMO_OFF');
  }
  await destroySession();
  return actionOk({ path: '/' });
});
