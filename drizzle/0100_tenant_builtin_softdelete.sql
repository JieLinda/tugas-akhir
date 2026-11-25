-- Companies (tenants) can be added and removed from the app; the three
-- original ones are BUILT IN and can never be removed.
--
-- Until now the tenant list was a constant in lib/tenant.ts, so adding a
-- business unit needed a code change and a deploy. The list is now read from
-- this table (lib/tenant.ts: listTenants), created from the "+" in the header's
-- Company dropdown and removed from the trash icon beside a non-built-in name
-- (lib/tenant-actions.ts).
--
--   tenants.is_builtin  true for Mulia / MSO / ERRO (the seed uuids). The
--                       delete action refuses these, whatever the UI shows.
--   tenants.deleted_at  a removed company is TOMBSTONED, never deleted: 29
--                       tables reference tenants(id), most with NO ACTION, and
--                       audit rows / old runs must keep resolving its name.
--                       The delete action also refuses a company that still
--                       owns data (candidates, positions, runs, an active
--                       Company ID mapping, job-profile assignments...).
--
-- Re-creating a removed company's name restores that row (same id), because
-- the slug index stays total.
--
-- Apply BEFORE deploying the new web app: it selects both columns. A database
-- without them makes listTenants() fall back to the three built-ins (logged),
-- so the app keeps working but create/delete are refused.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_builtin boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at timestamp;
--> statement-breakpoint
UPDATE tenants SET is_builtin = true
 WHERE id IN ('10000000-0000-0000-0000-000000000001',
              '10000000-0000-0000-0000-000000000002',
              '10000000-0000-0000-0000-000000000003');
