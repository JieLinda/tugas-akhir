-- Persistent cache for TITLE embeddings used by the Job Profile Match report.
--
-- The report matches every candidate's current position title against the
-- job-profile catalogue, and its embedding tier needs one vector per job-profile
-- name plus one per still-unplaced title. On this deployment that is ~280 + ~460
-- = ~740 texts, and the embedding source is a REMOTE gateway: measured at
-- 5.2s per 200-text call, so a cold report paid ~20 seconds of embedding before
-- it could render — for a page whose entire database phase costs 0.35s.
--
-- There was already an in-process Map, but it is per-process: every server
-- restart, every deploy, and every additional worker paid the 20s again, and in
-- production nobody keeps a process warm on this page.
--
-- A title's embedding is a pure function of (source, model, EXACT text), so it
-- is safe to persist forever — hence no invalidation column and no fingerprint.
-- A model or source change simply lands on different rows. This is deliberately
-- a cache of VECTORS rather than of match DECISIONS: a decision depends on the
-- whole job-profile corpus, so importing one JD would invalidate every row,
-- whereas caching vectors means a new JD costs exactly one embedding call.
--
-- `embedding` is bytea, not vector(768): nothing here does a pgvector nearest-
-- neighbour search (the cosines are computed in JS against an in-memory corpus),
-- so this stays in the main database and out of VECTOR_DATABASE_URL's way.
-- Float32 rather than Float64 — measured 442ms vs 1030ms to read all ~740 rows,
-- and the readers compare cosines against a 0.98 threshold where the ~1e-6
-- rounding cannot decide anything a float64 vector would decide differently.
CREATE TABLE IF NOT EXISTS job_family_title_embed (
  id serial PRIMARY KEY,
  -- Embedding source ('nomic-remote' | 'nomic-local' | 'multilingual') and the
  -- model name, both part of the key: the same text embeds differently on each.
  source varchar(40) NOT NULL,
  model varchar(160) NOT NULL,
  -- md5 of the EXACT text (not normalized): the vector is a function of the
  -- bytes handed to the model, and two titles differing only in case are two
  -- different inputs even though the matcher would fold them together.
  text_hash char(32) NOT NULL,
  text text NOT NULL,
  dims integer NOT NULL,
  -- Little-endian Float32 array, `dims` entries.
  embedding bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_family_title_embed
  ON job_family_title_embed (source, model, text_hash);
