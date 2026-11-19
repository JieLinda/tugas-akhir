-- Feature: hard-enforce eligibility filter rules (per program template)
-- Default TRUE: filter rules act as hard knockouts unless a program opts out.
ALTER TABLE "program_templates"
  ADD COLUMN IF NOT EXISTS "enforce_filter_rules" boolean NOT NULL DEFAULT true;

-- Feature: upvote / downvote feedback on a scoring run, fed back into the
-- LLM prompt on future runs (scoped: position | program | global).
CREATE TABLE IF NOT EXISTS "scoring_run_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "run_id" uuid NOT NULL REFERENCES "scoring_runs"("id") ON DELETE CASCADE,
  "position_id" uuid NOT NULL REFERENCES "critical_positions"("id") ON DELETE CASCADE,
  "program_template_id" uuid REFERENCES "program_templates"("id") ON DELETE SET NULL,
  "vote" varchar(4) NOT NULL,
  "reason" text,
  "scope" varchar(10) NOT NULL DEFAULT 'global',
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "scoring_run_feedback_vote_check" CHECK ("vote" IN ('up', 'down')),
  CONSTRAINT "scoring_run_feedback_scope_check" CHECK ("scope" IN ('position', 'program', 'global'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_scoring_run_feedback_run" ON "scoring_run_feedback" ("run_id");
CREATE INDEX IF NOT EXISTS "idx_scoring_run_feedback_tenant" ON "scoring_run_feedback" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_scoring_run_feedback_position" ON "scoring_run_feedback" ("position_id");
CREATE INDEX IF NOT EXISTS "idx_scoring_run_feedback_program" ON "scoring_run_feedback" ("program_template_id");
CREATE INDEX IF NOT EXISTS "idx_scoring_run_feedback_vote" ON "scoring_run_feedback" ("vote");
