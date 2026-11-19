-- Job Family from TECHNICAL COMPETENCY REQUIREMENTS — the vector space and the
-- per-document vectors, built without BERTopic.
--
-- Three tables, mirroring the shape job_family_topic_runs / _topics /
-- _assignments already uses for the BERTopic side: a build header, the columns
-- of the space, and one row per document.
--
--   builds  the run: what it was built from, how big the space came out, and
--           every degradation the build reported.
--   axis    the COLUMNS: one row per (competency identity × required level).
--           Storing them is not optional bookkeeping — a stored vector is a
--           list of integers and is unreadable without the column order that
--           produced it.
--   vectors the ROWS: one per job profile, binary, held as the sorted list of
--           axis positions that are 1.
--
-- The axis is rebuilt, never edited: a build is a snapshot of a corpus at a
-- moment, and the corpus moves every time a job profile is re-extracted.
-- Superseding a build means inserting a new one; nothing here is mutated in
-- place, so a clustering result can always name the space it was computed over.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS job_family_competency_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'completed' | 'failed'. The build is synchronous (one query plus a pass
  -- over ~275 small JSON arrays), so there is no 'processing' state to sweep.
  status varchar(20) NOT NULL DEFAULT 'completed',
  -- Documents that entered the build.
  doc_count integer NOT NULL DEFAULT 0,
  -- Number of (competency × level) dimensions.
  axis_size integer NOT NULL DEFAULT 0,
  -- Distinct competency identities, level-independent — axis_size collapsed
  -- over levels. Kept as its own column because the ratio between the two is
  -- the headline property of this encoding.
  competency_count integer NOT NULL DEFAULT 0,
  -- What the build was told to do (source filter, exclusions in force).
  params jsonb,
  -- AxisDiagnostics: excluded behavioural names, level conflicts, unresolved
  -- identities, sparsity. Every degradation is recorded rather than letting a
  -- column quietly change meaning.
  diagnostics jsonb,
  error text,
  created_by varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS job_family_competency_axis (
  id serial PRIMARY KEY,
  build_id uuid NOT NULL REFERENCES job_family_competency_builds(id) ON DELETE CASCADE,
  -- Position in the vector. Stable within a build, meaningless across builds.
  axis_index integer NOT NULL,
  -- 'C:<kamus code>' when the name resolved, else 'N:<normalized name>'. TEXT,
  -- not varchar(n): the normalized branch carries a competency name of
  -- unbounded length, and drizzle/0067 is the standing lesson about sizing a
  -- composite key by guess (a varchar(64) fingerprint overflowed, store()
  -- swallowed the write error, and the census re-ran on every tournament).
  competency_key text NOT NULL,
  kamus_code varchar(20),
  -- Kamus name when resolved, else the normalized profile spelling.
  display_name text NOT NULL,
  -- 1..4, or 0 = required but no legible level in the document. 0 is its own
  -- dimension on purpose: substituting a plausible level would file the
  -- document with jobs that really stated it.
  level integer NOT NULL,
  -- Documents with a 1 in this column. Denormalized so the matrix view and any
  -- IDF weighting read it without a scan over the vectors.
  doc_freq integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_family_competency_axis_index
  ON job_family_competency_axis (build_id, axis_index);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_family_competency_axis_cell
  ON job_family_competency_axis (build_id, competency_key, level);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_job_family_competency_axis_build
  ON job_family_competency_axis (build_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS job_family_competency_vectors (
  id serial PRIMARY KEY,
  build_id uuid NOT NULL REFERENCES job_family_competency_builds(id) ON DELETE CASCADE,
  -- A plain int, NOT an FK, matching job_family_topic_assignments: deleting a
  -- source profile must not mutate a build that already happened.
  job_profile_id integer NOT NULL,
  file_name varchar(500),
  position_name varchar(300),
  division_department varchar(300),
  -- The vector. Binary over the axis, so the sorted list of 1-positions is the
  -- whole of it — ~9 of ~223 dimensions per document here. No bytea: nothing
  -- does a nearest-neighbour search in the database, and an int[] is readable
  -- by eye and by SQL, which is the entire point of this table.
  axis_indices integer[] NOT NULL DEFAULT '{}',
  nnz integer NOT NULL DEFAULT 0,
  -- Per-requirement provenance: the spelling this document used, the level, the
  -- resolved code and which tier resolved it. The axis carries the canonical
  -- name; this carries what was actually on the page, so a surprising cell can
  -- be traced back to the document without re-reading the PDF.
  entries jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_family_competency_vectors_doc
  ON job_family_competency_vectors (build_id, job_profile_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_job_family_competency_vectors_build
  ON job_family_competency_vectors (build_id);
