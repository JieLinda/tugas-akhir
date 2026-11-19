-- Talent Mapping becomes where HAV is CONSOLIDATED (docs/talent-mapping.md).
--
-- The quadrant in force for every reader — eligibility rules, the AHP/LLM HAV
-- aspect, the candidate profile, Beranda — is now
--     manual placement  >  HAV Excel upload  >  formula (PA × BA)
-- and a HAV upload that CHANGES somebody's quadrant supersedes their earlier
-- manual placement (sync-service hav-sync.ts deletes it and logs the event).
--
-- So a placement no longer overrides "the formula"; it overrides the AUTOMATIC
-- answer, which is the upload when there is one and the formula otherwise. The
-- column that recorded the formula's answer becomes `baseline_quadrant`, with a
-- `baseline_source` saying which of the two it was — without the source a
-- baseline of "7" cannot say whether HR's spreadsheet or the formula said it.
--
-- Existing rows were written under 0078's rule, where the baseline WAS the
-- formula, so they are backfilled as 'formula' (or 'none' when the formula could
-- not place the candidate). That is what was true when they were made; the page
-- then reports those placements as made against a different automatic answer
-- than today's, which is accurate.
--
-- Also renames the audit action 'revert_to_formula' → 'revert_to_automatic' and
-- documents the new 'superseded_by_upload'.
--
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'talent_mapping_placements' AND column_name = 'formula_quadrant'
  ) THEN
    ALTER TABLE talent_mapping_placements RENAME COLUMN formula_quadrant TO baseline_quadrant;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE talent_mapping_placements ADD COLUMN IF NOT EXISTS baseline_source varchar(10);
--> statement-breakpoint
UPDATE talent_mapping_placements
   SET baseline_source = CASE WHEN baseline_quadrant IS NULL THEN 'none' ELSE 'formula' END
 WHERE baseline_source IS NULL;
--> statement-breakpoint
ALTER TABLE talent_mapping_placements ALTER COLUMN baseline_source SET DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE talent_mapping_placements ALTER COLUMN baseline_source SET NOT NULL;
--> statement-breakpoint
ALTER TABLE talent_mapping_placements DROP CONSTRAINT IF EXISTS talent_mapping_placements_baseline_source_check;
--> statement-breakpoint
ALTER TABLE talent_mapping_placements
  ADD CONSTRAINT talent_mapping_placements_baseline_source_check
  CHECK (baseline_source IN ('upload', 'formula', 'none'));
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'talent_audit_logs' AND column_name = 'formula_quadrant'
  ) THEN
    ALTER TABLE talent_audit_logs RENAME COLUMN formula_quadrant TO baseline_quadrant;
  END IF;
END $$;
--> statement-breakpoint
-- NULL on 'five_box' rows, which predate the idea.
ALTER TABLE talent_audit_logs ADD COLUMN IF NOT EXISTS baseline_source varchar(10);
--> statement-breakpoint
UPDATE talent_audit_logs
   SET baseline_source = CASE WHEN baseline_quadrant IS NULL THEN 'none' ELSE 'formula' END
 WHERE mapping_kind = 'hav16' AND baseline_source IS NULL;
--> statement-breakpoint
-- 'manual_place' | 'revert_to_automatic' | 'superseded_by_upload'.
UPDATE talent_audit_logs SET action = 'revert_to_automatic' WHERE action = 'revert_to_formula';
