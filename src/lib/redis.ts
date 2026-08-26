import { env, integrations } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

/**
 * Small key/value abstraction over Redis with an in-memory fallback.
 *
 * The fallback is genuinely correct for a single process, which makes local
 * development and single-instance deployments work without Redis. It is NOT
 * correct across instances — two servers would keep independent rate-limit
 * counters — so `isDistributed` is surfaced to the admin health screen and the
 * deployment docs call this out explicitly.
 */

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Atomic increment returning the new value; sets the TTL on first increment. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Sets only if absent. Returns true when this caller won the race. */
  setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  readonly isDistributed: boolean;
  readonly ready: boolean;
}

class MemoryStore implements KeyValueStore {
  readonly isDistributed = false;
  readonly ready = true;
  private readonly map = new Map<string, { value: string; expiresAt: number }>();
  private lastSweep = Date.now();

  private sweep(): void {
    const now = Date.now();
    // Amortised cleanup: at most once a second, regardless of call volume.
    if (now - this.lastSweep < 1000) return;
    this.lastSweep = now;
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
  }

  private read(key: string): string | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    this.sweep();
    return this.read(key);
  }

  async set(key: string, value: string, ttlSeconds = 3600): Promise<void> {
    this.sweep();
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    this.sweep();
    const current = this.read(key);
    const next = (current === null ? 0 : Number.parseInt(current, 10) || 0) + 1;
    const existing = this.map.get(key);
    this.map.set(key, {
      value: String(next),
      // Preserve the original window's expiry so the window is fixed, not sliding.
      expiresAt: existing && existing.expiresAt > Date.now()
        ? existing.expiresAt
        : Date.now() + ttlSeconds * 1000,
    });
    return next;
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    this.sweep();
    if (this.read(key) !== null) return false;
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }
}

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
  set(key: string, value: string, mode: string, ttl: number, nx: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, ttl: number): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  status: string;
};

class RedisStore implements KeyValueStore {
  readonly isDistributed = true;
  private connected = false;

  constructor(private readonly client: RedisLike) {
    client.on('ready', () => {
      this.connected = true;
    });
    client.on('error', (error) => {
      this.connected = false;
      logger.warn('redis.error', { error: (error as Error)?.message });
    });
  }

  get ready(): boolean {
    return this.connected || this.client.status === 'ready';
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds = 3600): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.client.incr(key);
    // Only the first increment in a window sets the TTL, keeping windows fixed.
    if (value === 1) await this.client.expire(key, ttlSeconds);
    return value;
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
}

const globalForStore = globalThis as unknown as { kvStore?: KeyValueStore };

function createStore(): KeyValueStore {
  if (!integrations.redis.configured) {
    if (env.isProduction) {
      logger.warn('redis.not_configured', {
        detail:
          'REDIS_URL is unset. Rate limiting and click de-duplication are per-process only, ' +
          'which is unsafe with more than one server instance.',
      });
    }
    return new MemoryStore();
  }
  try {
    // Imported lazily and optionally: ioredis is an optionalDependency so an
    // install without it still boots, just without distributed state.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis');
    const client = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
      connectTimeout: 5000,
    });
    return new RedisStore(client as RedisLike);
  } catch (error) {
    logger.error('redis.init_failed', { error: (error as Error).message });
    return new MemoryStore();
  }
}

export const kv: KeyValueStore = globalForStore.kvStore ?? createStore();
if (!env.isProduction) globalForStore.kvStore = kv;
