// Generate the downloadable Excel templates for the HAV and MCU uploads.
//
//   node scripts/gen-upload-templates.cjs
//
// Output: public/templates/template-hav-quadrant.xlsx
//         public/templates/template-mcu.xlsx
//
// The layout is NOT decorative — it mirrors exactly what the sync services read,
// so a file built from these templates cannot fail for structural reasons:
//
//   HAV  (sync-service/src/services/hav-sync.ts)
//     • sheet name MUST be "ALL"      -> `const sheetName = 'ALL'` is hardcoded;
//                                        any other name yields zero rows.
//     • columns: NPK, NAMA, Quadrant  -> read as row.NPK / row.NAMA / row.Quadrant
//                                        (header match is CASE-SENSITIVE)
//     • Quadrant: first number in the cell, must land in 1..16, else the row is
//                 skipped (normalizeQuadrant)
//
//   MCU  (sync-service/src/services/mcu-sync.ts)
//     • data must be the FIRST sheet  -> `workbook.SheetNames[0]`
//     • columns: NPK, Nama, Kesimpulan -> note "Nama" is title-case here while
//                                        HAV uses "NAMA"; they are different files
//     • Kesimpulan -> contains "unfit"            => unfit
//                     contains "fit" AND "note"   => fit_with_note
//                     contains "fit"              => fit
//                     anything else               => row skipped
//                     ("unfit" is tested first, so "unfit with note" is unfit)
//
// Both syncs UPSERT by NPK and never delete: an employee left out of the file
// keeps whatever a previous upload gave them. The Petunjuk sheet says so, because
// that is the single most common misunderstanding about these uploads.
const { utils, writeFile } = require('xlsx');
const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = path.resolve('public/templates');

/** Width hints so the generated file is readable without manual resizing. */
const widths = (...w) => w.map((wch) => ({ wch }));

function petunjukSheet(lines) {
  // Single unnamed column: this sheet is never parsed, only read by humans.
  const ws = utils.aoa_to_sheet(lines.map((l) => [l]));
  ws['!cols'] = widths(104);
  return ws;
}

// ── HAV Quadrant ──────────────────────────────────────────────
function buildHav() {
  const wb = utils.book_new();

  const data = utils.aoa_to_sheet([
    ['NPK', 'NAMA', 'Quadrant'],
    ['12345', 'Contoh Nama Karyawan', 1],
    ['12346', 'Contoh Nama Lainnya', 6],
    ['12347', 'Contoh Nama Ketiga', 16],
  ]);
  data['!cols'] = widths(14, 34, 12);
  // Sheet name is load-bearing — hav-sync reads Sheets['ALL'] and nothing else.
  utils.book_append_sheet(wb, data, 'ALL');

  utils.book_append_sheet(wb, petunjukSheet([
    'PETUNJUK PENGISIAN — HAV QUADRANT',
    '',
    'PENTING: nama sheet data harus tetap "ALL". Sistem hanya membaca sheet bernama ALL,',
    'sheet lain (termasuk sheet Petunjuk ini) diabaikan. Jangan ganti namanya.',
    '',
    'KOLOM (nama header harus sama persis, huruf besar/kecil berpengaruh):',
    '  NPK       — Nomor Pokok Karyawan. Wajib. Baris tanpa NPK diabaikan.',
    '  NAMA      — Nama karyawan. Opsional, hanya untuk memudahkan pembacaan.',
    '  Quadrant  — Kuadran HAV, angka 1 sampai 16. Wajib.',
    '',
    'FORMAT KOLOM Quadrant:',
    '  Sistem mengambil angka pertama yang ditemukan di sel, jadi semua ini diterima:',
    '    6            -> kuadran 6',
    '    Kuadran 6    -> kuadran 6',
    '    Q6           -> kuadran 6',
    '  Angka di luar 1-16 atau sel tanpa angka: barisnya DILEWATI (data lama tetap aman).',
    '',
    'SIFAT UNGGAHAN — MEMPERBARUI, BUKAN MENGGANTI:',
    '  Data dicocokkan per NPK. Karyawan yang TIDAK ada di file ini TIDAK dihapus —',
    '  mereka tetap memakai kuadran dari unggahan sebelumnya. Jadi file ini boleh berisi',
    '  hanya karyawan yang ingin diperbarui, tidak harus seluruh karyawan.',
    '',
    'SETELAH DIUNGGAH:',
    '  Berkas langsung diproses lalu DIHAPUS dari server. Simpan salinan Anda sendiri.',
    '',
    'Hapus baris contoh di sheet ALL sebelum mengisi data sebenarnya.',
  ]), 'Petunjuk');

  writeFile(wb, path.join(OUT_DIR, 'template-hav-quadrant.xlsx'));
}

// ── MCU ───────────────────────────────────────────────────────
function buildMcu() {
  const wb = utils.book_new();

  const data = utils.aoa_to_sheet([
    ['NPK', 'Nama', 'Kesimpulan', 'Keterangan'],
    ['12345', 'Contoh Nama Karyawan', 'Fit', ''],
    ['12346', 'Contoh Nama Lainnya', 'Fit With Note', 'Tekanan darah tinggi terkontrol, kontrol rutin 3 bulan'],
    ['12347', 'Contoh Nama Ketiga', 'Unfit', 'Hernia nukleus pulposus lumbal; tidak boleh angkat beban >10 kg'],
  ]);
  data['!cols'] = widths(14, 34, 22, 56);
  // MUST be appended first: mcu-sync reads SheetNames[0], whatever it is called.
  utils.book_append_sheet(wb, data, 'MCU');

  utils.book_append_sheet(wb, petunjukSheet([
    'PETUNJUK PENGISIAN — STATUS MCU',
    '',
    'PENTING: sheet data harus tetap menjadi sheet PERTAMA. Sistem membaca sheet pertama',
    'apa pun namanya, jadi jangan memindahkan sheet Petunjuk ini ke posisi pertama.',
    '',
    'KOLOM (nama header harus sama persis, huruf besar/kecil berpengaruh):',
    '  NPK         — Nomor Pokok Karyawan. Wajib. Baris tanpa NPK diabaikan.',
    '  Nama        — Nama karyawan. Opsional, hanya untuk memudahkan pembacaan.',
    '                Catatan: di file MCU ejaannya "Nama", sedangkan di file HAV "NAMA".',
    '  Kesimpulan  — Hasil MCU. Wajib.',
    '  Keterangan  — Penjelasan medis singkat. OPSIONAL tapi sangat dianjurkan',
    '                untuk yang berstatus Unfit atau Fit With Note.',
    '',
    'NILAI KOLOM Kesimpulan yang dikenali (tidak peka huruf besar/kecil):',
    '  Fit             -> fit',
    '  Fit With Note   -> fit_with_note   (mengandung kata "fit" dan "note")',
    '  Unfit           -> unfit',
    '  Nilai lain / sel kosong: barisnya DILEWATI (data lama tetap aman).',
    '  Teks tambahan masih diterima selama mengandung kata kuncinya, mis.',
    '  "FIT (dengan note tekanan darah)" tetap terbaca sebagai fit_with_note.',
    '  Teks selengkapnya kini DISIMPAN, tidak lagi dibuang setelah dibaca.',
    '',
    'UNTUK APA KOLOM Keterangan DIPAKAI:',
    '  Status MCU tidak menggugurkan kandidat; aturan MCU hanya menandai.',
    '  Keterangan disimpan sebagai catatan MCU kandidat dan tampil di formulir',
    '  Kandidat (Keterangan MCU).',
    '  Tulis kondisi dan batasannya, mis. "tidak boleh kerja shift malam" atau',
    '  "tidak boleh angkat beban >10 kg" — bukan diagnosis lengkap.',
    '',
    'SIFAT UNGGAHAN — MEMPERBARUI, BUKAN MENGGANTI:',
    '  Data dicocokkan per NPK. Karyawan yang TIDAK ada di file ini TIDAK dihapus —',
    '  mereka tetap memakai status dari unggahan sebelumnya (yang "fit" tetap "fit").',
    '  Jadi file ini boleh berisi hanya karyawan yang ingin diperbarui.',
    '',
    'SETELAH DIUNGGAH:',
    '  Berkas langsung diproses lalu DIHAPUS dari server. Simpan salinan Anda sendiri.',
    '',
    'Hapus baris contoh di sheet MCU sebelum mengisi data sebenarnya.',
  ]), 'Petunjuk');

  writeFile(wb, path.join(OUT_DIR, 'template-mcu.xlsx'));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
buildHav();
buildMcu();
for (const f of ['template-hav-quadrant.xlsx', 'template-mcu.xlsx']) {
  const p = path.join(OUT_DIR, f);
  console.log(`${f.padEnd(30)} ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
}
