ALTER TABLE "critical_positions"
  ADD COLUMN "required_competencies" jsonb DEFAULT '[]'::jsonb NOT NULL;
