-- Retire the folder→tenant mapping layer in favor of direct per-document /
-- per-upload tenant assignment (job_profile_tenants stays; the indirection
-- table above it goes).
--
-- Why this is safe: every document today already has a fully-resolved
-- ownership row in job_profile_tenants (280/280, all source='folder'). Those
-- rows are NOT derived data that disappears with the map — they are the real,
-- current answer to "who owns this document", just tagged with how they got
-- there. Relabeling them to 'manual' before dropping the map preserves every
-- existing assignment exactly as it is today; nothing needs to be re-entered.
UPDATE job_profile_tenants SET source = 'manual' WHERE source = 'folder';
--> statement-breakpoint
-- 'folder' rows are never written again after this migration (no more
-- reconciliation job on either side), so the default should reflect the one
-- remaining path: a direct assignment.
ALTER TABLE job_profile_tenants ALTER COLUMN source SET DEFAULT 'manual';
--> statement-breakpoint
DROP TABLE IF EXISTS job_profile_folder_map;
