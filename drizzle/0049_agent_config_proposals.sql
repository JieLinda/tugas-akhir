-- Agent Studio M9 — usulan perubahan konfigurasi.
--
-- Konfigurasi berlaku global per unit bisnis, dan kepatuhan agent pada
-- kebijakan konfigurasi adalah satu-satunya kemampuannya yang terukur di bawah
-- 100% (docs/agent-studio-fase0.md §3.4). Maka agent tidak pernah menulis
-- konfigurasi — ia menulis USULAN, dan manusia pemegang governance.manage yang
-- menerapkannya.
--
-- Dua snapshot pada tiap baris, direkam pada momen yang berbeda:
--   base     — nilai field yang diusulkan berubah, SAAT USULAN DIBUAT.
--              Diperiksa ulang saat diterapkan: bila sudah bergeser, penerapan
--              ditolak alih-alih menimpa perubahan yang tak pernah ditinjau.
--   previous — nilai penuh yang ditimpa, SAAT DITERAPKAN. Bahan pembatalan.
--
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0049_agent_config_proposals.sql

CREATE TABLE IF NOT EXISTS agent_config_proposals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  run_id      uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  domain      varchar(40) NOT NULL,
  target_id   varchar(120),
  patch       jsonb NOT NULL,
  base        jsonb,
  rationale   text NOT NULL,
  status      varchar(20) NOT NULL DEFAULT 'pending',
  previous    jsonb,
  applied_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  applied_at  timestamp,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_agent_config_proposals_tenant_status
  ON agent_config_proposals (tenant_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_config_proposals_run
  ON agent_config_proposals (run_id);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_config_proposals_status_check'
  ) THEN
    ALTER TABLE agent_config_proposals ADD CONSTRAINT agent_config_proposals_status_check
      CHECK (status IN ('pending', 'applied', 'rejected', 'rolled_back'));
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_config_proposals_domain_check'
  ) THEN
    ALTER TABLE agent_config_proposals ADD CONSTRAINT agent_config_proposals_domain_check
      CHECK (domain IN ('bertopic', 'ahp_weights', 'readiness', 'scoring_prompt', 'program_criteria'));
  END IF;
END $$;
