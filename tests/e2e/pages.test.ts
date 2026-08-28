import { spawn, type ChildProcess } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from '@/lib/auth/constants';
import { generateToken } from '@/lib/crypto/ids';
import { hashToken } from '@/lib/crypto/hash';
import { prisma } from '@/lib/db';

import { disconnect, resetDatabase, testDb } from '../helpers/db';
import { seedLoop } from '../helpers/seed-loop';

/**
 * Every signed-in page, fetched over real HTTP.
 *
 * A page that throws during server rendering returns 500, and a page whose
 * navigation entry points at a route that does not exist returns 404. Both are
 * invisible to type checking and to the unit suite, and both are the kind of
 * breakage a user finds first. This walks the whole application as each of the
 * three account types and asserts that nothing is broken and that no page
 * leaks a stack trace.
 *
 * It also checks the negative direction: a publisher must not be able to open
 * a brand page, and neither may open the admin console.
 */

const PORT = 3313;
const BASE = `http://127.0.0.1:${PORT}`;

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

async function waitForServer(timeoutMs = 90_000): Promise<void> {
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

/**
 * Mints a session the same way the application does — a random token in the
 * cookie, only its hash in the database — without going through the sign-in
 * form, which posts through a server action this test has no business
 * reimplementing.
 */
async function signIn(userId: string): Promise<string> {
  const token = generateToken();
  await testDb.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      csrfSecretHash: hashToken(generateToken()),
      mfaSatisfied: true,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return `${SESSION_COOKIE}=${token}`;
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });
  const body = response.status < 400 ? await response.text() : '';
  return { status: response.status, body, location: response.headers.get('location') };
}

const BRAND_PAGES = [
  '/brand',
  '/brand/campaigns',
  '/brand/campaigns/new',
  // Filled in once the loop campaign exists.
  '__CAMPAIGN__',
  '__CAMPAIGN_EDIT__',
  '__CAMPAIGN_FUNDING__',
  '/brand/publishers',
  '/brand/billing',
  '/brand/developers',
  '/brand/disputes',
  '/brand/settings',
  '/notifications',
];

const CREATOR_PAGES = [
  '/creator',
  '__CAMPAIGN_DETAIL__',
  '/creator/earnings',
  '/creator/disputes',
  '/creator/settings',
  '/notifications',
];

/** Routes that were merged into another screen and now redirect there. */
const MERGED_ROUTES: Array<[string, string]> = [
  ['/creator/links', '/creator'],
  ['/creator/payouts', '/creator/earnings'],
  ['/creator/exports', '/creator/earnings'],
  ['/creator/profile', '/creator/settings'],
  ['/brand/reports', '/brand'],
  ['/campaigns', '/'],
];

const ADMIN_PAGES = [
  '/admin',
  '/admin/system',
  '/admin/campaigns',
  '/admin/brands',
  '/admin/creators',
  '/admin/users',
  '/admin/clicks',
  '/admin/conversions',
  '/admin/fraud',
  '/admin/transactions',
  '/admin/payouts',
  '/admin/disputes',
  '/admin/reports',
  '/admin/settings',
  '/admin/audit',
];

const PUBLIC_PAGES = [
  '/',
  '/status',
  '/login',
  '/signup',
  '/forgot-password',
  '/docs/api',
  '/docs/tracking',
  '/docs/webhooks',
  '/legal/terms',
  '/legal/privacy',
  '/legal/cookies',
  '/legal/acceptable-use',
  '/legal/creator-agreement',
  '/legal/brand-agreement',
  '/legal/campaign-rules',
  '/legal/security',
];

/** Markers that mean a page rendered an error rather than content. */
function assertNoErrorMarkers(path: string, body: string): void {
  for (const marker of ['Application error', 'Internal Server Error', 'at Object.', 'TypeError:']) {
    expect(body, `${path} rendered "${marker}"`).not.toContain(marker);
  }
}

describe('every page renders', () => {
  /** Values that only appear once a page has actually rendered someone's data. */
  let tenantMarkers: string[] = [];
  let brandCookie = '';
  let creatorCookie = '';
  let adminCookie = '';

  beforeAll(async () => {
    await resetDatabase();

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

    const loop = await seedLoop();

    const adminUser = await testDb.user.create({
      data: {
        email: 'admin-pages@example.test',
        emailNormalized: 'admin-pages@example.test',
        role: 'ADMIN',
        name: 'Page Test Admin',
        emailVerifiedAt: new Date(),
      },
    });

    tenantMarkers = [loop.brand.displayName, loop.creator.handle, loop.campaign.name];

    // Campaign-scoped pages can only be addressed once a campaign exists.
    BRAND_PAGES[BRAND_PAGES.indexOf('__CAMPAIGN__')] = `/brand/campaigns/${loop.campaign.id}`;
    BRAND_PAGES[BRAND_PAGES.indexOf('__CAMPAIGN_EDIT__')] =
      `/brand/campaigns/${loop.campaign.id}/edit`;
    BRAND_PAGES[BRAND_PAGES.indexOf('__CAMPAIGN_FUNDING__')] =
      `/brand/campaigns/${loop.campaign.id}/funding`;
    CREATOR_PAGES[CREATOR_PAGES.indexOf('__CAMPAIGN_DETAIL__')] = `/campaigns/${loop.campaign.slug}`;

    [brandCookie, creatorCookie, adminCookie] = await Promise.all([
      signIn(loop.owner.id),
      signIn(loop.creatorUser.id),
      signIn(adminUser.id),
    ]);

    await waitForServer();
  }, 180_000);

  afterAll(async () => {
    stopServer();
    await disconnect();
    await prisma.$disconnect();
  });

  function assertNoTenantData(path: string, body: string): void {
    for (const marker of tenantMarkers) {
      expect(body, `GET ${path} leaked "${marker}"`).not.toContain(marker);
    }
    // A rendered dashboard always contains at least one data table or stat grid.
    expect(body, `GET ${path} rendered a table`).not.toContain('<table');
  }

  it('serves every public page', async () => {
    for (const path of PUBLIC_PAGES) {
      const { status, body } = await get(path);
      expect(status, `GET ${path}`).toBe(200);
      assertNoErrorMarkers(path, body);
    }
  });

  it('serves every brand page to a brand owner', async () => {
    for (const path of BRAND_PAGES) {
      const { status, body } = await get(path, brandCookie);
      expect(status, `GET ${path}`).toBe(200);
      assertNoErrorMarkers(path, body);
    }
  });

  it('serves every publisher page to a publisher', async () => {
    for (const path of CREATOR_PAGES) {
      const { status, body } = await get(path, creatorCookie);
      expect(status, `GET ${path}`).toBe(200);
      assertNoErrorMarkers(path, body);
    }
  });

  it('serves every admin page to an administrator', async () => {
    for (const path of ADMIN_PAGES) {
      const { status, body } = await get(path, adminCookie);
      expect(status, `GET ${path}`).toBe(200);
      assertNoErrorMarkers(path, body);
    }
  });

  it('sends a signed-out visitor to sign in rather than showing them a dashboard', async () => {
    for (const path of ['/brand', '/creator', '/admin']) {
      const { status, location } = await get(path);
      expect([302, 307], `GET ${path}`).toContain(status);
      expect(location, `GET ${path}`).toContain('/login');
    }
  });

  it('does not let a publisher open brand or admin pages', async () => {
    for (const path of ['/brand', '/brand/billing', '/brand/developers']) {
      const { status, body } = await get(path, creatorCookie);
      // The guard redirects them to their own dashboard. Next.js has already
      // flushed the document shell by the time the guard runs, so the redirect
      // travels in the body as a 200 rather than as a Location header. The page
      // itself never renders, which is what matters: no brand data is in the
      // response, only the shell and the redirect instruction.
      expect(status, `GET ${path}`).toBe(200);
      expect(body, `GET ${path}`).toContain('NEXT_REDIRECT;replace;/creator');
      assertNoTenantData(path, body);
    }

    for (const path of ['/admin', '/admin/payouts', '/admin/settings']) {
      const { status, body } = await get(path, creatorCookie);
      expect(status, `GET ${path}`).toBe(200);
      expect(body, `GET ${path}`).toContain('NEXT_REDIRECT');
      assertNoTenantData(path, body);
    }
  });

  it('does not let a brand user open the admin console', async () => {
    for (const path of ['/admin', '/admin/transactions', '/admin/creators']) {
      const { status, body } = await get(path, brandCookie);
      expect(status, `GET ${path}`).toBe(200);
      expect(body, `GET ${path}`).toContain('NEXT_REDIRECT');
      assertNoTenantData(path, body);
    }
  });

  it('sends a merged route to the screen that absorbed it', async () => {
    for (const [from, to] of MERGED_ROUTES) {
      const cookie = from.startsWith('/brand') ? brandCookie : creatorCookie;
      const { status, location } = await get(from, cookie);
      expect([301, 302, 307, 308], `GET ${from}`).toContain(status);
      expect(location, `GET ${from}`).toContain(to);
    }
  });

  it('serves the marketplace as the home page', async () => {
    const { status, body } = await get('/');
    expect(status).toBe(200);
    // The campaign wall, not a brochure.
    expect(body).toContain('Campaigns accepting traffic');
    assertNoErrorMarkers('/', body);
  });

  it('returns 404 for a page that does not exist, not an error', async () => {
    const { status } = await get('/definitely-not-a-page');
    expect(status).toBe(404);
  });
});
