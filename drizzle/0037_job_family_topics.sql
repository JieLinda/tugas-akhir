-- Job Family Discovery: BERTopic topic-modeling runs + results.
-- The downstream job over job_profile_embed (from migration 0031). A standalone
-- Python topic-service runs BERTopic (UMAP → HDBSCAN → c-TF-IDF) and writes
-- results here while the web app polls the run row for progress — mirroring how
-- scoring-service drives tournament_sessions. No pgvector needed for these
-- tables (the vectors live in job_profile_embed); UUIDs use gen_random_uuid()
-- (pgcrypto, available by default on modern Postgres).
CREATE TABLE IF NOT EXISTS "job_family_topic_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"progress" jsonb,
	"config" jsonb,
	"hierarchy" jsonb,
	"num_documents" integer DEFAULT 0 NOT NULL,
	"num_topics" integer DEFAULT 0 NOT NULL,
	"embedding_model" varchar(120),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_topic_runs_status" ON "job_family_topic_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_topic_runs_created" ON "job_family_topic_runs" USING btree ("created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_family_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"topic_id" integer NOT NULL,
	"label" varchar(400),
	"keywords" jsonb,
	"size" integer DEFAULT 0 NOT NULL,
	"representative_doc_ids" jsonb,
	"x" real,
	"y" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_family_topics_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "job_family_topic_runs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_family_topics_run_topic" ON "job_family_topics" USING btree ("run_id","topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_topics_run" ON "job_family_topics" USING btree ("run_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_family_topic_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"job_profile_id" integer NOT NULL,
	"position_name" varchar(300),
	"division_department" varchar(300),
	"topic_id" integer NOT NULL,
	"probability" real,
	"x" real,
	"y" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_family_topic_assign_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "job_family_topic_runs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_family_topic_assign_run_profile" ON "job_family_topic_assignments" USING btree ("run_id","job_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_topic_assign_run" ON "job_family_topic_assignments" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_topic_assign_topic" ON "job_family_topic_assignments" USING btree ("run_id","topic_id");
