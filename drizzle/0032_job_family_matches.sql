-- Job Family match mapping: candidate ↔ job profile (+ candidate_position) and
-- how/why they matched. One row per candidate (their current best match).
CREATE TABLE IF NOT EXISTS "job_family_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" uuid NOT NULL,
	"candidate_name" varchar(255),
	"candidate_position" varchar(400),
	"position_id" varchar(40),
	"job_profile_id" integer NOT NULL,
	"job_profile_name" varchar(400),
	"match_type" varchar(20) NOT NULL,
	"similarity" real,
	"matched_code" varchar(60),
	"jd_number" varchar(60),
	"file_name" varchar(500),
	"matched_part" text,
	"reason" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "job_family_matches"
		ADD CONSTRAINT "job_family_matches_candidate_id_candidates_id_fk"
		FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "job_family_matches"
		ADD CONSTRAINT "job_family_matches_job_profile_id_sync_job_profiles_id_fk"
		FOREIGN KEY ("job_profile_id") REFERENCES "sync_job_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_family_matches_candidate" ON "job_family_matches" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_matches_job_profile" ON "job_family_matches" USING btree ("job_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_matches_match_type" ON "job_family_matches" USING btree ("match_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_matches_position_id" ON "job_family_matches" USING btree ("position_id");
