-- Agent Studio — state eksekusi satu perintah bahasa alami.
--
-- Tiga tabel, dan alasan pemisahannya (rancangan: docs/agent-studio.md §M8):
--
--   agent_sessions   utas percakapan Studio. Beberapa perintah berturut-turut
--                    milik satu sesi sehingga riwayat dapat dibuka kembali.
--
--   agent_runs       SATU perintah user: pertanyaannya, rencana yang disusun
--                    planner, dan jawaban akhirnya. `plan` disimpan utuh sebagai
--                    jsonb supaya sebuah run tetap dapat diaudit dan diputar
--                    ulang persis seperti saat dijalankan — bahkan setelah
--                    registry tool berubah bentuk.
--
--   agent_run_steps  satu baris per langkah. Sengaja TIDAK disimpan di dalam
--                    kolom `plan`: langkah punya siklus hidupnya sendiri
--                    (pending → running → polling → done) dan dimutasi berkali-
--                    kali oleh tick loop. Menyimpannya di dalam jsonb berarti
--                    menulis ulang seluruh rencana pada tiap detak, dan dua tab
--                    yang membuka run yang sama akan saling menimpa diam-diam.
--
-- Kenapa seluruh state ada di Postgres alih-alih di memori proses: eksekusi
-- digerakkan oleh pemanggilan berulang dari klien (docs/agent-studio.md §1.1),
-- jadi setiap detak adalah request berbeda tanpa ingatan bersama. Tab yang
-- ditutup menghentikan detak, bukan menghapus run — ia dilanjutkan saat dibuka.
--
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0047_agent_studio.sql

CREATE TABLE IF NOT EXISTS agent_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  title       varchar(255),
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant_user
  ON agent_sessions (tenant_id, user_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS agent_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  query          text NOT NULL,
  plan           jsonb,
  planner_model  varchar(120),
  status         varchar(30) NOT NULL DEFAULT 'awaiting_approval',
  answer         jsonb,
  error          text,
  budget         jsonb,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now(),
  finished_at    timestamp
);
--> statement-breakpoint

-- Status ditegakkan di basis data, bukan hanya di TypeScript: tick loop menulis
-- kolom ini dari beberapa jalur, dan salah ketik di salah satunya akan membuat
-- run menggantung tanpa pernah terlihat gagal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_status_check'
  ) THEN
    ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check
      CHECK (status IN ('awaiting_approval', 'running', 'completed', 'failed', 'cancelled', 'needs_clarification'));
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs (session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_user ON agent_runs (tenant_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs (status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS agent_run_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id          varchar(40) NOT NULL,
  seq              integer NOT NULL,
  tool_id          varchar(80) NOT NULL,
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_params  jsonb,
  status           varchar(20) NOT NULL DEFAULT 'pending',
  gate             varchar(10) NOT NULL DEFAULT 'auto',
  external_ref     jsonb,
  progress         text,
  output           jsonb,
  error            text,
  attempt          integer NOT NULL DEFAULT 0,
  started_at       timestamp,
  finished_at      timestamp,
  updated_at       timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Kunci anti eksekusi ganda. Tick loop mengklaim langkah dengan UPDATE
-- bersyarat (pending → running) pada baris ini; tanpa keunikan (run, step)
-- dua tab yang terbuka bersamaan dapat menyisipkan langkah kembar dan
-- menjalankan scoring dua kali.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_run_steps_run_step
  ON agent_run_steps (run_id, step_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_seq
  ON agent_run_steps (run_id, seq);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_run_steps_status_check'
  ) THEN
    ALTER TABLE agent_run_steps ADD CONSTRAINT agent_run_steps_status_check
      CHECK (status IN ('pending', 'running', 'polling', 'done', 'failed', 'skipped'));
  END IF;
END $$;
