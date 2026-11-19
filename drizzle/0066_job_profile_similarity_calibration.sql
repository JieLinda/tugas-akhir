-- Similarity anchors for the CAREER aspect, DERIVED from the job-profile
-- embedding corpus instead of hardcoded.
--
-- This is the same defect drizzle/0064 fixed for the technical aspect, left
-- standing on the other side of the engine. `CAREER_SIM_FLOOR` / `_CEIL` fell
-- back to literals picked per embedding-model FAMILY — 0.45/0.85 for anything
-- not E5 — and `scoring-service/.env.example` said so outright: "tune once real
-- runs are observed". They never were. A census of this deployment's corpus
-- (275 documents, 75,350 cross-pairs, nomic-embed-text-v2-moe) shows both ends
-- were shifted low:
--
--   arbitrary (cross-document) pair:  p05 0.461 | p25 0.519 | p50 0.562
--                                     p75 0.612 | p95 0.709
--   genuine best match per document (near-duplicates excluded):
--                                     p50 0.905 | p95 0.991 | p99 0.998
--
--   • floor 0.45 sits just BELOW the 5th percentile of arbitrary pairs, so the
--     MEDIAN unrelated pair rescaled to 0.28 and the p75 one to 0.41. Every
--     stint earned ~28-40% relevance for being a job description at all — the
--     exact defect the rescale was introduced to remove, one third the size.
--     Career multiplies sim' by years and accumulates, so the leak reached
--     every candidate's effective-relevant-years total.
--   • ceil 0.85 sits below the median document's genuine twin (0.905), so more
--     than half the corpus saturated at sim' = 1.0 and the top of the scale
--     stopped discriminating: 0.86 and 0.99 both scored full relevance.
--
-- Fixed-not-per-run stays: the anchors must not follow who happens to be in a
-- pool, or a Career score means something different in every run. What changes
-- is that "fixed" no longer means "guessed" — the values are a property of the
-- CORPUS STATE, recomputed whenever that state changes. `fingerprint` hashes
-- (job_profile_id, content_hash) over every embedded row plus the model name, so
-- any re-embed, insert, delete or model switch produces a different value and
-- the next scoring run recomputes, without every write path in
-- lib/job-family-actions.ts having to know this table exists. Re-restructuring a
-- document without re-embedding correctly changes nothing: the anchors describe
-- vectors, not text.
--
-- Every run still records the anchors it used in `runInfo.career.scale`, so a
-- ranking finished before a re-embed stays explainable afterwards.
--
-- Singleton by construction (one corpus, one calibration): the unique index is
-- on a constant column.
CREATE TABLE IF NOT EXISTS job_profile_similarity_calibration (
  id serial PRIMARY KEY,
  -- Always TRUE — the unique index below makes this table hold exactly one row.
  singleton boolean NOT NULL DEFAULT TRUE,
  -- Hash of the embedded corpus; a change here means recompute.
  --
  -- 200, not 64: the value is `md5(...) || ':' || embedding_model`, so 32 + 1 +
  -- up to 120 = 153 characters. drizzle/0064 sized the same construction at
  -- varchar(64) and its INSERT has been failing ever since on any deployment
  -- whose model name is longer than 31 characters — silently, because the write
  -- is wrapped in a catch so a pending migration cannot fail a scoring run. See
  -- drizzle/0067, which widens that one.
  fingerprint varchar(200) NOT NULL,
  embedding_model varchar(120),
  -- p25 of the ARBITRARY cross-document pair distribution: at or below it there
  -- is certainly no relationship between two job profiles.
  --
  -- Deliberately p25 and NOT the median, even though the median (0.562) is the
  -- more natural reading of "a typical unrelated pair". The all-pairs
  -- distribution is not a pure no-relationship distribution — 275 job profiles
  -- of ONE company contain many genuinely related pairs, and they concentrate in
  -- its upper tail. Anchoring at the median or above would therefore zero out
  -- real signal (two different Sales roles) along with the noise. p25 is the
  -- conservative end of the contaminated distribution, and it keeps the same
  -- quartile reasoning kamus_similarity_calibration uses.
  sim_floor real NOT NULL,
  -- p99 of the per-document "best similarity to a DIFFERENT job profile", with
  -- near-duplicates (>= 0.999) excluded first.
  --
  -- Both halves of that are load-bearing. p99 rather than the max, for the same
  -- robustness reason as the kamus. And the duplicate filter because this corpus
  -- genuinely contains re-uploads and documents that restructure to identical
  -- text — 46 pairs across 37 documents at cosine >= 0.999 — which pin any
  -- max-based ceiling at exactly 1.0 and, being over 1% of the corpus, reach p99
  -- as well. Those pairs are the SAME job, not two similar ones.
  sim_ceil real NOT NULL,
  -- Diagnostics, so a shifted anchor can be explained rather than just noticed.
  -- Sample count is the cross-pair count the percentiles were taken over.
  sample_count integer NOT NULL,
  doc_count integer NOT NULL,
  -- Median of the arbitrary-pair distribution (the "unrelated baseline").
  arbitrary_p50 real,
  -- Median of the genuine best-match distribution (a typical real twin).
  best_p50 real,
  -- How many pairs were discarded as duplicates before measuring the ceiling.
  duplicate_pairs integer,
  computed_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_profile_similarity_calibration_singleton
  ON job_profile_similarity_calibration (singleton);
