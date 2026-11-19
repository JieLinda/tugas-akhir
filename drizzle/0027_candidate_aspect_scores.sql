-- Candidate aspect score cache (LLM tournament): reuse technical/education
-- scores across runs; input_hash invalidates when candidate data, position
-- context, or the aspect prompt changes.
CREATE TABLE IF NOT EXISTS "candidate_aspect_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"aspect" varchar(20) NOT NULL,
	"score" integer NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_aspect_scores_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE,
	CONSTRAINT "candidate_aspect_scores_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "critical_positions"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_candidate_aspect_scores" ON "candidate_aspect_scores" USING btree ("candidate_id","position_id","aspect");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_candidate_aspect_scores_position" ON "candidate_aspect_scores" USING btree ("position_id");
