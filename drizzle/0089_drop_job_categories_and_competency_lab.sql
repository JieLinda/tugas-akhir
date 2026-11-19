-- Remove two features that were deleted from the app, together with the tables
-- only they used.
--
-- job_categories / job_category_profiles (drizzle/0006, 0038): written only by
-- the "Jadikan Kategori Pekerjaan" promotion on the job family map, read by
-- nothing. The promotion is gone, so the tables are an orphaned copy of an old
-- run's families.
--
-- job_family_competency_builds / _axis / _vectors (drizzle/0077): the
-- competency-requirement space behind the unlisted /competency-lab page and the
-- offline competency-lab/ module, both deleted. Nothing else read them.
--
-- Data in these tables is discarded. Nothing in the job family map, scoring or
-- any other feature depends on it.
--
-- Idempotent.

DROP TABLE IF EXISTS
  job_category_profiles,
  job_categories,
  job_family_competency_vectors,
  job_family_competency_axis,
  job_family_competency_builds;
