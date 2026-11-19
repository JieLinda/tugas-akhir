-- MCU berhenti menggugurkan kandidat.
--
-- Sampai sekarang `mcuStatus in ('fit','fit_with_note')` adalah HARD FILTER di
-- ketiga template sistem (lib/program-defaults.ts, COMMON_HARD_FILTERS).
-- Akibatnya kandidat `unfit` tidak pernah dinilai sama sekali: ia tidak punya
-- skor, tidak punya peringkat, dan tidak punya penjelasan — ia hanya hilang
-- dengan satu baris alasan "MCU: Status MCU tidak Fit."
--
-- Itu menjawab pertanyaan yang salah. Temuan medis tidak membuat seseorang
-- kurang kompeten untuk sebuah jabatan; ia memengaruhi KEYAKINAN bahwa
-- penempatannya bisa dieksekusi. Dua hal itu dilaporkan terpisah sekarang:
-- skor kompetensi (AHP + TOPSIS, tetap enam aspek, tetap murni) dan Keyakinan
-- Penempatan (lapisan baru, tempat MCU menjadi faktor pengurang).
--
-- Karena itu aturannya diberi `severity: 'advisory'`, BUKAN dihapus:
--
--   * Dihapus berarti kehilangan catatan bahwa MCU pernah dinilai di sini, dan
--     menghilangkan domain nilainya dari editor.
--   * Advisory tetap dievaluasi dan tetap dilaporkan — hanya saja hasilnya
--     masuk `filterSummary.flagged`, bukan menggugurkan orangnya.
--   * Tenant yang memang menginginkan knockout bisa mengembalikannya lewat
--     Tata Kelola tanpa menulis ulang aturannya.
--
-- Kenapa per-aturan dan bukan sakelar `enforce_filter_rules` yang sudah ada:
-- sakelar itu mematikan SELURUH aturan program sekaligus, sehingga melunakkan
-- MCU berarti ikut melunakkan disiplin dan HAV. `severity` adalah satu-satunya
-- cara melunakkan tepat satu aturan.
--
-- `scoring_runs.config_snapshot` SENGAJA TIDAK DISENTUH. Run yang sudah selesai
-- adalah catatan penilaian pada satu tanggal, dan run-run itu memang dinilai
-- dengan MCU sebagai hard filter. Menulis ulang snapshotnya akan membuat
-- ranking lama menjelaskan dirinya dengan aturan yang tidak pernah berlaku
-- untuknya — kesalahan yang sama yang dicegah kolom itu sejak awal.
--
-- Idempoten: aturan yang SUDAH punya `severity` tidak disentuh, jadi menjalankan
-- ulang file ini tidak akan mengembalikan keputusan operator yang sengaja
-- mengubah MCU menjadi 'hard' lagi lewat Tata Kelola.
--   tsx scripts/apply-sql.ts drizzle/0071_mcu_advisory_filter.sql

-- Penelusuran rekursif, karena `filter_rules` menyimpan TIGA bentuk historis
-- yang semuanya masih ada di produksi dan dinormalisasi saat dibaca
-- (lib/filter-rules.ts: normalizeFilterTree):
--
--   1. { "tree": { "kind":"group", "op":"and", "children":[...] } }  ← kanonik
--   2. { "groups": [ { "rules": [...] } ] }                          ← lama
--   3. [ {...}, {...} ]                                              ← lama
--
-- Menulis satu UPDATE per bentuk berarti tiga jalur yang bisa berbeda diam-diam,
-- dan pohon kanonik boleh bersarang sedalam apa pun. Fungsi ini tidak peduli
-- bentuknya: ia menuruni apa pun yang berupa objek atau array dan menandai
-- setiap objek yang punya "field": "mcuStatus". Node lain dikembalikan apa
-- adanya, jadi aturan disiplin/HAV/PA tidak tersentuh.
-- Fungsi PERMANEN yang dibuang di akhir, bukan pg_temp: scripts/apply-sql.ts
-- menjalankan tiap statement lewat `pool.query()`, dan sebuah Pool tidak
-- menjamin statement berikutnya memakai koneksi yang sama. Fungsi pg_temp hidup
-- per-sesi, jadi ia bisa lenyap persis di antara CREATE dan UPDATE di bawah.
CREATE OR REPLACE FUNCTION mcu_mark_advisory_0071(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result jsonb;
  item   jsonb;
  k      text;
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  IF jsonb_typeof(node) = 'object' THEN
    -- Sebuah leaf rule. `field` adalah penanda yang dipakai coerceChild() di
    -- lib/filter-rules.ts untuk mengenali FilterRule telanjang, jadi ia juga
    -- penanda yang paling andal di sini.
    --
    -- `NOT node ? 'severity'` adalah kunci idempotensinya: aturan MCU yang sudah
    -- punya severity — entah dari file ini, entah karena operator sengaja
    -- mengembalikannya ke 'hard' — dibiarkan apa adanya.
    IF node ? 'field' AND node->>'field' = 'mcuStatus' AND NOT node ? 'severity' THEN
      RETURN node || '{"severity":"advisory"}'::jsonb;
    END IF;

    result := '{}'::jsonb;
    FOR k IN SELECT jsonb_object_keys(node) LOOP
      result := result || jsonb_build_object(k, mcu_mark_advisory_0071(node -> k));
    END LOOP;
    RETURN result;
  END IF;

  IF jsonb_typeof(node) = 'array' THEN
    result := '[]'::jsonb;
    FOR item IN SELECT * FROM jsonb_array_elements(node) LOOP
      result := result || jsonb_build_array(mcu_mark_advisory_0071(item));
    END LOOP;
    RETURN result;
  END IF;

  RETURN node;
END;
$$;
--> statement-breakpoint

-- Hanya baris yang benar-benar menyebut mcuStatus yang disentuh, supaya
-- template tanpa aturan MCU tidak ikut ditulis ulang (dan `updated_at`-nya
-- tidak bergeser tanpa alasan). Penjagaan idempotensi ada di dalam fungsi, per
-- ATURAN — bukan di sini per BARIS — karena satu template bisa memuat aturan
-- lain yang sudah punya severity, dan penjagaan tingkat baris akan membuat
-- aturan MCU-nya terlewat selamanya.
UPDATE program_templates
   SET filter_rules = mcu_mark_advisory_0071(filter_rules)
 WHERE filter_rules::text LIKE '%mcuStatus%';
--> statement-breakpoint

DROP FUNCTION IF EXISTS mcu_mark_advisory_0071(jsonb);
