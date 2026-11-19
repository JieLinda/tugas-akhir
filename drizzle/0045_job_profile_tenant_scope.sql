-- Tenant-scoping for job profile DOCUMENTS.
--
-- Until now the whole document stack was tenant-agnostic: sync_job_profiles has
-- no tenant column, job_profile_embed has none, and the topic-modeling tables
-- were explicitly documented as "global, not tenant-scoped". Every business unit
-- therefore saw the same 275 documents, all of which physically live in one
-- share subfolder named 'mulia'.
--
-- This migration introduces ownership WITHOUT touching the vectors: embeddings
-- are tenant-independent (same model, same space), so scoping is a join, not a
-- re-embed.
--
--   job_profile_folder_map  — editable folder → tenant(s) mapping, replacing the
--                             hardcoded folder logic that was removed earlier.
--   job_profile_tenants     — resolved per-document ownership (many-to-many, so
--                             one document can serve several BUs).
--   *.tenant_id             — topic runs and BERTopic configs become scopable;
--                             NULL keeps the existing global behaviour.
--
-- SCOPE OF EFFECT: display and analysis only (Job Profiles page, Job Family,
-- job-profile match). The scoring engines deliberately ignore these tables so
-- cross-tenant talent search keeps scoring every candidate against the same
-- corpus — see scoring-service/src/ahp-topsis-engine.ts.

CREATE TABLE IF NOT EXISTS "job_profile_folder_map" (
  "id"         serial PRIMARY KEY,
  -- sync_job_profiles.source_folder, lower-cased. '' / 'general' = share root.
  "folder"     varchar(200) NOT NULL,
  "tenant_id"  uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "label"      varchar(100),
  "is_active"  boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- One row per (folder, tenant): a shared folder may serve several BUs.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_profile_folder_map_folder_tenant"
  ON "job_profile_folder_map" ("folder", "tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_profile_folder_map_folder"
  ON "job_profile_folder_map" ("folder");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_profile_folder_map_tenant"
  ON "job_profile_folder_map" ("tenant_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "job_profile_tenants" (
  "job_profile_id" integer NOT NULL
    REFERENCES "sync_job_profiles"("id") ON DELETE CASCADE,
  "tenant_id"      uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- 'folder' rows are derived from job_profile_folder_map and rewritten on every
  -- sync; 'manual' rows are admin-pinned and the sync never deletes them.
  "source"         varchar(10) NOT NULL DEFAULT 'folder',
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("job_profile_id", "tenant_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_profile_tenants_tenant"
  ON "job_profile_tenants" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_profile_tenants_source"
  ON "job_profile_tenants" ("source");
--> statement-breakpoint

-- Topic runs: NULL tenant_id = global run over the whole corpus (what every
-- existing run was), non-null = clustered over that tenant's documents only.
ALTER TABLE "job_family_topic_runs"
  ADD COLUMN IF NOT EXISTS "tenant_id" uuid
  REFERENCES "tenants"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_topic_runs_tenant"
  ON "job_family_topic_runs" ("tenant_id");
--> statement-breakpoint

-- BERTopic configs: NULL = global default, non-null = per-tenant override.
-- Needed because min_cluster_size / n_neighbors tuned for a 275-document corpus
-- collapse a 30-document one into all-outliers.
ALTER TABLE "job_family_topic_configs"
  ADD COLUMN IF NOT EXISTS "tenant_id" uuid
  REFERENCES "tenants"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_family_topic_configs_tenant"
  ON "job_family_topic_configs" ("tenant_id");
--> statement-breakpoint

-- ── Backfill ──────────────────────────────────────────────────────
-- Seed the mapping for the only folder that currently exists. Tenant UUIDs match
-- the hardcoded list in lib/tenant.ts (Mulia / MSO / ERRO).
INSERT INTO "job_profile_folder_map" ("folder", "tenant_id", "label")
SELECT 'mulia', "id", 'Mulia'
  FROM "tenants"
 WHERE "id" = '10000000-0000-0000-0000-000000000001'
ON CONFLICT ("folder", "tenant_id") DO NOTHING;
--> statement-breakpoint

-- Resolve ownership for every already-synced document from that mapping. Driven
-- by the map (not hardcoded) so re-running it stays correct after folders change.
INSERT INTO "job_profile_tenants" ("job_profile_id", "tenant_id", "source")
SELECT p."id", m."tenant_id", 'folder'
  FROM "sync_job_profiles" p
  JOIN "job_profile_folder_map" m
    ON m."folder" = LOWER(COALESCE(p."source_folder", ''))
   AND m."is_active"
ON CONFLICT ("job_profile_id", "tenant_id") DO NOTHING;
