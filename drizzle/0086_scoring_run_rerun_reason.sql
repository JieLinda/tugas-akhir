-- Alasan sebuah run turunan dibuat ("Tambah Kandidat Pembanding").
--
-- Re-run kini hanya satu mode — run induk dibekukan apa adanya dan yang berubah
-- hanya himpunan kandidat (lihat "Re-run scoring — aturan desain" di CLAUDE.md
-- dan docs/rerun-modes-inventory.md). Run pembanding seperti itu dibuat karena
-- ada pertanyaan dari forum ("bagaimana bila X ikut dipertimbangkan?"), dan
-- pertanyaan itulah yang menjelaskan mengapa run ini ada. Tanpa kolom ini
-- alasannya hanya hidup di audit_log, yang tidak dibaca pohon run maupun
-- halaman detail.
--
-- WAJIB diisi untuk setiap run turunan baru — divalidasi di server
-- (`validateRerunRequest`, lib/rerun-freeze.ts), bukan di sini. Kolomnya
-- sengaja nullable: run akar tidak punya alasan re-run, dan run lama dibuat
-- sebelum kolom ini ada. NULL berarti "tidak dicatat", bukan "tanpa alasan".
--
-- Aditif saja: tidak ada baris lama yang diubah, diisi ulang, atau dihapus.
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0086_scoring_run_rerun_reason.sql

ALTER TABLE scoring_runs
  ADD COLUMN IF NOT EXISTS rerun_reason text;
