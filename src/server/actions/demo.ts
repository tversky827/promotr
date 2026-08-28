'use server';

import { z } from 'zod';

import { cookies } from 'next/headers';

import { checkOrigin, CsrfError } from '@/lib/auth/csrf';
import { getSession, createSession, destroySession } from '@/lib/auth/session';
import { DEMO_HOME, demoEnabled, demoUserFor, isDemoRole, type DemoRole } from '@/lib/demo/mode';
import { PRESENTATION_COOKIE } from '@/lib/demo/presentation';
import { recordAudit } from '@/lib/audit';
import { requireBrand } from '@/lib/auth/guards';
import * as budget from '@/lib/billing/budget';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { headers } from 'next/headers';

import { action, actionError, actionOk } from './shared';

/**
 * The demo role switcher.
 *
 * Switching does not fake a session: it ends the current one and opens a real
 * one for the demo account, so every guard, every query and every screen after
 * the switch is the production path. What makes that safe is that the action
 * refuses unless DEMO_MODE is on, and will only ever open a session for a user
 * flagged isDemo — it cannot be pointed at a real account.
 *
 * These two are the only actions in the product that do not take a
 * double-submit CSRF token, because the visitor pressing the switch usually has
 * no session and so has no token to submit. The origin check still runs, which
 * is the half that stops another site posting here; and the worst a forged
 * request could achieve is signing someone into a sample account on a
 * deployment that has already declared it holds nothing real.
 */

async function assertSameOrigin(): Promise<void> {
  if (!checkOrigin(await headers())) {
    throw new CsrfError('Request did not come from this site');
  }
}

const switchSchema = z.object({
  role: z.string().refine(isDemoRole, 'Choose creator or brand'),
});

export const switchDemoRole = action(
  switchSchema,
  async (input, context) => {
    await assertSameOrigin();

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

    // Belt and braces: demoUserFor already filters on isDemo, but this is the
    // one place in the product that issues a session without a password.
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
  },
  { skipCsrf: true },
);

/** Ends the demo session and returns to the marketplace. */
export const exitDemo = action(
  z.object({}),
  async () => {
    await assertSameOrigin();
    if (!demoEnabled) {
      return actionError('Demo mode is not enabled on this deployment.', undefined, 'DEMO_OFF');
    }
    await destroySession();
    return actionOk({ path: '/' });
  },
  { skipCsrf: true },
);

/**
 * Turn presentation mode on or off. A cookie on the presenter's own browser —
 * it changes what their pages render, and nothing about anyone else's.
 */
export const setPresentationMode = action(
  z.object({ on: z.union([z.literal('1'), z.literal('0')]) }),
  async (input) => {
    await assertSameOrigin();
    if (!demoEnabled) {
      return actionError('Demo mode is not enabled on this deployment.', undefined, 'DEMO_OFF');
    }

    const jar = await cookies();
    if (input.on === '1') {
      jar.set(PRESENTATION_COOKIE, '1', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 12 * 60 * 60,
      });
    } else {
      jar.delete(PRESENTATION_COOKIE);
    }

    return actionOk({ on: input.on === '1' });
  },
  { skipCsrf: true },
);

/**
 * Fund a demo brand's new campaign and put it live.
 *
 * A real brand does this in three deliberate steps — create, fund, submit —
 * because each one commits money or exposes the campaign to publishers, and
 * collapsing them would remove a decision a brand should be making. A demo
 * brand has no money to commit and a walkthrough to get through, so the three
 * run together here: funded from the account balance it already holds, then put
 * through the same moderation any campaign faces, and activated only if that
 * moderation approves it.
 */
export const launchDemoCampaign = action(
  z.object({ campaignId: z.string().uuid() }),
  async (input, context) => {
    await assertSameOrigin();
    if (!demoEnabled) {
      return actionError('Demo mode is not enabled on this deployment.', undefined, 'DEMO_OFF');
    }

    const { brand, user } = await requireBrand('campaign:create');
    if (!brand.isDemo) {
      return actionError('This is only available to a demo brand account.', undefined, 'DEMO_OFF');
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, brandId: brand.id },
      include: { budget: true },
    });
    if (!campaign) return actionError('That campaign was not found.');
    if (campaign.status === 'ACTIVE') return actionOk(undefined, 'Campaign is already live.');
    if (campaign.status !== 'DRAFT') {
      return actionError('This campaign has already been submitted.');
    }

    // Fund it from the balance the account already holds. `fundCampaign` moves
    // the money brand-deposit → campaign-escrow through the ledger and refuses
    // if the balance cannot cover it, which is the check that matters.
    const declared = campaign.budget?.totalBudgetMicros ?? 0n;
    const funded = campaign.budget?.fundedMicros ?? 0n;
    const shortfall = declared - funded;

    if (shortfall > 0n) {
      try {
        await prisma.$transaction(async (tx) => {
          await budget.fundCampaign(tx, {
            campaignId: campaign.id,
            brandId: brand.id,
            amountMicros: shortfall,
            idempotencyKey: `demo:launch:fund:${campaign.id}`,
            reason: 'Funded from the demo account balance',
          });
        });
      } catch (error) {
        return actionError(
          `The campaign could not be funded from your balance: ${(error as Error).message}`,
        );
      }
    }

    const { moderateCampaign } = await import('@/lib/moderation');
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'PENDING_REVIEW' },
    });
    const decision = await moderateCampaign(campaign.id);

    await recordAudit({
      actorUserId: user.id,
      actorIp: context.ip,
      action: 'campaign.launched',
      entityKind: 'campaign',
      entityId: campaign.id,
      metadata: { decision: decision?.decision ?? 'UNKNOWN' },
    });

    if (decision?.decision !== 'APPROVED') {
      return actionOk(
        { launched: false },
        decision?.decision === 'REJECTED'
          ? 'Moderation did not accept this campaign.'
          : 'Submitted. Moderation held this campaign for a human to review.',
      );
    }

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'ACTIVE', launchedAt: new Date() },
    });

    logger.info('demo.campaign_launched', { campaignId: campaign.id, brandId: brand.id });
    return actionOk({ launched: true }, 'Campaign launched successfully.');
  },
  { skipCsrf: true },
);
