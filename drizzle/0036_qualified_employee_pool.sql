-- Job Family GLOBAL filter result — the qualified employee pool.
-- Distinct from program_templates' per-scoring-run hard filters: this is a
-- project-wide pre-qualification layer. One row per employee_id (NIK) that
-- passes the global-default filter rules, INCLUDING employees not yet in
-- `candidates` (the universe is candidates ⟕ sync_employees). Re-running the
-- filtering "sync" upserts by employee_id and prunes rows that no longer pass.
-- Idempotent (safe to re-run).
CREATE TABLE IF NOT EXISTS "qualified_employee_pool" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"candidate_id" uuid,
	"is_candidate" boolean DEFAULT false NOT NULL,
	"tenant_id" uuid,
	"company_id" varchar(20),
	"name" varchar(255),
	"current_position" varchar(400),
	"grade" varchar(20),
	"attributes" jsonb,
	"passed_rules" jsonb,
	"scope_tenant_ids" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qualified_employee_pool"
   ADD CONSTRAINT "qualified_employee_pool_candidate_id_candidates_id_fk"
   FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_qualified_employee_pool_employee" ON "qualified_employee_pool" ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qualified_employee_pool_tenant" ON "qualified_employee_pool" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qualified_employee_pool_candidate" ON "qualified_employee_pool" ("candidate_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qualified_employee_pool_is_candidate" ON "qualified_employee_pool" ("is_candidate");
