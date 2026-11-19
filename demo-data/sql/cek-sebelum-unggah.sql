-- Cek sebelum mengunggah data demo (HANYA MEMBACA, tidak mengubah apa pun).
-- Dibuat otomatis oleh demo-data/generate.py — jangan diedit manual.
--   psql "$DATABASE_URL" -f demo-data/sql/cek-sebelum-unggah.sql

\echo '1) Company ID yang bisa dipakai untuk kolom COMPANY_ID (harus aktif):'
SELECT company_id, tenant_id, label, is_active FROM sync_company_tenant_map ORDER BY company_id;

\echo '2) NPK demo yang SUDAH dipakai (harus kosong; bila tidak, buat ulang dengan --npk-prefix):'
SELECT 'sync_employees' AS tabel, employee_id AS npk, company_id, display_name AS info
  FROM sync_employees WHERE employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046')
UNION ALL
SELECT 'candidates', employee_id, tenant_id::text, CASE WHEN deleted_at IS NULL THEN 'aktif' ELSE 'tombstone' END
  FROM candidates WHERE employee_id IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046')
UNION ALL
SELECT 'sync_hav', npk, NULL, quadrant FROM sync_hav WHERE npk IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046')
UNION ALL
SELECT 'sync_mcu', npk, NULL, status FROM sync_mcu WHERE npk IN ('99001', '99002', '99003', '99004', '99005', '99006', '99007', '99008', '99009', '99010', '99011', '99012', '99013', '99014', '99015', '99016', '99017', '99018', '99019', '99020', '99021', '99022', '99023', '99024', '99025', '99026', '99027', '99028', '99029', '99030', '99031', '99032', '99033', '99034', '99035', '99036', '99037', '99038', '99039', '99040', '99041', '99042', '99043', '99044', '99045', '99046')
ORDER BY 1, 2;

\echo '3) Kode demo yang SUDAH ada (harus kosong pada unggahan pertama):'
SELECT 'sync_positions' AS tabel, position_id AS kode, company_id FROM sync_positions WHERE position_id IN ('DM01000001', 'DM01010001', 'DM01010011', 'DM01010012', 'DM01010013', 'DM01010021', 'DM01010022', 'DM01010023', 'DM01020001', 'DM01020011', 'DM01020021', 'DM01020022', 'DM02000001', 'DM02030001', 'DM02030011', 'DM02030021', 'DM02030022', 'DM02040001', 'DM02040011', 'DM02040021', 'DM03000001', 'DM03050001', 'DM03050011', 'DM03050021', 'DM03050022', 'DM04000001', 'DM04060001', 'DM04060011', 'DM04060021', 'DM04060022', 'DM04060099', 'DM05000001', 'DM05070001', 'DM05070011', 'DM05070012', 'DM05070021', 'DM05070022', 'DM05080001', 'DM05080011', 'DM05080021')
UNION ALL SELECT 'sync_divisions', iddivision, company_id FROM sync_divisions WHERE iddivision IN ('DMDIV01', 'DMDIV02', 'DMDIV03', 'DMDIV04', 'DMDIV05')
UNION ALL SELECT 'sync_departments', iddepartment, company_id FROM sync_departments WHERE iddepartment IN ('DMDEP01', 'DMDEP02', 'DMDEP03', 'DMDEP04', 'DMDEP05', 'DMDEP06', 'DMDEP07', 'DMDEP08')
UNION ALL SELECT 'sync_grade_levels', level_id || ' / ' || grade_id, company_id FROM sync_grade_levels WHERE level_id IN ('DM-STF', 'DM-SPV', 'DM-MGR', 'DM-GM', 'DM-DIR')
UNION ALL SELECT 'sync_kamus_kompetensi', code, source_file FROM sync_kamus_kompetensi WHERE code IN ('TC 901', 'TC 902', 'TC 903', 'TC 904', 'TC 905', 'TC 906', 'TC 907', 'TC 908', 'TC 909', 'TC 910', 'TC 911', 'TC 912', 'TC 913', 'TC 914')
UNION ALL SELECT 'sync_job_profiles', file_name, status FROM sync_job_profiles WHERE file_name IN ('DM04060001 JD-DMO-001 IT Application Development Department Head.pdf', 'DM02040001 JD-DMO-002 Treasury & Tax Department Head.pdf', 'DM01010001 JD-DMO-003 Retail Sales Department Head.pdf', 'DM03050001 JD-DMO-004 People Development Department Head.pdf', 'DM05080001 JD-DMO-005 Spare Parts Department Head.pdf', 'DM04060011 JD-DMO-006 IT Application Development Supervisor.pdf')
ORDER BY 1, 2;

\echo '4) Kode kompetensi di kamus Anda (untuk kolom TECHNICAL_ID di 06-kompetensi-teknis.xlsx):'
SELECT code, name FROM sync_kamus_kompetensi ORDER BY code;
