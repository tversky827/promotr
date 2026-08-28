-- Demo accounts.
--
-- The product ships a walkthrough: a creator and a brand that can be switched
-- between without signing in, so the two-sided flow can be shown end to end.
-- Those accounts are real rows going through the real code paths — the ledger,
-- tracking and budget logic are the production ones — but they must never be
-- able to reach a payment provider. This flag is what the money rails check.
--
-- Defaulting to false means an existing database gains no demo accounts by
-- applying this migration.

ALTER TABLE "users" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "brands" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "creators" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- The role switcher looks a demo user up by role on every switch. Kept as a
-- plain index rather than a partial one so it matches what @@index declares,
-- which is what keeps `prisma migrate diff` quiet.
CREATE INDEX "users_isDemo_role_idx" ON "users" ("isDemo", "role");
