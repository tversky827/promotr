import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { claim, deadLetterJobs, enqueue, markFailed, markSucceeded, queueStats, reclaimStalledJobs, retryDeadJob } from '@/lib/jobs/queue';
import { Worker } from '@/lib/jobs/worker';
import { rollupHour, rollupRecent } from '@/lib/analytics/rollup';
import { derive, totals } from '@/lib/analytics/queries';
import { signPayload, verifySignature } from '@/lib/webhooks/outbound';
import { prisma } from '@/lib/db';
import * as budget from '@/lib/billing/budget';
import { accounts, post } from '@/lib/billing/ledger';
import { recordClick, resolveRedirect } from '@/lib/tracking/redirect';

import { disconnect, resetDatabase, testDb } from '../helpers/db';
import { createBrand, createCampaign, createCreator, createTrackingLink } from '../helpers/factories';

describe('job queue', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnect();
    await prisma.$disconnect();
  });

  it('enqueues and claims jobs', async () => {
    await enqueue('analytics.rollup', { hours: 1 });
    const claimed = await claim('worker-1', 10);

    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.type).toBe('analytics.rollup');
    expect(claimed[0]!.status).toBe('RUNNING');
    expect(claimed[0]!.attempts).toBe(1);
    expect(claimed[0]!.lockedBy).toBe('worker-1');
  });

  it('suppresses duplicates by idempotency key', async () => {
    const first = await enqueue('analytics.rollup', {}, { idempotencyKey: 'rollup:2026-01-01T00' });
    const second = await enqueue('analytics.rollup', {}, { idempotencyKey: 'rollup:2026-01-01T00' });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await testDb.job.count()).toBe(1);
  });

  it('never hands the same job to two workers', async () => {
    for (let i = 0; i < 20; i += 1) {
      await enqueue('analytics.rollup', { i });
    }

    // Five workers claim concurrently.
    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, i) => claim(`worker-${i}`, 10)),
    );

    const allIds = claims.flat().map((j) => j.id);
    expect(new Set(allIds).size).toBe(allIds.length); // no job claimed twice
    expect(allIds.length).toBe(20);
  });

  it('does not claim jobs scheduled for the future', async () => {
    await enqueue('analytics.rollup', {}, { runAt: new Date(Date.now() + 60_000) });
    expect(await claim('worker-1', 10)).toHaveLength(0);
  });

  it('retries with backoff, then dead-letters', async () => {
    await enqueue('analytics.rollup', {}, { maxAttempts: 3 });

    let job = (await claim('w', 1))[0]!;
    let status = await markFailed(job, new Error('boom 1'));
    expect(status).toBe('QUEUED');

    // The retry is scheduled in the future, so it is not immediately claimable.
    expect(await claim('w', 1)).toHaveLength(0);
    await testDb.job.update({ where: { id: job.id }, data: { runAt: new Date() } });

    job = (await claim('w', 1))[0]!;
    status = await markFailed(job, new Error('boom 2'));
    expect(status).toBe('QUEUED');
    await testDb.job.update({ where: { id: job.id }, data: { runAt: new Date() } });

    job = (await claim('w', 1))[0]!;
    status = await markFailed(job, new Error('boom 3'));
    expect(status).toBe('DEAD');

    const dead = await deadLetterJobs();
    expect(dead).toHaveLength(1);
    expect(dead[0]!.lastError).toBe('boom 3');

    // A dead job can be revived from the admin console.
    expect(await retryDeadJob(dead[0]!.id)).toBe(true);
    const revived = await testDb.job.findUniqueOrThrow({ where: { id: dead[0]!.id } });
    expect(revived.status).toBe('QUEUED');
    expect(revived.attempts).toBe(0);
  });

  it('reclaims jobs abandoned by a crashed worker', async () => {
    await enqueue('analytics.rollup', {});
    const job = (await claim('doomed-worker', 1))[0]!;

    // Simulate the worker dying: the job stays RUNNING with an old lock.
    await testDb.job.update({
      where: { id: job.id },
      data: { lockedAt: new Date(Date.now() - 30 * 60_000) },
    });

    const reclaimed = await reclaimStalledJobs(10 * 60_000);
    expect(reclaimed).toBe(1);
    expect((await claim('healthy-worker', 1))[0]!.id).toBe(job.id);
  });

  it('reports queue depth by queue and status', async () => {
    await enqueue('payout.process', { payoutId: 'x' });
    await enqueue('email.send', { userId: 'x' });
    await enqueue('webhook.dispatch', { brandId: 'x' });

    const stats = await queueStats();
    const queues = stats.map((s) => s.queue).sort();
    // Money work is isolated from notification floods.
    expect(queues).toContain('critical');
    expect(queues).toContain('notifications');
    expect(queues).toContain('webhooks');
  });

  it('a worker tick runs a real job to completion', async () => {
    await enqueue('analytics.rollup', { hours: 1 });

    const worker = new Worker({ concurrency: 2, scheduleRecurring: false });
    const processed = await worker.tick();

    expect(processed).toBe(1);
    const job = await testDb.job.findFirstOrThrow();
    expect(job.status).toBe('SUCCEEDED');
    expect(job.completedAt).not.toBeNull();
  });

  it('a worker marks an unknown job type failed rather than crashing', async () => {
    await testDb.job.create({
      data: { queue: 'default', type: 'does.not.exist', payload: {}, maxAttempts: 1 },
    });

    const worker = new Worker({ scheduleRecurring: false });
    await worker.tick();

    const job = await testDb.job.findFirstOrThrow();
    expect(job.status).toBe('DEAD');
    expect(job.lastError).toMatch(/No handler registered/);
  });

  it('schedules recurring work exactly once per time bucket', async () => {
    const worker = new Worker({ scheduleRecurring: true });
    await worker.tick();
    const afterFirst = await testDb.job.count();

    // Three more ticks in the same minute must not duplicate anything.
    await worker.tick();
    await worker.tick();

    const scheduled = await testDb.job.findMany({ where: { idempotencyKey: { not: null } } });
    const keys = scheduled.map((j) => j.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(afterFirst).toBeGreaterThan(0);
  });
});

describe('analytics rollup', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('aggregates raw clicks into hourly statistics', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id, { payoutMicros: 200_000n });

    await prisma.$transaction(async (tx) => {
      await post(tx, {
        kind: 'BRAND_DEPOSIT',
        idempotencyKey: 'dep',
        description: 'Deposit',
        lines: [
          { account: accounts.externalSettlement(), direction: 'DEBIT', amountMicros: 100_000_000n },
          { account: accounts.brandDeposit(brand.id), direction: 'CREDIT', amountMicros: 100_000_000n },
        ],
      });
      await budget.fundCampaign(tx, {
        campaignId: campaign.id,
        brandId: brand.id,
        amountMicros: 100_000_000n,
        idempotencyKey: 'fund',
      });
    });

    const link = await createTrackingLink(campaign.id, creator.id);

    // Three distinct visitors.
    for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) {
      const request = {
        code: link.code,
        ip,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        referrer: 'https://www.youtube.com/watch?v=x',
        country: 'US',
        region: null,
        city: null,
        query: new URLSearchParams(),
      };
      const { outcome, link: resolved, clickId } = await resolveRedirect(request);
      if (resolved && outcome.kind === 'redirect') {
        await recordClick({ clickId, link: resolved, request, latencyMs: 3 });
      }
    }

    await rollupHour(new Date());

    const stats = await testDb.statHourly.findMany();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.clicks).toBe(3);
    expect(stats[0]!.qualifiedClicks).toBe(3);
    expect(stats[0]!.uniqueVisitors).toBe(3);
    expect(stats[0]!.grossMicros).toBe(750_000n); // 3 × $0.25
    expect(stats[0]!.netMicros).toBe(600_000n); // 3 × $0.20

    // Dashboard queries read the rollup.
    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 3_600_000) };
    const metrics = derive(await totals({ campaignId: campaign.id }, range));
    expect(metrics.clicks).toBe(3);
    expect(metrics.epcMicros).toBe(200_000n); // $0.20 earnings per click
    expect(metrics.cpcMicros).toBe(250_000n); // $0.25 cost per click to the brand
  });

  it('is idempotent — re-running an hour recomputes rather than doubling', async () => {
    const { brand } = await createBrand();
    const { creator } = await createCreator();
    const campaign = await createCampaign(brand.id);
    await createTrackingLink(campaign.id, creator.id);

    await testDb.click.create({
      data: {
        linkId: (await testDb.trackingLink.findFirstOrThrow()).id,
        campaignId: campaign.id,
        creatorId: creator.id,
        brandId: brand.id,
        ipHash: 'h', ipPrefixHash: 'p', sessionFp: 'fp1',
        eligibility: 'ELIGIBLE',
      },
    });

    await rollupHour(new Date());
    await rollupHour(new Date());
    await rollupRecent(1);

    const stats = await testDb.statHourly.findMany();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.clicks).toBe(1); // not 3
  });
});

describe('webhook signatures', () => {
  it('round-trips a signature', () => {
    const secret = 'whsec_test_secret';
    const body = JSON.stringify({ id: 'evt_1', type: 'conversion.created' });
    const timestamp = Math.floor(Date.now() / 1000);

    const header = signPayload(secret, body, timestamp);
    expect(verifySignature({ secret, body, header })).toEqual({ valid: true });
  });

  it('rejects a tampered body', () => {
    const secret = 'whsec_test_secret';
    const header = signPayload(secret, '{"amount":10}', Math.floor(Date.now() / 1000));
    const result = verifySignature({ secret, body: '{"amount":1000000}', header });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature mismatch');
  });

  it('rejects the wrong secret', () => {
    const body = '{"a":1}';
    const header = signPayload('whsec_real', body, Math.floor(Date.now() / 1000));
    expect(verifySignature({ secret: 'whsec_attacker', body, header }).valid).toBe(false);
  });

  it('rejects a replayed delivery outside the tolerance window', () => {
    const secret = 'whsec_test_secret';
    const body = '{"a":1}';
    const old = Math.floor(Date.now() / 1000) - 3600;

    const header = signPayload(secret, body, old);
    const result = verifySignature({ secret, body, header });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/outside the 300s tolerance/);
  });

  it('rejects a malformed header', () => {
    expect(verifySignature({ secret: 's', body: 'b', header: 'garbage' }).valid).toBe(false);
    expect(verifySignature({ secret: 's', body: 'b', header: 't=123' }).valid).toBe(false);
  });
});
