-- Audit trail for sync executions.
--
-- Until now "last sync" in the UI was MAX(synced_at) on each sync table, which
-- only records when data CHANGED. A run that synced zero rows, failed halfway,
-- or was never triggered at all is indistinguishable from a healthy one — and a
-- stale timestamp gave no way to tell "nobody ran it" from "it ran and found
-- nothing". This table records the run itself, independent of its output.
CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Module key as used by the HTTP API / CLI: 'employees', 'hav', 'all',
  -- 'upload:job-profiles', …
  "job_key"        varchar(64) NOT NULL,
  -- running | success | failed. 'running' rows are reconciled on service start
  -- (see markInterruptedRuns) so a crash cannot leave one hanging forever.
  "status"         varchar(16) NOT NULL,
  -- ui | api | cron | cli — how it was kicked off.
  "trigger_source" varchar(16) NOT NULL DEFAULT 'api',
  -- upsert | rebuild, for the candidates sync.
  "mode"           varchar(16),
  -- Scope actually applied. NULL = all tenants / companies.
  "tenant_ids"     text[],
  "company_ids"    text[],
  -- Email of the user who triggered it via the UI; NULL for cron/cli.
  "actor"          varchar(200),
  "synced"         integer,
  "total"          integer,
  "message"        text,
  "error"          text,
  "started_at"     timestamptz NOT NULL DEFAULT now(),
  "finished_at"    timestamptz,
  "duration_ms"    integer
);
--> statement-breakpoint

-- "latest run per module" is the hot query behind the UI.
CREATE INDEX IF NOT EXISTS "idx_sync_runs_job_started"
  ON "sync_runs" ("job_key", "started_at" DESC);
--> statement-breakpoint

-- History view + "anything running right now?" polling.
CREATE INDEX IF NOT EXISTS "idx_sync_runs_started" ON "sync_runs" ("started_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_runs_status" ON "sync_runs" ("status");
