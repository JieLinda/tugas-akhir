-- Jejak perhitungan run (Unduh trace perhitungan · XLSX).
--
-- Sebuah run AHP+TOPSIS sudah menyimpan hasilnya (`analysis_results`), skor
-- aspek seluruh pool (`scoring_run_pool_aspects`), diagnostik tingkat run
-- (`scoring_runs.run_info`), dan konfigurasi yang dibekukan
-- (`scoring_runs.config_snapshot`). Yang TIDAK tersimpan di mana pun adalah
-- angka-angka di antara data mentah kandidat dan skor kriterianya, padahal
-- angka itulah yang dibutuhkan untuk menelusuri rumusnya secara manual:
--
--   • tanggal mulai/selesai tiap periode jabatan, bulan penuh, tahun sejak
--     berakhir dan faktor peluruhan per stint (career) — hanya "tahun" dan nilai
--     yang dibulatkan 4 desimal yang tersimpan;
--   • matriks sel Hungarian (cosinus mentah tiap pasangan kompetensi yang
--     dipertimbangkan, bukan hanya pasangan yang terpilih), label level mentah
--     kandidat, dan bobot IDF per kompetensi acuan pada jalur pengganti career;
--   • nilai per slot, bobot slot, D⁺/D⁻ PA; indeks kategori behavior; peringkat
--     jenjang pendidikan; pembagi kolom, titik ideal dan anti-ideal TOPSIS;
--   • parameter yang bisa diubah lewat env (rentang selisih level, surplus,
--     peluruhan, plafon jalur pengganti, ...), yang selama ini hanya hidup di
--     proses scoring-service;
--   • sebaran sensus di balik setiap jangkar (kamus, korpus job profile, kurva
--     rumpun hasil topic-service, mutasi nyata, pengangkatan nyata, IDF). Tabel
--     kalibrasi yang ada hanya singleton berisi hasil akhirnya dan ditimpa
--     setiap kali korpus berubah.
--
-- Dua tabel, keduanya hanya bertambah:
--
-- 1. scoring_run_traces — satu baris per (run, tahap). `stage = 'pool'` ditulis
--    web app saat run dibuat (nilai kolom aturan filter dan hasil gerbang per
--    kandidat); `stage = 'engine'` ditulis scoring-service SEBELUM run ditandai
--    `completed`. `payload` adalah JSON yang DISEGEL dengan kunci data aplikasi
--    (format `v1:` yang sama dengan `candidate_simulations.payload`), karena
--    isinya data kandidat; `sealed = false` hanya pada instalasi yang tidak
--    pernah mengaktifkan enkripsi. Saat kunci terkunci jejak TIDAK ditulis —
--    tidak pernah sebagai teks biasa — dan run mencatat alasannya di
--    `run_info.trace`.
--
-- 2. scoring_census_snapshots — sebaran yang diukur sebuah sensus, per
--    (jenis, fingerprint masukan). Tidak berisi identitas kandidat: pasangan
--    dokumen job profile, cosinus mutasi antar-job profile, judul jabatan dan
--    lama bekerja saat diangkat, frekuensi kompetensi. Sebuah run merujuknya
--    lewat fingerprint di jejaknya, sehingga sensus yang sama dipakai bersama
--    oleh banyak run tanpa disalin.
--
-- I-1: jejak run yang sudah `completed` tidak boleh ditambah atau diubah —
-- dijaga trigger di bawah, sama dengan `scoring_run_pool_aspects`.
--
-- Aditif dan idempoten. Terapkan SEBELUM scoring-service dan web app baru
-- berjalan; tanpa tabel ini keduanya tetap jalan, hanya jejaknya yang tidak
-- tersimpan (kegagalan menulis dicatat, tidak pernah menggagalkan run).
--   tsx scripts/apply-sql.ts drizzle/0092_scoring_run_trace.sql

CREATE TABLE IF NOT EXISTS scoring_run_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES scoring_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stage varchar(16) NOT NULL,
  version integer NOT NULL,
  payload text NOT NULL,
  sealed boolean NOT NULL DEFAULT false,
  byte_size integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scoring_run_traces_stage_check CHECK (stage IN ('pool', 'engine'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_scoring_run_traces_run_stage
  ON scoring_run_traces (run_id, stage);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_scoring_run_traces_tenant
  ON scoring_run_traces (tenant_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS scoring_census_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(40) NOT NULL,
  fingerprint varchar(200) NOT NULL,
  payload jsonb NOT NULL,
  sample_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_scoring_census_snapshots_kind_fingerprint
  ON scoring_census_snapshots (kind, fingerprint);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_guard_completed_run_trace() RETURNS trigger AS $$
DECLARE
  run_status text;
BEGIN
  SELECT status INTO run_status FROM scoring_runs WHERE id = NEW.run_id;
  IF run_status = 'completed'
     AND (TG_OP = 'INSERT' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
  THEN
    RAISE EXCEPTION 'Jejak run % sudah selesai dan tidak boleh diubah (I-1).', NEW.run_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_scoring_run_traces_completed_immutable ON scoring_run_traces;
--> statement-breakpoint
CREATE TRIGGER trg_scoring_run_traces_completed_immutable
  BEFORE INSERT OR UPDATE ON scoring_run_traces
  FOR EACH ROW EXECUTE FUNCTION pulse_guard_completed_run_trace();
