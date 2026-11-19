-- Mode demo — data kandidat versi demo ("dupp"), status on/off per kandidat,
-- dan penanda demo pada run penilaian.
--
-- Mode demo dinyalakan per browser dengan kata kunci `?mode=demo` di URL
-- halaman mana pun (proxy.ts) dan TIDAK punya kontrol di UI. Di mode itu:
--
--   * Edit kandidat TIDAK menulis ke `candidates`. Seluruh isian yang tampil di
--     formulir disalin ke `candidates_dupp` (upsert per kandidat) dan dibaca
--     sebagai gantinya — oleh daftar & detail kandidat, filter, Talent Pool,
--     Talent Mapping, dan penilaian (web dan scoring-service).
--   * Kandidat OFF secara bawaan: hanya kandidat yang barisnya di
--     `candidate_demo_states` ber-`enabled = true` yang ikut filter, Talent Pool,
--     Talent Mapping, dan penilaian. Tidak ada baris = off.
--   * Reload menghapus baris dupp (data asli tampil lagi) dan menyalakan kandidat.
--   * Run yang dibuat di mode demo ditandai `is_demo` dan hanya tampil di mode
--     demo; mode asli tidak pernah menampilkannya, dan mode demo tidak
--     menampilkan run asli (run asli memuat kandidat yang sedang off).
--
-- `payload` disegel seperti kolom kandidat lain (encryptIfEnabled, format v1:):
-- isinya data personalia, termasuk bila disunting menjadi data rekaan.
--
-- Urutan deploy: terapkan file ini SEBELUM web app dan scoring-service baru,
-- karena skema Drizzle memilih `scoring_runs.is_demo` dan
-- `tournament_sessions.is_demo` pada setiap `select().from(...)`.
--
--   tsx scripts/apply-sql.ts drizzle/0093_demo_mode.sql

CREATE TABLE IF NOT EXISTS candidates_dupp (
  candidate_id uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  payload      text NOT NULL,
  sealed       boolean NOT NULL DEFAULT false,
  updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidates_dupp_tenant ON candidates_dupp (tenant_id);

CREATE TABLE IF NOT EXISTS candidate_demo_states (
  candidate_id uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  enabled      boolean NOT NULL DEFAULT false,
  updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidate_demo_states_on
  ON candidate_demo_states (candidate_id) WHERE enabled;

-- A constant default adds the column without rewriting rows, so the I-1
-- triggers on completed runs (drizzle/0087) never fire for it.
ALTER TABLE scoring_runs        ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE tournament_sessions ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_scoring_runs_is_demo ON scoring_runs (is_demo) WHERE is_demo;

-- A successor pick is a decision; one made in demo mode must never count in
-- real mode (RTC, "Suksesor terpilih", the Kandidat badge). Its own flag, not
-- a join through run_id: that column is nullable and ON DELETE SET NULL.
ALTER TABLE position_picks ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
-- ...and part of its unique key: (position, program, candidate) alone would let
-- a demo pick of someone already chosen in real mode upsert the REAL decision.
-- Every existing row is is_demo = false, so the wider key cannot collide.
DROP INDEX IF EXISTS idx_position_picks_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_position_picks_unique
  ON position_picks (position_id, program_code, candidate_id, is_demo);
