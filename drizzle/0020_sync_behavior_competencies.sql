CREATE TABLE IF NOT EXISTS "sync_behavior_competencies" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" varchar(10) NOT NULL,
  "employee_id" varchar(20) NOT NULL,
  "rekomendasi_name" varchar(255),
  "keterangan" text,
  "tgl_pelaksanaan" timestamp with time zone,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_sync_behavior_company_employee" ON "sync_behavior_competencies" ("company_id", "employee_id");
CREATE INDEX IF NOT EXISTS "idx_sync_behavior_company" ON "sync_behavior_competencies" ("company_id");
