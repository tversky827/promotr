# Promotr

A performance marketplace. Brands post campaigns that pay for results; creators
and publishers take a tracking link in seconds and earn on the traffic,
leads, sales or installs they actually deliver.

No negotiation, no manual matching, no invoices. A campaign is live once it is
funded; a publisher who meets its terms gets a link immediately; every click and
conversion is priced, recorded in a double-entry ledger, and paid out.

```
Brand funds a campaign  →  Publisher takes a link  →  Visitor clicks
        ↓                                                   ↓
  Budget escrowed                                    Click priced & recorded
        ↓                                                   ↓
  Conversion reported  →  Earning accrued  →  Hold elapses  →  Payout
```

## What is here

This is a complete application, not a scaffold. It has:

- **Tracking** — a redirect service with click deduplication, geo and channel
  eligibility, and four ways for a brand to report conversions (JavaScript SDK,
  image pixel, server-to-server postback, REST API).
- **A double-entry ledger** — every movement of money is a balanced transaction
  in append-only entries, enforced by database triggers rather than by
  convention. Balances are derived and continuously reconciled.
- **Exact money arithmetic** — integers throughout, in millionths of a currency
  unit, so a $0.0025 cost-per-click is exact rather than rounded. No floating
  point touches money anywhere in the codebase.
- **Budget solvency** — a campaign cannot spend past what it holds. Enforced by
  a row lock *and* by a database CHECK constraint, so two simultaneous
  conversions cannot overspend even if application code is bypassed.
- **A fraud engine that explains itself** — every flag lists the signals that
  produced it, in words a person can act on. Flags hold earnings for review;
  they never delete them.
- **Payouts** — Stripe Connect onboarding, eligibility gates, and a payout that
  reverses cleanly in full if the transfer fails.
- **Brand, publisher and admin applications** — campaign building and funding,
  link management and earnings, and an operator console covering moderation,
  fraud, payouts, disputes, the ledger and platform settings.

## Getting started

Requirements: Node 22+, PostgreSQL 16+ (14 works), and optionally Redis.

```bash
npm install
cp .env.example .env          # then fill in the REQUIRED values
openssl rand -base64 32       # APP_ENCRYPTION_KEY
openssl rand -base64 32       # IP_HASH_SECRET

npm run db:migrate            # create the schema
npm run db:seed               # optional: 5 brands, 20 publishers, 15 campaigns
npm run dev                   # http://localhost:3000
npm run worker                # in a second terminal: background jobs
```

The seed prints sign-in credentials for a brand, a publisher and an
administrator. It refuses to run against any database that holds real financial
activity.

No third-party keys are needed to run and explore the product. Features that
require them — payments, payouts, email, file storage — report themselves as
not configured rather than pretending to work. See
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (runs `prisma generate` first) |
| `npm start` | Serve the production build |
| `npm run worker` | Background job worker — required in production |
| `npm test` | Full test suite (needs a PostgreSQL test database) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run verify` | typecheck + tests + build, the pre-deploy gate |
| `npm run db:migrate` | Apply migrations in development |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:seed` | Development seed data |
| `npm run db:reset` | Drop, re-migrate and re-seed |

## Documentation

| Document | Covers |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system fits together, and why |
| [DATABASE.md](docs/DATABASE.md) | Schema, money representation, partitioning |
| [API.md](docs/API.md) | Public REST API, tracking endpoints, webhooks |
| [PAYMENTS.md](docs/PAYMENTS.md) | The ledger, fees, budgets, payouts, edge cases |
| [FRAUD.md](docs/FRAUD.md) | Signals, scoring, what a flag does and does not do |
| [SECURITY.md](docs/SECURITY.md) | Authentication, authorisation, privacy, secrets |
| [ENVIRONMENT.md](docs/ENVIRONMENT.md) | Every environment variable |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Running it in production |
| [LAUNCH.md](docs/LAUNCH.md) | What to do before taking real money |

## Stack

Next.js 16 (App Router, server components, server actions) · React 19 ·
TypeScript · PostgreSQL 16 with Prisma · Redis (optional) · Stripe Connect ·
Tailwind CSS · Vitest.

Dependencies are deliberately few. Password hashing, TOTP, S3 signing, SMTP,
error reporting and charts are implemented against Node's standard library and
the platforms' documented HTTP APIs rather than pulled in as packages, because
each dependency in a payments codebase is a supply-chain liability. `npm audit`
reports zero vulnerabilities.

## Rebranding

Nothing about the name is hard-coded. `NEXT_PUBLIC_BRAND_*` controls the name,
tagline, legal entity, support address, logo and accent colour;
`NEXT_PUBLIC_TRACKING_URL` lets tracking links live on a separate short domain.
See `src/lib/brand.ts`.

## Licence

No licence is granted. All rights reserved by the copyright holder.
