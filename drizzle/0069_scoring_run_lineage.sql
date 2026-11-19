-- Silsilah run: hubungan struktural antara sebuah run dan run yang menurunkannya.
--
-- Sampai sekarang hubungan itu hanya hidup di dalam jsonb — `run_info.augment
-- .baseRunId` atau `run_info.exclude.baseRunId` — yang berarti tiga hal:
--
--   1. Tidak bisa ditanya terbalik. "Run apa saja yang diturunkan dari X?"
--      membutuhkan pemindaian jsonb seluruh tabel, jadi tidak ada satu pun
--      tampilan yang menyajikannya.
--   2. Tidak lengkap. Mode "hitung ulang pool penuh" TIDAK menulis augment
--      maupun exclude, sehingga run turunan itu tercatat sebagai run akar —
--      terputus dari run dasarnya sejak menit pertama.
--   3. Ditulis oleh deployable yang salah. `run_info` diisi scoring-service saat
--      run SELESAI, jadi run yang gagal atau masih berjalan tidak punya induk
--      sama sekali, dan run yang sesinya sudah dihapus kehilangan jejaknya.
--
-- `parent_run_id` ditulis web app saat run DIBUAT, jadi induknya tercatat sejak
-- detik pertama dan tetap ada meski run-nya gagal.
--
-- ON DELETE SET NULL, bukan CASCADE. Menghapus satu run tidak boleh menghapus
-- penilaian-penilaian yang diturunkan darinya: itu catatan penilaian pada
-- tanggal tertentu, sama seperti alasan `position_picks.run_id` dan
-- `tournament_sessions.run_id` juga SET NULL. Anak yang kehilangan induknya
-- menjadi akar yatim, dan UI silsilah menampilkannya apa adanya.
--
-- `rerun_mode` SENGAJA terpisah dari parent_run_id. Punya induk (struktural) dan
-- cara diturunkan (semantik) adalah dua pernyataan berbeda: mode "hitung ulang
-- data terbaru" punya induk TETAPI benar-benar menjalankan ulang filter
-- kelayakan dan membekukan konfigurasi live-nya sendiri, sehingga ia tidak boleh
-- ikut menampilkan catatan "penyaringan dijalankan pada run dasar".
--
-- Nilai: baseline | incremental_add | refresh_add | exclude |
--        finalists_rematch | refresh_full  (lihat lib/rerun-modes.ts)
-- Dibiarkan nullable: NULL berarti "run lama, sebelum kolom ini ada", dan
-- pembacanya memperlakukannya sebagai baseline — yang secara struktural memang
-- benar, karena ia juga tidak punya induk.
--
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0069_scoring_run_lineage.sql

ALTER TABLE scoring_runs
  ADD COLUMN IF NOT EXISTS parent_run_id uuid;
--> statement-breakpoint

ALTER TABLE scoring_runs
  ADD COLUMN IF NOT EXISTS rerun_mode varchar(32);
--> statement-breakpoint

-- FK ditambahkan terpisah dan dijaga, karena ADD CONSTRAINT tidak punya
-- IF NOT EXISTS di PostgreSQL dan file ini harus aman dijalankan ulang.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scoring_runs_parent_run_id_fkey'
  ) THEN
    ALTER TABLE scoring_runs
      ADD CONSTRAINT scoring_runs_parent_run_id_fkey
      FOREIGN KEY (parent_run_id) REFERENCES scoring_runs(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_scoring_runs_parent ON scoring_runs (parent_run_id);
--> statement-breakpoint

-- Backfill. Dua sumber, karena `runInfo` ditulis ke dua tempat oleh dua
-- pernyataan terpisah dan yang kedua menelan errornya (drizzle/0065): run yang
-- gagal menulis salinan keduanya hanya punya penunjuk itu di sesinya.
--
-- Sengaja TIDAK lengkap, dan itu harus dinyatakan daripada disamarkan:
--   • Run yang dibuat sebelum drizzle/0065 tidak punya `run_info` sama sekali.
--   • Run yang sesinya sudah dihapus wizard lama kehilangan keduanya.
--   • Run mode "pool penuh" LAMA tidak pernah mencatat base run-nya di mana pun,
--     jadi induknya memang tidak bisa dipulihkan. Ia tetap menjadi akar.
-- Sisanya menjadi akar yatim, yang secara struktural tidak bisa dibedakan dari
-- run awal — dan itulah sebabnya `rerun_mode` di bawah hanya diisi ketika
-- induknya benar-benar ditemukan.
--
-- `WHERE parent_run_id IS NULL` membuatnya konvergen bila dijalankan ulang.
-- EXISTS menjaga FK: run dasar yang sudah dihapus tidak boleh dirujuk.
WITH src AS (
  SELECT r.id,
         COALESCE(
           r.run_info,
           (SELECT ts.final_ranked->'runInfo'
              FROM tournament_sessions ts
             WHERE ts.run_id = r.id AND ts.final_ranked ? 'runInfo'
             ORDER BY ts.updated_at DESC
             LIMIT 1)
         ) AS info
    FROM scoring_runs r
   WHERE r.parent_run_id IS NULL
),
resolved AS (
  SELECT id,
         COALESCE(info->'exclude'->>'baseRunId', info->'augment'->>'baseRunId') AS base_id,
         CASE
           WHEN info->'exclude'->>'baseRunId' IS NOT NULL THEN 'exclude'
           WHEN info->'augment'->>'baseRunId' IS NOT NULL THEN 'incremental_add'
           ELSE NULL
         END AS mode
    FROM src
)
UPDATE scoring_runs r
   SET parent_run_id = resolved.base_id::uuid,
       rerun_mode    = resolved.mode
  FROM resolved
 WHERE r.id = resolved.id
   AND resolved.base_id IS NOT NULL
   AND resolved.base_id ~ '^[0-9a-fA-F-]{36}$'
   AND resolved.base_id <> r.id::text
   AND EXISTS (SELECT 1 FROM scoring_runs p WHERE p.id = resolved.base_id::uuid);
--> statement-breakpoint

-- Semua run yang tersisa tanpa induk dicatat sebagai run awal. Ini pernyataan
-- struktural, bukan tebakan: tanpa induk, sebuah run memang titik awal
-- perbandingannya sendiri.
UPDATE scoring_runs
   SET rerun_mode = 'baseline'
 WHERE rerun_mode IS NULL
   AND parent_run_id IS NULL;
