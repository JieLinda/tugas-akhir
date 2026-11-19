-- Employee personal information (birth date → candidate age).
--
-- Source: GET /employeeV1/employee/Information on the HR API gateway — the same
-- gateway and token as the disciplinary/education jobs, but this endpoint lists
-- every employee page by page (optionally filtered by `companyid`), so the job
-- pages through it once instead of calling per employee.
--
-- The endpoint also returns national ID / NPWP / BPJS numbers, phone and email.
-- None of that is stored: the product needs age, so only the birth date (plus
-- the display name, to make a row identifiable when reconciling) is kept.
-- Storing the rest would put identity documents in a database that is joined,
-- exported and fed to an LLM elsewhere in this app.
CREATE TABLE IF NOT EXISTS sync_employee_personal (
  id serial PRIMARY KEY,
  company_id varchar(10) NOT NULL,
  employee_id varchar(20) NOT NULL,
  display_name varchar(200),
  birth_date date,
  synced_at timestamptz NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_employee_personal
  ON sync_employee_personal (company_id, employee_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sync_employee_personal_employee
  ON sync_employee_personal (employee_id);
--> statement-breakpoint
-- Age is DERIVED, never stored: a stored age is wrong the day after it is
-- written. The birth date rides in the candidate row like every other personal
-- field, and is `text` because it is sealed with the candidate data key
-- (lib/candidate-crypto.ts) — which also means no SQL may filter or sort on it.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS birth_date text;
