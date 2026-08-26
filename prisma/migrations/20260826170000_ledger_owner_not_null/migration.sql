-- Singleton platform/external ledger accounts previously used NULL ownerId.
-- Postgres unique indexes treat NULLs as distinct, so that permitted duplicate
-- PLATFORM_REVENUE accounts. Collapse NULL to '' and make the column NOT NULL
-- so the unique constraint actually holds.
UPDATE "ledger_accounts" SET "ownerId" = '' WHERE "ownerId" IS NULL;
ALTER TABLE "ledger_accounts" ALTER COLUMN "ownerId" SET DEFAULT '';
ALTER TABLE "ledger_accounts" ALTER COLUMN "ownerId" SET NOT NULL;
