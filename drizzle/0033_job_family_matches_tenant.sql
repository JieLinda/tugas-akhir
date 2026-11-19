-- Add tenant/company division columns to job_family_matches so each stored
-- match records which Pulse tenant + MSSQL company the candidate belongs to.
ALTER TABLE "job_family_matches" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "job_family_matches" ADD COLUMN IF NOT EXISTS "company_id" varchar(20);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_matches_tenant" ON "job_family_matches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_matches_company" ON "job_family_matches" USING btree ("company_id");
