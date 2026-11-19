-- A managed position can be held by more than one person.
--
-- Non-unique roles (SALESMAN, INSTRUCTOR, branch-level supervisors…) are held by
-- several active employees at once. The old single holder_name/holder_employee_id
-- pair forced the picker to choose one of them and label the rest "(+N pejabat
-- aktif lainnya)", which meant the others were neither shown on the position nor
-- excluded from its own candidate pool — a sitting incumbent could be ranked as
-- their own successor.
--
-- The pair stays on critical_positions as the PRIMARY holder: ~8 readers join on
-- it (job-profile suggestion, position→family mapping, progress-running, run
-- dossiers), and a nullable child table lets every one of them keep working
-- while the full set lives here.
CREATE TABLE IF NOT EXISTS critical_position_holders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid NOT NULL REFERENCES critical_positions(id) ON DELETE CASCADE,
  employee_id varchar(100) NOT NULL,
  name varchar(255),
  /** Mirrors critical_positions.holder_* — exactly one per position. */
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_critical_position_holders
  ON critical_position_holders (position_id, employee_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_critical_position_holders_position
  ON critical_position_holders (position_id);
--> statement-breakpoint
-- Backfill: every existing position keeps exactly the holder it already had, now
-- also recorded as a row here so readers can use one source.
INSERT INTO critical_position_holders (position_id, employee_id, name, is_primary)
SELECT cp.id, cp.holder_employee_id, cp.holder_name, true
  FROM critical_positions cp
 WHERE cp.holder_employee_id IS NOT NULL
   AND btrim(cp.holder_employee_id) <> ''
ON CONFLICT (position_id, employee_id) DO NOTHING;
