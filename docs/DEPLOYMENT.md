# Deployment

## What has to run

| Component | Required | Notes |
| --- | --- | --- |
| The web application | yes | Next.js, Node 22+ |
| PostgreSQL 14+ | yes | 16 recommended; the ledger lives here |
| A background worker | yes | Payouts, rollups, retention, email, webhooks |
| Redis | strongly recommended | Required if you run more than one instance |
| Object storage | recommended | Creative uploads and CSV exports |

The worker is not optional. Without it: earnings never move from approved to
available, payouts never process, dashboards never update, webhooks never
deliver, and click partitions are never created — which eventually stops clicks
being recordable at all.

Run it as a process (`npm run worker`), or, where you cannot, call
`/api/cron/tick` every minute from a scheduler with `CRON_SECRET`. The endpoint
drains what it can within one request; that is fine at low volume and not a
substitute for a worker under load.

## First deploy

```bash
npm ci
npx prisma migrate deploy        # never `migrate dev` in production
npm run build
npm start                        # and, separately, npm run worker
```

Then, in order:

1. Create the first administrator. There is no bootstrap back door: sign up
   normally, then promote the row.
   ```sql
   UPDATE users SET role = 'ADMIN' WHERE email = 'you@example.com';
   ```
2. Sign in and enable two-factor authentication. Administrator accounts cannot
   perform privileged actions without satisfying MFA in the current session.
3. Open **Admin → Settings** and set the platform fee, payout minimum and fraud
   thresholds for your market.
4. Open **Admin → System health** and confirm each integration reports as
   configured.
5. Point Stripe's webhooks at `/api/webhooks/stripe` and copy the signing
   secret into `STRIPE_WEBHOOK_SECRET`. **Payouts and deposits only settle on a
   verified webhook**, so a missing secret means money never lands.

## Platforms

### A free deployment, for an MVP

Enough to put a working URL in front of people, on free tiers, with no card.
Three parts: the application on a Next.js host, a hosted Postgres, and a
scheduler standing in for the worker.

The combination below is the one this codebase fits with no changes — Vercel for
the app, Neon for the database, GitHub Actions for the schedule. Any equivalent
works: Render or Railway for the app, Supabase or a small managed Postgres for
the database, cron-job.org for the schedule.

**1. Create the database.** On Neon, create a project and copy both connection
strings: the pooled one and the direct one. You need both — see `directUrl` in
`prisma/schema.prisma`. They differ only by `-pooler` in the hostname:

```
pooled  postgresql://user:pw@ep-name-123-pooler.region.aws.neon.tech/db?sslmode=require
direct  postgresql://user:pw@ep-name-123.region.aws.neon.tech/db?sslmode=require
```

Append `&pgbouncer=true&connection_limit=1` to the **pooled** one before using it
as `DATABASE_URL`. Neon's pooler runs PgBouncer in transaction mode, which does
not keep prepared statements between statements; without that flag Prisma
eventually fails with "prepared statement already exists" under concurrency.

**2. Apply the schema.** The host does it for you: `vercel-build` in
`package.json` runs `prisma migrate deploy` before building, and Vercel prefers
that script over `build`. Set the two database variables in step 3 and the first
deployment creates the schema.

Migrations then run on every deployment. They are idempotent, a failed one fails
the build rather than shipping code against the wrong schema, and Prisma takes an
advisory lock so two concurrent deployments cannot both apply. On a team with
many parallel deployments, drop the script and run migrations as a deliberate
step instead:

```bash
DATABASE_URL="<direct>" DIRECT_DATABASE_URL="<direct>" npx prisma migrate deploy
```

**3. Deploy the application.** Import the repository on Vercel. If the branch you
want is not the repository's default, set it under **Settings → Git → Production
Branch** before deploying. Then set:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the pooled connection string |
| `DIRECT_DATABASE_URL` | the direct connection string |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` — a fresh one, not the Compose value |
| `IP_HASH_SECRET` | `openssl rand -base64 32` — likewise |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | the deployment URL, no trailing slash |
| `NEXT_PUBLIC_TRACKING_URL` | the same |

The two `NEXT_PUBLIC_` values are compiled into the build, so set them once the
host has told you the URL and then **redeploy** — restarting is not enough.

**4. Schedule the background jobs.** There is no long-lived process on a
serverless host, so nothing releases matured earnings, refreshes dashboards,
processes payouts or creates next month's click partitions. Add the repository
secrets `APP_URL` and `CRON_SECRET` and enable
`.github/workflows/cron.yml`, which calls `/api/cron/tick` every ten minutes.
Any scheduler that can make an authenticated HTTPS request does the same job.

**5. Make yourself an administrator.** Sign up through the site, then:

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'you@example.com';
```

#### What is degraded on free tiers, and what to do about it

| Missing | Effect | Fix when it matters |
| --- | --- | --- |
| Redis | Rate limits are per instance rather than per cluster | Upstash has a free tier |
| Object storage | CSV exports are generated but held in memory, so the download usually 410s | Cloudflare R2 free tier |
| Email provider | No verification, reset or payout emails; notifications still appear in-app | Resend free tier |
| Stripe keys | No funding, no payouts — every money screen says so | Add test keys to exercise the flows |
| A database that sleeps | The first request after an idle period is slow | Expected on free Postgres |

#### Before you point anyone at that URL

- **Do not seed it.** Every seeded account shares one password published in this
  repository, including an administrator. The seed refuses to run against a
  non-local database for that reason; if you override it for a throwaway
  preview, change the administrator password before you share the link.
- Check the host's terms. Free tiers are commonly limited to non-commercial use,
  and taking real money on one is usually a breach — a working demo is fine, a
  live marketplace is not.
- Nothing here is a substitute for [LAUNCH.md](LAUNCH.md) before real money.

### Locally, with Compose

`docker-compose.yml` in the repository root runs the whole stack — Postgres,
migrations, seed data, the application and the worker — with `docker compose up`.
It is a development stack: it carries fixed keys so one command is enough, and
it seeds fake activity. Do not point it at anything real.

### A container platform (recommended)

Two processes from one image. `Dockerfile` in the repository root is the one the
Compose stack uses; for production, add `npm prune --omit=dev` after the build
so the Prisma CLI and the seed script do not ship:

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
```

Run the worker from the same image with `CMD ["npm", "run", "worker"]`. Scale
web instances horizontally; one or two workers is plenty at the volumes this is
designed for, and any number is safe — jobs are claimed with
`FOR UPDATE SKIP LOCKED`.

Health check: `GET /api/health`. It returns 503 only when the database is
unreachable. A missing Stripe key means payments are off, not that the instance
should be taken out of rotation.

### Vercel or similar

The application deploys as-is. Two things need attention:

- **No long-lived worker.** Add a cron entry calling `/api/cron/tick` every
  minute with the `CRON_SECRET`, and be aware of the platform's function
  timeout — the endpoint budgets 45 seconds.
- **Connection pooling.** Set `DATABASE_URL` to the pooled endpoint and
  `DIRECT_DATABASE_URL` to the direct one, which migrations use.

### A single server

Perfectly reasonable to start. Run Postgres, Redis, the app and the worker on
one machine behind a reverse proxy that terminates TLS. Set `TRUST_PROXY=true`
only because there is a proxy in front; if the Node process is directly exposed,
set it to `false` or clients can spoof their address and defeat rate limiting
and fraud detection.

## Migrations

`npx prisma migrate deploy` is forward-only and safe to run on every deploy. Two
migrations are hand-written (partitioning, integrity triggers) and are annotated
in place.

Deploy order matters when a migration changes a column the running code uses:
apply migrations first, then release code, and prefer additive changes so old
and new code can both run during the rollover.

Check for drift:

```bash
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma \
                        --to-schema-datasource prisma/schema.prisma
```

Generated columns and GIN indexes always appear as differences; anything else is
real drift.

## Backups

The ledger is the record of what you owe. Treat backups accordingly:

- Point-in-time recovery on, with at least 7 days of retention.
- Nightly logical dumps stored somewhere the application cannot reach, so a
  compromise of the app is not a compromise of the backups.
- **Restore one, on a schedule.** A backup that has never been restored is a
  hypothesis, not a backup.
- After any restore, run reconciliation from **Admin → System health** and
  confirm the ledger balances globally.

## Scheduled work

The worker schedules all of this itself; the table is here so you know what is
running.

| Job | Cadence | Purpose |
| --- | --- | --- |
| `analytics.rollup` | every minute | Dashboard figures, recomputing the last two hours |
| `earnings.release` | every minute | Approved earnings whose hold has elapsed become withdrawable |
| `budget.alert` | every 5 minutes | Low-balance notifications |
| `campaign.complete` | every 5 minutes | Campaigns past their end date |
| `fraud.recompute` | hourly | Publisher account risk scores |
| `payout.reconcile` | hourly | Provider payout state versus ours |
| `conversions.autoapprove` | hourly | Pending conversions past the approval window |
| `partitions.ensure` | hourly | Create next month's click partitions ahead of need |
| `ledger.reconcile` | daily | Cached balances versus the sum of entries |
| `retention.prune` | daily | Drop click partitions past retention |

`payout.process`, `export.generate`, `email.send` and `webhook.dispatch` are
enqueued by the action that needs them rather than on a schedule.

## Monitoring

Watch these, and alert on them:

| Signal | Why it matters |
| --- | --- |
| `ledger.drift_detected` | A balance disagrees with its entries. Investigate immediately |
| Global balance check failing | Debits no longer equal credits. Stop and investigate |
| Dead-lettered jobs | Work that will never complete on its own |
| Rollup age over two hours | Dashboards are stale; the worker may be down |
| Webhook endpoints auto-disabled | A brand has stopped receiving events |
| 5xx rate | Sentry, when configured |
| Database connections, replication lag, disk | The usual |

The status page at `/status` measures the same things from inside and is safe to
expose publicly — it reports capabilities, not infrastructure.

## Scaling

In the order the pressure usually arrives:

1. **Redis**, as soon as there is more than one web instance.
2. **A read replica** for reporting, if dashboards start competing with the
   write path.
3. **More workers** if the queue backs up. They coordinate through the database.
4. **Shorter click retention.** Dropping a partition is instant; aggregates are
   unaffected.
5. **A CDN** in front of static assets and the redirect, if traffic is
   geographically spread.

The redirect is the hot path. It resolves from a 30-second cache and defers
everything else past the response, so a viral link costs one cached lookup.

## Rollback

Code rolls back by redeploying the previous image. Migrations do not roll back
automatically, which is why additive changes matter. If a release must be
reverted after a destructive migration, restore from backup and replay — and
reconcile the ledger afterwards.

## Before you take real money

See [LAUNCH.md](LAUNCH.md). It is a checklist, not a formality.
