import { PrismaClient } from '@prisma/client';

import { env } from '@/lib/env';

/**
 * Prisma client singleton. Next.js hot-reloads modules in development, which
 * would otherwise open a new connection pool on every edit until Postgres
 * refuses connections.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({
    log: env.isDevelopment ? ['warn', 'error'] : ['error'],
    datasources: { db: { url: env.databaseUrl } },
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (!env.isProduction) globalForPrisma.prisma = prisma;

/**
 * Run `fn` inside a serialisable-isolation transaction, retrying on the
 * serialisation failures Postgres raises under contention. Used for the money
 * paths where two concurrent events must not both read a stale budget.
 */
export async function withSerializableTransaction<T>(
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
  options: { maxRetries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const { maxRetries = 5, timeoutMs = 15_000 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: 'Serializable',
        timeout: timeoutMs,
        maxWait: 10_000,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === maxRetries) throw error;
      // Exponential backoff with jitter to break up lockstep retries.
      const delay = Math.min(2 ** attempt * 10, 250) + Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/** Postgres 40001 (serialisation failure) and 40P01 (deadlock) are retryable. */
export function isRetryableTransactionError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === '40001' || code === '40P01') return true;
  const meta = (error as { meta?: { code?: string } })?.meta?.code;
  if (meta === '40001' || meta === '40P01') return true;
  const message = (error as Error)?.message ?? '';
  return (
    message.includes('could not serialize access') ||
    message.includes('deadlock detected') ||
    message.includes('40001')
  );
}

/** Prisma's unique-constraint violation code. */
export function isUniqueViolation(error: unknown, target?: string): boolean {
  const e = error as { code?: string; meta?: { target?: string[] | string } };
  if (e?.code !== 'P2002') return false;
  if (!target) return true;
  const t = e.meta?.target;
  const list = Array.isArray(t) ? t : typeof t === 'string' ? [t] : [];
  return list.some((x) => x.includes(target));
}

export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: (error as Error).message };
  }
}
