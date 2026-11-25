"""Write the two helper SQL scripts with the EXACT identifiers of the generated
files (NPKs, position codes, ...), so they stay correct for a --npk-prefix
variant and can never touch a row the demo did not create.

Both run in psql (they use psql variables and \\if):

  psql "$DATABASE_URL" -f demo-data/sql/cek-sebelum-unggah.sql
  psql "$DATABASE_URL" -v company=DEMO -f demo-data/sql/hapus-data-demo.sql             # dry run
  psql "$DATABASE_URL" -v company=DEMO -v commit=1 -f demo-data/sql/hapus-data-demo.sql # for real
"""

from __future__ import annotations

from pathlib import Path

from . import dataset as ds
from .dataset import KAMUS_PDF_NAME as KAMUS_FILE
from .dataset import job_profile_file_name as jd_file_name


def _list(values) -> str:
    return ", ".join("'" + str(v).replace("'", "''") + "'" for v in values)


def _ids() -> dict[str, str]:
    return {
        "npk": _list(e.npk for e in ds.EMPLOYEES),
        "pos": _list(p.code for p in ds.POSITIONS),
        "div": _list(ds.DIVISIONS),
        "dep": _list(ds.DEPARTMENTS),
        "lvl": _list(lid for lid, _n, _g in ds.GRADE_LEVELS),
        "kamus": _list(code for code, _n in ds.COMPETENCIES.values()),
        "jd": _list(jd_file_name(code, jd) for code, jd in ds.JOB_PROFILE_SEATS),
    }


def precheck() -> str:
    i = _ids()
    return f"""-- Cek sebelum mengunggah data demo (HANYA MEMBACA, tidak mengubah apa pun).
-- Dibuat otomatis oleh demo-data/generate.py — jangan diedit manual.
--   psql "$DATABASE_URL" -f demo-data/sql/cek-sebelum-unggah.sql

\\echo '1) Company ID yang bisa dipakai untuk kolom COMPANY_ID (harus aktif):'
SELECT company_id, tenant_id, label, is_active FROM sync_company_tenant_map ORDER BY company_id;

\\echo '2) NPK demo yang SUDAH dipakai (harus kosong; bila tidak, buat ulang dengan --npk-prefix):'
SELECT 'sync_employees' AS tabel, employee_id AS npk, company_id, display_name AS info
  FROM sync_employees WHERE employee_id IN ({i['npk']})
UNION ALL
SELECT 'candidates', employee_id, tenant_id::text, CASE WHEN deleted_at IS NULL THEN 'aktif' ELSE 'tombstone' END
  FROM candidates WHERE employee_id IN ({i['npk']})
UNION ALL
SELECT 'sync_hav', npk, NULL, quadrant FROM sync_hav WHERE npk IN ({i['npk']})
UNION ALL
SELECT 'sync_mcu', npk, NULL, status FROM sync_mcu WHERE npk IN ({i['npk']})
ORDER BY 1, 2;

\\echo '3) Kode demo yang SUDAH ada (harus kosong pada unggahan pertama):'
SELECT 'sync_positions' AS tabel, position_id AS kode, company_id FROM sync_positions WHERE position_id IN ({i['pos']})
UNION ALL SELECT 'sync_divisions', iddivision, company_id FROM sync_divisions WHERE iddivision IN ({i['div']})
UNION ALL SELECT 'sync_departments', iddepartment, company_id FROM sync_departments WHERE iddepartment IN ({i['dep']})
UNION ALL SELECT 'sync_grade_levels', level_id || ' / ' || grade_id, company_id FROM sync_grade_levels WHERE level_id IN ({i['lvl']})
UNION ALL SELECT 'sync_kamus_kompetensi', code, source_file FROM sync_kamus_kompetensi WHERE code IN ({i['kamus']})
UNION ALL SELECT 'sync_job_profiles', file_name, status FROM sync_job_profiles WHERE file_name IN ({i['jd']})
ORDER BY 1, 2;

\\echo '4) Kode kompetensi di kamus Anda (untuk kolom TECHNICAL_ID di 06-kompetensi-teknis.xlsx):'
SELECT code, name FROM sync_kamus_kompetensi ORDER BY code;
"""


def cleanup() -> str:
    i = _ids()
    return f"""-- Menghapus data demo dari database.
-- Dibuat otomatis oleh demo-data/generate.py — jangan diedit manual.
--
-- Bawaan: HANYA MENAMPILKAN jumlah baris lalu ROLLBACK. Tambahkan -v commit=1 untuk benar-benar menghapus.
--   psql "$DATABASE_URL" -v company=DEMO -f demo-data/sql/hapus-data-demo.sql
--   psql "$DATABASE_URL" -v company=DEMO -v commit=1 -f demo-data/sql/hapus-data-demo.sql
--
-- company = Company ID yang Anda isikan di kolom COMPANY_ID berkas demo.
-- Yang dihapus HANYA baris berkunci identitas demo (NPK, kode posisi, kode kamus, nama berkas di bawah).
-- Kandidat TIDAK dihapus: kandidat dibuat tombstone (deleted_mode = 'bulk'), sesuai aturan aplikasi,
-- supaya hasil scoring / pilihan suksesor yang sempat dibuat saat demo tetap utuh. Mengunggah ulang
-- berkas demo lalu menjalankan sinkronisasi Kandidat akan memunculkan mereka kembali dengan id yang sama.
-- Tidak disentuh: pemetaan Company ID (nonaktifkan sendiri di Sinkronisasi), riwayat sync_runs,
-- dan vektor job profile di VECTOR_DATABASE_URL (dibangun ulang dari halaman Job Family).

\\set ON_ERROR_STOP on
\\if :{{?company}}
\\else
  \\echo 'Wajib: -v company=<Company ID yang dipakai di berkas demo>'
  \\quit
\\endif

BEGIN;

UPDATE candidates SET deleted_at = now(), deleted_by = NULL, deleted_mode = 'bulk'
 WHERE employee_id IN ({i['npk']})
   AND tenant_id IN (SELECT tenant_id FROM sync_company_tenant_map WHERE company_id = :'company')
   AND deleted_at IS NULL;

DELETE FROM sync_employee_positions     WHERE company_id = :'company' AND employee_id IN ({i['npk']});
DELETE FROM sync_technical_competencies WHERE company_id = :'company' AND employee_id IN ({i['npk']});
DELETE FROM sync_performance_appraisals WHERE company_id = :'company' AND employee_id IN ({i['npk']});
DELETE FROM sync_behavior_competencies  WHERE company_id = :'company' AND employee_id IN ({i['npk']});
DELETE FROM sync_disciplinary           WHERE company_id = :'company' AND employee_id IN ({i['npk']});
DELETE FROM sync_education              WHERE company_id = :'company' AND employee_id IN ({i['npk']});
-- COMPANY_ID kosong di Data Karyawan dulu tetap masuk (kini kolom itu wajib), jadi sisa lama ikut dibersihkan.
DELETE FROM sync_employees              WHERE (company_id = :'company' OR company_id IS NULL) AND employee_id IN ({i['npk']});
DELETE FROM sync_hav                    WHERE npk IN ({i['npk']});
DELETE FROM sync_mcu                    WHERE npk IN ({i['npk']});
-- Turunan (SEBELUM sync_positions, yang dirujuknya lewat positions.sync_position_id): 'Tambah Data' langsung mengisi positions (master posisi per Company) dari sync_positions.
-- Posisi yang sempat didaftarkan di Manajemen Posisi selama demo DIPERTAHANKAN (critical_positions merujuknya).
DELETE FROM positions p                 WHERE p.position_id IN ({i['pos']})
   AND p.tenant_id IN (SELECT tenant_id FROM sync_company_tenant_map WHERE company_id = :'company')
   AND NOT EXISTS (SELECT 1 FROM critical_positions cp WHERE cp.position_id = p.id);
DELETE FROM sync_position_hierarchy     WHERE company_id = :'company' AND position_id IN ({i['pos']});
DELETE FROM sync_positions              WHERE company_id = :'company' AND position_id IN ({i['pos']});
DELETE FROM sync_grade_levels           WHERE company_id = :'company' AND level_id IN ({i['lvl']});
DELETE FROM sync_departments            WHERE iddepartment IN ({i['dep']});
DELETE FROM sync_divisions              WHERE iddivision IN ({i['div']});
DELETE FROM sync_kamus_kompetensi       WHERE code IN ({i['kamus']}) AND source_file = '{KAMUS_FILE}';
-- job_profile_tenants, job_family_matches dan job_family_ai_match_cache ikut terhapus (ON DELETE CASCADE).
DELETE FROM sync_job_profiles           WHERE file_name IN ({i['jd']});

SELECT 'kandidat aktif tersisa' AS cek, count(*) AS n FROM candidates
 WHERE employee_id IN ({i['npk']}) AND deleted_at IS NULL
UNION ALL SELECT 'sync_employees tersisa', count(*) FROM sync_employees WHERE employee_id IN ({i['npk']})
UNION ALL SELECT 'sync_positions tersisa', count(*) FROM sync_positions WHERE position_id IN ({i['pos']})
UNION ALL SELECT 'positions (master Company) tersisa', count(*) FROM positions WHERE position_id IN ({i['pos']});

\\if :{{?commit}}
  COMMIT;
  \\echo 'Data demo dihapus (COMMIT).'
\\else
  ROLLBACK;
  \\echo 'Uji coba saja: semua perubahan di atas DIBATALKAN (ROLLBACK). Jalankan ulang dengan -v commit=1.'
\\endif
"""


def write_all(out_dir: Path) -> list[Path]:
    sql_dir = out_dir / "sql"
    sql_dir.mkdir(parents=True, exist_ok=True)
    a = sql_dir / "cek-sebelum-unggah.sql"
    b = sql_dir / "hapus-data-demo.sql"
    a.write_text(precheck(), encoding="utf-8")
    b.write_text(cleanup(), encoding="utf-8")
    return [a, b]
