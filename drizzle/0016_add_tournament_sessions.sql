-- Tournament sessions: persist LLM tournament state between per-stage server
-- actions so the wizard can stream progress without holding an in-memory singleton.
CREATE TABLE IF NOT EXISTS "tournament_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "position_id" uuid NOT NULL REFERENCES "critical_positions"("id") ON DELETE CASCADE,
  "program_template_id" uuid REFERENCES "program_templates"("id") ON DELETE SET NULL,
  "label" varchar(255),
  "target_finalists" integer NOT NULL DEFAULT 10,
  "batch_size" integer NOT NULL DEFAULT 4,
  "current_pool" jsonb NOT NULL,
  "carryover_losers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "stages" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'running',
  "final_ranked" jsonb,
  "run_id" uuid REFERENCES "scoring_runs"("id") ON DELETE SET NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "tournament_sessions_status_check"
    CHECK (status IN ('running', 'finalizing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS "idx_tournament_sessions_tenant" ON "tournament_sessions"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_tournament_sessions_position" ON "tournament_sessions"("position_id");
CREATE INDEX IF NOT EXISTS "idx_tournament_sessions_status" ON "tournament_sessions"("status");
