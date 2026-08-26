/**
 * Vitest global setup.
 *
 * Integration tests run against a real PostgreSQL database — the financial and
 * tracking guarantees this product makes (row locks, serialisable transactions,
 * partitioning, CHECK constraints, deferred triggers) simply cannot be verified
 * against a mock. TEST_DATABASE_URL points at a throwaway database.
 */
// NODE_ENV is typed read-only by @types/node; the assignment is intentional here.
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'test';

// Deterministic keys so hashes are stable across runs.
process.env.APP_ENCRYPTION_KEY =
  process.env.APP_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString('base64');
process.env.IP_HASH_SECRET =
  process.env.IP_HASH_SECRET ?? Buffer.alloc(32, 11).toString('base64');

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/promotr_test?schema=public';

process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
process.env.NEXT_PUBLIC_TRACKING_URL =
  process.env.NEXT_PUBLIC_TRACKING_URL ?? 'http://localhost:3000';
process.env.EMAIL_PROVIDER = 'console';
// Tests must never reach a real Redis; the in-memory store is deterministic.
delete process.env.REDIS_URL;

export {};
