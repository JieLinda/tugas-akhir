-- I-1 — Kekekalan run yang sudah selesai (FR-SN-05, NFR-RR-03).
--
-- Run yang berstatus `completed` adalah catatan sebuah penilaian pada sebuah
-- tanggal. Angka hasilnya, snapshot konfigurasinya, dan keanggotaan pool-nya
-- tidak boleh berubah oleh aksi apa pun: perubahan tata kelola, sinkronisasi
-- data, pembuatan run anak, penandaan, maupun keputusan forum. Hal yang boleh
-- bertambah hanyalah catatan di tabel terpisah (`scoring_run_exclusions`,
-- `position_picks`, `mcu_confidence_assessments`, `candidate_simulations`), yang
-- masing-masing mencatat pelaku, waktu, dan alasan.
--
-- Sampai sekarang aturan ini hanya hidup di kode. Kode memang tidak pernah
-- mengubah run selesai dari web app, tetapi scoring-service sendiri menulis
-- `run_info` dan `config_snapshot.rerun.frozen` SESUDAH menandai run
-- `completed`. Engine sudah diubah agar `completed` menjadi tulisan terakhir.
-- Trigger di bawah ini menjadikan aturan itu janji database, bukan kebiasaan
-- kode: tulisan apa pun ke run selesai ditolak, dari deployable mana pun.
--
-- Pengecualian yang disengaja, masing-masing karena tindakan FK atau penanda manusia:
--   • `scoring_runs.parent_run_id` → NULL: FK `ON DELETE SET NULL` saat induk dihapus.
--   • `scoring_runs.program_template_id` → NULL: FK `ON DELETE SET NULL` saat program dihapus.
--   • `analysis_results.manual_rank`: urutan seri manual. Ini penanda manusia
--     atas seri yang nyata, bukan angka hasil — `rank` dan `final_score` tetap.
--     Kolom ini dibiarkan dapat ditulis karena memindahkannya ke tabel lain
--     menuntut migrasi data (lihat docs/rerun-requirements-audit.md §3).
--   • DELETE tidak dijaga: menghapus run, posisi, atau kandidat adalah tindakan
--     eksplisit yang menghapus catatan secara utuh (lewat cascade), bukan
--     mengubah isinya.
--
-- Aditif dan idempoten: hanya membuat fungsi dan trigger, tidak menyentuh baris
-- mana pun. Terapkan SETELAH drizzle/0086.
--   tsx scripts/apply-sql.ts drizzle/0087_completed_run_immutability.sql

CREATE OR REPLACE FUNCTION pulse_guard_completed_scoring_run() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'completed' THEN
    IF (to_jsonb(NEW) - 'parent_run_id' - 'program_template_id')
         IS DISTINCT FROM (to_jsonb(OLD) - 'parent_run_id' - 'program_template_id')
       OR (NEW.parent_run_id IS NOT NULL AND NEW.parent_run_id IS DISTINCT FROM OLD.parent_run_id)
       OR (NEW.program_template_id IS NOT NULL AND NEW.program_template_id IS DISTINCT FROM OLD.program_template_id)
    THEN
      RAISE EXCEPTION 'Run % sudah selesai dan tidak boleh diubah (I-1). Catat penandaan, keputusan, atau komentar di tabelnya sendiri.', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_scoring_runs_completed_immutable ON scoring_runs;
--> statement-breakpoint
CREATE TRIGGER trg_scoring_runs_completed_immutable
  BEFORE UPDATE ON scoring_runs
  FOR EACH ROW EXECUTE FUNCTION pulse_guard_completed_scoring_run();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_guard_completed_run_results() RETURNS trigger AS $$
DECLARE
  run_status text;
BEGIN
  SELECT status INTO run_status FROM scoring_runs WHERE id = OLD.run_id;
  IF run_status = 'completed'
     AND (to_jsonb(NEW) - 'manual_rank') IS DISTINCT FROM (to_jsonb(OLD) - 'manual_rank')
  THEN
    RAISE EXCEPTION 'Hasil run % sudah selesai dan tidak boleh diubah (I-1). Hanya urutan seri manual yang boleh dicatat.', OLD.run_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_analysis_results_completed_immutable ON analysis_results;
--> statement-breakpoint
CREATE TRIGGER trg_analysis_results_completed_immutable
  BEFORE UPDATE ON analysis_results
  FOR EACH ROW EXECUTE FUNCTION pulse_guard_completed_run_results();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_guard_completed_run_pool() RETURNS trigger AS $$
DECLARE
  run_status text;
BEGIN
  SELECT status INTO run_status FROM scoring_runs WHERE id = NEW.run_id;
  IF run_status = 'completed'
     AND (TG_OP = 'INSERT' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
  THEN
    RAISE EXCEPTION 'Pool run % sudah selesai dan tidak boleh diubah (I-1).', NEW.run_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_scoring_run_pool_aspects_completed_immutable ON scoring_run_pool_aspects;
--> statement-breakpoint
CREATE TRIGGER trg_scoring_run_pool_aspects_completed_immutable
  BEFORE INSERT OR UPDATE ON scoring_run_pool_aspects
  FOR EACH ROW EXECUTE FUNCTION pulse_guard_completed_run_pool();
