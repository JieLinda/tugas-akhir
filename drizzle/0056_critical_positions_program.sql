-- A managed position now belongs to exactly ONE succession program.
--
-- Before this migration a position was program-agnostic and the program was
-- chosen per scoring run, so "Talent Pool" and "Successor" rankings for the same
-- seat piled up under one row and the Position Management list could only show
-- the tenant's whole program list against every position. Scoring the same seat
-- under a second program is now an explicit act: add the position again with
-- that program.
--
-- Backfill keeps history honest by asking the data, not by guessing: a position
-- takes the program of its most recent scoring run. Runs made under a different
-- program stay attached to the row (they are labelled per run everywhere they
-- are rendered) — the column states what the seat is managed as from now on.
ALTER TABLE critical_positions
  ADD COLUMN IF NOT EXISTS program_template_id uuid REFERENCES program_templates(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE critical_positions
  ADD COLUMN IF NOT EXISTS program_code varchar(50);
--> statement-breakpoint
UPDATE critical_positions cp
   SET program_code = latest.program
  FROM (
    SELECT DISTINCT ON (sr.position_id) sr.position_id, sr.program
      FROM scoring_runs sr
     WHERE sr.program IS NOT NULL
     ORDER BY sr.position_id, sr.created_at DESC
  ) latest
 WHERE latest.position_id = cp.id
   AND cp.program_code IS NULL;
--> statement-breakpoint
-- Never scored → the default succession track. 'successor' is seeded for every
-- tenant by autoSeedSystemTemplates (lib/program-defaults.ts).
UPDATE critical_positions SET program_code = 'successor' WHERE program_code IS NULL;
--> statement-breakpoint
UPDATE critical_positions cp
   SET program_template_id = pt.id
  FROM program_templates pt
 WHERE pt.tenant_id = cp.tenant_id
   AND pt.code = cp.program_code
   AND cp.program_template_id IS NULL;
--> statement-breakpoint
ALTER TABLE critical_positions ALTER COLUMN program_code SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_critical_positions_program
  ON critical_positions (tenant_id, program_code);
