-- Behavioural-assessment HISTORY: the three most recent assessment-center
-- results per employee, for the Talent Mapping work queue (docs/talent-mapping.md
-- § Baki "Belum terpetakan").
--
-- sync_behavior_competencies keeps exactly ONE row per (company, employee) —
-- the latest assessment, which is what the HAV formula reads — while the MSSQL
-- source (DVP_ASSESSMENT_CENTER_DTL) holds every assessment. A reviewer placing
-- somebody by hand, because the formula cannot, wants the trajectory as well as
-- the last result ("READY in 2019, HIGH in 2023"), so the behaviour sync now also
-- copies the newest BEHAVIOR_HISTORY_DEPTH (3) distinct assessment dates here.
--
-- Deliberately a separate table rather than widening the unique key of the old
-- one: candidate-populate joins sync_behavior_competencies expecting one row per
-- employee, and a second row per person there would duplicate candidates.
--
-- Replaced per employee on every sync (delete + insert for the employees the
-- source returned); employees the source no longer returns keep their rows,
-- like every other sync table that is update-only. Readers merge in the current
-- sync_behavior_competencies row, so an Excel-uploaded BA (which writes only that
-- table) still shows as the newest entry, and an empty table degrades to "one
-- entry per person" rather than to nothing.
--
-- Plaintext, like the sync table it extends: the encrypted copy of the current
-- value is candidates.behavior_recommendation.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS sync_behavior_competency_history (
  id serial PRIMARY KEY,
  company_id varchar(10) NOT NULL,
  employee_id varchar(20) NOT NULL,
  -- 1 = the newest assessment date, up to the sync's history depth.
  rank smallint NOT NULL,
  tgl_pelaksanaan timestamptz NOT NULL,
  rekomendasi_name varchar(255),
  keterangan text,
  synced_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_behavior_history_assessment
  ON sync_behavior_competency_history (company_id, employee_id, tgl_pelaksanaan);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sync_behavior_history_employee
  ON sync_behavior_competency_history (company_id, employee_id, rank);
