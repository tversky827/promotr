'use server';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { checkOrigin, CsrfError } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { rollupRecent } from '@/lib/analytics/rollup';
import { recordConversion } from '@/lib/conversions/record';
import { prisma } from '@/lib/db';
import { demoEnabled } from '@/lib/demo/mode';
import { logger } from '@/lib/observability/logger';
import { formatMicros } from '@/lib/money';
import { recordClick, resolveRedirect } from '@/lib/tracking/redirect';
import { headers } from 'next/headers';

import { action, actionError, actionOk } from './shared';

/**
 * Simulated traffic.
 *
 * These do not write numbers onto a dashboard. Each one drives the same code a
 * real event drives: a simulated click goes through link resolution, fraud
 * scoring, the click record and — if the campaign pays per click and has budget
 * — accrual against the ledger; a simulated conversion goes through attribution,
 * the de-duplication rules and the same accrual. What is simulated is the
 * traffic arriving, not what the platform does with it, which is the only way a
 * walkthrough can show the product rather than a picture of it.
 *
 * Because of that, they can fail honestly: a campaign out of budget will refuse
 * the earning and say so, exactly as it would in production.
 *
 * Available only in demo mode, and only to a demo publisher.
 */

async function demoCreator() {
  if (!demoEnabled) return null;
  if (!checkOrigin(await headers())) throw new CsrfError('Request did not come from this site');

  const session = await getSession();
  if (!session?.user.isDemo) return null;

  return prisma.creator.findFirst({ where: { userId: session.user.id, isDemo: true } });
}

const NOT_AVAILABLE = 'Simulation is only available to a demo publisher account.';

/** A request shaped like one arriving from a phone on a mobile network. */
function syntheticRequest(code: string, index: number) {
  return {
    code,
    // Spread across a /16 so the fraud engine sees a plausible mix of networks
    // rather than one address hammering the link.
    ip: `198.51.${100 + (index % 100)}.${1 + (index % 250)}`,
    userAgent:
      index % 3 === 0
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
    referrer: index % 2 === 0 ? 'https://www.instagram.com/' : 'https://www.tiktok.com/',
    country: 'US',
    region: null,
    city: null,
    query: new URLSearchParams(),
  };
}

const clicksSchema = z.object({
  count: z.coerce.number().int().min(1).max(500).default(100),
  linkId: z.string().uuid().optional(),
});

export const simulateClicks = action(
  clicksSchema,
  async (input) => {
    const creator = await demoCreator();
    if (!creator) return actionError(NOT_AVAILABLE, undefined, 'DEMO_OFF');

    const link = await pickLink(creator.id, input.linkId, 'CPC');
    if (!link) return actionError('No active link to send traffic through yet.');

    let recorded = 0;
    let billable = 0;

    for (let i = 0; i < input.count; i += 1) {
      const request = syntheticRequest(link.code, i);
      const resolved = await resolveRedirect(request);
      if (!resolved.link) break;

      const before = await countBillable(link.id);
      await recordClick({
        clickId: resolved.clickId,
        link: resolved.link,
        request,
        latencyMs: 3,
      });
      recorded += 1;
      if ((await countBillable(link.id)) > before) billable += 1;
    }

    await rollupRecent(2);
    logger.info('demo.simulated_clicks', { creatorId: creator.id, recorded, billable });

    return actionOk(
      { recorded, billable },
      `${recorded} clicks sent through ${link.campaignName}. ${billable} qualified and earned; the rest were screened out as duplicates or bot traffic.`,
    );
  },
  { skipCsrf: true },
);

export const simulateConversion = action(
  z.object({}),
  async () => {
    const creator = await demoCreator();
    if (!creator) return actionError(NOT_AVAILABLE, undefined, 'DEMO_OFF');

    // A conversion has to hang off a campaign that pays for one. Click-priced
    // campaigns record the outcome but do not pay for it, so simulating one
    // there would show a conversion and no money, which reads as a bug.
    const link = await pickLink(creator.id, undefined, 'CONVERSION');
    if (!link) return actionError('No conversion-priced campaign to convert on yet.');

    // Attribution needs a real click to attach to, and one old enough to be
    // plausible — the fraud rules reject a conversion that arrives seconds
    // after the click it claims.
    const clicks = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "clicks"
      WHERE "linkId" = ${link.id}::uuid
        AND eligibility = 'ELIGIBLE'
        AND "createdAt" < now() - interval '1 hour'
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    const clickId = clicks[0]?.id;
    if (!clickId) return actionError('No attributable click on that campaign yet.');

    const revenueMicros = 120_000_000n;
    const result = await recordConversion({
      campaignId: link.campaignId,
      clickId,
      externalId: `demo-sim-${randomUUID().slice(0, 12)}`,
      eventType: 'SALE',
      revenueMicros,
      source: 'manual',
      metadata: { simulated: true },
    });

    if (!result.ok) return actionError(result.message, undefined, result.code);

    await rollupRecent(2);
    logger.info('demo.simulated_conversion', { creatorId: creator.id, campaignId: link.campaignId });

    const earned = result.conversion.payoutMicros;
    return actionOk(
      { earnedMicros: earned.toString() },
      `Conversion recorded on ${link.campaignName}: a ${formatMicros(revenueMicros)} order, paying you ${formatMicros(earned)}.`,
    );
  },
  { skipCsrf: true },
);

const earningsSchema = z.object({
  amount: z.coerce.number().int().min(1).max(1_000).default(100),
});

/**
 * Earn a target amount.
 *
 * There is no "add money" button — money in this product only exists because an
 * event was paid for. So this sends exactly as much qualified traffic through
 * the best-paying link as it takes to earn the amount, and stops when the
 * campaign's budget says stop.
 */
export const simulateEarnings = action(
  earningsSchema,
  async (input) => {
    const creator = await demoCreator();
    if (!creator) return actionError(NOT_AVAILABLE, undefined, 'DEMO_OFF');

    const link = await pickLink(creator.id, undefined, 'CPC');
    if (!link) return actionError('No click-priced link to earn through yet.');
    if (link.payoutMicros <= 0n) return actionError('That campaign has no per-click payout.');

    const targetMicros = BigInt(input.amount) * 1_000_000n;
    let earnedMicros = 0n;
    let attempts = 0;
    const limit = 400;

    while (earnedMicros < targetMicros && attempts < limit) {
      const request = syntheticRequest(link.code, attempts);
      const resolved = await resolveRedirect(request);
      if (!resolved.link) break;

      const before = await countBillable(link.id);
      await recordClick({ clickId: resolved.clickId, link: resolved.link, request, latencyMs: 3 });
      attempts += 1;
      if ((await countBillable(link.id)) > before) earnedMicros += link.payoutMicros;
    }

    await rollupRecent(2);
    logger.info('demo.simulated_earnings', {
      creatorId: creator.id,
      earnedMicros: earnedMicros.toString(),
      attempts,
    });

    if (earnedMicros === 0n) {
      return actionError(
        `No traffic qualified on ${link.campaignName}. Its budget may be exhausted.`,
      );
    }

    return actionOk(
      { earnedMicros: earnedMicros.toString() },
      `${formatMicros(earnedMicros)} earned on ${link.campaignName}, from ${attempts} clicks.`,
    );
  },
  { skipCsrf: true },
);

interface PickedLink {
  id: string;
  code: string;
  campaignId: string;
  campaignName: string;
  payoutMicros: bigint;
}

/**
 * The link to simulate through: the publisher's highest-paying active link on a
 * campaign that still has budget, so the simulation demonstrates an earning
 * rather than a rejection.
 */
async function pickLink(
  creatorId: string,
  linkId: string | undefined,
  kind: 'CPC' | 'CONVERSION',
): Promise<PickedLink | null> {
  const models =
    kind === 'CPC' ? ['CPC'] : ['CPA', 'CPL', 'REVSHARE', 'HYBRID'];

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; code: string; campaign_id: string; name: string; payout: bigint }>
  >(
    `
    SELECT l.id, l.code, c.id AS campaign_id, c.name, c."payoutMicros" AS payout
    FROM "tracking_links" l
    JOIN "campaigns" c ON c.id = l."campaignId"
    JOIN "campaign_budgets" b ON b."campaignId" = c.id
    WHERE l."creatorId" = $1::uuid
      AND l.active
      AND c.status = 'ACTIVE'
      AND c."payoutModel"::text = ANY($2::text[])
      AND b."fundedMicros" - b."reservedMicros" - b."spentMicros" > c."payoutMicros"
      ${linkId ? 'AND l.id = $3::uuid' : ''}
    ORDER BY c."payoutMicros" DESC
    LIMIT 1
    `,
    ...(linkId ? [creatorId, models, linkId] : [creatorId, models]),
  );

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    campaignId: row.campaign_id,
    campaignName: row.name,
    payoutMicros: BigInt(row.payout),
  };
}

async function countBillable(linkId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM "clicks" WHERE "linkId" = ${linkId}::uuid AND billable
  `;
  return Number(rows[0]?.count ?? 0n);
}
