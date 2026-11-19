-- Career similarity anchors: THREE independent estimators instead of one.
--
-- drizzle/0066 made the anchors measured rather than hardcoded, which was the
-- right move and fixed a real defect. But it measured ONE thing — percentiles of
-- the arbitrary cross-document pair distribution — and that estimator turns out
-- to be biased low at the floor in a way nothing about it could reveal.
--
-- WHY p25-OF-ALL-PAIRS IS TOO LOW. It answers "how similar is an arbitrary pair
-- of job profiles", then puts sim' = 0 at the 25th percentile of that. On this
-- corpus (275 documents, 37,675 pairs) that is 0.519 — and at cosine 0.519 the
-- probability that two profiles are even in the same JOB FAMILY is 10%. So the
-- zero point of the relevance scale sat where 90% of pairs are unrelated, and
-- everything above it earned positive relevance: the median arbitrary pair
-- (0.562) scored 0.09, and the 95th-percentile-of-noise pair (0.709) scored 0.39.
-- Career multiplies sim' by years and accumulates, so a 12-year career of
-- unrelated work banked ~4.7 "effective relevant years" out of a target of ~7.
--
-- Measured consequence, over 660 scored candidates in 8 real runs: candidates
-- scored from real job-profile documents averaged 35.1, while candidates scored
-- through the competency fallback averaged 66.7. Of the 104 candidates scoring
-- >= 90, 90 had fallback evidence. The score was reporting how much of a
-- candidate's history LACKED a job profile, not how relevant it was.
--
-- THE FIX IS NOT A BETTER PERCENTILE — it is asking a question with a checkable
-- answer. "Related" has to be defined against something observable, so this
-- migration stores three estimators of the same two anchors:
--
--   corpus      — the 0066 method. p25 of arbitrary pairs / p99 of each
--                 document's nearest genuine twin. Always available; kept
--                 because it needs nothing but the vectors.
--   family      — the cosine at which P(same job family) crosses 50% and 95%,
--                 taken against `job_family_topic_assignments` of the last
--                 COMPLETED topic run. Measured: 0.671 / 0.858. Partly circular
--                 (the families were themselves clustered from these vectors),
--                 which is exactly why it is one of three and not the answer.
--   transitions — REVEALED PREFERENCE. The cosine distribution of internal moves
--                 people ACTUALLY MADE, read out of `candidate_position_history`:
--                 p10 as the floor, p75 as the ceiling. This is the only
--                 estimator with no circularity — it is HR decisions that already
--                 happened, not a property of the embedding. Measured over the 64
--                 observed moves whose both endpoints have a job profile:
--                   p10 0.628 | p25 0.704 | p50 0.827 | p75 0.888 | p90 0.940
--                 against arbitrary pairs at p50 0.562. The moves people make are
--                 emphatically not arbitrary pairs, and the old floor of 0.519
--                 sat BELOW the 10th percentile of them.
--
-- The three converge on the floor — 0.671 / 0.606 (Platt-implied) / 0.628 — and
-- disagree more on the ceiling, which is expected: "definitely the same job" is
-- rarer and each estimator sees a different tail. The resolved anchor is the
-- MEDIAN of the available estimates, so one estimator being unavailable or wrong
-- cannot move the scale on its own, and `estimators` records every value that
-- went in. On this deployment that lands at roughly 0.65 / 0.90 versus the
-- 0.519 / 0.998 it replaces.
--
-- Re-baselining is a DELIBERATE score shift, not a silent bugfix. Runs keep
-- their own `runInfo.career.scale`, which now carries the estimator breakdown,
-- so a ranking finished under the old anchors stays explainable — and visibly
-- incomparable — afterwards.
--
-- `estimators` is jsonb rather than columns because the set of estimators is
-- expected to grow (a job-level label set would be a fourth), and each carries a
-- different sample description. A NULL means the row predates this migration:
-- its floor/ceil came from `corpus` alone.

ALTER TABLE job_profile_similarity_calibration
  ADD COLUMN IF NOT EXISTS estimators jsonb;

-- Which estimator combination produced the stored floor/ceil, for the run-config
-- panel. 'corpus' for every pre-existing row, by definition.
ALTER TABLE job_profile_similarity_calibration
  ADD COLUMN IF NOT EXISTS estimator_sources varchar(120);

UPDATE job_profile_similarity_calibration
   SET estimator_sources = 'corpus'
 WHERE estimator_sources IS NULL;
