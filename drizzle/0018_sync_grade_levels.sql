CREATE TABLE IF NOT EXISTS "sync_grade_levels" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" varchar(10) NOT NULL,
  "level_id" varchar(20) NOT NULL,
  "level_name" varchar(200),
  "grade_id" varchar(20) NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_sync_grade_levels" ON "sync_grade_levels" ("company_id", "level_id", "grade_id");
CREATE INDEX IF NOT EXISTS "idx_sync_grade_levels_company" ON "sync_grade_levels" ("company_id");
