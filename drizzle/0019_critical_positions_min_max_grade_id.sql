ALTER TABLE "critical_positions" ADD COLUMN IF NOT EXISTS "min_grade_id" varchar(20);
ALTER TABLE "critical_positions" ADD COLUMN IF NOT EXISTS "max_grade_id" varchar(20);
