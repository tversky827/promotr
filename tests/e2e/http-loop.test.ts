import { spawn, type ChildProcess } from 'node:child_process';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { balanceSummary } from '@/lib/billing/earnings';
import { verifyGlobalBalance } from '@/lib/billing/ledger';
import { prisma } from '@/lib/db';

import { disconnect, resetDatabase, testDb } from '../helpers/db';
import { seedLoop } from '../helpers/seed-loop';

/**
 * End-to-end over real HTTP.
 *
 * The other integration tests call the library functions directly. This one
 * boots the actual Next.js server and drives it through HTTP, so the route
 * handlers, middleware, headers, and the `after()` deferral are all exercised
 * the way a real visitor and a real advertiser would exercise them.
 */

const PORT = 3311;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let server: ChildProcess | null = null;

/** Kills the whole process group, not just the npm wrapper. */
function stopServer(): void {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  server = null;
}

async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok || response.status === 503) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Server did not start in time');
}

/** The click is recorded in an after() hook, so poll rather than sleeping blindly. */
async function waitForClick(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const click = await testDb.click.findFirst({ orderBy: { createdAt: 'desc' } });
    if (click) return click;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Click was not recorded within the timeout');
}

describe('end-to-end over HTTP', () => {
  beforeAll(async () => {
    server = spawn('npm', ['run', 'start', '--', '-p', String(PORT)], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(PORT),
        DATABASE_URL: process.env.DATABASE_URL,
        NEXT_PUBLIC_APP_URL: BASE,
        NEXT_PUBLIC_TRACKING_URL: BASE,
      },
      stdio: 'ignore',
      // Its own process group: `npm start` spawns the real server as a child,
      // and signalling only the wrapper leaves that child holding the port —
      // where the next run silently talks to the previous build.
      detached: true,
    });
    await waitForServer();
  }, 120_000);

  afterAll(async () => {
    stopServer();
    await disconnect();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('redirects a visitor and records the click', async () => {
    const { link, campaign, creator } = await seedLoop();

    const response = await fetch(`${BASE}/r/${link.code}`, {
      redirect: 'manual',
      headers: { 'user-agent': CHROME, referer: 'https://www.youtube.com/watch?v=x' },
    });

    expect(response.status).toBe(302);

    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    const target = new URL(location!);
    expect(target.origin + target.pathname).toBe('https://example.com/landing');
    // The advertiser receives the click id so they can report a conversion.
    const clickId = target.searchParams.get('adc_click');
    expect(clickId).toMatch(/^[0-9a-f-]{36}$/);

    // Tracking links must never be cached.
    expect(response.headers.get('cache-control')).toContain('no-store');
    // Our URL (which contains the tracking code) is not leaked onward.
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');

    const click = await waitForClick();
    expect(click.id).toBe(clickId);
    expect(click.campaignId).toBe(campaign.id);
    expect(click.creatorId).toBe(creator.id);
    expect(click.browser).toBe('Chrome');
    expect(click.referrerHost).toBe('youtube.com');
  });

  it('completes the full loop: click, conversion, earning', async () => {
    const { link, campaign, creator, apiKey } = await seedLoop();

    // 1. A visitor clicks the publisher's link.
    const redirect = await fetch(`${BASE}/r/${link.code}`, {
      redirect: 'manual',
      headers: { 'user-agent': CHROME },
    });
    const clickId = new URL(redirect.headers.get('location')!).searchParams.get('adc_click')!;
    await waitForClick();

    // 2. The advertiser reports a conversion through the API.
    const conversion = await fetch(`${BASE}/api/v1/conversions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.key}`,
      },
      body: JSON.stringify({
        campaign_id: campaign.id,
        click_id: clickId,
        conversion_id: 'order-e2e-1',
        value: '129.99',
      }),
    });

    expect(conversion.status).toBe(201);
    const body = (await conversion.json()) as { data: Record<string, unknown> };
    expect(body.data.status).toBe('PENDING');
    expect(body.data.duplicate).toBe(false);
    expect(body.data.publisher_payout).toBe('10000000'); // $10, as micros

    // 3. The publisher's balance reflects it.
    const balance = await balanceSummary(creator.id);
    expect(balance.pendingMicros).toBe(10_000_000n);
    expect((await verifyGlobalBalance()).balanced).toBe(true);
  });

  it('does not charge twice when the advertiser retries a conversion', async () => {
    const { link, campaign, creator, apiKey } = await seedLoop();

    const redirect = await fetch(`${BASE}/r/${link.code}`, {
      redirect: 'manual',
      headers: { 'user-agent': CHROME },
    });
    const clickId = new URL(redirect.headers.get('location')!).searchParams.get('adc_click')!;
    await waitForClick();

    const send = () =>
      fetch(`${BASE}/api/v1/conversions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.key}` },
        body: JSON.stringify({
          campaign_id: campaign.id,
          click_id: clickId,
          conversion_id: 'order-retry',
          value: '50.00',
        }),
      });

    const first = await send();
    const second = await send();
    const third = await send();

    expect(first.status).toBe(201);
    // A retry is a success, not an error — clients must not treat it as failure.
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(((await second.json()) as { data: { duplicate: boolean } }).data.duplicate).toBe(true);

    expect(await testDb.conversion.count()).toBe(1);
    expect(await testDb.earning.count()).toBe(1);
    expect((await balanceSummary(creator.id)).pendingMicros).toBe(10_000_000n);
  });

  it('rejects an unauthenticated conversion report', async () => {
    const { campaign } = await seedLoop();

    const response = await fetch(`${BASE}/api/v1/conversions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaign.id, conversion_id: 'x' }),
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(await testDb.conversion.count()).toBe(0);
  });

  it("rejects a conversion against another brand's campaign", async () => {
    const first = await seedLoop();
    const second = await seedLoop();

    // Authenticate as brand A, target brand B's campaign.
    const response = await fetch(`${BASE}/api/v1/conversions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${first.apiKey.key}`,
      },
      body: JSON.stringify({
        campaign_id: second.campaign.id,
        conversion_id: 'cross-tenant',
        value: '99.00',
      }),
    });

    expect(response.status).toBe(404);
    expect(await testDb.conversion.count()).toBe(0);
  });

  it('accepts a server-to-server postback', async () => {
    const { link, campaign, apiKey, creator } = await seedLoop();

    const redirect = await fetch(`${BASE}/r/${link.code}`, {
      redirect: 'manual',
      headers: { 'user-agent': CHROME },
    });
    const clickId = new URL(redirect.headers.get('location')!).searchParams.get('adc_click')!;
    await waitForClick();

    const postback = await fetch(
      `${BASE}/api/postback?key=${apiKey.key}&campaign_id=${campaign.id}&click_id=${clickId}&conversion_id=pb-1&value=75.50`,
    );

    expect(postback.status).toBe(200);
    expect((await balanceSummary(creator.id)).pendingMicros).toBe(10_000_000n);
  });

  it('always returns a valid image from the conversion pixel', async () => {
    const { link, campaign, apiKey } = await seedLoop();

    const redirect = await fetch(`${BASE}/r/${link.code}`, {
      redirect: 'manual',
      headers: { 'user-agent': CHROME },
    });
    const clickId = new URL(redirect.headers.get('location')!).searchParams.get('adc_click')!;
    await waitForClick();

    const pixel = await fetch(
      `${BASE}/px/c?k=${apiKey.key}&c=${campaign.id}&id=px-1&click=${clickId}&v=25.00`,
    );

    expect(pixel.status).toBe(200);
    expect(pixel.headers.get('content-type')).toBe('image/gif');
    expect(pixel.headers.get('x-audicents-status')).toBe('recorded');

    // Even a completely invalid request must return an image, never a broken
    // image icon on the advertiser's confirmation page.
    const broken = await fetch(`${BASE}/px/c?k=bogus&c=nope&id=x`);
    expect(broken.status).toBe(200);
    expect(broken.headers.get('content-type')).toBe('image/gif');
    expect(broken.headers.get('x-audicents-status')).toBe('unauthorized');
  });

  it('serves the tracking SDK with the deployment host baked in', async () => {
    const response = await fetch(`${BASE}/sdk/a.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');

    const source = await response.text();
    expect(source).toContain('trackConversion');
    expect(source).toContain(BASE);
  });

  it('sends visitors somewhere useful when a code does not resolve', async () => {
    const response = await fetch(`${BASE}/r/ZZZZZZZZZZ`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/campaigns');
    // No click is recorded for an unresolvable code.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await testDb.click.count()).toBe(0);
  });

  it('answers 403, not 401, when a key is valid but lacks the scope', async () => {
    const loop = await seedLoop();

    // A conversion-only key, which is what a checkout integration should hold.
    const { createApiKey } = await import('@/lib/api/apikey');
    const scoped = await createApiKey({
      brandId: loop.brand.id,
      name: 'Conversions only',
      scopes: ['conversions:write'],
    });

    const readAttempt = await fetch(`${BASE}/api/v1/campaigns`, {
      headers: { Authorization: `Bearer ${scoped.key}` },
    });
    // 401 would say "we do not know who you are", which is not what happened.
    expect(readAttempt.status).toBe(403);
    expect((await readAttempt.json()).error.code).toBe('FORBIDDEN');

    const unknownKey = await fetch(`${BASE}/api/v1/campaigns`, {
      headers: { Authorization: 'Bearer pk_live_definitely_not_a_key' },
    });
    expect(unknownKey.status).toBe(401);
    expect((await unknownKey.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('re-issues a CSRF token to a session that lost its cookie', async () => {
    const loop = await seedLoop();

    // A session whose CSRF cookie the browser has dropped. Without recovery,
    // every form on the site would fail a check the user cannot fix.
    const { generateToken } = await import('@/lib/crypto/ids');
    const { hashToken } = await import('@/lib/crypto/hash');
    const sessionToken = generateToken();
    await testDb.session.create({
      data: {
        userId: loop.owner.id,
        tokenHash: hashToken(sessionToken),
        csrfSecretHash: hashToken(generateToken()),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const response = await fetch(`${BASE}/api/auth/csrf`, {
      method: 'POST',
      headers: { origin: BASE, cookie: `audicents_session=${sessionToken}` },
    });
    expect(response.status).toBe(200);

    const { token } = (await response.json()) as { token: string };
    expect(token).toBeTruthy();

    // The new token is bound to that session, not merely echoed back.
    const session = await testDb.session.findFirstOrThrow({
      where: { tokenHash: hashToken(sessionToken) },
      select: { csrfSecretHash: true },
    });
    expect(session.csrfSecretHash).toBe(hashToken(token));

    // And it hands nothing to a caller with no session.
    const anonymous = await fetch(`${BASE}/api/auth/csrf`, {
      method: 'POST',
      headers: { origin: BASE },
    });
    expect(anonymous.status).toBe(401);

    // Nor to a cross-site caller holding a valid session cookie.
    const crossSite = await fetch(`${BASE}/api/auth/csrf`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', cookie: `audicents_session=${sessionToken}` },
    });
    expect(crossSite.status).toBe(403);
  });

  it('applies security headers to application responses', async () => {
    const response = await fetch(`${BASE}/`);

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    // The framework version must not be advertised.
    expect(response.headers.get('x-powered-by')).toBeNull();
  });
});
