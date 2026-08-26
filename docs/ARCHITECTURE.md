# Architecture

## Shape

One Next.js application, one PostgreSQL database, one worker process.

```
                         ┌──────────────────────────────┐
   visitor ──/go/:code──►│                              │
                         │      Next.js application     │──► PostgreSQL
   brand ─────────────── │  (App Router, RSC, actions,  │      ▲
   publisher ─────────── │   route handlers)            │      │
   admin ─────────────── │                              │◄─────┼── Redis (optional)
                         └──────────────┬───────────────┘      │
                                        │ enqueue              │
                                 ┌──────▼───────┐              │
   Stripe ──webhook────────────► │    jobs      │──────────────┘
                                 │   (worker)   │──► email / S3 / webhooks
                                 └──────────────┘
```

There is no separate API service. Route handlers serve the public API and the
tracking endpoints; server actions serve the application's own mutations. Both
call the same library functions, so there is one implementation of each rule and
one place to test it.

## Layers

```
src/app/          routes: pages, route handlers, the redirect
src/components/   presentation only
src/server/actions/  transport: CSRF, schema validation, session, audit
src/lib/          the product: money, ledger, tracking, fraud, jobs, payments
prisma/           schema and migrations
tests/            unit, integration and end-to-end suites
```

The rule that keeps this honest: **business logic lives in `src/lib`, never in a
route or an action.** A server action parses input, resolves who is asking,
calls a library function, writes an audit record and returns a typed result. It
does not decide whether a publisher may have a link or whether a campaign may
launch — `issueTrackingLink` and `launchDecision` decide that, and the tests
call them directly.

## Request paths

**The redirect** (`/go/:code`) is the hottest path and the most latency
sensitive: a visitor is waiting. It resolves the link from a short-lived cache,
issues the redirect immediately, and does everything else — fraud scoring,
click recording, earning accrual — in an `after()` hook once the response is
already on its way. A slow fraud check therefore cannot slow down a visitor,
and a failed one cannot break a redirect.

**Conversion reporting** (`/api/v1/conversions`, `/api/postback`, `/px/c`) is
authenticated by API key, deduplicated on `(campaign_id, conversion_id)`, and
answers 200 for a duplicate rather than an error, because the caller retrying is
the correct behaviour and punishing it produces double-charging.

**Application pages** are server components that query the database directly.
Dashboards read `stat_hourly`, never raw click partitions.

## Data flow of one earning

1. A click arrives; the redirect resolves the link and answers.
2. The fraud engine scores the click and returns a decision: bill, hold, or
   refuse.
3. For a cost-per-click campaign, the earning accrues immediately; for the
   others it waits for a conversion.
4. Accrual takes a row lock on the campaign budget, checks that funds remain,
   reserves the gross amount (publisher payout + platform fee), and posts a
   balanced ledger transaction.
5. The earning sits `PENDING` until the campaign's approval window passes, then
   `APPROVED`, then becomes withdrawable when the hold elapses.
6. A payout moves the balance into a clearing account, and the provider's
   webhook — not the API call that started it — settles or reverses it.

Each step is idempotent and each writes to the ledger only through `post()`,
which refuses any transaction whose debits and credits do not match.

## Background work

A single `jobs` table, claimed with `FOR UPDATE SKIP LOCKED`, so any number of
workers can run without coordination. Jobs retry with exponential backoff and
dead-letter after a bounded number of attempts rather than retrying forever.
Recurring work (rollups, retention, payout processing, reconciliation) is
enqueued by the worker itself with an idempotency key derived from the time
bucket, so three workers scheduling the same hour produce one job.

Deployments that cannot run a long-lived process can drive the same queue
through `/api/cron/tick` on a scheduler. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Scale

The design target is ten million clicks a month on ordinary hardware.

- `clicks` and `impressions` are range-partitioned by month. Retention is a
  partition drop, which is instant, rather than a delete of millions of rows.
- Dashboards read hourly rollups. A thirty-day chart reads a few hundred rows
  instead of tens of millions.
- The redirect's link lookup is cached for 30 seconds, so a viral link resolves
  from memory.
- Rate limiting and dedupe use Redis when configured, and an in-process
  fallback when not — correct on one instance, and honest about being
  per-instance when there are several.

## Failure behaviour

| When this fails | The system does this |
| --- | --- |
| Redis | Falls back to in-process limits; nothing is denied |
| Fraud scoring | Click is recorded; the safe direction is "no evidence" |
| Email provider | Notification is stored in-app; the job retries |
| Object storage | Exports serve directly from the app |
| Stripe | Money movements refuse with a clear message; nothing is faked |
| A worker crash | Claimed jobs are reclaimed after the stall timeout |

Nothing degrades into pretending. Where a capability is unavailable, the UI says
so and the action refuses; it never reports success it cannot back.

## Why these choices

**Postgres for analytics, not a warehouse.** Partitioning plus hourly rollups
covers the target volume with one database to operate and back up. A dedicated
event store would be the right call an order of magnitude later; adding it now
would be infrastructure without a problem.

**A ledger rather than balance columns.** Balances that are updated in place
cannot be audited and drift silently. Here a balance is a cached total that is
continuously checked against the sum of its entries, and drift is an alert.

**Micros rather than cents.** Cost-per-click pricing is routinely sub-cent.
Storing cents would force rounding on every click, and a tenth of a cent lost
per click is real money at scale, taken from publishers.

**Server actions rather than a REST layer for our own UI.** The public API is
versioned and stable for brands; the application's own mutations do not need to
be, and giving them their own transport would duplicate every validation rule.
