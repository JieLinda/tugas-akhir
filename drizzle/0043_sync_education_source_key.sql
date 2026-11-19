-- sync_education was the only sync table without a natural key: education-sync
-- did DELETE-then-INSERT per employee. Two problems with that:
--   1. It is not an upsert — every sync churns row ids even when nothing changed.
--   2. An empty/failed API response deleted that employee's rows outright, so a
--      transient upstream blip silently destroyed education history (which feeds
--      the AHP education aspect score).
--
-- Give it a deterministic source_key so it can ON CONFLICT DO UPDATE like every
-- other sync. md5 rather than the plain colon-composite used elsewhere because
-- institution_name alone is varchar(300) and would overflow a readable key.
ALTER TABLE "sync_education" ADD COLUMN IF NOT EXISTS "source_key" varchar(32);
--> statement-breakpoint

-- Backfill. Must match the TS builder in education-sync.ts exactly: parts joined
-- with ':', NULLs as empty string, numbers as text.
UPDATE "sync_education"
SET "source_key" = md5(
  coalesce("company_id", '') || ':' ||
  coalesce("employee_id", '') || ':' ||
  coalesce("education_level", '') || ':' ||
  coalesce("education_field", '') || ':' ||
  coalesce("institution_name", '') || ':' ||
  coalesce("start_year"::text, '') || ':' ||
  coalesce("end_year"::text, '')
)
WHERE "source_key" IS NULL;
--> statement-breakpoint

-- Collapse pre-existing duplicates (delete+insert history could produce them)
-- keeping the lowest id, otherwise the unique index below cannot be created.
DELETE FROM "sync_education" a
USING "sync_education" b
WHERE a."source_key" = b."source_key"
  AND a."id" > b."id";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_sync_education_source_key"
  ON "sync_education" ("source_key");
