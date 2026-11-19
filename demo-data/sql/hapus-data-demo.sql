-- Menghapus data demo dari database.
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

\set ON_ERROR_STOP on
\if :{?company}
\else
  \echo 'Wajib: -v company=<Company ID yang dipakai di berkas demo>'
  \quit
\endif

BEGIN;

UPDATE candidates SET deleted_at = now(), deleted_by = NULL, deleted_mode = 'bulk'
 WHERE employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046')
   AND tenant_id IN (SELECT tenant_id FROM sync_company_tenant_map WHERE company_id = :'company')
   AND deleted_at IS NULL;

DELETE FROM sync_employee_positions     WHERE company_id = :'company' AND employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046');
DELETE FROM sync_technical_competencies WHERE company_id = :'company' AND employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046');
DELETE FROM sync_performance_appraisals WHERE company_id = :'company' AND employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046');
DELETE FROM sync_behavior_competencies  WHERE company_id = :'company' AND employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046');
DELETE FROM sync_disciplinary           WHERE company_id = :'company' AND employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046');
DELETE FROM sync_education              WHERE company_id = :'company' AND employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046');
-- COMPANY_ID kosong di Data Karyawan tetap masuk (kolom itu tidak wajib di sumber ini), jadi ikut dibersihkan.
DELETE FROM sync_employees              WHERE (company_id = :'company' OR company_id IS NULL) AND employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046');
DELETE FROM sync_hav                    WHERE npk IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046');
DELETE FROM sync_mcu                    WHERE npk IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046');
DELETE FROM sync_position_hierarchy     WHERE company_id = :'company' AND position_id IN ('DM01000001', 'DM01010001', 'DM01010011', 'DM01010012', 'DM01010013', 'DM01010021', 'DM01010022', 'DM01010023', 'DM01020001', 'DM01020011', 'DM01020021', 'DM01020022', 'DM02000001', 'DM02030001', 'DM02030011', 'DM02030021', 'DM02030022', 'DM02040001', 'DM02040011', 'DM02040021', 'DM03000001', 'DM03050001', 'DM03050011', 'DM03050021', 'DM03050022', 'DM04000001', 'DM04060001', 'DM04060011', 'DM04060021', 'DM04060022', 'DM04060099', 'DM05000001', 'DM05070001', 'DM05070011', 'DM05070012', 'DM05070021', 'DM05070022', 'DM05080001', 'DM05080011', 'DM05080021');
DELETE FROM sync_positions              WHERE company_id = :'company' AND position_id IN ('DM01000001', 'DM01010001', 'DM01010011', 'DM01010012', 'DM01010013', 'DM01010021', 'DM01010022', 'DM01010023', 'DM01020001', 'DM01020011', 'DM01020021', 'DM01020022', 'DM02000001', 'DM02030001', 'DM02030011', 'DM02030021', 'DM02030022', 'DM02040001', 'DM02040011', 'DM02040021', 'DM03000001', 'DM03050001', 'DM03050011', 'DM03050021', 'DM03050022', 'DM04000001', 'DM04060001', 'DM04060011', 'DM04060021', 'DM04060022', 'DM04060099', 'DM05000001', 'DM05070001', 'DM05070011', 'DM05070012', 'DM05070021', 'DM05070022', 'DM05080001', 'DM05080011', 'DM05080021');
DELETE FROM sync_grade_levels           WHERE company_id = :'company' AND level_id IN ('DM-STF', 'DM-SPV', 'DM-MGR', 'DM-GM', 'DM-DIR');
DELETE FROM sync_departments            WHERE iddepartment IN ('DMDEP01', 'DMDEP02', 'DMDEP03', 'DMDEP04', 'DMDEP05', 'DMDEP06', 'DMDEP07', 'DMDEP08');
DELETE FROM sync_divisions              WHERE iddivision IN ('DMDIV01', 'DMDIV02', 'DMDIV03', 'DMDIV04', 'DMDIV05');
DELETE FROM sync_kamus_kompetensi       WHERE code IN ('TC 901', 'TC 902', 'TC 903', 'TC 904', 'TC 905', 'TC 906', 'TC 907', 'TC 908', 'TC 909', 'TC 910', 'TC 911', 'TC 912', 'TC 913', 'TC 914') AND source_file = '13-kamus-kompetensi-demo.pdf';
-- job_profile_tenants, job_family_matches dan job_family_ai_match_cache ikut terhapus (ON DELETE CASCADE).
DELETE FROM sync_job_profiles           WHERE file_name IN ('DM04060001 JD-DMO-001 IT Application Development Department Head.pdf', 'DM02040001 JD-DMO-002 Treasury & Tax Department Head.pdf', 'DM01010001 JD-DMO-003 Retail Sales Department Head.pdf', 'DM03050001 JD-DMO-004 People Development Department Head.pdf', 'DM05080001 JD-DMO-005 Spare Parts Department Head.pdf', 'DM04060011 JD-DMO-006 IT Application Development Supervisor.pdf');

SELECT 'kandidat aktif tersisa' AS cek, count(*) AS n FROM candidates
 WHERE employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046') AND deleted_at IS NULL
UNION ALL SELECT 'sync_employees tersisa', count(*) FROM sync_employees WHERE employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046')
UNION ALL SELECT 'sync_positions tersisa', count(*) FROM sync_positions WHERE position_id IN ('DM01000001', 'DM01010001', 'DM01010011', 'DM01010012', 'DM01010013', 'DM01010021', 'DM01010022', 'DM01010023', 'DM01020001', 'DM01020011', 'DM01020021', 'DM01020022', 'DM02000001', 'DM02030001', 'DM02030011', 'DM02030021', 'DM02030022', 'DM02040001', 'DM02040011', 'DM02040021', 'DM03000001', 'DM03050001', 'DM03050011', 'DM03050021', 'DM03050022', 'DM04000001', 'DM04060001', 'DM04060011', 'DM04060021', 'DM04060022', 'DM04060099', 'DM05000001', 'DM05070001', 'DM05070011', 'DM05070012', 'DM05070021', 'DM05070022', 'DM05080001', 'DM05080011', 'DM05080021');

\if :{?commit}
  COMMIT;
  \echo 'Data demo dihapus (COMMIT).'
\else
  ROLLBACK;
  \echo 'Uji coba saja: semua perubahan di atas DIBATALKAN (ROLLBACK). Jalankan ulang dengan -v commit=1.'
\endif
