-- Widen the similarity-calibration fingerprint columns from varchar(64) to 200.
--
-- Both calibration tables store `md5(corpus) || ':' || embedding_model` as their
-- fingerprint — 32 characters, a colon, then a model name the schema itself
-- allows up to 120 characters for. varchar(64) therefore only fits a model name
-- of 31 characters or fewer, and this deployment's is 37
-- ("ollama/nomic-embed-text-v2-moe:latest").
--
-- The failure mode is invisible by construction. `store()` in
-- technical-anchors.ts wraps its INSERT in a catch, on purpose: an unapplied
-- migration must not fail a scoring run, since the measurement still stands for
-- the run that just took it. But that also means a PERMANENT write failure looks
-- exactly like a transient one — the anchors are correct on every run, the log
-- line `technicalAnchors.storeFailed` scrolls past, and the cache is never
-- populated. The cost is the full census (kamus: 360 rows, ~128k cross-pairs of
-- 768-dim cosine) re-running on EVERY tournament instead of once per corpus
-- change, which is precisely what the fingerprint exists to avoid.
--
-- Found while adding the career-side equivalent (drizzle/0066), whose first
-- resolve hit the identical error.
ALTER TABLE kamus_similarity_calibration
  ALTER COLUMN fingerprint TYPE varchar(200);

-- No-op when 0066 was applied at its final width; present so a database that
-- received an earlier copy of 0066 converges to the same shape.
ALTER TABLE job_profile_similarity_calibration
  ALTER COLUMN fingerprint TYPE varchar(200);
