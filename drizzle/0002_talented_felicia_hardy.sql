CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid,
	"action" varchar(30) NOT NULL,
	"summary" varchar(500),
	"diff" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"filter_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_method" varchar(50) DEFAULT 'SAW' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scoring_runs" ALTER COLUMN "candidate_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "employee_id" varchar(100);--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "discipline_status" varchar(20) DEFAULT 'clear' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "mcu_status" varchar(20) DEFAULT 'fit' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "performance_grade" varchar(4);--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "hav_quadrant" integer;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "behavior_review_status" varchar(20) DEFAULT 'pass' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "assessment_validity" date;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "education" varchar(100);--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "major" varchar(255);--> statement-breakpoint
ALTER TABLE "criteria" ADD COLUMN IF NOT EXISTS "category" varchar(20) DEFAULT 'score' NOT NULL;--> statement-breakpoint
ALTER TABLE "criteria" ADD COLUMN IF NOT EXISTS "source_template_id" uuid;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "holder_name" varchar(255);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "holder_employee_id" varchar(100);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "holder_since" varchar(100);--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD COLUMN IF NOT EXISTS "program_template_id" uuid;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD COLUMN IF NOT EXISTS "program" varchar(50);--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD COLUMN IF NOT EXISTS "filter_summary" jsonb;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_templates" ADD CONSTRAINT "program_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_templates" ADD CONSTRAINT "program_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_tenant_created" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_program_templates_tenant" ON "program_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_program_templates_tenant_code" ON "program_templates" USING btree ("tenant_id","code");--> statement-breakpoint
ALTER TABLE "criteria" ADD CONSTRAINT "criteria_source_template_id_program_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."program_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD CONSTRAINT "scoring_runs_program_template_id_program_templates_id_fk" FOREIGN KEY ("program_template_id") REFERENCES "public"."program_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_candidates_tenant_employee_id" ON "candidates" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_runs_status" ON "scoring_runs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "discipline_status_check" CHECK (discipline_status IN ('clear', 'warning', 'sanction'));--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "mcu_status_check" CHECK (mcu_status IN ('fit', 'fit_with_note', 'unfit', 'expired'));--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "behavior_review_status_check" CHECK (behavior_review_status IN ('pass', 'review', 'fail'));--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "hav_quadrant_check" CHECK (hav_quadrant IS NULL OR (hav_quadrant >= 1 AND hav_quadrant <= 16));--> statement-breakpoint
ALTER TABLE "criteria" ADD CONSTRAINT "category_check" CHECK (category IN ('filter', 'score'));--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD CONSTRAINT "scoring_runs_status_check" CHECK (status IN ('draft', 'completed', 'archived'));