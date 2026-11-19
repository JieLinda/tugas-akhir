-- Talent Management 5-Box succession module (Stage 1 + Stage 2).
--
-- Six tables:
--   talent_data_staging        — unified per-employee talent data (merged from
--                                sync_employees / sync_performance_appraisals /
--                                sync_assessment_center / sync_technical_competencies /
--                                sync_talent_mapping_history / sync_rtc_history) plus
--                                the engine's computed scores & box and the validation
--                                state. Keyed by (tenant_id, employee_id).
--   talent_audit_logs          — every box change (override) with mandatory
--                                justification when the box differs from the system's.
--   talent_box_configs         — tenant-scoped thresholds & weights (editable).
--   sync_talent_mapping_history— EDP past Talent Mapping records.
--   sync_rtc_history           — EDP RTC (readiness) records.
--   sync_assessment_center     — SDP/Orange Assessment Center scores.
--
-- This file is written by hand because `pnpm db:generate` is unusable in this
-- repo (drizzle/meta/_journal.json stops at 0005). Apply with:
--   tsx scripts/apply-sql.ts drizzle/0055_talent_succession.sql
-- (or psql:  psql $DATABASE_URL -f drizzle/0055_talent_succession.sql)

CREATE TABLE IF NOT EXISTS "talent_data_staging" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "employee_id" varchar(20) NOT NULL,
  "company_id" varchar(10),
  "name" varchar(200),
  "department" varchar(200),
  "division" varchar(200),
  "position_title" varchar(300),
  "grade_id" varchar(20),
  "entry_date" date,
  "pa_current_year" varchar(10),
  "pa_year1" varchar(10),
  "pa_year2" varchar(10),
  "past_talent_mapping" varchar(30),
  "past_talent_mapping_year" integer,
  "rtc_count" integer DEFAULT 0 NOT NULL,
  "rtc_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "assessment_center_score" numeric(5, 2),
  "assessment_center_date" timestamp with time zone,
  "competency_score" numeric(5, 2),
  "competency_count" integer DEFAULT 0 NOT NULL,
  "performance_score" numeric(5, 2),
  "potential_score" numeric(5, 2),
  "performance_level" varchar(10),
  "potential_level" varchar(10),
  "system_recommended_box" varchar(10),
  "missing_pa" boolean DEFAULT false NOT NULL,
  "missing_assessment" boolean DEFAULT false NOT NULL,
  "missing_competency" boolean DEFAULT false NOT NULL,
  "final_validated_box" varchar(10),
  "final_validated_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "final_validated_at" timestamp with time zone,
  "justification_reason" text,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_talent_data_staging_tenant_employee" ON "talent_data_staging" ("tenant_id", "employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_talent_data_staging_tenant_box" ON "talent_data_staging" ("tenant_id", "system_recommended_box");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_talent_data_staging_tenant_validated" ON "talent_data_staging" ("tenant_id", "final_validated_box");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_talent_data_staging_division" ON "talent_data_staging" ("division");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_talent_data_staging_employee" ON "talent_data_staging" ("employee_id");
--> statement-breakpoint
ALTER TABLE "talent_data_staging" ADD CONSTRAINT "talent_data_staging_box_check" CHECK ("system_recommended_box" IS NULL OR "system_recommended_box" IN ('TOP', 'STRONG', 'SOLID', 'BORDER', 'BOTTOM'));
--> statement-breakpoint
ALTER TABLE "talent_data_staging" ADD CONSTRAINT "talent_data_staging_validated_check" CHECK ("final_validated_box" IS NULL OR "final_validated_box" IN ('TOP', 'STRONG', 'SOLID', 'BORDER', 'BOTTOM'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "talent_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "employee_id" varchar(20) NOT NULL,
  "changed_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "old_box" varchar(10),
  "new_box" varchar(10) NOT NULL,
  "justification_reason" text,
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_talent_audit_tenant_timestamp" ON "talent_audit_logs" ("tenant_id", "timestamp");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_talent_audit_employee" ON "talent_audit_logs" ("employee_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "talent_box_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "performance_high" numeric(5, 2) NOT NULL,
  "performance_medium" numeric(5, 2) NOT NULL,
  "potential_high" numeric(5, 2) NOT NULL,
  "potential_medium" numeric(5, 2) NOT NULL,
  "pa_weights" jsonb NOT NULL,
  "potential_weights" jsonb NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_talent_box_configs_tenant" ON "talent_box_configs" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_talent_mapping_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" varchar(10),
  "employee_id" varchar(20) NOT NULL,
  "mapping_year" integer,
  "mapping_status" varchar(30),
  "note" text,
  "source_table" varchar(120),
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sync_talent_mapping_history" ON "sync_talent_mapping_history" ("company_id", "employee_id", "mapping_year");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_talent_mapping_employee" ON "sync_talent_mapping_history" ("employee_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_rtc_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" varchar(10),
  "employee_id" varchar(20) NOT NULL,
  "rtc_year" integer,
  "rtc_name" varchar(255),
  "rtc_status" varchar(50),
  "rtc_date" timestamp with time zone,
  "note" text,
  "source_table" varchar(120),
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sync_rtc_history" ON "sync_rtc_history" ("company_id", "employee_id", "rtc_year", "rtc_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_rtc_employee" ON "sync_rtc_history" ("employee_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_assessment_center" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" varchar(10),
  "employee_id" varchar(20) NOT NULL,
  "assessment_date" timestamp with time zone,
  "score" numeric(5, 2),
  "dimension" varchar(120),
  "rekomendasi_name" varchar(255),
  "source_table" varchar(120),
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_assessment_center_employee" ON "sync_assessment_center" ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_assessment_center_company_employee" ON "sync_assessment_center" ("company_id", "employee_id");
