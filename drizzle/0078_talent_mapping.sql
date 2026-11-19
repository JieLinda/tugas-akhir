-- Talent Mapping: the HAV 16-box map of the Talent Pool (/talent-pool/mapping).
-- See docs/talent-mapping.md.
--
-- The formula (PA × behavioural assessment, lib/hav-quadrant-derive.ts) places
-- every Talent Pool candidate on every read; nothing about it is stored. What IS
-- stored is the human part:
--
--   talent_mapping_placements  STATE   — the current manual placement, one row
--                                         per candidate. It wins over the formula,
--                                         so a reviewer's decision is not silently
--                                         re-placed by the next recompute.
--   talent_audit_logs          HISTORY — one 'hav16' row per manual move: who,
--                                         when, from where to where, what the
--                                         formula said at that moment, and why.
--
-- talent_audit_logs is the parked 5-Box prototype's audit table
-- (drizzle/0055), reused rather than duplicated so a talent placement has ONE
-- trail. Its existing rows become mapping_kind = 'five_box' and are untouched.
-- new_box loses NOT NULL because a 'hav16' row deliberately leaves the 5-Box
-- columns empty: the box is derivable from the quadrant, and writing it in
-- plaintext next to an encrypted quadrant would publish the half that matters.
--
-- The quadrant and justification columns are text, not integer/varchar,
-- because they hold "v1:" ciphertext (encryptIfEnabled) — the same treatment
-- candidates.hav_quadrant gets. Timestamps are timestamptz, not the naive
-- `timestamp` that 55 older columns carry (see lib/db/pg-time.ts).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS talent_mapping_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  -- Encrypted "1".."16".
  quadrant text NOT NULL,
  -- Encrypted; the formula's answer when the placement was made. NULL = the
  -- formula could not place the candidate then (PA or assessment missing).
  formula_quadrant text,
  -- Encrypted. Mandatory: every deviation from the formula carries its reason.
  justification text NOT NULL,
  placed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  placed_by_username varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_talent_mapping_placements_candidate
  ON talent_mapping_placements (tenant_id, candidate_id);
--> statement-breakpoint

ALTER TABLE talent_audit_logs
  ADD COLUMN IF NOT EXISTS mapping_kind varchar(20) NOT NULL DEFAULT 'five_box';
--> statement-breakpoint
-- SET NULL, not CASCADE: an audit row must outlive the row it describes.
ALTER TABLE talent_audit_logs
  ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL;
--> statement-breakpoint
-- 'manual_place' | 'revert_to_formula'. NULL on 'five_box' rows.
ALTER TABLE talent_audit_logs ADD COLUMN IF NOT EXISTS action varchar(30);
--> statement-breakpoint
ALTER TABLE talent_audit_logs ADD COLUMN IF NOT EXISTS old_quadrant text;
--> statement-breakpoint
ALTER TABLE talent_audit_logs ADD COLUMN IF NOT EXISTS new_quadrant text;
--> statement-breakpoint
ALTER TABLE talent_audit_logs ADD COLUMN IF NOT EXISTS formula_quadrant text;
--> statement-breakpoint
-- Snapshot of the actor's login identity: changed_by_user_id goes NULL if the
-- user row is ever deleted, and "who did this" must survive that.
ALTER TABLE talent_audit_logs ADD COLUMN IF NOT EXISTS changed_by_username varchar(255);
--> statement-breakpoint
ALTER TABLE talent_audit_logs ALTER COLUMN new_box DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE talent_audit_logs DROP CONSTRAINT IF EXISTS talent_audit_logs_kind_check;
--> statement-breakpoint
ALTER TABLE talent_audit_logs
  ADD CONSTRAINT talent_audit_logs_kind_check CHECK (mapping_kind IN ('five_box', 'hav16'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_talent_audit_candidate ON talent_audit_logs (candidate_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_talent_audit_kind_tenant
  ON talent_audit_logs (tenant_id, mapping_kind, "timestamp");
