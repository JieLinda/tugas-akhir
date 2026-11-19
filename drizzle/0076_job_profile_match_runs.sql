-- Job Profile Match: persist the last RUN per business unit.
--
-- job_family_matches is the committed MAPPING (matched pairs only). The run
-- that produced it — including the "posisi tanpa profil" / "profil tanpa
-- incumbent" lists that exist only as by-products of a full run — lived nowhere
-- but the browser tab, so every visit to /job-profiles/match started blank and
-- cost another ~20s "Jalankan Pencocokan". One row per tenant, replaced on each
-- run. Idempotent.
CREATE TABLE IF NOT EXISTS job_profile_match_runs (
  id serial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  selected_tenant_ids jsonb NOT NULL,
  report jsonb NOT NULL,
  run_by varchar(255),
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_profile_match_runs_tenant
  ON job_profile_match_runs (tenant_id);
