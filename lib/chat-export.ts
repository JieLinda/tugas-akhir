/**
 * Export one AI-assistant conversation as PDF, Word (.docx) or Excel (.xlsx).
 *
 * All three read the SAME block model (`lib/chat-transcript.ts`) and the same
 * summary rows, so the three files can never describe the run differently. What
 * each format is actually for:
 *
 *  - **PDF** — the archival copy. Fixed pagination, per-message headers, page
 *    numbers; what gets attached to a succession decision.
 *  - **Word (.docx)** — the editable copy, for pasting into an HR memo. Real
 *    OOXML via `docx`, so paragraphs, lists and tables are Word objects the
 *    reader can edit, and Word never shows a format warning.
 *  - **Excel** — the analysable copy: one row per turn, plus every markdown
 *    table the assistant produced lifted out into real cells, which is the one
 *    thing the other two formats cannot give.
 *
 * Everything runs in the browser off the history the panel already holds — there
 * is no server round-trip and therefore no second copy of the permission and
 * decryption rules in `lib/chat-actions.ts` to keep in step.
 */

import type { Paragraph as DocxParagraph, Table as DocxTable } from 'docx';
import { downloadBlob, fileDateStamp, slugify } from '@/lib/file-download';
import {
  buildSummaryRows,
  buildTranscript,
  collectTables,
  inlineToPlain,
  inlineToTokens,
  type ChatExportMessage,
  type ChatExportMeta,
  type TranscriptEntry,
} from '@/lib/chat-transcript';

export interface ChatExportPayload {
  meta: ChatExportMeta;
  messages: ChatExportMessage[];
}

const DOC_TITLE = 'Riwayat Chat AI Assistant';

function fileBase(meta: ChatExportMeta) {
  return `pulse-chat-${slugify(meta.positionTitle) || 'run'}-${fileDateStamp()}`;
}

/** True when there is at least one message worth writing to a file. */
export function hasExportableChat(messages: ChatExportMessage[]) {
  return messages.some((m) => m.content?.trim());
}

// ─── PDF ──────────────────────────────────────────────────────────

/**
 * jsPDF's built-in fonts are WinAnsi-encoded, so a character outside that set
 * prints as a blank or a wrong glyph — silently, in a document nobody re-reads.
 * The assistant emits exactly these through `stripLatexMath` (arrows, relations,
 * sigma), so they are transliterated rather than embedding a Unicode font, which
 * would mean shipping a ~300 KB TTF for a handful of symbols.
 */
const PDF_SUBSTITUTIONS: [RegExp, string][] = [
  [/[→⟶]/g, '->'],
  [/[⇒⟹]/g, '=>'],
  [/←/g, '<-'],
  [/≤/g, '<='],
  [/≥/g, '>='],
  [/≠/g, '!='],
  [/≈/g, '~='],
  [/Σ/g, 'Sigma'],
  [/Π/g, 'Pi'],
  [/∞/g, 'tak terbatas'],
  [/√/g, 'akar'],
  [/α/g, 'alpha'],
  [/β/g, 'beta'],
  [/σ/g, 'sigma'],
  [/[✓✔]/g, 'v'],
  [/[✗✘]/g, 'x'],
  [/[─-╿]/g, '-'],
  [/ /g, ' '],
];

function pdfSafe(text: string): string {
  let out = text;
  for (const [re, to] of PDF_SUBSTITUTIONS) out = out.replace(re, to);
  return out;
}

export async function exportChatPdf(payload: ChatExportPayload) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const entries = buildTranscript(payload.messages);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  /** Break the page when `needed` points would overflow the bottom margin. */
  function ensureRoom(needed: number) {
    if (y + needed <= pageHeight - margin - 18) return;
    doc.addPage();
    y = margin;
  }

  function writeText(
    raw: string,
    opts: {
      size?: number;
      style?: 'normal' | 'bold' | 'italic';
      font?: 'helvetica' | 'courier';
      color?: [number, number, number];
      indent?: number;
      gapAfter?: number;
    } = {},
  ) {
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    const lead = size * 1.38;
    doc.setFont(opts.font ?? 'helvetica', opts.style ?? 'normal');
    doc.setFontSize(size);
    const color = opts.color ?? [30, 41, 59];
    doc.setTextColor(color[0], color[1], color[2]);
    const lines: string[] = doc.splitTextToSize(pdfSafe(raw), contentWidth - indent);
    for (const line of lines) {
      ensureRoom(lead);
      doc.text(line, margin + indent, y + size * 0.85);
      y += lead;
    }
    y += opts.gapAfter ?? 0;
  }

  // ── Cover header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 74, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(DOC_TITLE, margin, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text(pdfSafe(payload.meta.positionTitle), margin, 54);
  y = 96;

  autoTable(doc, {
    startY: y,
    head: [['Keterangan', 'Nilai']],
    body: buildSummaryRows(payload.meta, entries).map((row) => [row.label, pdfSafe(row.value)]),
    theme: 'grid',
    headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 130 }, 1: { cellWidth: contentWidth - 130 } },
    margin: { left: margin, right: margin },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 22;

  // ── Conversation
  for (const entry of entries) {
    // A message header must not be the last thing on a page: a speaker label
    // stranded above the fold reads as a message the model never answered.
    ensureRoom(58);

    const isUser = entry.role === 'user';
    const fill: [number, number, number] = isUser ? [219, 234, 254] : [241, 245, 249];
    const rule: [number, number, number] = isUser ? [37, 99, 235] : [148, 163, 184];
    const label: [number, number, number] = isUser ? [30, 64, 175] : [51, 65, 85];
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.setDrawColor(rule[0], rule[1], rule[2]);
    doc.rect(margin, y, contentWidth, 20, 'F');
    doc.setLineWidth(2);
    doc.line(margin, y, margin, y + 20);
    doc.setLineWidth(0.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(label[0], label[1], label[2]);
    doc.text(`${entry.index}. ${entry.speaker}`, margin + 8, y + 13.5);
    if (entry.timestamp) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(entry.timestamp, pageWidth - margin - 8, y + 13.5, { align: 'right' });
    }
    y += 28;

    if (entry.attachment) {
      writeText(`Data terlampir: ${entry.attachment}`, {
        size: 9,
        style: 'italic',
        color: [37, 99, 235],
        indent: 10,
        gapAfter: 2,
      });
    }
    if (entry.unreadable) {
      writeText('Pesan ini tidak dapat didekripsi saat riwayat dibaca.', {
        size: 9,
        style: 'italic',
        color: [185, 28, 28],
        indent: 10,
        gapAfter: 2,
      });
    }

    for (const block of entry.blocks) {
      switch (block.kind) {
        case 'heading':
          writeText(inlineToPlain(block.text), {
            size: block.level <= 2 ? 11.5 : 10.5,
            style: 'bold',
            color: [15, 23, 42],
            indent: 10,
            gapAfter: 3,
          });
          break;
        case 'paragraph':
          writeText(inlineToPlain(block.text), { indent: 10, gapAfter: 6 });
          break;
        case 'quote':
          writeText(inlineToPlain(block.text), {
            style: 'italic',
            color: [71, 85, 105],
            indent: 22,
            gapAfter: 6,
          });
          break;
        case 'code':
          writeText(block.text, { font: 'courier', size: 8.5, color: [51, 65, 85], indent: 16, gapAfter: 6 });
          break;
        case 'list':
          for (const item of block.items) {
            const marker = item.ordered ? `${item.number}.` : '•';
            writeText(`${marker} ${inlineToPlain(item.text)}`, {
              indent: 16 + item.depth * 14,
              gapAfter: 1,
            });
          }
          y += 5;
          break;
        case 'table': {
          // autoTable paginates itself, so it needs the cursor, not a break.
          autoTable(doc, {
            startY: y,
            head: [block.head.map((cell) => pdfSafe(inlineToPlain(cell)))],
            body: block.rows.map((row) => row.map((cell) => pdfSafe(inlineToPlain(cell)))),
            theme: 'striped',
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8 },
            styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
            margin: { left: margin + 10, right: margin },
          });
          y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;
          break;
        }
      }
    }

    ensureRoom(14);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
  }

  // ── Page numbers, added last because the total is only known now.
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      pdfSafe(`${DOC_TITLE} — ${payload.meta.positionTitle}`),
      margin,
      pageHeight - 18,
    );
    doc.text(`${page} / ${total}`, pageWidth - margin, pageHeight - 18, { align: 'right' });
  }

  doc.save(`${fileBase(payload.meta)}.pdf`);
}

// ─── Word (.docx) ─────────────────────────────────────────────────

/**
 * A real OOXML .docx, written with `docx` — not HTML served under a .doc name.
 *
 * The HTML trick opens in Word, but the file is a web page wearing a Word
 * extension: no real styles, no page numbering, and Word warns about the format
 * on every open and again on every save. This costs a dependency that is loaded
 * only when someone picks Word (dynamic import, like jspdf and xlsx), and gives
 * a document whose paragraphs, lists and tables are the genuine Word objects an
 * HR user then edits.
 */

const NUMBERING_REF = 'chat-ordered';
/** 6pt in twips — the gap after a block. */
const GAP = 120;

export async function exportChatDocx(payload: ChatExportPayload) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    LevelFormat,
    Packer,
    PageNumber,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import('docx');

  const entries = buildTranscript(payload.messages);

  const thin = { style: BorderStyle.SINGLE, size: 2, color: 'CBD5E1' } as const;
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
  const gridBorders = {
    top: thin,
    bottom: thin,
    left: thin,
    right: thin,
    insideHorizontal: thin,
    insideVertical: thin,
  };
  const openBorders = {
    top: none,
    bottom: none,
    left: none,
    right: none,
    insideHorizontal: none,
    insideVertical: none,
  };

  /** Inline markdown as Word runs. */
  function runs(
    text: string,
    base: { size?: number; color?: string; bold?: boolean; italics?: boolean } = {},
  ) {
    return inlineToTokens(text).map(
      (token) =>
        new TextRun({
          text: token.text,
          bold: base.bold || token.bold,
          italics: base.italics || token.italic,
          strike: token.strike,
          // A code span keeps its monospace font; that is the only styling Word
          // needs to make it read as code inside a sentence.
          font: token.code ? 'Consolas' : undefined,
          size: base.size ?? 20,
          color: base.color,
        }),
    );
  }

  function cell(
    children: (DocxParagraph | DocxTable)[],
    opts: { fill?: string; width?: number } = {},
  ) {
    return new TableCell({
      children,
      shading: opts.fill ? { fill: opts.fill } : undefined,
      width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      margins: { top: 40, bottom: 40, left: 90, right: 90 },
    });
  }

  function blocksToDocx(blocks: TranscriptEntry['blocks'], listInstanceBase: number) {
    const out: (DocxParagraph | DocxTable)[] = [];
    let listInstance = listInstanceBase;

    for (const block of blocks) {
      switch (block.kind) {
        case 'heading':
          out.push(
            new Paragraph({
              children: runs(block.text, {
                bold: true,
                size: block.level <= 2 ? 23 : 21,
                color: '0F172A',
              }),
              spacing: { before: 160, after: 80 },
            }),
          );
          break;
        case 'paragraph':
          out.push(new Paragraph({ children: runs(block.text), spacing: { after: GAP } }));
          break;
        case 'quote':
          out.push(
            new Paragraph({
              children: runs(block.text, { italics: true, color: '475569' }),
              indent: { left: 360 },
              border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'CBD5E1', space: 8 } },
              spacing: { after: GAP },
            }),
          );
          break;
        case 'code': {
          const codeLines = block.text.split('\n');
          codeLines.forEach((line, idx) => {
            out.push(
              new Paragraph({
                children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 17 })],
                shading: { fill: 'F1F5F9' },
                indent: { left: 240 },
                spacing: { after: idx === codeLines.length - 1 ? GAP : 0 },
              }),
            );
          });
          break;
        }
        case 'list': {
          // One numbering instance per list block, so a second list starts at 1
          // again instead of continuing the first one's count.
          listInstance += 1;
          for (const item of block.items) {
            out.push(
              new Paragraph({
                children: runs(item.text),
                spacing: { after: 40 },
                ...(item.ordered
                  ? { numbering: { reference: NUMBERING_REF, level: item.depth, instance: listInstance } }
                  : { bullet: { level: item.depth } }),
              }),
            );
          }
          break;
        }
        case 'table':
          out.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: gridBorders,
              rows: [
                new TableRow({
                  tableHeader: true,
                  children: block.head.map((head) =>
                    cell(
                      [
                        new Paragraph({
                          children: runs(head, { bold: true, size: 18, color: 'FFFFFF' }),
                        }),
                      ],
                      { fill: '0F172A' },
                    ),
                  ),
                }),
                ...block.rows.map(
                  (row) =>
                    new TableRow({
                      children: row.map((value) =>
                        cell([new Paragraph({ children: runs(value, { size: 18 }) })]),
                      ),
                    }),
                ),
              ],
            }),
            // Word glues consecutive tables together; an empty paragraph is the
            // only separator it honours.
            new Paragraph({ text: '', spacing: { after: GAP } }),
          );
          break;
      }
    }
    return { children: out, listInstance };
  }

  // ── title + summary
  const children: (DocxParagraph | DocxTable)[] = [
    new Paragraph({
      children: [new TextRun({ text: DOC_TITLE, bold: true, size: 32, color: '0F172A' })],
      spacing: { after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '0F172A', space: 6 } },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: [payload.meta.positionTitle, payload.meta.department, payload.meta.division]
            .filter(Boolean)
            .join(' · '),
          size: 20,
          color: '475569',
        }),
      ],
      spacing: { after: 240 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: gridBorders,
      rows: buildSummaryRows(payload.meta, entries).map(
        (row) =>
          new TableRow({
            children: [
              cell([new Paragraph({ children: runs(row.label, { bold: true, size: 18 }) })], {
                fill: 'F8FAFC',
                width: 28,
              }),
              cell([new Paragraph({ children: runs(row.value, { size: 18 }) })], { width: 72 }),
            ],
          }),
      ),
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Percakapan', bold: true, size: 24, color: '0F172A' })],
      spacing: { before: 320, after: 160 },
    }),
  ];

  // ── conversation
  let listInstance = 0;
  for (const entry of entries) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: openBorders,
        rows: [
          new TableRow({
            children: [
              cell(
                [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `${entry.index}. ${entry.speaker}`,
                        bold: true,
                        size: 18,
                        color: entry.role === 'user' ? '1E40AF' : '334155',
                      }),
                    ],
                  }),
                ],
                { fill: entry.role === 'user' ? 'DBEAFE' : 'F1F5F9', width: 70 },
              ),
              cell(
                [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ text: entry.timestamp ?? '', size: 18, color: '64748B' }),
                    ],
                  }),
                ],
                { fill: entry.role === 'user' ? 'DBEAFE' : 'F1F5F9', width: 30 },
              ),
            ],
          }),
        ],
      }),
      new Paragraph({ text: '', spacing: { after: 60 } }),
    );

    if (entry.attachment) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Data terlampir: ${entry.attachment}`,
              italics: true,
              size: 18,
              color: '1D4ED8',
            }),
          ],
          spacing: { after: GAP },
        }),
      );
    }
    if (entry.unreadable) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'Pesan ini tidak dapat didekripsi saat riwayat dibaca.',
              italics: true,
              size: 18,
              color: 'B91C1C',
            }),
          ],
          spacing: { after: GAP },
        }),
      );
    }

    const rendered = blocksToDocx(entry.blocks, listInstance);
    listInstance = rendered.listInstance;
    children.push(...rendered.children);
    children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
  }

  const footerColor = '94A3B8';
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: NUMBERING_REF,
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 360 + level * 360, hanging: 220 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${DOC_TITLE} — ${payload.meta.positionTitle}   `,
                    size: 16,
                    color: footerColor,
                  }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: footerColor }),
                  new TextRun({ text: ' / ', size: 16, color: footerColor }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: footerColor }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${fileBase(payload.meta)}.docx`);
}


// ─── Excel (.xlsx) ────────────────────────────────────────────────

/** Excel refuses a cell over 32767 characters, and fails the whole write. */
const CELL_LIMIT = 32767;
const TRUNCATION_NOTE = '\n\n[…dipotong, teks melebihi batas satu sel Excel]';

function excelCell(text: string): string {
  if (text.length <= CELL_LIMIT) return text;
  return text.slice(0, CELL_LIMIT - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
}

export async function exportChatWorkbook(payload: ChatExportPayload) {
  const XLSX = await import('xlsx');
  const entries = buildTranscript(payload.messages);
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(
    buildSummaryRows(payload.meta, entries).map((row) => ({
      Keterangan: row.label,
      Nilai: row.value,
    })),
  );
  summarySheet['!cols'] = [{ wch: 22 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Ringkasan');

  const conversationSheet = XLSX.utils.json_to_sheet(
    entries.map((entry) => ({
      No: entry.index,
      Waktu: entry.timestamp ?? '-',
      Peran: entry.speaker,
      'Data Terlampir': entry.attachment ?? '',
      Pesan: excelCell(entry.plainText),
      Catatan: entry.unreadable ? 'Tidak dapat didekripsi' : '',
    })),
  );
  conversationSheet['!cols'] = [
    { wch: 5 },
    { wch: 18 },
    { wch: 14 },
    { wch: 28 },
    { wch: 110 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(workbook, conversationSheet, 'Percakapan');

  // Tables the assistant produced, lifted into real cells. This is the reason to
  // export a chat as a spreadsheet at all — a comparison the model rendered as
  // markdown becomes sortable instead of a paragraph.
  const tables = collectTables(entries);
  if (tables.length > 0) {
    const aoa: (string | number)[][] = [];
    tables.forEach(({ entry, table }, idx) => {
      if (idx > 0) aoa.push([]);
      aoa.push([`Tabel ${idx + 1} — pesan #${entry.index} (${entry.speaker}${entry.timestamp ? `, ${entry.timestamp}` : ''})`]);
      aoa.push(table.head.map(inlineToPlain));
      for (const row of table.rows) {
        aoa.push(
          row.map((cell) => {
            const plain = inlineToPlain(cell);
            // Numbers stay numbers — a percentage column that lands as text is
            // exactly the thing a spreadsheet export is supposed to fix.
            const numeric = plain.replace(/[%\s]/g, '').replace(',', '.');
            return numeric && !Number.isNaN(Number(numeric)) ? Number(numeric) : plain;
          }),
        );
      }
    });
    const tableSheet = XLSX.utils.aoa_to_sheet(aoa);
    const widest = Math.max(...tables.map(({ table }) => table.head.length), 1);
    tableSheet['!cols'] = Array.from({ length: widest }, (_, i) => ({ wch: i === 0 ? 42 : 20 }));
    XLSX.utils.book_append_sheet(workbook, tableSheet, 'Tabel');
  }

  const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `${fileBase(payload.meta)}.xlsx`);
}

export type ChatExportFormat = 'pdf' | 'docx' | 'xlsx';

export async function exportChat(format: ChatExportFormat, payload: ChatExportPayload) {
  if (format === 'pdf') return exportChatPdf(payload);
  if (format === 'xlsx') return exportChatWorkbook(payload);
  return exportChatDocx(payload);
}

// Re-exported so the panel can build a payload without importing two modules.
export type { ChatExportMessage, ChatExportMeta };
