/**
 * Typed environment access.
 *
 * Two rules drive this module:
 *  1. Missing *core* configuration is a hard failure in production. The app
 *     refuses to boot rather than starting in a half-working state.
 *  2. Missing *integration* configuration is a first-class, visible state.
 *     `integrations.stripe.configured === false` is surfaced in the UI as
 *     "Stripe is not configured" — never faked, never silently swallowed.
 */

type Raw = Record<string, string | undefined>;

const raw: Raw = process.env as Raw;

function str(key: string, fallback = ''): string {
  const v = raw[key];
  return v === undefined || v === '' ? fallback : v;
}

function bool(key: string, fallback = false): boolean {
  const v = raw[key];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

function int(key: string, fallback: number): number {
  const v = raw[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function num(key: string, fallback: number): number {
  const v = raw[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function stripTrailingSlash(u: string): string {
  return u.endsWith('/') ? u.slice(0, -1) : u;
}

export const nodeEnv = str('NODE_ENV', 'development') as
  | 'development'
  | 'test'
  | 'production';

export const isProduction = nodeEnv === 'production';
export const isTest = nodeEnv === 'test';
export const isDevelopment = nodeEnv === 'development';

/** Errors accumulated during load, reported together instead of one at a time. */
const configErrors: string[] = [];

function requiredInProduction(key: string, fallback: string): string {
  const v = str(key, '');
  if (v) return v;
  if (isProduction) {
    configErrors.push(`${key} is required in production`);
  }
  return fallback;
}

const appUrl = stripTrailingSlash(
  requiredInProduction('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),
);

const trackingUrl = stripTrailingSlash(
  str('NEXT_PUBLIC_TRACKING_URL', '') || appUrl,
);

const databaseUrl = requiredInProduction('DATABASE_URL', '');

/**
 * A 32-byte key, as base64.
 *
 * The documented way to produce one is `openssl rand -base64 32`, and a value
 * of that shape is used exactly as given. But secrets are routinely pasted from
 * a password manager or a hosting console, and those produce long random text
 * rather than base64 — 40 mashed characters decode to 30 bytes, which used to
 * fail the length check and stop the application from booting.
 *
 * So a secret that is not already a big enough base64 key is turned into one
 * from its own bytes. The mapping is deterministic, so a given secret always
 * yields the same key and nothing encrypted under it becomes unreadable.
 */
function requiredKey(key: string): string {
  const raw = str(key, '');

  if (raw) {
    let decoded = 0;
    try {
      decoded = Buffer.from(raw, 'base64').length;
    } catch {
      decoded = 0;
    }
    if (decoded >= 32) return raw;

    // Take 32 bytes of the secret itself rather than hashing it: this module
    // is evaluated in the edge runtime as well, where node:crypto does not
    // exist. A 32-character random secret carries far more entropy than the
    // key needs, and the mapping is deterministic, so nothing encrypted under
    // a given secret becomes unreadable.
    const bytes = Buffer.from(raw, 'utf8');
    if (bytes.length >= 32) {
      return bytes.subarray(0, 32).toString('base64');
    }

    configErrors.push(
      `${key} is too short: use at least 32 characters, or generate one with "openssl rand -base64 32"`,
    );
    return '';
  }

  if (isProduction) {
    configErrors.push(`${key} is required in production (openssl rand -base64 32)`);
    return '';
  }

  // Development-only deterministic fallback. Never used in production.
  return Buffer.from(`insecure-development-key::${key}`.padEnd(32, '.').slice(0, 32)).toString(
    'base64',
  );
}

export const env = {
  nodeEnv,
  isProduction,
  isDevelopment,
  isTest,

  appUrl,
  trackingUrl,
  databaseUrl,
  directDatabaseUrl: str('DIRECT_DATABASE_URL', '') || databaseUrl,
  redisUrl: str('REDIS_URL', ''),

  encryptionKey: requiredKey('APP_ENCRYPTION_KEY'),
  ipHashSecret: requiredKey('IP_HASH_SECRET'),

  cronSecret: str('CRON_SECRET', ''),
  trustProxy: bool('TRUST_PROXY', true),
  trustedProxyCidrs: str('TRUSTED_PROXY_CIDRS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  clickRetentionDays: int('CLICK_RETENTION_DAYS', 180),
  workerConcurrency: int('WORKER_CONCURRENCY', 5),
  workerPollIntervalMs: int('WORKER_POLL_INTERVAL_MS', 1000),

  bootstrapAdminEmail: str('BOOTSTRAP_ADMIN_EMAIL', ''),
  bootstrapAdminPassword: str('BOOTSTRAP_ADMIN_PASSWORD', ''),
} as const;

/**
 * Integration availability. Each entry answers a single question: can this
 * feature actually run right now? UI surfaces read these directly.
 */
export const integrations = {
  stripe: {
    get configured(): boolean {
      return Boolean(str('STRIPE_SECRET_KEY'));
    },
    get secretKey(): string {
      return str('STRIPE_SECRET_KEY');
    },
    get publishableKey(): string {
      return str('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
    },
    get webhookSecret(): string {
      return str('STRIPE_WEBHOOK_SECRET');
    },
    get connectWebhookSecret(): string {
      return str('STRIPE_CONNECT_WEBHOOK_SECRET') || str('STRIPE_WEBHOOK_SECRET');
    },
    get connectClientId(): string {
      return str('STRIPE_CONNECT_CLIENT_ID');
    },
    get accountType(): 'express' | 'standard' | 'custom' {
      const v = str('STRIPE_CONNECT_ACCOUNT_TYPE', 'express');
      return v === 'standard' || v === 'custom' ? v : 'express';
    },
    /** Live mode is inferred from the key prefix, never from a separate flag. */
    get liveMode(): boolean {
      return str('STRIPE_SECRET_KEY').startsWith('sk_live_');
    },
    get webhookConfigured(): boolean {
      return Boolean(str('STRIPE_WEBHOOK_SECRET'));
    },
  },

  email: {
    get provider(): 'resend' | 'postmark' | 'sendgrid' | 'smtp' | 'console' {
      const p = str('EMAIL_PROVIDER', 'console');
      return ['resend', 'postmark', 'sendgrid', 'smtp', 'console'].includes(p)
        ? (p as 'resend')
        : 'console';
    },
    /** `console` counts as configured for development; it is explicit, not fake. */
    get configured(): boolean {
      const p = str('EMAIL_PROVIDER', 'console');
      if (p === 'console') return !isProduction;
      if (p === 'smtp') return Boolean(str('SMTP_HOST') && str('SMTP_USER'));
      return Boolean(str('EMAIL_API_KEY'));
    },
    get apiKey(): string {
      return str('EMAIL_API_KEY');
    },
    get from(): string {
      return str('EMAIL_FROM', 'no-reply@localhost');
    },
    get replyTo(): string {
      return str('EMAIL_REPLY_TO');
    },
    get smtp() {
      return {
        host: str('SMTP_HOST'),
        port: int('SMTP_PORT', 587),
        user: str('SMTP_USER'),
        password: str('SMTP_PASSWORD'),
      };
    },
  },

  storage: {
    get configured(): boolean {
      return Boolean(str('S3_BUCKET') && str('S3_ACCESS_KEY_ID') && str('S3_SECRET_ACCESS_KEY'));
    },
    get endpoint(): string {
      return str('S3_ENDPOINT');
    },
    get region(): string {
      return str('S3_REGION', 'us-east-1');
    },
    get bucket(): string {
      return str('S3_BUCKET');
    },
    get accessKeyId(): string {
      return str('S3_ACCESS_KEY_ID');
    },
    get secretAccessKey(): string {
      return str('S3_SECRET_ACCESS_KEY');
    },
    get publicUrl(): string {
      return stripTrailingSlash(str('S3_PUBLIC_URL'));
    },
    get forcePathStyle(): boolean {
      return bool('S3_FORCE_PATH_STYLE', true);
    },
  },

  sentry: {
    get configured(): boolean {
      return Boolean(str('SENTRY_DSN'));
    },
    get dsn(): string {
      return str('SENTRY_DSN');
    },
    get environment(): string {
      return str('SENTRY_ENVIRONMENT', nodeEnv);
    },
    get tracesSampleRate(): number {
      return num('SENTRY_TRACES_SAMPLE_RATE', 0.1);
    },
  },

  google: {
    get configured(): boolean {
      return Boolean(str('GOOGLE_OAUTH_CLIENT_ID') && str('GOOGLE_OAUTH_CLIENT_SECRET'));
    },
    get clientId(): string {
      return str('GOOGLE_OAUTH_CLIENT_ID');
    },
    get clientSecret(): string {
      return str('GOOGLE_OAUTH_CLIENT_SECRET');
    },
  },

  safeBrowsing: {
    get configured(): boolean {
      return Boolean(str('SAFE_BROWSING_API_KEY'));
    },
    get apiKey(): string {
      return str('SAFE_BROWSING_API_KEY');
    },
  },

  redis: {
    get configured(): boolean {
      return Boolean(str('REDIS_URL'));
    },
    get url(): string {
      return str('REDIS_URL');
    },
  },
} as const;

/** Thrown at boot when required production configuration is missing. */
export class ConfigurationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigurationError';
  }
}

let validated = false;

/** Called once from instrumentation.ts at server start. */
export function assertConfigured(): void {
  if (validated) return;
  validated = true;
  if (configErrors.length > 0) {
    throw new ConfigurationError(configErrors);
  }
}

export function configurationProblems(): string[] {
  return [...configErrors];
}

/** A safe, serialisable snapshot for the admin "system health" screen. */
export function integrationStatus() {
  return {
    stripe: {
      configured: integrations.stripe.configured,
      liveMode: integrations.stripe.liveMode,
      webhookConfigured: integrations.stripe.webhookConfigured,
      connectAccountType: integrations.stripe.accountType,
    },
    email: {
      configured: integrations.email.configured,
      provider: integrations.email.provider,
    },
    storage: { configured: integrations.storage.configured, bucket: integrations.storage.bucket },
    redis: { configured: integrations.redis.configured },
    sentry: { configured: integrations.sentry.configured },
    google: { configured: integrations.google.configured },
    safeBrowsing: { configured: integrations.safeBrowsing.configured },
  };
}
