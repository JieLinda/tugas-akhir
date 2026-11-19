ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "behavior_recommendation" varchar(255);
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "behavior_notes" text;
