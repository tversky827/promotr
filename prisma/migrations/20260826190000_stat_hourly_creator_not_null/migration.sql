-- stat_hourly."creatorId" becomes NOT NULL.
--
-- Every source row the rollup reads (clicks, impressions, conversions,
-- earnings) carries a publisher, so a NULL here was never legitimate data. It
-- was actively harmful: Postgres treats NULLs as distinct in a unique index, so
-- the rollup's ON CONFLICT (bucket, "campaignId", "creatorId") could never match
-- a NULL-publisher row and every re-run would insert a duplicate instead of
-- recomputing it — silently double-counting dashboards.
--
-- Any pre-existing NULL rows are aggregates that cannot be attributed to a
-- publisher; they are deleted rather than guessed at, and the next rollup pass
-- recomputes those hours from the source tables.
DELETE FROM "stat_hourly" WHERE "creatorId" IS NULL;

ALTER TABLE "stat_hourly" ALTER COLUMN "creatorId" SET NOT NULL;
