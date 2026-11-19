-- The ORDER of sync and manual HAV events decides which one is in force
-- (docs/talent-mapping.md § "Urutan waktu: sync vs manual").
--
-- HR's rule: whichever happened LAST wins. A Talent Mapping placement made
-- after a sync stands; a sync that changes somebody's automatic HAV (upload ›
-- formula PA × BA) after their placement replaces it. "A sync" is not only the
-- HAV Excel: PA and BA arrive from the MSSQL syncs and move the formula, so the
-- candidate sync that carries them counts too. Precedence alone (manual > upload
-- > formula) cannot express "last one wins" — it needs a clock on each side:
--
--   talent_mapping_placements.updated_at   when the hand placement was made
--                                           (already timestamptz, drizzle/0078)
--   candidates.hav_auto_changed_at          when a sync last CHANGED the
--                                           automatic HAV (new, here)
--
-- A placement is in force only while it is newer. The sync that moves the clock
-- also deletes the older placement and logs it; readers compare the two clocks
-- as well, so the answer stays right even if a placement and a sync race.
--
-- NULL = no sync has changed it since this column existed, so every placement
-- made before this migration stands until a sync actually changes that person's
-- automatic HAV. Deliberately NOT backfilled from sync_hav.synced_at: that is
-- bumped on every import, changed or not, so it would date "unchanged" as
-- "changed" and silently void the placements already on the map.
--
-- Not encrypted: it says when, never what.
--
-- Idempotent.

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS hav_auto_changed_at timestamptz;
--> statement-breakpoint
-- 'hav_upload' | 'hav_folder' | 'candidate_sync'
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS hav_auto_change_source varchar(30);
--> statement-breakpoint
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_hav_auto_change_source_check;
--> statement-breakpoint
ALTER TABLE candidates
  ADD CONSTRAINT candidates_hav_auto_change_source_check
  CHECK (hav_auto_change_source IS NULL OR hav_auto_change_source IN ('hav_upload', 'hav_folder', 'candidate_sync'));
--> statement-breakpoint
-- talent_audit_logs.action gains two values, documented here because the column
-- carries no CHECK (the 'five_box' rows leave it NULL):
--   'superseded_by_sync'  the candidate sync's new PA/BA moved the formula after
--                         a hand placement (the upload case stays 'superseded_by_upload')
--   'automatic_changed'   a sync changed the automatic HAV of somebody with no
--                         hand placement — logged so the trail shows every sync
--                         event between the manual ones, not only those that
--                         displaced somebody
CREATE INDEX IF NOT EXISTS idx_talent_audit_candidate_time
  ON talent_audit_logs (candidate_id, "timestamp");
