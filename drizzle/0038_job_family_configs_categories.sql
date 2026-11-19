-- Job Family: persisted BERTopic config versions + promoted job categories.
--   • job_family_topic_configs — the active (versioned) BERTopic parameter set,
--     source of truth for the Configuration editor. Each run's config_id points
--     at the immutable version it ran with.
--   • job_categories / job_category_profiles — the STABLE taxonomy of job
--     families promoted from a run, the basis for talent pooling. The pool per
--     category is computed live (no materialized pool table).
-- Also adds job_family_topic_runs.config_id.
CREATE TABLE IF NOT EXISTS "job_family_topic_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120),
	"params" jsonb NOT NULL,
	"content_hash" varchar(64),
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_topic_configs_active" ON "job_family_topic_configs" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_topic_configs_created" ON "job_family_topic_configs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "job_family_topic_runs" ADD COLUMN IF NOT EXISTS "config_id" uuid;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"topic_id" integer,
	"code" varchar(60),
	"name" varchar(300) NOT NULL,
	"description" text,
	"keywords" jsonb,
	"size" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_categories_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "job_family_topic_runs"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_categories_status" ON "job_categories" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_categories_run" ON "job_categories" USING btree ("run_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_category_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"job_profile_id" integer NOT NULL,
	"position_name" varchar(300),
	"division_department" varchar(300),
	"probability" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_category_profiles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "job_categories"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_category_profiles_cat_profile" ON "job_category_profiles" USING btree ("category_id","job_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_category_profiles_category" ON "job_category_profiles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_category_profiles_profile" ON "job_category_profiles" USING btree ("job_profile_id");
