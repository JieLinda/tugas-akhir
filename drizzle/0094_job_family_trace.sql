-- Jejak perhitungan peta job family (Unduh trace pembentukan peta · XLSX).
--
-- Sebuah run topic modeling menyimpan HASILNYA (famili, penugasan, kata kunci)
-- dan beberapa diagnostik, tetapi tidak satu pun angka di antaranya: graf
-- tetangga UMAP beserta bandwidth tiap dokumen, pohon rentang dan pohon
-- terkondensasi HDBSCAN, matriks hitungan dan bobot idf c-TF-IDF, matriks
-- keanggotaan lunak di balik setiap "keanggotaan", kemiripan yang memindahkan
-- sebuah outlier. Semuanya hidup di dalam model yang sudah di-fit dan hilang
-- bersama prosesnya. topic-service kini menyalinnya ke tabel di bawah setelah
-- hasil run tersimpan (topic-service/app/trace.py), dan web app menyusunnya
-- menjadi workbook berisi rumus Excel hidup (lib/job-family-trace/).
--
-- `payload` = gzip(JSON). Satu baris per run; run yang dihapus menghapus
-- jejaknya. Isinya teks dokumen job profile dan vektornya — bukan data pribadi,
-- dan keduanya sudah tersimpan polos di job_profile_embed.
--
-- Urutan deploy: terapkan file ini SEBELUM topic-service baru. Bila belum,
-- run tetap selesai normal dan diagnostics.trace mencatat bahwa jejaknya tidak
-- tersimpan.
--
--   tsx scripts/apply-sql.ts drizzle/0094_job_family_trace.sql

CREATE TABLE IF NOT EXISTS job_family_topic_traces (
  run_id         uuid PRIMARY KEY REFERENCES job_family_topic_runs(id) ON DELETE CASCADE,
  format_version integer NOT NULL,
  payload        bytea NOT NULL,
  byte_size      integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Asal-usul setiap vektor dokumen, dicatat saat embedding: template yang
-- dipakai merestrukturisasi dokumennya, sumber dan dimensi model, dan sidik
-- data hasil ekstraksi yang direstrukturisasi. Tanpa ini, setelah template
-- berubah tidak ada yang bisa mengatakan dari teks mana sebuah vektor berasal.
--
-- job_profile_embed mengikuti VECTOR_DATABASE_URL dan boleh berada di instance
-- lain. Bagian ini hanya berlaku bila tabelnya ada di database tempat file ini
-- diterapkan; di instance vektor terpisah, ensureVectorDbSchema()
-- (lib/db/vector-db.ts) menambahkan kolom yang sama secara otomatis.
DO $$
BEGIN
  IF to_regclass('public.job_profile_embed') IS NOT NULL THEN
    ALTER TABLE job_profile_embed ADD COLUMN IF NOT EXISTS embed_template text;
    ALTER TABLE job_profile_embed ADD COLUMN IF NOT EXISTS embed_source varchar(40);
    ALTER TABLE job_profile_embed ADD COLUMN IF NOT EXISTS embed_dimensions integer;
    ALTER TABLE job_profile_embed ADD COLUMN IF NOT EXISTS extracted_hash varchar(64);
  END IF;
END $$;
