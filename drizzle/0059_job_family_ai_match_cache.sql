-- Decisions made by the AI matching tier, cached per position title.
--
-- The tier runs on titles the filename / exact / embedding tiers could not
-- place. Without a cache it would re-ask the model on every report load, which
-- is both slow and — because an LLM is not a pure function — visibly unstable:
-- the same title could pair with a different JD between two page loads, and the
-- matched list would reshuffle under the operator.
--
-- Keyed by the NORMALIZED title (lowercased, whitespace collapsed) because the
-- decision is about the title, not about the person holding it: several
-- candidates share one title and must resolve to the same JD.
--
-- A row with job_profile_id NULL is a real answer — "none of the shortlisted
-- JDs is this role" — and is cached too, so a title the model already rejected
-- does not cost another call on the next run.
CREATE TABLE IF NOT EXISTS job_family_ai_match_cache (
  id serial PRIMARY KEY,
  title_key varchar(400) NOT NULL,
  title text NOT NULL,
  job_profile_id integer REFERENCES sync_job_profiles(id) ON DELETE CASCADE,
  confidence real,
  reason text,
  model varchar(120),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_family_ai_match_cache_title
  ON job_family_ai_match_cache (title_key);
