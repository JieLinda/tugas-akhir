-- A change to PA or behaviour puts the HAV FORMULA in force
-- (docs/talent-mapping.md § "Perubahan PA/BA dan tier formula").
--
-- HR's rule (2026-11): the precedence manual > upload > formula still decides
-- when nothing has happened, but these EVENTS re-decide it, and the latest wins:
--
--   1. a PA or BA edit on the Kandidat form                → formula
--   2. a PA/BA workbook upload (or MSSQL sync) that CHANGES → formula
--      the candidate's PA or BA
--   3. a Talent Mapping drag & drop                         → manual, until 1/2 again
--   4. a HAV workbook upload whose quadrant differs from    → upload
--      the candidate's HAV before it
--   (+) the "Hitung kuadran HAV" button on the Kandidat form → formula
--
-- 1, 2 and the button must win over an older UPLOAD as well as an older
-- placement, which the static order cannot say, so the candidate carries which
-- automatic tier the last event put in force:
--
--   candidates.hav_auto_tier   'formula' | 'upload' | NULL (= the static order)
--
-- NULL for every existing row, so nothing changes until an event happens. The
-- event also moves `hav_auto_changed_at` (drizzle/0080), which is what voids an
-- older placement; the new origins name who moved it.
--
-- Apply BEFORE deploying the new web app, sync-service and scoring-service:
-- they read and write the column (each degrades to the static order without it,
-- logged, but the web app's Kandidat save writes it and would fail).
--
-- Not encrypted: it says which rule applies, never a quadrant.
--
-- Idempotent.

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS hav_auto_tier varchar(10);
--> statement-breakpoint
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_hav_auto_tier_check;
--> statement-breakpoint
ALTER TABLE candidates
  ADD CONSTRAINT candidates_hav_auto_tier_check
  CHECK (hav_auto_tier IS NULL OR hav_auto_tier IN ('upload', 'formula'));
--> statement-breakpoint
-- New origins: 'candidate_edit' (PA/BA edited on the Kandidat form),
-- 'hav_formula' ("Hitung kuadran HAV"), 'pa_ba_upload' (the candidate sync run
-- straight after a PA or BA workbook upload).
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_hav_auto_change_source_check;
--> statement-breakpoint
ALTER TABLE candidates
  ADD CONSTRAINT candidates_hav_auto_change_source_check
  CHECK (hav_auto_change_source IS NULL OR hav_auto_change_source IN
    ('hav_upload', 'hav_folder', 'candidate_sync', 'pa_ba_upload', 'candidate_edit', 'hav_formula'));
