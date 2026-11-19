-- AHP + TOPSIS scoring method
-- Pairwise comparison matrix (Saaty scale) per program template. When null,
-- the scoring service derives AHP weights from default_criteria weights.
ALTER TABLE "program_templates" ADD COLUMN IF NOT EXISTS "ahp_config" jsonb;
