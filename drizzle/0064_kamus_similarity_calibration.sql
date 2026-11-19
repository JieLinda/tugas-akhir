-- Similarity anchors for the technical aspect, DERIVED from the kamus embedding
-- corpus instead of hardcoded.
--
-- `TECHNICAL_SIM_FLOOR` / `TECHNICAL_SIM_CEIL` were measured once by hand
-- (0.72 / 0.89) and baked in as defaults. That is a latent staleness bug: they
-- describe the cosine distribution of ONE corpus, and re-embedding the kamus,
-- adding or removing competencies, or switching the embedding model all move
-- that distribution while leaving the numbers untouched. Nothing fails — every
-- cosine still computes — only the MEANING of the resulting score shifts, which
-- is the least detectable kind of wrong.
--
-- The anchors are therefore a property of the CORPUS STATE, recomputed whenever
-- that state changes. `fingerprint` is what makes "whenever" exact without
-- having to enumerate every write path: it hashes the (code, level,
-- content_hash) of every embedded row plus the model name, so any re-embed,
-- insert, delete or model switch produces a different value and the next
-- scoring run recomputes. A kamus edit that does NOT change the vectors (say,
-- fixing a description's typo without re-embedding) correctly leaves it alone,
-- because the anchors describe the vectors, not the text.
--
-- This does NOT reintroduce per-run percentiles, which are deliberately avoided
-- for the career aspect and here alike. Per-run percentiles vary with who
-- happens to be in the pool — an accident of the run. These vary only with the
-- measuring instrument itself, and every run records the anchors it used in
-- `runInfo.technical`, so a finished ranking stays explainable after a re-embed.
--
-- Singleton by construction (one corpus, one calibration): the unique index is
-- on a constant column.
CREATE TABLE IF NOT EXISTS kamus_similarity_calibration (
  id serial PRIMARY KEY,
  -- Always TRUE — the unique index below makes this table hold exactly one row.
  singleton boolean NOT NULL DEFAULT TRUE,
  -- Hash of the embedded corpus; a change here means recompute.
  fingerprint varchar(64) NOT NULL,
  embedding_model varchar(120),
  -- p25 of the per-row "best similarity to a DIFFERENT competency" distribution.
  -- At or below it, "the most similar competency in the dictionary" is no
  -- evidence of coverage at all.
  sim_floor real NOT NULL,
  -- p99 of that same distribution. Deliberately NOT the maximum: the max is a
  -- single point, so one near-duplicate competency added to the kamus would
  -- drag the ceiling to ~0.99 and compress the whole scale. On the corpus this
  -- was designed against the two agree (0.8905 vs 0.8917).
  sim_ceil real NOT NULL,
  -- Diagnostics, so a shifted anchor can be explained rather than just noticed.
  sample_count integer NOT NULL,
  code_count integer NOT NULL,
  p50 real,
  p95 real,
  computed_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kamus_similarity_calibration_singleton
  ON kamus_similarity_calibration (singleton);
