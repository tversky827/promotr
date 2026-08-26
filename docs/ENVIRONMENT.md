# Environment

Copy `.env.example` to `.env` and fill it in. `.env` is git-ignored and must
never be committed.

Variables fall into three groups:

- **Required** — the application refuses to start in production without them.
- **Integration** — each unlocks a capability. When unset, that capability
  reports itself as not configured and refuses to run. Nothing is faked.
- **Tuning** — sensible defaults; change them when you have a reason.

## Required

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `development`, `test` or `production` |
| `DATABASE_URL` | PostgreSQL 14+. Include `?schema=public` |
| `NEXT_PUBLIC_APP_URL` | Public origin, no trailing slash. Used in emails, OAuth returns, provider redirects and canonical URLs |
| `NEXT_PUBLIC_TRACKING_URL` | Base for tracking links. Usually the same host; may be a short domain |
| `APP_ENCRYPTION_KEY` | 32 bytes, base64. `openssl rand -base64 32` |
| `IP_HASH_SECRET` | 32 bytes, base64. `openssl rand -base64 32` |

`NEXT_PUBLIC_*` values are **inlined at build time**, including into server
bundles. Changing one requires a rebuild, not just a restart.

### The two keys

`APP_ENCRYPTION_KEY` encrypts MFA seeds, webhook signing secrets, OAuth tokens
and tax identifiers with AES-256-GCM. **Rotating it makes existing encrypted
values unreadable** — publishers would lose MFA and webhook secrets would stop
matching. Rotation means re-encrypting with both keys available.

`IP_HASH_SECRET` salts the pseudonymous identifiers derived from IP addresses.
Rotating it deliberately breaks historical correlation: duplicate detection
starts fresh. That is a privacy feature, and a reasonable thing to do on a
schedule.

## Integrations

Each one is optional. The admin **System health** screen shows which are
configured, and the product tells a user plainly when a feature is off rather
than failing mysteriously.

### Payments — Stripe

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Server-side API key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Card entry in the browser |
| `STRIPE_WEBHOOK_SECRET` | Verifies `/api/webhooks/stripe` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Verifies Connect events, if routed separately |
| `STRIPE_CONNECT_CLIENT_ID` | Only for `standard` Connect accounts |
| `STRIPE_CONNECT_ACCOUNT_TYPE` | `express` (default), `standard` or `custom` |

Without these: brands cannot add funds, publishers cannot onboard or withdraw,
and both screens say so. Campaigns, tracking and earnings still work against
balances an administrator credits.

The `sk_live_`/`sk_test_` prefix determines whether the deployment issues
`pk_live_` or `pk_test_` API keys, so a test deployment cannot mint keys that
look production-grade.

### Email

| Variable | Purpose |
| --- | --- |
| `EMAIL_PROVIDER` | `resend`, `postmark`, `sendgrid`, `smtp` or `console` |
| `EMAIL_API_KEY` | For the API providers |
| `EMAIL_FROM` | Sender, e.g. `"Promotr <no-reply@example.com>"` |
| `EMAIL_REPLY_TO` | Optional |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | For `smtp` |

`console` writes rendered emails to the server log — right for development,
wrong for production. Without a provider, notifications still appear in-app and
the send job retries; nothing is silently dropped, but verification and password
reset emails will not arrive, so this is effectively required for a real launch.

### Object storage — any S3-compatible service

| Variable | Purpose |
| --- | --- |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | Where objects live |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Credentials |
| `S3_PUBLIC_URL` | CDN or public bucket URL for reading |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO/R2, `false` for AWS S3 |

Without it: creative uploads are refused with a clear message, and CSV exports
are held in memory and served directly by the application. That works for
small deployments but does not survive a restart, and does not work across
instances.

### Error monitoring — Sentry

`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`,
`SENTRY_TRACES_SAMPLE_RATE`. Reported through Sentry's envelope API over
`fetch`, with no SDK dependency. Without it, errors go to the structured log.

### Google sign-in

`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`. Without them the
"Continue with Google" button is not rendered at all — it is not shown broken.

Authorised redirect URI: `{NEXT_PUBLIC_APP_URL}/api/auth/google/callback`.

Signing in with Google matches an existing account on the **verified** email
address and links the provider to it; an unverified Google address is refused.
A new account created this way is a publisher — brands sign up through the form,
because a brand account names a legal entity and that is not something to infer
from an OAuth profile.

### URL screening

`SAFE_BROWSING_API_KEY`. When set, campaign destinations are screened for
malware and phishing during moderation. When unset, that check is skipped and
the campaign is routed to manual review instead — the check is never silently
assumed to have passed.

### Redis

`REDIS_URL`. Used for rate limiting, redirect caching and click deduplication.
Without it, an in-process implementation is used: correct on one instance,
per-instance across several. Strongly recommended in production, and required
if you run more than one instance.

## Branding

Every one of these is optional and has a default. None of them is hard-coded
anywhere in the source.

| Variable | Default |
| --- | --- |
| `NEXT_PUBLIC_BRAND_NAME` | `Promotr` |
| `NEXT_PUBLIC_BRAND_TAGLINE` | `Get paid to drive traffic.` |
| `NEXT_PUBLIC_BRAND_LEGAL_NAME` | `Promotr, Inc.` |
| `NEXT_PUBLIC_BRAND_SUPPORT_EMAIL` | `support@example.com` |
| `NEXT_PUBLIC_BRAND_LOGO_URL` | built-in mark |
| `NEXT_PUBLIC_BRAND_PRIMARY_HSL` | `243 75% 59%` |

## Tuning

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORKER_CONCURRENCY` | `5` | Jobs a worker claims per tick |
| `WORKER_POLL_INTERVAL_MS` | `1000` | Idle poll interval |
| `CRON_SECRET` | — | Protects `/api/cron/tick`. Without it that endpoint is disabled |
| `CLICK_RETENTION_DAYS` | `180` | Raw click/impression retention. Aggregates are kept regardless |
| `TRUST_PROXY` | `true` | Trust `X-Forwarded-For`. **Turn this off if the server is directly exposed** — otherwise a client can spoof its address and defeat rate limiting and fraud detection |
| `TRUSTED_PROXY_CIDRS` | — | Additional trusted proxy ranges |
| `DIRECT_DATABASE_URL` | — | Non-pooled connection for migrations when `DATABASE_URL` points at PgBouncer |

## Not environment variables

Fees, payout thresholds, fraud thresholds, verification requirements and limits
are **platform settings**, stored in the database and editable in
**Admin → Settings** without a deploy. They are not environment variables on
purpose: an operator changing a fee should not require a release.

## Verifying configuration

```bash
npm run verify          # typecheck, tests, build
curl localhost:3000/api/health
```

`/api/health` reports which integrations are configured (booleans only — never
values), and returns 503 only when the database is unreachable. A missing
Stripe key means payments are off, not that the instance should be pulled from
the load balancer.
