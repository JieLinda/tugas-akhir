// "Panduan" (how to read the workbook) and "Ringkasan" (identity + every check,
// counted live: change an input and the mismatch counts follow).

import { BuildContext, SHEET } from '../context';
import { DATE_TIME, FS, N, mismatchCountF, serialOf } from '../sheet';

const STAGES: [string, string, string][] = [
  ['0', SHEET.params, 'Parameter, konstanta dan setelan env yang dipakai proses scoring — dirujuk lewat nama sel P_….'],
  ['1', SHEET.pool, 'Pembentukan pool: populasi → pejabat & rentang grade → aturan filter (pohon DAN/ATAU).'],
  ['2a', SHEET.techAnchors, 'Jangkar L/U kompetensi teknis dari sensus kamus (' + SHEET.censusKamus + ').'],
  ['2b', SHEET.careerAnchors, 'Jangkar L/U dokumen karier: tiga estimator (' + SHEET.censusCorpus + ', ' + SHEET.censusBest + ', ' + SHEET.censusFamily + ', ' + SHEET.censusMoves + ') → nilai tengah.'],
  ['2c', SHEET.censusDepth, 'T_tahun terukur per jenjang dari pengangkatan nyata (penjaga monotonisitas).'],
  ['2d', SHEET.idf, 'Bobot kekhasan IDF per kompetensi (' + SHEET.idfDocs + ').'],
  ['3', SHEET.labels, 'Label level kompetensi → level 1..4 (satu rumus per label).'],
  ['4', SHEET.techCand, 'Kompetensi Teknis: ' + SHEET.techRequired + ' → ' + SHEET.techHeld + ' → ' + SHEET.techPairs + ' (+ ' + SHEET.techCells + ') → skor.'],
  ['5', SHEET.careerCand, 'Relevansi Karier: ' + SHEET.careerStints + ' (+ jalur pengganti: Pengganti - Pemegang → Gabungan → Pasangan → ' + SHEET.careerFallback + '), ' + SHEET.careerTarget + ' → dua sumbu → skor.'],
  ['6', SHEET.behavior, 'Behavior: label → kategori → nilai ordinal → skor.'],
  ['7', SHEET.pa, 'Performance Appraisal: slot semester → nilai → bobot → D⁺/D⁻ → CC → skor.'],
  ['8', SHEET.hav, 'HAV: manual > upload > rumus → kuadran → skor.'],
  ['9', SHEET.education, 'Pendidikan: sumbu jenjang (aturan) + sumbu relevansi (model) → skor.'],
  ['10', SHEET.ahp, 'AHP: matriks berpasangan → bobot → λmaks, CI, CR → bobot efektif.'],
  ['11', SHEET.topsis, 'TOPSIS: x → norm → v → A⁺/A⁻ → D⁺/D⁻ → CC → peringkat → skor → readiness → finalis.'],
];

export function buildSummary(ctx: BuildContext): void {
  const b = ctx.b;
  const s = ctx.sheet(SHEET.summary, [52, 20, 14, 70]);
  s.row(['RINGKASAN RUN & PEMERIKSAAN']);
  s.blank();
  const id = b.run;
  const kv = (k: string, v: unknown) => s.row([k, v == null ? '—' : (v as any)]);
  kv('Run', id.id);
  kv('Label', id.label);
  kv('Posisi sasaran', id.positionTitle);
  kv('Program', id.programName);
  kv('Business unit', id.tenantName);
  kv('Metode', id.method);
  kv('Jenis run', id.parentRunId ? id.rerunModeLabel : 'Run root');
  kv('Run induk', id.parentRunId);
  kv('Alasan (run turunan)', id.rerunReason);
  kv('Pembuat', id.createdByName);
  s.row(['Dibuat', N(serialOf(id.createdAt), DATE_TIME)]);
  s.row(['Selesai', N(serialOf(id.completedAt), DATE_TIME)]);
  s.row(['Workbook dibuat', N(serialOf(b.generatedAt), DATE_TIME)]);
  kv('Kandidat dinilai (pool)', b.pool.length || b.results.length);
  kv('Jejak engine', b.engineTraceStatus.readable ? 'tersimpan' : b.engineTraceStatus.reason);
  kv('Jejak pembentukan pool', b.poolTraceStatus.readable ? 'tersimpan' : b.poolTraceStatus.reason);
  if (ctx.t) {
    kv('Zona waktu proses scoring-service', `${ctx.t.process.timeZone ?? '—'} (${ctx.t.process.offsetMinutes} menit), Node ${ctx.t.process.node}`);
    kv('Kandidat dibawa dari run induk', `${ctx.t.carried.candidateIds.length} (rinciannya dari jejak induk: ${ctx.t.carried.fromParentTrace})`);
  }
  if (b.censusMissing.length > 0) kv('Sensus dirujuk tetapi tidak ditemukan', b.censusMissing.map((c) => `${c.kind}:${c.fingerprint.slice(0, 24)}…`).join(', '));
  s.blank();
  s.row(['PEMERIKSAAN — rumus di workbook ini vs angka yang disimpan engine (dihitung langsung)']);
  s.row(['Tahap', 'Jumlah selisih', 'Toleransi', 'Keterangan']);
  for (const c of ctx.checks) {
    const r = s.next;
    s.row([c.label, mismatchCountF(c.range, `$C$${r}`), c.tolerance, c.note]);
  }
  const last = s.next - 1;
  const first = last - ctx.checks.length + 1;
  s.blank();
  s.row([
    'Status keseluruhan',
    ctx.checks.length ? FS(`IF(SUM(B${first}:B${last})=0,"SEMUA COCOK","ADA SELISIH — lihat baris di atas")`) : 'Tidak ada pemeriksaan (data tidak cukup)',
  ]);
}

export function buildGuide(ctx: BuildContext): void {
  const s = ctx.sheet(SHEET.guide, [10, 34, 110]);
  const b = ctx.b;
  s.row(['TRACE PERHITUNGAN RUN AHP + TOPSIS']);
  s.row(['', 'Run', `${b.run.id} — ${b.run.label ?? ''}`]);
  s.row(['', 'Posisi', b.run.positionTitle ?? '—']);
  s.blank();
  s.row(['', 'Tujuan', 'Verifikasi dan penelusuran manual: setiap angka antara data mentah kandidat dan peringkat akhir diturunkan ulang di sini dengan RUMUS EXCEL yang hidup, di samping angka yang benar-benar disimpan engine.']);
  s.row(['', 'Cara membaca', 'Kolom bertajuk "(rumus)" dihitung oleh Excel; kolom "engine" / "dipakai TOPSIS" adalah nilai yang disimpan run; kolom "Selisih" = rumus − engine. Lembar Ringkasan menghitung jumlah selisih per tahap secara langsung.']);
  s.row(['', 'Parameter', 'Semua parameter dirujuk lewat NAMA SEL (P_TEK_L, P_KAR_DECAY, …) di lembar Parameter. Ubah nilainya untuk melihat pengaruhnya pada skor dan peringkat — seluruh rantai menghitung ulang.']);
  s.row(['', 'Masukan vs rumus', 'Yang menjadi MASUKAN (bukan rumus): data mentah kandidat, cosinus yang diukur basis data vektor, jawaban model bahasa (pendidikan), dan hasil pencocokan teks (judul jabatan, regex tahun pengalaman, token jurusan). Semua langkah sesudahnya adalah rumus.']);
  s.row(['', 'Hungarian', 'Penugasan satu-satu yang memaksimalkan Σ nilai sel adalah optimasi, bukan rumus sel. Lembar Teknis - Sel Hungarian memuat SEMUA sel kandidat yang dipertimbangkan beserta pilihan engine, sehingga optimalitasnya dapat diperiksa dengan Solver.']);
  s.row(['', 'Pembulatan', 'Skor aspek memakai ROUND(x × 100, 0) (JavaScript Math.round). Excel menafsirkan angka pada 15 digit bermakna, sehingga nilai yang tepat di x,5 bisa — sangat jarang — dibulatkan berbeda; lembar Ringkasan akan menunjukkannya.']);
  s.row(['', 'Presisi jangkar', 'Jangkar yang dibaca dari kalibrasi tersimpan disimpan sebagai real (float4, ~7 digit): selisih ~1E-8 antara jangkar dipakai dan persentil sensus adalah pembulatan itu.']);
  s.row(['', 'Aplikasi', 'Butuh Excel 2019 / Microsoft 365 atau LibreOffice Calc ≥ 6 (fungsi MAXIFS, PERCENTILE.INC). Lembar sensus bisa berisi puluhan ribu baris; hitung ulang penuh bisa memakan beberapa detik.']);
  s.row(['', 'Kerahasiaan', 'Workbook ini memuat data kandidat (nilai PA, behavior, HAV, pendidikan, riwayat jabatan, status filter). Perlakukan seperti data personalia; unduhan ini dicatat di Riwayat Perubahan.']);
  s.blank();
  s.row(['Tahap', 'Lembar', 'Isi']);
  for (const [n, sheet, text] of STAGES) s.row([n, sheet, text]);
  s.blank();
  s.row(['', 'YANG TIDAK TERCATAT PADA RUN INI']);
  const gaps = Array.from(new Set(ctx.gaps));
  if (gaps.length === 0) s.row(['', '—', 'Tidak ada: seluruh tahap dapat diturunkan ulang dari data yang disimpan run.']);
  for (const g of gaps) s.row(['', '•', g]);
}
