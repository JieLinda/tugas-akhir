-- Konfirmasi per langkah untuk Agent Studio (Fase 2).
--
-- Fase 1 hanya mengenal persetujuan per-RENCANA: user meninjau seluruh langkah
-- sekali, lalu semuanya berjalan. Itu cukup selama seluruh tool hanya membaca
-- dan menjalankan. Begitu tool yang MENGUBAH data masuk kosakata, satu
-- persetujuan di muka tidak lagi memadai — dan bukan karena alasan seremonial:
--
--   Parameter sebuah langkah sering baru diketahui saat langkah sebelumnya
--   selesai. "Keluarkan Budi dari run terakhir" tersusun sebagai
--   `runId: "$s1.latestRunId"`; pada saat rencana ditinjau, user melihat sebuah
--   rujukan, bukan run yang sesungguhnya akan disentuh.
--
-- Kolom ini menandai langkah yang sudah dikonfirmasi. Langkah berkelas ubah yang
-- parameternya SUDAH konkret saat rencana ditinjau ikut dicap pada persetujuan
-- awal — meminta klik kedua untuk nilai yang sama persis hanya melatih user
-- menyetujui tanpa membaca, kebiasaan yang justru mematikan gunanya konfirmasi.
-- Yang parameternya masih berupa rujukan menunggu, lalu ditampilkan kembali
-- dengan nilai sebenarnya.
--
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0048_agent_step_approval.sql

ALTER TABLE agent_run_steps
  ADD COLUMN IF NOT EXISTS approved_at timestamp;
