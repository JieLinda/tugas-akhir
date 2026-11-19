-- Agent Studio M10/M14 — memori preferensi + resep.
--
--   agent_memories — preferensi yang dinyatakan user kepada agent, disuntikkan
--   ke prompt planner pada setiap perencanaan milik user itu. Terlihat di panel
--   Studio dan dapat dihapus — preferensi tak terlihat yang tak bisa dicabut
--   adalah sumber keluhan "kenapa hasilnya aneh" (docs/agent-studio.md §M10).
--
--   agent_recipes — rencana yang berhasil, disimpan untuk dijalankan ulang.
--   Menyimpan RENCANA, bukan hasil: replay membuat run baru yang divalidasi
--   ulang terhadap registry/izin/prasyarat hari ini.
--
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0050_agent_memories_recipes.sql

CREATE TABLE IF NOT EXISTS agent_memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  content     varchar(500) NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_agent_memories_tenant_user
  ON agent_memories (tenant_id, user_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS agent_recipes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  created_by     uuid NOT NULL REFERENCES users(id),
  name           varchar(120) NOT NULL,
  description    varchar(500),
  plan           jsonb NOT NULL,
  source_run_id  uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  use_count      integer NOT NULL DEFAULT 0,
  last_used_at   timestamp,
  created_at     timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_agent_recipes_tenant ON agent_recipes (tenant_id);
