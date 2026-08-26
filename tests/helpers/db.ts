import { execSync } from 'node:child_process';

import { PrismaClient } from '@prisma/client';

/**
 * Test database helpers.
 *
 * Tests share one database and clean between cases with TRUNCATE ... CASCADE,
 * which is dramatically faster than dropping and re-migrating and keeps the
 * partitions, triggers and constraints that the tests exist to exercise.
 */

export const testDb = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL! } },
  log: ['error'],
});

/** Every table, in an order that CASCADE can resolve. */
const TABLES = [
  'ledger_entries',
  'ledger_transactions',
  'ledger_accounts',
  'earnings',
  'payouts',
  'conversions',
  'clicks',
  'impressions',
  'stat_hourly',
  'tracking_links',
  'campaign_applications',
  'campaign_invitations',
  'campaign_creatives',
  'campaign_rules',
  'campaign_budgets',
  'brand_deposits',
  'campaigns',
  'dispute_messages',
  'disputes',
  'fraud_events',
  'webhook_deliveries',
  'webhook_endpoints',
  'api_keys',
  'verified_domains',
  'brand_payment_methods',
  'brand_members',
  'brands',
  'social_accounts',
  'creator_profiles',
  'creators',
  'notifications',
  'export_jobs',
  'terms_acceptances',
  'terms_versions',
  'audit_logs',
  'oauth_accounts',
  'email_tokens',
  'sessions',
  'users',
  'jobs',
  'stripe_events',
  'idempotency_records',
  'platform_settings',
];

export async function resetDatabase(): Promise<void> {
  await testDb.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

export async function disconnect(): Promise<void> {
  await testDb.$disconnect();
}

/** Applies migrations to the test database. Run once before the suite. */
export function migrateTestDatabase(): void {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });
}
