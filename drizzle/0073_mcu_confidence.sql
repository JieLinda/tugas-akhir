-- Keyakinan Penempatan (placement confidence) — angka KEDUA, di samping ranking.
--
-- Skor kompetensi menjawab "seberapa cocok orang ini dengan jabatannya".
-- Keyakinan penempatan menjawab "seberapa yakin penempatan ini bisa dijalankan".
-- Keduanya pertanyaan berbeda dan dilaporkan terpisah: TIDAK ADA satu pun kolom
-- di sini yang masuk ke `analysis_results.final_score`, dan matriks AHP tetap
-- 6x6. Menambah kriteria ke-7 akan membuat setiap matriks perbandingan
-- tersimpan gagal isValidPairwise() dan diam-diam jatuh ke bobot bawaan --
-- termasuk matriks yang di-pin run turunan, yang justru ada supaya bobot TIDAK
-- bergerak.
--
-- VERSI, bukan penimpaan. Satu run adalah catatan penilaian pada satu tanggal,
-- jadi menghitung ulang keyakinan setelah keterangan MCU diperbarui TIDAK boleh
-- menimpa angka yang menyertai run itu. Tiap hitung ulang menulis baris baru
-- dengan `version` berikutnya; `is_run_original` menandai satu-satunya baris
-- yang dihitung bersama run-nya sendiri. Pembaca menampilkan versi tertinggi
-- dan tetap bisa menunjukkan angka aslinya.
--
-- `payload` DIENKRIPSI dan bertipe text, alasan yang sama persis dengan
-- `candidate_simulations.payload` (drizzle/0061): ini prosa medis tentang orang
-- bernama, disimpan tanpa batas waktu. Pembacanya mengembalikan null saat
-- aplikasi terkunci, bukan melempar.
--
-- ON DELETE CASCADE ke scoring_runs: berbeda dengan `position_picks.run_id`,
-- ini BUKAN keputusan manusia yang berdiri sendiri -- ia hanya bermakna sebagai
-- keterangan atas satu ranking, jadi ia ikut hilang bersama ranking itu.
--
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0073_mcu_confidence.sql

CREATE TABLE IF NOT EXISTS mcu_confidence_assessments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES scoring_runs(id) ON DELETE CASCADE,
  candidate_id        uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,

  -- 1 = dihitung bersama run-nya. Hitung ulang menaikkan angka ini.
  version             integer NOT NULL DEFAULT 1,
  is_run_original     boolean NOT NULL DEFAULT false,

  -- Status MCU SAAT asesmen ini dibuat (terenkripsi, seperti kolom sumbernya).
  -- Disimpan supaya sebuah angka lama tetap bisa menjelaskan dirinya setelah
  -- status orangnya berubah.
  mcu_status          text,

  -- 0..100. 100 berarti tidak ada hal pada MCU yang menurunkan keyakinan.
  -- CATATAN: 100 dengan source='none' TIDAK berarti "sudah dinilai dan aman",
  -- melainkan "belum dinilai". Pembaca wajib membedakannya.
  confidence          numeric(5,2) NOT NULL,
  risk_level          varchar(10) NOT NULL,

  -- rule | llm-grounded | llm-structured | none
  source              varchar(20) NOT NULL,
  had_note            boolean NOT NULL DEFAULT false,
  without_job_profile boolean NOT NULL DEFAULT false,

  -- JSON tersegel: narrative, affectedDuties, mitigations, searchQueries, sources.
  payload             text,
  model               varchar(120),
  created_at          timestamp NOT NULL DEFAULT now(),

  CONSTRAINT uq_mcu_confidence_run_candidate_version UNIQUE (run_id, candidate_id, version)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_mcu_confidence_run ON mcu_confidence_assessments (run_id);
--> statement-breakpoint

-- Pengambilan versi terbaru per kandidat adalah pola baca yang paling sering.
CREATE INDEX IF NOT EXISTS idx_mcu_confidence_run_candidate_version
  ON mcu_confidence_assessments (run_id, candidate_id, version DESC);
