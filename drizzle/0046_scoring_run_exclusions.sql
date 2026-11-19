-- Dynamic candidate exclusion on a FINISHED scoring result.
--
-- Two tables, one for each half of the feature:
--
--   scoring_run_exclusions   — "kandidat ini tidak dipertimbangkan" on a run that
--                              is already done. A soft mark: the analysis_results
--                              row keeps its original rank and closeness, because
--                              a completed run is the record of an assessment on
--                              a date and rewriting it would destroy the audit
--                              trail. Display, export, and finalisation skip the
--                              row; nothing is recomputed.
--
--   scoring_run_pool_aspects — the six AHP aspect scores of EVERY candidate the
--                              AHP+TOPSIS engine scored, finalist or not.
--
-- Why the second table exists: analysis_results only stores the top-N finalists
-- (targetFinalists), but the aspects are per-candidate and set-independent —
-- technical, career, behavior, PA, HAV and education do not depend on who else
-- is in the pool. Persisting them for the whole pool buys two things:
--
--   • BACKFILL — excluding a finalist frees a slot, and the re-rank can promote
--     the candidate ranked N+1 instead of returning a list that is one shorter.
--     Without this table the only possible re-rank is "over the surviving
--     finalists", which is the worst option available: a set of uniformly high
--     scorers makes the TOPSIS ideal/anti-ideal collapse toward each other.
--
--   • RE-RANK WITHOUT RE-SCORING — TOPSIS is set-relative (its ideal solutions
--     are derived from the alternatives present), so dropping a candidate needs
--     a fresh topsisRank() but no LLM call and no embedding work. Seconds
--     instead of the minutes-to-hours a full pool recompute costs.
--
-- Runs created before this migration simply have no pool rows. The re-rank then
-- falls back to the finalists in analysis_results and reports the degradation
-- (no backfill possible) rather than silently ranking a truncated pool.

CREATE TABLE IF NOT EXISTS "scoring_run_exclusions" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "run_id"       uuid NOT NULL REFERENCES "scoring_runs"("id") ON DELETE CASCADE,
  "candidate_id" uuid NOT NULL REFERENCES "candidates"("id") ON DELETE CASCADE,
  -- retired | resigned | promoted | conflict_of_interest | other
  "reason"       varchar(30) NOT NULL DEFAULT 'other',
  -- Free-text detail; the UI requires it when reason = 'other'.
  "note"         text,
  "excluded_by"  uuid NOT NULL REFERENCES "users"("id"),
  "excluded_at"  timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- One exclusion per candidate per run; re-including is a plain DELETE, so the
-- surviving history is the audit_log entry pair.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_scoring_run_exclusions_run_candidate"
  ON "scoring_run_exclusions" ("run_id", "candidate_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_scoring_run_exclusions_run"
  ON "scoring_run_exclusions" ("run_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_scoring_run_exclusions_tenant"
  ON "scoring_run_exclusions" ("tenant_id");
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "scoring_run_exclusions"
    ADD CONSTRAINT "scoring_run_exclusions_reason_check"
    CHECK ("reason" IN ('retired', 'resigned', 'promoted', 'conflict_of_interest', 'other'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "scoring_run_pool_aspects" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id"       uuid NOT NULL REFERENCES "scoring_runs"("id") ON DELETE CASCADE,
  "candidate_id" uuid NOT NULL REFERENCES "candidates"("id") ON DELETE CASCADE,
  -- Rank within the FULL scored pool (1-based), not within the finalist cut.
  "pool_rank"    integer NOT NULL,
  -- TOPSIS closeness of the run that wrote this row; kept so a later re-rank can
  -- show the before/after shift instead of only the new number.
  "closeness"    numeric(10, 6) NOT NULL,
  -- Whether the candidate made the finalist cut (i.e. has an analysis_results row).
  "is_finalist"  boolean NOT NULL DEFAULT false,
  -- The six aspect scores keyed by AHP_CRITERIA_ORDER.
  "aspects"      jsonb NOT NULL,
  -- technicalMatching / careerMatching / educationEval — the reusable detail blobs.
  "details"      jsonb,
  "created_at"   timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_scoring_run_pool_aspects_run_candidate"
  ON "scoring_run_pool_aspects" ("run_id", "candidate_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_scoring_run_pool_aspects_run"
  ON "scoring_run_pool_aspects" ("run_id");
