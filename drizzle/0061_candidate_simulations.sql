-- Per-candidate "how would they do in this seat" simulations.
--
-- A NOTE, not a score. The ranking is produced by the scoring engines and this
-- never touches it: nothing reads these rows back into analysis_results,
-- position_picks or any weight. It exists because a ranking says WHO is closest
-- and never says what the first ninety days would actually look like.
--
-- Keyed per (run, candidate) because a simulation is only meaningful against the
-- assessment it was written for: the same person against the same seat scored
-- three months later is a different situation, and overwriting the old note
-- would quietly rewrite the reasoning behind a decision already taken. Both FKs
-- cascade — a deleted run has no simulations to explain, and a hard-deleted
-- candidate takes their notes with them (candidates are tombstoned rather than
-- deleted in normal operation, so this fires only on a real DELETE).
CREATE TABLE IF NOT EXISTS candidate_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES scoring_runs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  position_id uuid NOT NULL REFERENCES critical_positions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Rank the candidate held when the simulation was written — the note reads
  -- differently for a #1 than for a #9, and the run can be re-ranked later.
  rank_at_simulation integer,
  -- The structured narrative, serialized JSON. TEXT rather than jsonb because it
  -- is sealed with the app data key like chat_messages.content: this is prose
  -- about a named person's weaknesses and fitness, generated once and kept —
  -- strictly more sensitive than a chat turn, and nothing queries into it.
  -- Values not in the "v1:" format pass through decrypt unchanged, so an install
  -- that never turned encryption on keeps working.
  payload text NOT NULL,
  model varchar(120),
  -- True when the seat had no job profile, so the simulation leaned on the
  -- incumbents' competencies instead of the JD's stated demands — the same
  -- degradation the scoring engine records, surfaced on the note itself.
  without_job_profile boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Bare timestamp, matching every other run-scoped table (scoring_runs,
  -- analysis_results, scoring_run_pool_aspects); the timestamptz group is the
  -- sync_* and candidates side. Mixing them makes ordering a simulation against
  -- its own run an implicit session-timezone cast.
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_simulations_run_candidate
  ON candidate_simulations (run_id, candidate_id);
--> statement-breakpoint
-- No separate (run_id) index: the unique index above already leads with it.
-- Tenant IS indexed because every read filters on it — there is no RLS here.
CREATE INDEX IF NOT EXISTS idx_candidate_simulations_tenant
  ON candidate_simulations (tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_candidate_simulations_candidate
  ON candidate_simulations (candidate_id);
