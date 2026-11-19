-- Candidates at-rest encryption: widen every encryptable column to `text` and
-- drop the mcu_status CHECK.
--
-- Why text: base64 AES-256-GCM ciphertext (lib/crypto/envelope.ts) runs ~1.5x
-- longer than the plaintext it wraps and its exact length depends on the value,
-- not the schema. varchar(20) cannot hold the seal of a 20-char string.
--
-- The mcu_status CHECK is dropped because the column now stores ciphertext,
-- which the database cannot validate against a plaintext domain.
--
-- This file is written by hand because `pnpm db:generate` is unusable in this
-- repo: drizzle/meta/_journal.json stops at 0005 while 0053 migrations exist,
-- so drizzle-kit's diff is against a 0005 snapshot and prompts interactively.
-- Apply with:  tsx scripts/apply-sql.ts drizzle/0054_candidates_encrypt.sql
-- (or psql:  psql $DATABASE_URL -f drizzle/0054_candidates_encrypt.sql)

ALTER TABLE "candidates" ALTER COLUMN "name" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "email" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "current_position" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "department" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "division" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "years_experience" SET DATA TYPE text USING "years_experience"::text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "photo_url" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "grade" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "discipline_status" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "mcu_status" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "performance_grade" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "hav_quadrant" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "behavior_recommendation" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "education" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "major" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "candidates" DROP CONSTRAINT IF EXISTS "mcu_status_check";
