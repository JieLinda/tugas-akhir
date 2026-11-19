-- Remove the LLM "AI Tournament" scoring method: its stored runs, and every
-- table and column only it used.
--
-- AHP + TOPSIS is the only scoring method. The tournament engine
-- (`tournament_sessions.scoring_method = 'sequential'`, run/result
-- `method = 'LLM'`) is deleted from scoring-service and the web app, and this
-- migration deletes what it left in the database — by explicit decision of the
-- product owner, so these rankings are discarded, not archived:
--
--   1. Every session whose scoring_method is not 'ahp_topsis' (the runner
--      treated any other value as the tournament). Sessions BEFORE runs: a
--      leftover 'running' session is exactly what the orphan sweeper picks up.
--   2. Every run with method 'LLM', plus a non-AHP run a deleted session
--      pointed at. FK cascades take analysis_results, scoring_run_feedback,
--      scoring_run_exclusions, scoring_run_pool_aspects, scoring_run_traces and
--      the runs' chat_messages. position_picks.run_id is SET NULL: a chosen
--      successor is a human decision recorded FROM a ranking and survives it,
--      as it does under "Reset scoring" (lib/position-bulk-actions.ts).
--      DELETE is not guarded by the I-1 triggers (drizzle/0087): deleting a run
--      removes the record whole rather than changing it. A child run of a
--      deleted run keeps existing with parent_run_id SET NULL, which those
--      triggers allow.
--   3. Tables only the tournament read or wrote:
--        candidate_aspect_scores  per-candidate LLM aspect score cache
--        scoring_run_feedback     upvote/downvote of LLM runs, injected into the
--                                 tournament's system prompt as "learning"
--        prompt_versions          history of program_templates.system_prompt
--        program_contexts         "Konteks Bisnis" — agent instructions read by
--                                 the tournament (and once injected into the
--                                 hidden AI Assistant chat; that injection is
--                                 removed in the same change)
--   4. Columns only the tournament used: program_templates.system_prompt,
--      tournament_sessions.stages and tournament_sessions.carryover_losers.
--      tournament_sessions.scoring_method now defaults to 'ahp_topsis'.
--
-- NOT touched: AHP+TOPSIS runs and sessions, position_picks rows, audit_log
-- (its summaries name runs that no longer exist; it is history), and
-- tournament_sessions.pending_pool (always [] now, but the AHP engine still
-- reads current_pool ∪ pending_pool).
--
-- Irreversible: the deleted rows and dropped columns are gone. Take a backup
-- first if the LLM rankings may ever be needed.
--
-- Apply AFTER the new web app AND the new scoring-service are running: the old
-- builds can still create tournament sessions, and they read and write every
-- table and column dropped here.
--
-- One transaction (no statement-breakpoints, so apply-sql sends it as a single
-- query): either all of it applies or none of it does. Idempotent.
--   tsx scripts/apply-sql.ts drizzle/0097_remove_llm_tournament.sql
--
-- Check before / after:
--   SELECT method, count(*) FROM scoring_runs GROUP BY 1;
--   SELECT scoring_method, count(*) FROM tournament_sessions GROUP BY 1;

BEGIN;

CREATE TEMP TABLE _llm_tournament_runs ON COMMIT DROP AS
  SELECT r.id
    FROM scoring_runs r
   WHERE r.method = 'LLM'
  UNION
  SELECT r.id
    FROM tournament_sessions ts
    JOIN scoring_runs r ON r.id = ts.run_id
   WHERE ts.scoring_method IS DISTINCT FROM 'ahp_topsis'
     AND r.method IS DISTINCT FROM 'AHP_TOPSIS';

DELETE FROM tournament_sessions
 WHERE scoring_method IS DISTINCT FROM 'ahp_topsis';

DELETE FROM scoring_runs
 WHERE id IN (SELECT id FROM _llm_tournament_runs);

DROP TABLE IF EXISTS candidate_aspect_scores;
DROP TABLE IF EXISTS scoring_run_feedback;
DROP TABLE IF EXISTS prompt_versions;
DROP TABLE IF EXISTS program_contexts;

ALTER TABLE program_templates DROP COLUMN IF EXISTS system_prompt;

ALTER TABLE tournament_sessions
  DROP COLUMN IF EXISTS stages,
  DROP COLUMN IF EXISTS carryover_losers,
  ALTER COLUMN scoring_method SET DEFAULT 'ahp_topsis';

COMMIT;
