-- ============================================================================
-- Hand-written DDL: objects Prisma's schema language cannot express.
--
-- IMPORTANT (see docs/DATABASE.md § "Hand-managed database objects"):
-- Prisma does not model functions, triggers or partitions. They are safe across
-- `prisma migrate dev`. The GIN indexes at the bottom ARE visible to Prisma's
-- differ; if a future `migrate dev` emits a DROP INDEX for one of them, re-add
-- it in that same migration rather than accepting the drop.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Partition management for the high-volume tracking tables.
--    Monthly RANGE partitions on "createdAt". A DEFAULT partition catches rows
--    that fall outside provisioned ranges so an insert can never fail.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ensure_time_partitions(
  parent_table text,
  months_back  int DEFAULT 1,
  months_ahead int DEFAULT 3
) RETURNS int AS $$
DECLARE
  i           int;
  part_start  date;
  part_end    date;
  part_name   text;
  created     int := 0;
BEGIN
  FOR i IN -months_back..months_ahead LOOP
    part_start := date_trunc('month', (now() AT TIME ZONE 'UTC') + (i || ' month')::interval)::date;
    part_end   := (part_start + interval '1 month')::date;
    part_name  := format('%s_p%s', parent_table, to_char(part_start, 'YYYYMM'));

    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        part_name, parent_table, part_start, part_end
      );
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END;
$$ LANGUAGE plpgsql;

-- Drops whole partitions older than the retention horizon. Dropping a partition
-- is O(1) metadata work, unlike a bulk DELETE which would bloat the table.
CREATE OR REPLACE FUNCTION drop_old_partitions(
  parent_table text,
  older_than_days int
) RETURNS TABLE(dropped text) AS $$
DECLARE
  cutoff date := (date_trunc('month', (now() AT TIME ZONE 'UTC') - (older_than_days || ' day')::interval))::date;
  r      record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits inh ON inh.inhrelid = c.oid
    JOIN pg_class p ON p.oid = inh.inhparent
    WHERE p.relname = parent_table
      AND c.relname ~ '_p[0-9]{6}$'
      AND to_date(right(c.relname, 6), 'YYYYMM') < cutoff
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I', r.relname);
    dropped := r.relname;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS clicks_default PARTITION OF "clicks" DEFAULT;
CREATE TABLE IF NOT EXISTS impressions_default PARTITION OF "impressions" DEFAULT;
SELECT ensure_time_partitions('clicks', 2, 6);
SELECT ensure_time_partitions('impressions', 2, 6);

-- ---------------------------------------------------------------------------
-- 2. Ledger integrity. The ledger is the financial source of truth, so the
--    invariants are enforced by the database, not only by application code.
-- ---------------------------------------------------------------------------

-- 2a. Entries are append-only. Corrections must be new offsetting entries.
CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries is append-only (attempted % on entry %). Post an offsetting entry instead.',
    TG_OP, COALESCE(OLD.id::text, '?');
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

-- 2b. Every transaction must balance: sum(debits) = sum(credits).
--     Deferred to commit so a transaction can be assembled entry by entry.
CREATE OR REPLACE FUNCTION ledger_transaction_balanced() RETURNS trigger AS $$
DECLARE
  debits  bigint;
  credits bigint;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN direction = 'DEBIT'  THEN "amountMicros" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountMicros" ELSE 0 END), 0)
  INTO debits, credits
  FROM "ledger_entries"
  WHERE "transactionId" = NEW."transactionId";

  IF debits <> credits THEN
    RAISE EXCEPTION
      'unbalanced ledger transaction %: debits=% credits=%',
      NEW."transactionId", debits, credits;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_transaction_balanced();

-- 2c. Amounts are strictly positive; direction carries the sign.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT ledger_entries_amount_positive CHECK ("amountMicros" > 0);

-- ---------------------------------------------------------------------------
-- 3. Budget invariants. Application code takes a row lock before spending, but
--    the database refuses to record an overspend regardless of code paths.
-- ---------------------------------------------------------------------------

ALTER TABLE "campaign_budgets"
  ADD CONSTRAINT campaign_budget_non_negative CHECK (
    "fundedMicros"   >= 0 AND
    "reservedMicros" >= 0 AND
    "spentMicros"    >= 0
  );

ALTER TABLE "campaign_budgets"
  ADD CONSTRAINT campaign_budget_within_funding CHECK (
    "reservedMicros" + "spentMicros" <= "fundedMicros"
  );

-- Earnings arithmetic must be internally consistent.
ALTER TABLE "earnings"
  ADD CONSTRAINT earnings_amounts_consistent CHECK (
    "grossMicros" >= 0 AND "feeMicros" >= 0 AND "netMicros" >= 0
    AND "netMicros" + "feeMicros" = "grossMicros"
  );

ALTER TABLE "payouts"
  ADD CONSTRAINT payouts_amount_positive CHECK ("amountMicros" > 0 AND "amountCents" > 0);

ALTER TABLE "conversions"
  ADD CONSTRAINT conversions_amounts_non_negative CHECK (
    "revenueMicros" >= 0 AND "payoutMicros" >= 0 AND "feeMicros" >= 0
  );

ALTER TABLE "campaigns"
  ADD CONSTRAINT campaigns_payout_non_negative CHECK (
    "payoutMicros" >= 0 AND "revshareBps" >= 0 AND "revshareBps" <= 10000
  );

ALTER TABLE "brand_deposits"
  ADD CONSTRAINT brand_deposits_refund_within_amount CHECK (
    "refundedMicros" >= 0 AND "refundedMicros" <= "amountMicros"
  );

-- ---------------------------------------------------------------------------
-- 4. Full-text and fuzzy search indexes.
-- ---------------------------------------------------------------------------

CREATE INDEX campaigns_search_idx ON "campaigns"
  USING GIN (to_tsvector('english',
    coalesce(name,'') || ' ' || coalesce(description,'') || ' ' ||
    coalesce("offerSummary",'') || ' ' || coalesce(category,'')));

CREATE INDEX campaigns_name_trgm_idx ON "campaigns" USING GIN (name gin_trgm_ops);

CREATE INDEX creator_profiles_search_idx ON "creator_profiles"
  USING GIN (to_tsvector('english',
    coalesce("displayName",'') || ' ' || coalesce(bio,'')));

CREATE INDEX brands_search_idx ON "brands"
  USING GIN (to_tsvector('english',
    coalesce("displayName",'') || ' ' || coalesce("legalName",'') || ' ' || coalesce(category,'')));

-- Partial index: the payout worker only ever scans approved, unpaid earnings.
CREATE INDEX earnings_payable_idx ON "earnings" ("creatorId", "availableAt")
  WHERE status = 'AVAILABLE' AND "payoutId" IS NULL;

-- Partial index: the job runner only scans runnable jobs.
CREATE INDEX jobs_runnable_idx ON "jobs" ("queue", "runAt")
  WHERE status = 'QUEUED';
