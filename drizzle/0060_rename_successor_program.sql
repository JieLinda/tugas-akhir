-- Rename the "Successor" program to "Critical Position".
--
-- DISPLAY NAME ONLY. The code stays 'successor', because it is what
-- `critical_positions.program_code`, `scoring_runs.program` and
-- `position_picks.program_code` carry — including on finished runs, whose
-- program label is part of the record of an assessment already made. Renaming
-- the code would be a data migration across that history to change a word on a
-- screen; the seed default in lib/program-defaults.ts matches this name so a
-- newly seeded tenant lands in the same place.
--
-- Guarded on the old name so a tenant that already renamed this program by hand
-- keeps their own wording.
UPDATE program_templates
   SET name = 'Critical Position',
       updated_at = NOW()
 WHERE code = 'successor'
   AND name = 'Successor';
