// Regenerate the Word copies of the Markdown documents in docs/ (G-8).
//
// The .md file is the source of truth; the .docx beside it is a rendering for
// readers who work in Word. This keeps the two in step with one command and in
// the house style of the existing copies: Calibri 10,5 pt on A4, a bold
// navy title, a generated "Daftar Isi" from the ## and ### headings, tables
// with a shaded repeating header row (EAEFF5) and zebra rows (F6F8FB) inside
// thin grey borders, monospace code blocks in a shaded box, and a footer with
// the document title and the page number.
//
//   npx tsx scripts/docs-to-docx.ts docs/kebutuhan-fungsional.md [docs/… .md]
//
// Writes docs/<name>.docx next to each input. Only the Markdown these docs use
// is supported: #–#### headings, paragraphs, - / 1. lists (nested by indent),
// pipe tables, fenced code blocks, --- rules, and **bold**, *italic*, `code`,
// [text](url) inline. Anything else is written as plain text, never dropped.

import { readFileSync, writeFileSync } from 'node:fs';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const COLOR = { navy: '1F3864', muted: '595959', border: 'BFBFBF', head: 'EAEFF5', zebra: 'F6F8FB', link: '2E74B5' };
const SIZE = { body: 21, table: 19, code: 15, title: 44, h2: 25, h3: 22, h4: 21, footer: 17, toc3: 20 };
const MARGIN = 1296; // twips (0,9 in), as in the existing copies
const PAGE = { width: 11906, height: 16838 }; // A4
const TEXT_WIDTH = PAGE.width - 2 * MARGIN; // 9314

// ── Markdown → blocks ───────────────────────────────────────────────────────

type ListItem = { level: number; ordered: boolean; text: string };
type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'rule' }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'table'; header: string[] | null; rows: string[][] }
  | { kind: 'code'; lines: string[] };

const LIST_ITEM = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const isRule = (l: string) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
const isFence = (l: string) => /^\s*```/.test(l);
const isHeading = (l: string) => /^#{1,6}\s/.test(l);
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableDivider = (l: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);

/** Split "| a | b \| c |" into cells, honouring escaped pipes. */
function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (body[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += body[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** 0 for no indent, 1 for 2–3 spaces (under "- " or "1. "), 2 for 4–6, … */
const levelOf = (indent: number) => (indent < 2 ? 0 : Math.min(3, Math.ceil((indent - 1) / 3)));

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (isFence(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i]!)) buf.push(lines[i++]!);
      i++;
      out.push({ kind: 'code', lines: buf });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ kind: 'heading', level: h[1]!.length, text: h[2]!.trim() });
      i++;
      continue;
    }
    if (isRule(line)) {
      out.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1]!)) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!)) rows.push(splitRow(lines[i++]!));
      out.push({ kind: 'table', header: header.every((c) => !c) ? null : header, rows });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const m = LIST_ITEM.exec(l);
        if (m) {
          items.push({ level: levelOf(m[1]!.length), ordered: /\d/.test(m[2]!), text: m[3]!.trim() });
          i++;
          continue;
        }
        if (l.trim() && /^\s+/.test(l) && !isFence(l) && !isTableRow(l)) {
          items[items.length - 1]!.text += ` ${l.trim()}`;
          i++;
          continue;
        }
        if (!l.trim()) {
          // A blank line inside a list continues it when the next line is an
          // item or an indented continuation; otherwise the list ends.
          let j = i;
          while (j < lines.length && !lines[j]!.trim()) j++;
          const next = lines[j];
          if (next !== undefined && (LIST_ITEM.test(next) || (/^\s{2,}\S/.test(next) && !isFence(next)))) {
            i = j;
            continue;
          }
        }
        break;
      }
      out.push({ kind: 'list', items });
      continue;
    }
    const buf = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !isHeading(lines[i]!) &&
      !isRule(lines[i]!) &&
      !isFence(lines[i]!) &&
      !LIST_ITEM.test(lines[i]!) &&
      !(isTableRow(lines[i]!) && i + 1 < lines.length && isTableDivider(lines[i + 1]!))
    ) {
      buf.push(lines[i++]!.trim());
    }
    out.push({ kind: 'paragraph', text: buf.join(' ') });
  }
  return out;
}

// ── Inline → runs ───────────────────────────────────────────────────────────

type RunStyle = { size: number; bold?: boolean; color?: string; font?: string };

export function inlineRuns(text: string, base: RunStyle): TextRun[] {
  const runs: TextRun[] = [];
  let bold = false;
  let italic = false;
  let buf = '';
  const flush = () => {
    if (!buf) return;
    runs.push(new TextRun({ text: buf, bold: bold || base.bold, italics: italic, size: base.size, color: base.color, font: base.font }));
    buf = '';
  };
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length && /[\\`*_{}\[\]()#+\-.!|<>]/.test(text[i + 1]!)) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        runs.push(
          new TextRun({ text: text.slice(i + 1, end), font: 'Consolas', bold: bold || base.bold, italics: italic, size: base.size, color: base.color }),
        );
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith('**', i)) {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    // *italic*, and _italic_ only at word boundaries (snake_case stays as is).
    if (ch === '*' || (ch === '_' && !/\w/.test(text[i - 1] ?? '') !== !/\w/.test(text[i + 1] ?? ''))) {
      flush();
      italic = !italic;
      i++;
      continue;
    }
    if (ch === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(i));
      if (m) {
        flush();
        runs.push(new TextRun({ text: m[1]!.replace(/`/g, ''), size: base.size, color: COLOR.link, underline: {}, bold: bold || base.bold, font: base.font }));
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return runs;
}

/** Visible text of a cell or heading, for widths and the table of contents. */
const plain = (t: string) => t.replace(/\\\|/g, '|').replace(/[*`]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

// ── Blocks → docx ───────────────────────────────────────────────────────────

const thin = { style: BorderStyle.SINGLE, size: 2, color: COLOR.border };
const inner = { style: BorderStyle.SINGLE, size: 4, color: 'auto' };
const CELL_MARGINS = { top: 60, bottom: 60, left: 110, right: 110 };

/**
 * Each column gets room for its longest unbreakable word (so "FR-AUT-01" or an
 * identifier never splits mid-token), then the rest of the line in proportion
 * to how much text the column holds on average.
 */
function columnWidths(rows: string[][]): number[] {
  const n = Math.max(...rows.map((r) => r.length));
  const cells = (c: number) => rows.map((r) => plain(r[c] ?? ''));
  // Prose columns earn the spare width: weight is the column's AVERAGE text
  // length, so one long identifier does not make a column look like prose.
  const weight = Array.from({ length: n }, (_, c) => {
    const lens = cells(c).map((t) => t.length);
    return Math.max(4, lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length));
  });
  const longestWord = (c: number) => Math.max(1, ...cells(c).flatMap((t) => t.split(/\s+/)).map((w) => w.length));
  let mins = Array.from({ length: n }, (_, c) => Math.min(Math.round(TEXT_WIDTH * 0.35), Math.max(900, longestWord(c) * 100 + 240)));
  const minTotal = mins.reduce((a, b) => a + b, 0);
  if (minTotal > TEXT_WIDTH) mins = mins.map((m) => Math.floor((m * TEXT_WIDTH) / minTotal));
  const rest = Math.max(0, TEXT_WIDTH - mins.reduce((a, b) => a + b, 0));
  const totalWeight = weight.reduce((a, b) => a + b, 0);
  return mins.map((m, c) => m + Math.floor((rest * weight[c]!) / totalWeight));
}

function table(header: string[] | null, rows: string[][]): Table {
  const all = header ? [header, ...rows] : rows;
  const widths = columnWidths(all);
  const cell = (text: string, c: number, opts: { head?: boolean; zebra?: boolean }) =>
    new TableCell({
      width: { size: widths[c]!, type: WidthType.DXA },
      margins: CELL_MARGINS,
      shading: opts.head
        ? { fill: COLOR.head, type: ShadingType.CLEAR, color: 'auto' }
        : opts.zebra
          ? { fill: COLOR.zebra, type: ShadingType.CLEAR, color: 'auto' }
          : undefined,
      children: [
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: inlineRuns(text, opts.head ? { size: SIZE.table, bold: true, color: COLOR.navy } : { size: SIZE.table, color: '000000' }),
        }),
      ],
    });
  const n = widths.length;
  const pad = (r: string[]) => Array.from({ length: n }, (_, c) => r[c] ?? '');
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: thin, left: thin, bottom: thin, right: thin, insideHorizontal: inner, insideVertical: inner },
    rows: [
      ...(header ? [new TableRow({ tableHeader: true, children: pad(header).map((t, c) => cell(t, c, { head: true })) })] : []),
      ...rows.map((r, k) => new TableRow({ cantSplit: true, children: pad(r).map((t, c) => cell(t, c, { zebra: k % 2 === 1 })) })),
    ],
  });
}

function codeBox(lines: string[]): Table {
  const runs: TextRun[] = [];
  lines.forEach((l, k) => runs.push(new TextRun({ text: l, font: 'Consolas', size: SIZE.code, break: k === 0 ? 0 : 1 })));
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: [TEXT_WIDTH],
    borders: { top: thin, left: thin, bottom: thin, right: thin, insideHorizontal: inner, insideVertical: inner },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: TEXT_WIDTH, type: WidthType.DXA },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            shading: { fill: COLOR.zebra, type: ShadingType.CLEAR, color: 'auto' },
            children: [new Paragraph({ spacing: { before: 0, after: 0, line: 240 }, children: runs })],
          }),
        ],
      }),
    ],
  });
}

const rule = () =>
  new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.border, space: 6 } },
    spacing: { before: 120, after: 160 },
    children: [],
  });

const bodyParagraph = (text: string) =>
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 40, after: 120, line: 276 },
    children: inlineRuns(text, { size: SIZE.body }),
  });

function heading(level: number, text: string): Paragraph {
  if (level <= 1) {
    return new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { before: 0, after: 80 },
      children: [new TextRun({ text: plain(text), bold: true, color: COLOR.navy, size: SIZE.title, font: 'Calibri' })],
    });
  }
  const spec =
    level === 2
      ? { h: HeadingLevel.HEADING_2, size: SIZE.h2, color: COLOR.navy, before: 260, after: 110 }
      : level === 3
        ? { h: HeadingLevel.HEADING_3, size: SIZE.h3, color: COLOR.navy, before: 200, after: 90 }
        : { h: HeadingLevel.HEADING_4, size: SIZE.h4, color: COLOR.muted, before: 170, after: 80 };
  return new Paragraph({
    heading: spec.h,
    keepNext: true,
    spacing: { before: spec.before, after: spec.after },
    children: inlineRuns(text, { size: spec.size, bold: true, color: spec.color, font: 'Calibri' }),
  });
}

function tableOfContents(blocks: Block[]): Paragraph[] {
  const entries = blocks.filter((b): b is Extract<Block, { kind: 'heading' }> => b.kind === 'heading' && (b.level === 2 || b.level === 3));
  if (entries.length < 3) return [];
  return [
    rule(),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 140 },
      children: [new TextRun({ text: 'Daftar Isi', bold: true, color: COLOR.navy, size: SIZE.h2, font: 'Calibri' })],
    }),
    ...entries.map((e) =>
      new Paragraph({
        spacing: { before: 0, after: 40 },
        indent: { left: e.level === 2 ? 0 : 340 },
        children: [
          new TextRun(
            e.level === 2
              ? { text: plain(e.text), bold: true, color: COLOR.navy, size: SIZE.body }
              : { text: plain(e.text), color: COLOR.muted, size: SIZE.toc3 },
          ),
        ],
      }),
    ),
  ];
}

export function buildDocument(md: string): Document {
  const blocks = parseMarkdown(md);
  const titleBlock = blocks.find((b) => b.kind === 'heading' && b.level === 1) as Extract<Block, { kind: 'heading' }> | undefined;
  const title = titleBlock ? plain(titleBlock.text) : 'AI Pulse';
  const children: (Paragraph | Table)[] = [];
  let listInstance = 0;
  // The contents go after the document's own header table, as in the existing copies.
  const firstTable = blocks.findIndex((b) => b.kind === 'table');
  const tocAfter = firstTable >= 0 && firstTable <= 4 ? firstTable : blocks.findIndex((b) => b.kind === 'heading' && b.level === 1);
  blocks.forEach((b, k) => {
    switch (b.kind) {
      case 'heading':
        children.push(heading(b.level, b.text));
        break;
      case 'paragraph':
        children.push(bodyParagraph(b.text));
        break;
      case 'rule':
        children.push(rule());
        break;
      case 'code':
        children.push(codeBox(b.lines), new Paragraph({ spacing: { before: 0, after: 80 }, children: [] }));
        break;
      case 'table':
        children.push(table(b.header, b.rows), new Paragraph({ spacing: { before: 0, after: 80 }, children: [] }));
        break;
      case 'list': {
        listInstance += 1;
        for (const item of b.items) {
          children.push(
            new Paragraph({
              numbering: { reference: item.ordered ? 'ordered' : 'bullets', level: item.level, instance: listInstance },
              spacing: { before: 20, after: 20 },
              children: inlineRuns(item.text, { size: SIZE.body }),
            }),
          );
        }
        break;
      }
    }
    if (k === tocAfter) children.push(...tableOfContents(blocks));
  });

  const bulletLevels = ['●', '○', '■', '●'].map((symbol, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: symbol,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const orderedLevels = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL].map((format, level) => ({
    level,
    format,
    text: `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));

  return new Document({
    creator: 'AI Pulse',
    title,
    styles: { default: { document: { run: { font: 'Calibri', size: SIZE.body } } } },
    numbering: {
      config: [
        { reference: 'bullets', levels: bulletLevels },
        { reference: 'ordered', levels: orderedLevels },
      ],
    },
    sections: [
      {
        properties: {
          page: { size: PAGE, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border, space: 6 } },
                children: [
                  new TextRun({ text: `${title}   ·   `, color: COLOR.muted, size: SIZE.footer }),
                  new TextRun({ children: [PageNumber.CURRENT], color: COLOR.muted, size: SIZE.footer }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

async function main() {
  const inputs = process.argv.slice(2).filter((a) => a.endsWith('.md'));
  if (inputs.length === 0) {
    console.error('Pemakaian: npx tsx scripts/docs-to-docx.ts docs/<nama>.md [docs/<nama>.md …]');
    process.exit(1);
  }
  for (const input of inputs) {
    const out = input.replace(/\.md$/, '.docx');
    const buffer = await Packer.toBuffer(buildDocument(readFileSync(input, 'utf8')));
    writeFileSync(out, buffer);
    console.log(`${input} → ${out} (${Math.round(buffer.length / 1024)} KB)`);
  }
}

if (process.argv[1] && /docs-to-docx\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
