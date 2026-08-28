# Database

PostgreSQL 16 (14 is sufficient), accessed through Prisma. 43 models. The schema
is `prisma/schema.prisma`; migrations are in `prisma/migrations` and are applied
with `npm run db:deploy`.

## Money

**Every monetary column is a `BIGINT` holding micros — millionths of a currency
unit.**

```
$1.00      = 1_000_000 micros
$0.25      =   250_000 micros
$0.0025    =     2_500 micros   (a quarter-cent cost-per-click, exact)
```

Cents are not fine enough. Cost-per-click campaigns are routinely priced below a
cent, and storing cents would round every single click. A tenth of a cent per
click, over ten million clicks, is ten thousand dollars — taken from publishers,
silently, by a data type.

Rounding happens exactly once: at the boundary with the payment provider, which
transacts in cents. `splitToCents()` performs that conversion and returns the
remainder, which stays in the publisher's balance rather than disappearing.
There is a test that asserts the dust is retained.

No floating point value is ever used for money. `src/lib/money.ts` is the only
module that does monetary arithmetic.

## The ledger

Three tables carry every movement of money.

- **`ledger_accounts`** — one row per (type, owner). A brand's deposit balance, a
  campaign's escrow, a publisher's pending and available balances, and the
  platform's own revenue, clearing and settlement accounts.
- **`ledger_transactions`** — one row per event, with an idempotency key.
- **`ledger_entries`** — the debits and credits. Append-only.

Four invariants are enforced by the database, not by application code:

| Invariant | Enforced by |
| --- | --- |
| Entries are never updated or deleted | `ledger_entries_immutable()` trigger |
| Every transaction balances | deferred constraint trigger checking sum(debits) = sum(credits) at commit |
| No transaction is posted twice | unique index on `ledger_transactions.idempotencyKey` |
| A campaign cannot overspend its funding | `campaign_budget_within_funding` CHECK |

Application-level protection can be bypassed by a bad migration, a console
session, or a bug. These cannot. The test suite includes a case that tries to
overspend a budget with raw SQL and asserts that the database refuses it.

`ledger_accounts.ownerId` is `NOT NULL` with an empty-string default rather than
nullable. Postgres treats NULLs as distinct in a unique index, so a nullable
owner would silently permit two "platform revenue" accounts.

## Partitioned tables

`clicks` and `impressions` are `PARTITION BY RANGE ("createdAt")`, one partition
per month.

- The primary key is `(id, createdAt)` — Postgres requires the partition key in
  every unique index.
- Neither table has an inbound foreign key. That is deliberate: it lets a
  partition be dropped in O(1) when it ages out. Referential integrity for
  these rows is maintained by the application, which is the trade a
  time-series table makes.
- `ensure_time_partitions()` creates the next months ahead of time; it runs as
  a scheduled job and is idempotent.
- `drop_old_partitions()` implements retention (`CLICK_RETENTION_DAYS`).
  Aggregate statistics survive the drop, so history is preserved without
  keeping the raw rows.

## Rollups

`stat_hourly` holds one row per (hour, campaign, publisher) with clicks,
qualified clicks, unique visitors, impressions, conversions and money. Every
dashboard reads it.

The aggregation recomputes an hour from source rather than incrementing, so
re-running it after a partial failure heals rather than double-counts. Both key
columns are `NOT NULL`: a nullable publisher would break `ON CONFLICT`
matching — Postgres treats NULLs as distinct — and every rollup pass would have
inserted a duplicate instead of updating.

A click held for fraud review counts as qualified, because the campaign's budget
is reserved against it either way.

## Idempotency

Four separate mechanisms, because they protect different things:

| Where | Key | Protects against |
| --- | --- | --- |
| Ledger | `ledger_transactions.idempotencyKey` | double-posting money |
| Conversions | `(campaignId, externalId)` | double-charging a brand |
| Jobs | `jobs.idempotencyKey` | duplicate scheduled work |
| Inbound webhooks | `stripe_events.id` | replayed provider events |

## Indexes worth knowing about

- Full-text search on campaigns and publisher profiles uses GIN indexes over
  generated `tsvector` columns. Prisma's schema differ cannot see them, so they
  are created in a hand-written migration — if a future migration drops them,
  they must be re-added. The migration header says so.
- Partial indexes cover the hot queues: unresolved fraud events, queued jobs,
  pending payouts, open disputes.
- Every foreign key used in a list view has a covering index; the click table is
  indexed by campaign, publisher and time.

## Migrations

```bash
npm run db:migrate      # development: create and apply
npm run db:deploy       # production: apply only
npm run db:reset        # drop everything and start over (development only)
```

Two migrations are hand-edited rather than generated: the partitioning
statements and the integrity triggers. Both are annotated in place explaining
what they do and what would break if a later migration dropped them.

Check for drift between the schema file and a live database:

```bash
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma \
                        --to-schema-datasource prisma/schema.prisma
```

The generated-column and GIN index definitions show up as expected differences.

## Seed data

`npm run db:seed` creates 5 brands, 20 publishers, 15 campaigns and several
thousand clicks, conversions and earnings — all through the real ledger and
budget code paths, so balances are internally consistent.

Every seeded account uses the `seed.audicents.test` email domain. The script
refuses to run if `NODE_ENV=production` (unless explicitly overridden), if any
payout or settled deposit exists, or if any non-seed user account is present. It
cannot clear a previous run once that run has posted to the ledger — entries are
append-only and that invariant has no dev-mode exception — so it directs you to
`npm run db:reset` instead.

## Backups

Point-in-time recovery, tested by restoring. The ledger is the record of what
the platform owes; a backup that has never been restored is a hypothesis. See
[DEPLOYMENT.md](DEPLOYMENT.md).
