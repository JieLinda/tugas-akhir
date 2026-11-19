-- Snapshot konfigurasi tata kelola pada saat sebuah scoring run dibuat.
--
-- Template program (aturan filter kelayakan, kriteria & bobot, matriks AHP,
-- jumlah finalis) dan ambang readiness bebas diubah kapan saja setelah run
-- selesai. Selama ini halaman "Konfigurasi Run" membacanya secara langsung,
-- sehingga hasil penilaian yang sudah final bisa dijelaskan dengan aturan yang
-- belum tentu pernah berlaku untuknya.
--
-- Kolom ini ditulis SEKALI saat run dibuat dan tidak pernah diperbarui: run yang
-- sudah selesai adalah catatan penilaian pada tanggal tertentu, jadi konfigurasi
-- penyusunnya harus ikut dibekukan bersamanya.
--
-- NULL untuk run yang dibuat sebelum kolom ini ada — pembacanya harus jatuh
-- kembali ke template saat ini dan menandai bahwa itu rekonstruksi, bukan
-- konfigurasi asli.
--
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0053_scoring_run_config_snapshot.sql

ALTER TABLE scoring_runs
  ADD COLUMN IF NOT EXISTS config_snapshot jsonb;
