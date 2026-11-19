-- Data MCU tidak lagi ikut dalam perhitungan skor.
--
-- Prompt sistem bawaan ketiga program (lib/program-defaults.ts) meminta AI
-- Tournament memprioritaskan "MCU Fit" / "ketangguhan fisik (MCU Fit)". Prompt
-- itu dibaca oleh scoring-service saat menilai kandidat, sehingga status MCU
-- ikut mewarnai skor kriteria dan skor akhir — padahal MCU hanya boleh muncul
-- sebagai angka terpisah (Keyakinan Penempatan) yang tidak menyentuh skor.
--
-- Default di kode sudah diperbaiki, tetapi template yang SUDAH tersimpan
-- menyimpan salinannya sendiri di `program_templates.system_prompt`. File ini
-- menghapus tiga frasa persis itu dari baris yang tersimpan. Hanya frasa
-- persisnya yang diganti, jadi bagian lain prompt — termasuk yang sudah diubah
-- operator lewat Tata Kelola — tidak tersentuh, dan menjalankan ulang file ini
-- tidak mengubah apa pun.
--
-- `scoring_runs.config_snapshot` SENGAJA TIDAK DISENTUH: run yang sudah selesai
-- adalah catatan penilaian pada satu tanggal, dan memang dinilai dengan prompt
-- lama.
--   tsx scripts/apply-sql.ts drizzle/0091_mcu_out_of_scoring_prompts.sql

UPDATE program_templates
   SET system_prompt = REPLACE(
         REPLACE(
           REPLACE(
             system_prompt,
             ', status disipliner bersih, MCU Fit, dan kuadran HAV',
             ', status disipliner bersih, dan kuadran HAV'),
           ', status kedisiplinan bersih, MCU Fit, dan kuadran HAV',
           ', status kedisiplinan bersih, dan kuadran HAV'),
         ', ketangguhan fisik (MCU Fit), status disipliner bersih',
         ', status disipliner bersih'),
       updated_at = now()
 WHERE system_prompt LIKE '%MCU Fit%';
