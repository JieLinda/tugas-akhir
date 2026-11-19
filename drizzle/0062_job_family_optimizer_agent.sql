-- Asisten optimasi Job Family: agent bercakupan sempit + jejak mutu tiap run.
--
-- Jalankan ulang dengan:
--   pnpm exec tsx scripts/apply-sql.ts drizzle/0062_job_family_optimizer_agent.sql
--
-- Dua penambahan, keduanya menutup lubang yang berbeda.
--
-- 1. `agent_sessions.scope` — sebuah sesi agent kini boleh dibatasi pada satu
--    bidang pekerjaan. Panel di tab Pengaturan Job Family hanya boleh menyentuh
--    tool job family; tanpa cakupan yang TERSIMPAN, pembatasan itu hanya hidup
--    di dalam satu permintaan. Detak berikutnya (tab lama, sesi yang dibuka
--    kembali, resep yang diputar ulang) akan datang tanpa pembatas dan
--    menjalankan tool di luar bidangnya — yaitu tepat pada saat tidak ada
--    seorang pun yang sedang melihat. Kolomnya NULL untuk sesi Agent Studio
--    penuh, yang memang tidak dibatasi.
--
-- 2. `job_family_topic_runs.diagnostics` — tiga langkah pasca-clustering
--    (penempatan ulang outlier, pemangkasan jumlah topik, penyusunan Family
--    Tree) boleh gagal tanpa menggagalkan run, dan selama ini kegagalannya
--    ditelan `except: pass`. Akibatnya sebuah run berstatus 'completed' tidak
--    berarti setiap permintaan terpenuhi: user menyalakan "kurangi outlier",
--    melihat run selesai, dan outliernya utuh — tanpa satu pun keterangan.
--    Kolom ini merekam apa yang benar-benar terjadi di tiap langkah, termasuk
--    yang dilewati, sehingga asisten optimasi dapat menjelaskan hasilnya
--    alih-alih menebaknya.

ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS scope varchar(40);
--> statement-breakpoint

ALTER TABLE job_family_topic_runs
  ADD COLUMN IF NOT EXISTS diagnostics jsonb;
--> statement-breakpoint

-- Daftar sesi pada panel bercakupan selalu menyaring kolom ini lebih dulu.
CREATE INDEX IF NOT EXISTS idx_agent_sessions_scope
  ON agent_sessions (tenant_id, user_id, scope);
