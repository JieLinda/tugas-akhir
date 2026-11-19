-- Job Family Discovery: restructured job-profile paragraphs + sentence embeddings.
-- Groundwork for BERTopic topic modelling over job profiles. Requires pgvector.
-- The embedding vector is fixed at 768 dims (Xenova/multilingual-e5-base).
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_profile_embed" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_profile_id" integer NOT NULL,
	"position_name" varchar(300),
	"division_department" varchar(300),
	"document" text NOT NULL,
	"embedding" vector(768),
	"embedding_model" varchar(120),
	"content_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_profile_embed_job_profile_id_fkey" FOREIGN KEY ("job_profile_id") REFERENCES "sync_job_profiles"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_profile_embed_job_profile" ON "job_profile_embed" USING btree ("job_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_profile_embed_position" ON "job_profile_embed" USING btree ("position_name");
