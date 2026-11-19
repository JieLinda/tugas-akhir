-- Job Family optimizer: keep what was MEASURED when a setting was applied.
--
-- The optimizer (Pengaturan Job Family → Optimasi Job Family) now applies a
-- BERTopic setting only after topic-service has measured it on the current
-- corpus (POST /topics/trials). This table keeps that measurement — the goal,
-- the corpus fingerprint, the metrics before and after, the verdict — so the
-- run later built with the setting can be checked against it, whether the map
-- is rebuilt right away or later from the map page.
--
-- Looked up by config_hash (sha256 of the canonical BERTopic config), not by
-- config version: a later template save creates a new version with the same
-- parameters, and the measurement still describes it. Append-only.
--
-- Without this table the optimizer still measures and applies; only the
-- check after a rebuild has nothing to compare against.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS job_family_optimization_expectations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal varchar(40) NOT NULL,
  config_hash varchar(64) NOT NULL,
  bertopic jsonb NOT NULL,
  corpus_fingerprint varchar(64) NOT NULL,
  corpus_documents integer NOT NULL,
  threshold real,
  baseline jsonb NOT NULL,
  predicted jsonb NOT NULL,
  verdict jsonb NOT NULL,
  regressions jsonb NOT NULL,
  created_by varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jf_opt_expectations_hash_created
  ON job_family_optimization_expectations (config_hash, created_at);
