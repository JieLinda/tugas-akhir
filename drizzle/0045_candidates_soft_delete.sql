-- Soft delete for candidates.
--
-- WHY NOT A HARD DELETE
-- `candidates.id` is referenced with ON DELETE CASCADE by analysis_results,
-- position_picks, candidate_aspect_scores and job_family_matches, and is held
-- WITHOUT any foreign key inside tournament_sessions.current_pool /
-- pending_pool / carryover_losers / stages and scoring_runs.filter_summary.
-- Removing a row therefore destroys finished scoring history in four tables and
-- leaves dangling uuids in two more. A tombstone keeps every id valid.
--
-- WHY THE UNIQUE INDEX STAYS TOTAL
-- idx_candidates_tenant_employee_id is deliberately NOT made partial. The sync
-- upsert in sync-service/src/services/candidate-populate.ts infers its conflict
-- target from that index with `ON CONFLICT (tenant_id, employee_id)`; a partial
-- index makes that statement fail outright, and rewriting it to match would
-- make the next sync INSERT a brand-new uuid for an NPK that already has a
-- tombstoned row — which is precisely the identity break the tombstone exists
-- to prevent. Keeping it total means a resync UPDATES the existing row, so the
-- uuid every historical scoring row points at never changes.
--
-- deleted_mode decides whether a resync resurrects the row:
--   'bulk'   — cleared wholesale from the Sinkronisasi page before re-importing.
--              The next sync clears deleted_at and the candidate returns.
--   'manual' — removed one at a time from the Kandidat page because that person
--              does not belong in the pool. The weekly sync must NOT undo that.

ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "deleted_by" uuid;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "deleted_mode" varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'candidates_deleted_by_users_id_fk'
  ) THEN
    ALTER TABLE "candidates"
      ADD CONSTRAINT "candidates_deleted_by_users_id_fk"
      FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'candidates_deleted_mode_check'
  ) THEN
    ALTER TABLE "candidates"
      ADD CONSTRAINT "candidates_deleted_mode_check"
      CHECK ("deleted_mode" IS NULL OR "deleted_mode" IN ('bulk', 'manual'));
  END IF;
END $$;

-- Every candidate list, pool build and dashboard aggregate is "this tenant's
-- live candidates", so the partial index carries the filter rather than making
-- each of those queries scan tombstones it will discard.
CREATE INDEX IF NOT EXISTS "idx_candidates_tenant_live"
  ON "candidates" ("tenant_id") WHERE "deleted_at" IS NULL;

-- Identity resolution joins on a zero-padded employee_id and takes LIMIT 1
-- (lib/pulse-data.ts, lib/position-family-map-actions.ts,
-- scoring-service/src/scoring-engine.ts). With tombstones present those queries
-- must be able to prefer a live row cheaply.
CREATE INDEX IF NOT EXISTS "idx_candidates_live_employee"
  ON "candidates" ("tenant_id", "employee_id") WHERE "deleted_at" IS NULL;
