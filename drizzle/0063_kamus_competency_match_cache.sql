-- Resolution of a free-text competency name onto a kamus-kompetensi CODE.
--
-- The kamus is the canonical vocabulary (90 entries), but the two sides that
-- get compared during scoring do not speak it consistently:
--
--   • REQUIRED names come from LLM-extracted job-profile PDFs. 34 of 102
--     distinct names in this deployment match no kamus entry — extraction typos
--     ("DocuPment Administration", "Hukum Bendah"), morphological variants
--     ("Business Process Analyst" for BUSINESS PROCESS ANALYSIS), dropped
--     qualifiers ("Learning & Development" for …MANAGEMENT), reordered words
--     ("System Information (MIS)").
--   • CANDIDATE names come from HR sync and are far cleaner (2 of 65 unmatched).
--
-- The cost of a miss is not a missing vector, it is a WRONG PAIRING. A required
-- competency with no code has no level vector, so every cell in its column is 0
-- — and because Hungarian maximises, the candidate competency that should have
-- filled it gets spent on some other column that happens to score above zero.
-- The reported case: "Business Process Analyst" (job profile) never met the
-- candidate's "BUSINESS PROCESS ANALYSIS" (which the kamus DOES define as
-- TC 012), and that competency was paired with "Budgeting" instead.
--
-- Keyed by the NORMALIZED name because the decision is about the name, not
-- about who wrote it: the same string appears across many job profiles and must
-- resolve identically every time.
--
-- A row with code NULL is a REAL answer — "no kamus entry means this" — and is
-- cached too. "Leadership", "Communication" and "Problem Solving" are genuinely
-- absent from a technical-competency dictionary, and re-asking the model about
-- them on every run would cost calls to relearn the same no.
--
-- Only NON-EXACT resolutions land here. A name that already equals a kamus name
-- is resolved in code, costs nothing, and would only make this table stale.
CREATE TABLE IF NOT EXISTS kamus_competency_match_cache (
  id serial PRIMARY KEY,
  -- Normalized name (uppercased, & → AND, punctuation → space, collapsed).
  name_key varchar(400) NOT NULL,
  -- One original spelling, kept for display in the review UI.
  name text NOT NULL,
  -- Resolved kamus code, or NULL for a cached "no match".
  code varchar(40),
  -- Which tier decided: 'fuzzy' = deterministic token match, 'ai' = LLM.
  tier varchar(20) NOT NULL,
  confidence real,
  reason text,
  model varchar(120),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kamus_competency_match_cache_key
  ON kamus_competency_match_cache (name_key);
