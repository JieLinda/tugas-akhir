ALTER TABLE "program_templates" ADD COLUMN IF NOT EXISTS "target_finalists" integer NOT NULL DEFAULT 10;
