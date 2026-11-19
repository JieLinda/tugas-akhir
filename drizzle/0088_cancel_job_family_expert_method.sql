-- Cancel the job-family expert-ranking method (feature vectors F1–F6, ROC /
-- Kendall's W weights from Human Capital experts, composite BERTopic runs and
-- expert review). Its code was reverted (commits 6aa97a6 and 2db9853), which
-- also deleted drizzle/0082–0085 — so on a database where those were applied,
-- this is what removes what they created. On one where they never ran, every
-- statement is a no-op. Numbered after the newest migration rather than reusing
-- 0082 so a database that applied 0082–0085 does not see two different
-- migrations under one number.
--
-- Composite runs are DELETED, not just orphaned, and that is the load-bearing
-- part: they are ordinary job_family_topic_runs rows, and the reverted code no
-- longer filters on `representation`. Left in place, a completed composite run
-- becomes "the latest run" for scoring-service (career-anchors.ts — the
-- `family` estimator and its fingerprint — and tournament-evidence.ts) and for
-- the job family map. Deleting the run cascades to its job_family_topics /
-- _topic_assignments rows; job_categories.run_id is SET NULL.
--
-- Apply right after deploying the revert: the pre-revert web app selects
-- job_family_topic_runs.representation and fails once the column is gone, and
-- the reverted code reads a leftover composite run as the latest one until this
-- has run.
--
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'job_family_topic_runs' AND column_name = 'representation'
  ) THEN
    DELETE FROM job_family_topic_runs WHERE representation = 'composite';
  END IF;
END $$;
--> statement-breakpoint

DROP TABLE IF EXISTS
  job_family_review_metrics,
  job_family_review_decisions,
  job_family_run_configs,
  job_family_weight_sets,
  job_family_expert_rankings,
  job_family_weight_rounds,
  job_family_feature_vectors,
  job_family_feature_docs;
--> statement-breakpoint

ALTER TABLE job_family_topic_assignments
  DROP CONSTRAINT IF EXISTS ck_job_family_topic_assignments_placement;
--> statement-breakpoint

ALTER TABLE job_family_topic_assignments DROP COLUMN IF EXISTS placement;
--> statement-breakpoint

DROP INDEX IF EXISTS idx_job_family_topic_runs_representation;
--> statement-breakpoint

ALTER TABLE job_family_topic_runs
  DROP CONSTRAINT IF EXISTS ck_job_family_topic_runs_representation;
--> statement-breakpoint

ALTER TABLE job_family_topic_runs DROP COLUMN IF EXISTS representation;
