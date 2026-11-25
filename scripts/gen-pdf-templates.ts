// Generate the editable Word templates for the two PDF uploads on Tambah Data.
//
//   npx tsx scripts/gen-pdf-templates.ts
//
// Output: public/templates/template-kamus-kompetensi.docx
//         public/templates/template-job-profile.docx
//
// The user fills one in Word and saves it as PDF ("Save As → PDF"); that PDF is
// what the upload accepts. Like scripts/gen-upload-templates.cjs for HAV/MCU,
// the layout is NOT decorative.
//
// KAMUS (sync-service/src/services/kamus-sync.ts, parseKamusPdf) reads the PDF
// by text POSITION, not as prose:
//   • ONE competency per page — the page's first line matching
//     /^TC\s*0*(\d+)\s*[–—-]\s*(.+)$/ starts a record; a second header on the
//     same page is NOT recognised. A page with no header continues the previous
//     competency's table. Pages before the first header are skipped, so the
//     instruction page is free text — but none of its LINES may start with
//     "TC <digits> -", or it would become a record.
//   • Everything between the header line and the level-label row is the
//     description.
//   • The label row holds exactly BASIC KNOWLEDGE / INTERMEDIATE / ADVANCE /
//     MASTERY, alone in their cells: the parser takes the column boundaries from
//     those labels' centres (a "1 BASIC KNOWLEDGE" cell would fail that and fall
//     back to the original template's fixed x positions).
//   • Level text is bucketed by where each line STARTS, so it stays inside its
//     own cell; no page header/footer (a footer line would land in a column).
//   The example competencies use TC 998/999, far above the real dictionary, so
//   uploading the template unedited can never overwrite a real entry.
//
// JOB PROFILE (sync-service/src/services/llm-processor.ts) is read by a vision
// model, so the layout is guidance for the model rather than geometry: the
// section names follow the fields of its JSON, and the two competency boxes
// carry the titles BEHAVIORAL COMPETENCY (no number column) and TECHNICAL
// COMPETENCY (with a Level 1–4 column), which is exactly how its prompt tells
// them apart. Placeholders are in [brackets] and must be replaced; the file
// NAME convention (position code first) is stated on the upload card, because
// the first matching tier reads the code from the file name.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from 'docx';

const OUT = join(process.cwd(), 'public', 'templates');
const FONT = 'Arial';
const NAVY = '1F3864';
const HEAD = 'DCE6F2';
const MUTED = '7F7F7F';
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '8C8C8C' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const run = (text: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) =>
  new TextRun({ text, font: FONT, bold: o.bold, size: o.size ?? 20, color: o.color, italics: o.italics });

const para = (
  text: string | TextRun[],
  o: { bold?: boolean; size?: number; color?: string; italics?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number } = {},
) =>
  new Paragraph({
    children: typeof text === 'string' ? [run(text, o)] : text,
    alignment: o.align ?? AlignmentType.LEFT,
    spacing: { after: o.after ?? 80, before: o.before ?? 0 },
  });

/** A placeholder the user overwrites: grey italic, in brackets. */
const hint = (text: string) => run(`[${text}]`, { italics: true, color: MUTED });

function cell(
  children: Paragraph[],
  o: { width: number; shade?: boolean; align?: (typeof VerticalAlignTable)[keyof typeof VerticalAlignTable]; span?: number } = { width: 0 },
): TableCell {
  return new TableCell({
    children,
    width: { size: o.width, type: WidthType.DXA },
    columnSpan: o.span,
    borders: BORDERS,
    verticalAlign: o.align ?? VerticalAlignTable.TOP,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: o.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: HEAD } : undefined,
  });
}

function table(widths: number[], rows: TableRow[]): Table {
  return new Table({
    rows,
    columnWidths: widths,
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
  });
}

// ── Kamus Kompetensi ────────────────────────────────────────────────────────

const LEVEL_LABELS = ['BASIC KNOWLEDGE', 'INTERMEDIATE', 'ADVANCE', 'MASTERY'];

type KamusExample = { code: string; name: string; description: string; levels: string[][] };

const KAMUS_EXAMPLES: KamusExample[] = [
  {
    code: 'TC 998',
    name: 'CONTOH NAMA KOMPETENSI',
    description:
      'Ganti dengan definisi kompetensi: apa yang dikuasai, untuk tujuan apa, dan dalam konteks pekerjaan apa. ' +
      'Satu sampai empat kalimat. Jangan memulai baris dengan kata Basic, Intermediate, Advance, atau Mastery.',
    levels: [
      ['Memahami konsep dasar dan istilah kompetensi ini.', 'Menjalankan tugas rutin dengan arahan atasan.'],
      ['Menjalankan tugas secara mandiri sesuai prosedur.', 'Mengidentifikasi masalah umum dan solusinya.'],
      ['Menganalisis masalah kompleks dan menyusun perbaikan.', 'Membimbing rekan kerja dalam kompetensi ini.'],
      ['Menetapkan standar dan kebijakan terkait kompetensi ini.', 'Menjadi rujukan lintas fungsi dan organisasi.'],
    ],
  },
  {
    code: 'TC 999',
    name: 'CONTOH KOMPETENSI KEDUA',
    description:
      'Contoh kompetensi kedua. Setiap kompetensi dimulai di halaman baru; salin halaman ini untuk menambah kompetensi.',
    levels: [
      ['Poin level 1.'],
      ['Poin level 2.'],
      ['Poin level 3.'],
      ['Poin level 4.'],
    ],
  },
];

// A4 landscape in twips; 1 cm margins leave a 26.7 cm text width.
const L_PAGE = { width: 16838, height: 11906 };
const L_MARGIN = 850;
const L_TEXT = L_PAGE.width - 2 * L_MARGIN; // 15138
const L_COL = Math.floor(L_TEXT / 4);

function kamusInstructions(): Paragraph[] {
  const lines = [
    'Cara memakai template ini:',
    '1. Halaman petunjuk ini boleh dibiarkan — halaman sebelum kompetensi pertama tidak dibaca. Kalimat di halaman ini tidak boleh diawali kode kompetensi.',
    '2. Satu kompetensi = satu halaman. Salin halaman contoh untuk menambah kompetensi; jangan menaruh dua kompetensi di satu halaman.',
    '3. Baris judul ditulis: kode TC + tiga angka, tanda pisah, lalu nama kompetensi dalam huruf besar — sendirian di barisnya, persis seperti contoh.',
    '4. Paragraf di antara judul dan tabel dibaca sebagai deskripsi. Jangan menaruh teks lain di sana.',
    '5. Baris judul tabel tetap berisi BASIC KNOWLEDGE, INTERMEDIATE, ADVANCE, MASTERY, masing-masing sendirian di selnya. Jangan menambah angka level di sel itu.',
    '6. Isi tiap level di bawah judul kolomnya, satu poin per baris. Tabel boleh berlanjut ke halaman berikutnya.',
    '7. Jangan menambah header atau footer halaman.',
    '8. Ganti atau hapus kedua contoh (kode 998 dan 999). Kode yang sudah ada di database akan diperbarui isinya, kode baru ditambahkan.',
    '9. Simpan sebagai PDF (File → Save As → PDF), lalu unggah PDF-nya di Tambah Data → Kamus Kompetensi.',
  ];
  return [
    para('TEMPLATE KAMUS KOMPETENSI TEKNIS', { bold: true, size: 32, color: NAVY, after: 240 }),
    ...lines.map((l, i) => para(l, { bold: i === 0, size: 22, after: 140 })),
  ];
}

function kamusPage(ex: KamusExample): (Paragraph | Table)[] {
  const header = new TableRow({
    tableHeader: true,
    children: LEVEL_LABELS.map((label) =>
      cell([para(label, { bold: true, size: 18, align: AlignmentType.CENTER, after: 0 })], {
        width: L_COL,
        shade: true,
        align: VerticalAlignTable.CENTER,
      }),
    ),
  });
  const body = new TableRow({
    children: ex.levels.map((points) =>
      cell(
        points.map((p) => para(`• ${p}`, { size: 17, after: 60 })),
        { width: L_COL },
      ),
    ),
  });
  return [
    new Paragraph({ children: [new PageBreak()] }),
    para(`${ex.code} – ${ex.name}`, { bold: true, size: 30, color: NAVY, after: 160 }),
    para(ex.description, { size: 20, after: 240 }),
    table([L_COL, L_COL, L_COL, L_COL], [header, body]),
  ];
}

function kamusDocument(): Document {
  return new Document({
    creator: 'Pulse',
    title: 'Template Kamus Kompetensi',
    sections: [
      {
        properties: {
          page: {
            // Portrait dimensions on purpose: the docx library swaps width and
            // height itself when the orientation is LANDSCAPE. Passing the
            // landscape numbers swapped them back to a portrait page, the
            // 4-column table overflowed, and the parser lost the Basic column
            // (caught by converting with Word and parsing the PDF).
            size: { width: L_PAGE.height, height: L_PAGE.width, orientation: PageOrientation.LANDSCAPE },
            margin: { top: L_MARGIN, bottom: L_MARGIN, left: L_MARGIN, right: L_MARGIN },
          },
        },
        children: [...kamusInstructions(), ...KAMUS_EXAMPLES.flatMap(kamusPage)],
      },
    ],
  });
}

// ── Job Profile ─────────────────────────────────────────────────────────────

const P_PAGE = { width: 11906, height: 16838 };
const P_MARGIN = 1000;
const P_TEXT = P_PAGE.width - 2 * P_MARGIN; // 9906
const LABEL_W = 2900;

const section = (title: string) =>
  para(title, { bold: true, size: 22, color: 'FFFFFF', before: 240, after: 100 });

/** Section heading as a filled bar (a one-cell table), like the original documents. */
function sectionBar(title: string): Table {
  return new Table({
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [section(title)],
            width: { size: P_TEXT, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: NAVY },
            borders: BORDERS,
            margins: { top: 20, bottom: 20, left: 100, right: 100 },
          }),
        ],
      }),
    ],
    columnWidths: [P_TEXT],
    width: { size: P_TEXT, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
  });
}

function kv(rows: Array<[string, string]>): Table {
  return table(
    [LABEL_W, P_TEXT - LABEL_W],
    rows.map(
      ([k, v]) =>
        new TableRow({
          children: [
            cell([para(k, { bold: true, size: 19, after: 0 })], { width: LABEL_W, shade: true }),
            cell([new Paragraph({ children: [hint(v)], spacing: { after: 0 } })], { width: P_TEXT - LABEL_W }),
          ],
        }),
    ),
  );
}

const gap = () => para('', { after: 60 });

function jobProfileDocument(): Document {
  const docInfoW = 4200;
  const docInfo = table(
    [1700, docInfoW - 1700],
    [
      ['No. Dokumen', 'JD-XXX-001'],
      ['Tanggal Efektif', 'YYYY-MM-DD'],
      ['Revisi', '0'],
      ['Halaman', '1 dari 2'],
    ].map(
      ([k, v]) =>
        new TableRow({
          children: [
            cell([para(k!, { size: 17, after: 0 })], { width: 1700 }),
            cell([new Paragraph({ children: [hint(v!)], spacing: { after: 0 } })], { width: docInfoW - 1700 }),
          ],
        }),
    ),
  );

  const respHeader = new TableRow({
    tableHeader: true,
    children: [
      cell([para('No', { bold: true, size: 19, after: 0 })], { width: 700, shade: true }),
      cell([para('Tanggung Jawab Utama', { bold: true, size: 19, after: 0 })], { width: 5400, shade: true }),
      cell([para('Indikator Keberhasilan', { bold: true, size: 19, after: 0 })], { width: P_TEXT - 6100, shade: true }),
    ],
  });
  const respRows = [1, 2, 3].map(
    (n) =>
      new TableRow({
        children: [
          cell([para(String(n), { size: 19, after: 0 })], { width: 700 }),
          cell([new Paragraph({ children: [hint('Tanggung jawab / aktivitas utama jabatan')], spacing: { after: 0 } })], { width: 5400 }),
          cell([new Paragraph({ children: [hint('KPI atau ukuran keberhasilannya')], spacing: { after: 0 } })], { width: P_TEXT - 6100 }),
        ],
      }),
  );

  const half = Math.floor(P_TEXT / 2);
  const behavioral = table(
    [half, P_TEXT - half],
    [
      new TableRow({
        children: [
          cell([para('BEHAVIORAL COMPETENCY', { bold: true, size: 19, after: 0 })], { width: P_TEXT, shade: true, span: 2 }),
        ],
      }),
      ...[0, 1].map(
        () =>
          new TableRow({
            children: [
              cell([new Paragraph({ children: [hint('Kompetensi perilaku, mis. Leadership')], spacing: { after: 0 } })], { width: half }),
              cell([new Paragraph({ children: [hint('Kompetensi perilaku, mis. Customer Focus')], spacing: { after: 0 } })], { width: P_TEXT - half }),
            ],
          }),
      ),
    ],
  );

  const levelW = 1200;
  const technical = table(
    [P_TEXT - levelW, levelW],
    [
      new TableRow({
        tableHeader: true,
        children: [
          cell([para('TECHNICAL COMPETENCY', { bold: true, size: 19, after: 0 })], { width: P_TEXT - levelW, shade: true }),
          cell([para('Level', { bold: true, size: 19, align: AlignmentType.CENTER, after: 0 })], { width: levelW, shade: true }),
        ],
      }),
      ...[
        ['Nama kompetensi teknis sesuai Kamus Kompetensi', '1–4'],
        ['Nama kompetensi teknis sesuai Kamus Kompetensi', '1–4'],
        ['Nama kompetensi teknis sesuai Kamus Kompetensi', '1–4'],
      ].map(
        ([name, level]) =>
          new TableRow({
            children: [
              cell([new Paragraph({ children: [hint(name!)], spacing: { after: 0 } })], { width: P_TEXT - levelW }),
              cell([new Paragraph({ children: [hint(level!)], alignment: AlignmentType.CENTER, spacing: { after: 0 } })], { width: levelW }),
            ],
          }),
      ),
    ],
  );

  const approvals = table(
    [Math.floor(P_TEXT / 3), Math.floor(P_TEXT / 3), P_TEXT - 2 * Math.floor(P_TEXT / 3)],
    [
      new TableRow({
        children: ['Dibuat oleh', 'Diperiksa oleh', 'Disetujui oleh'].map((t, i) =>
          cell([para(t, { bold: true, size: 19, after: 0 })], {
            width: i < 2 ? Math.floor(P_TEXT / 3) : P_TEXT - 2 * Math.floor(P_TEXT / 3),
            shade: true,
          }),
        ),
      }),
      new TableRow({
        children: [0, 1, 2].map((i) =>
          cell(
            [para('', { after: 400 }), new Paragraph({ children: [hint('Nama / Jabatan')], spacing: { after: 0 } })],
            { width: i < 2 ? Math.floor(P_TEXT / 3) : P_TEXT - 2 * Math.floor(P_TEXT / 3) },
          ),
        ),
      }),
    ],
  );

  return new Document({
    creator: 'Pulse',
    title: 'Template Job Profile',
    sections: [
      {
        properties: {
          page: {
            size: { width: P_PAGE.width, height: P_PAGE.height, orientation: PageOrientation.PORTRAIT },
            margin: { top: P_MARGIN, bottom: P_MARGIN, left: P_MARGIN, right: P_MARGIN },
          },
        },
        children: [
          para('JOB PROFILE', { bold: true, size: 36, color: NAVY, after: 120 }),
          docInfo,
          gap(),
          sectionBar('1. IDENTITAS JABATAN'),
          kv([
            ['Nama Jabatan', 'Nama jabatan persis seperti di struktur organisasi'],
            ['Division / Department', 'mis. Information Technology Division / IT Application Development'],
            ['Atasan Langsung', 'Nama jabatan atasan langsung'],
            ['Bawahan Langsung', 'Nama jabatan bawahan langsung, dipisah koma; "-" bila tidak ada'],
          ]),
          sectionBar('2. STRUKTUR ORGANISASI'),
          new Paragraph({
            children: [hint('Gambarkan bagan atau uraikan: atasan → jabatan ini → bawahan')],
            spacing: { before: 80, after: 80 },
          }),
          sectionBar('3. TUJUAN JABATAN'),
          new Paragraph({ children: [hint('Satu paragraf: mengapa jabatan ini ada dan hasil yang diharapkan')], spacing: { before: 80, after: 80 } }),
          sectionBar('4. TANGGUNG JAWAB UTAMA'),
          table([700, 5400, P_TEXT - 6100], [respHeader, ...respRows]),
          sectionBar('5. WEWENANG'),
          new Paragraph({ children: [run('1. '), hint('Wewenang pengambilan keputusan')], spacing: { before: 80, after: 40 } }),
          new Paragraph({ children: [run('2. '), hint('Wewenang lain')], spacing: { after: 80 } }),
          sectionBar('6. HUBUNGAN KERJA'),
          kv([
            ['Internal', 'Unit/jabatan di dalam perusahaan'],
            ['Eksternal', 'Pihak luar: vendor, pelanggan, regulator'],
          ]),
          sectionBar('7. PEMECAHAN MASALAH'),
          kv([
            ['Tantangan', 'Masalah khas yang dihadapi jabatan ini'],
            ['Perlu Persetujuan Atasan', 'Keputusan yang harus disetujui atasan'],
            ['Acuan', 'Kebijakan, SOP, atau regulasi yang dipakai'],
          ]),
          sectionBar('8. SPESIFIKASI JABATAN'),
          kv([
            ['Pendidikan', 'mis. S1 Teknik Informatika / Sistem Informasi'],
            ['Pengalaman', 'mis. Minimal 5 tahun di bidang terkait, 2 tahun sebagai supervisor'],
            ['Jenis Kelamin', 'Pria / Wanita, atau tidak dibatasi'],
            ['Keahlian / Sertifikasi', 'Keahlian atau sertifikasi yang disyaratkan'],
          ]),
          sectionBar('9. KOMPETENSI'),
          gap(),
          behavioral,
          gap(),
          technical,
          para('Level kompetensi teknis: 1 Basic Knowledge, 2 Intermediate, 3 Advance, 4 Mastery. Tulis level sebagai angka.', {
            size: 16,
            color: MUTED,
            before: 60,
          }),
          sectionBar('10. PENGESAHAN'),
          gap(),
          approvals,
        ],
      },
    ],
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const outputs: Array<[string, Document]> = [
    ['template-kamus-kompetensi.docx', kamusDocument()],
    ['template-job-profile.docx', jobProfileDocument()],
  ];
  for (const [name, doc] of outputs) {
    const path = join(OUT, name);
    writeFileSync(path, await Packer.toBuffer(doc));
    console.log(`wrote ${path}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
