/**
 * The AI-assistant conversation, turned into a shape any export format can render.
 *
 * WHY A BLOCK MODEL and not three ad-hoc formatters. The assistant answers in
 * markdown — headings, bullet lists, and quite often tables. PDF, Word and Excel
 * each need that structure expressed differently (jsPDF text runs + autoTable,
 * OOXML paragraphs and tables, spreadsheet cells), but they must agree on WHAT
 * the message says. Parsing once into blocks and rendering three times is what keeps a
 * bullet list from becoming one run-on paragraph in the PDF while Word shows it
 * correctly.
 *
 * Inline markdown (bold, code spans, links) is deliberately LEFT IN the block
 * text. Only the renderer knows whether it can honour it, so the choice belongs
 * there: `inlineToTokens` turns it into Word runs, `inlineToPlain` drops it for
 * the PDF and for spreadsheet cells.
 */

import { stripLatexMath } from '@/lib/markdown-math';
import { decodeAskMessage } from '@/lib/ask-ai-envelope';
import { EMPTY_DATE, formatDateTime } from '@/lib/datetime';

/**
 * One line of a list. The marker lives on the ITEM, not on the list, because a
 * nested bullet under a numbered step is one list to a reader — modelling it per
 * block split "1. / 2. / - nested / 3." into three lists and restarted the
 * numbering at 1.
 */
export type TranscriptListItem = {
  text: string;
  /** 0 = top level, capped at 2 — deeper nesting is indistinguishable in print. */
  depth: number;
  ordered: boolean;
  /** Sequence within its own run at this depth; 1 for bullets. */
  number: number;
};

export type TranscriptBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: TranscriptListItem[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] };

/** One stored message, as the panel holds it. */
export interface ChatExportMessage {
  role: string;
  content: string;
  /** ISO string from the DB; absent for a message sent in this browser session. */
  createdAt?: string | null;
}

export interface ChatExportMeta {
  positionTitle: string;
  department: string;
  division: string;
  runId: string | null;
  runLabel: string | null;
  runMethod: string | null;
  runProgram: string | null;
  runStatus: string | null;
  runCreatedAt: string | null;
  runCompletedAt: string | null;
  candidateCount: number;
}

export interface TranscriptEntry {
  /** 1-based turn number, as it reads in the document. */
  index: number;
  role: 'user' | 'assistant';
  speaker: string;
  /** Formatted local time, or null when the message was never persisted. */
  timestamp: string | null;
  /**
   * Set when the question came from a derivation panel: the same thing the
   * reader sees as a chip in the chat. Null for a typed question.
   */
  attachment: string | null;
  blocks: TranscriptBlock[];
  /** Flattened text — the Excel cell, and the fallback for anything else. */
  plainText: string;
}

// ─── markdown → blocks ────────────────────────────────────────────

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE = /^\s*([-*_])\s*(\1\s*){2,}$/;

function splitTableRow(line: string): string[] {
  const inner = TABLE_ROW.exec(line)?.[1] ?? line;
  return inner.split('|').map((cell) => cell.trim());
}

export function parseMarkdownBlocks(source: string): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  // LaTeX is repaired here for the same reason the panel repairs it at render
  // time: the stored history already contains it, and a document is not a place
  // where the reader can work around raw math delimiters.
  const lines = stripLatexMath(source ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: TranscriptListItem[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() });
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push({ kind: 'quote', text: quote.join(' ').trim() });
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ kind: 'list', items: list });
    list = null;
  };

  /**
   * Sequence number for an ordered item: continue the nearest preceding run at
   * the same depth, restarting at 1 once a shallower item has intervened — which
   * is what makes "1. / 2. / - nested / 3." number as 1, 2, 3.
   */
  const nextNumber = (items: TranscriptListItem[], depth: number) => {
    for (let k = items.length - 1; k >= 0; k--) {
      const item = items[k]!;
      if (item.depth > depth) continue;
      if (item.depth < depth) return 1;
      return item.number + 1;
    }
    return 1;
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      flushAll();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        body.push(lines[i]!);
        i++;
      }
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    // A table is only a table when the row after the header is a divider —
    // otherwise a sentence containing a pipe would swallow the paragraph.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!)) {
      flushAll();
      const head = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        const cells = splitTableRow(lines[i]!);
        // Pad/trim to the header width so no renderer has to guess.
        rows.push(Array.from({ length: head.length }, (_, c) => cells[c] ?? ''));
        i++;
      }
      i--;
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]!.trim());
      continue;
    }

    const ordered = ORDERED.exec(line);
    const unordered = ordered ? null : UNORDERED.exec(line);
    if (ordered || unordered) {
      flushParagraph();
      flushQuote();
      const match = (ordered ?? unordered)!;
      const indent = match[1]!.length;
      const text = match[2]!.trim();
      const isOrdered = Boolean(ordered);
      const depth = Math.min(2, Math.floor(indent / 2));
      // A marker-type switch starts a new list only at the TOP level, where
      // markdown really does mean two lists. Deeper down it is nesting, and
      // splitting there is what broke the numbering.
      const topLevelSwitch =
        depth === 0 &&
        list != null &&
        [...list].reverse().find((item) => item.depth === 0)?.ordered !== isOrdered;
      if (!list || topLevelSwitch) {
        flushList();
        list = [];
      }
      list.push({
        text,
        depth,
        ordered: isOrdered,
        number: isOrdered ? nextNumber(list, depth) : 1,
      });
      continue;
    }

    // A horizontal rule carries no content in any of the three formats.
    if (RULE.test(line)) {
      flushAll();
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    flushQuote();
    flushList();
    paragraph.push(line.trim());
  }

  flushAll();
  return blocks;
}

// ─── inline rendering ─────────────────────────────────────────────

/** Strip inline markdown down to the words. */
export function inlineToPlain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*\*|___)(.+?)\1/g, '$2')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?![\w*])/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Inline markdown as styled runs.
 *
 * The .docx writer cannot take markdown or HTML — Word wants a run per style
 * change — so emphasis has to be tokenized rather than string-replaced. Shared
 * from here so the tokenizer and `inlineToPlain` can never disagree about what
 * counts as emphasis.
 */
export type InlineToken = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
};

// Alternatives are ordered longest-marker-first, so `***x***` is not read as
// `**` plus a stray `*`. Written as a literal rather than assembled from strings
// (`'\*'` is just `'*'` to the string parser, which silently produced an invalid
// pattern), and with NUMBERED groups because this project targets ES6 and named
// capture groups are rejected there.
//
// 1/2 = bold+italic marker/text, 3/4 = bold, 5 = code, 6 = strike, 7/8 = italic.
const INLINE_PATTERN =
  /(\*\*\*|___)(.+?)\1|(\*\*|__)(.+?)\3|`([^`]+)`|~~(.+?)~~|(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\7(?![\w*])/g;

export function inlineToTokens(text: string): InlineToken[] {
  const normalized = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  const tokens: InlineToken[] = [];
  let cursor = 0;
  INLINE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_PATTERN.exec(normalized)) !== null) {
    if (match.index > cursor) tokens.push({ text: normalized.slice(cursor, match.index) });
    const [, , boldItalic, , bold, code, strike, , italic] = match;
    if (boldItalic != null) tokens.push({ text: boldItalic, bold: true, italic: true });
    else if (bold != null) tokens.push({ text: bold, bold: true });
    else if (code != null) tokens.push({ text: code, code: true });
    else if (strike != null) tokens.push({ text: strike, strike: true });
    else if (italic != null) tokens.push({ text: italic, italic: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < normalized.length) tokens.push({ text: normalized.slice(cursor) });
  // A run with no text at all makes Word drop the paragraph entirely.
  return tokens.filter((token) => token.text !== '');
}

/** Blocks as plain text — one Excel cell, or a fallback anywhere else. */
export function blocksToPlainText(blocks: TranscriptBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
        out.push(inlineToPlain(block.text).toUpperCase());
        break;
      case 'paragraph':
        out.push(inlineToPlain(block.text));
        break;
      case 'quote':
        out.push(`“${inlineToPlain(block.text)}”`);
        break;
      case 'code':
        out.push(block.text);
        break;
      case 'list':
        out.push(
          block.items
            .map((item) => {
              const pad = '  '.repeat(item.depth);
              const marker = item.ordered ? `${item.number}.` : '-';
              return `${pad}${marker} ${inlineToPlain(item.text)}`;
            })
            .join('\n'),
        );
        break;
      case 'table':
        out.push(
          [block.head, ...block.rows]
            .map((row) => row.map(inlineToPlain).join(' | '))
            .join('\n'),
        );
        break;
    }
  }
  return out.join('\n\n').trim();
}

/** Every markdown table in the transcript, in reading order. */
export function collectTables(entries: TranscriptEntry[]) {
  return entries.flatMap((entry) =>
    entry.blocks
      .filter((block): block is Extract<TranscriptBlock, { kind: 'table' }> => block.kind === 'table')
      .map((table) => ({ entry, table })),
  );
}

// ─── messages → transcript ────────────────────────────────────────

/**
 * Exported timestamps return null rather than a dash: the transcript's table
 * rows omit an absent value, and an exported document must not imply a time it
 * does not have.
 */
export function formatTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const text = formatDateTime(iso);
  return text === EMPTY_DATE ? null : text;
}

export function buildTranscript(messages: ChatExportMessage[]): TranscriptEntry[] {
  return messages.map((message, idx) => {
    const role: 'user' | 'assistant' = message.role === 'user' ? 'user' : 'assistant';
    const envelope = role === 'user' ? decodeAskMessage(message.content) : null;

    if (envelope) {
      // The payload behind a chip is a few hundred lines of numbers that the
      // chat itself hides. The transcript hides it too, on purpose: an export
      // that pasted it in would be mostly machine data and would stop reading
      // like the conversation the person actually had. What IS recorded is what
      // the chip says on screen — which data, whose, and that it went to the
      // model — so the document never implies the answer came from nothing.
      const ref = envelope.ref;
      const detail = ref.detail ? ` · ${ref.detail}` : '';
      return {
        index: idx + 1,
        role,
        speaker: 'Anda',
        timestamp: formatTimestamp(message.createdAt),
        attachment: `${ref.label} — ${ref.candidate}${detail}`,
        blocks: [
          {
            kind: 'paragraph' as const,
            text: `Pertanyaan dikirim dari panel derivasi **${ref.label}** untuk **${ref.candidate}**${
              ref.detail ? ` (${ref.detail})` : ''
            }. Rincian angkanya dilampirkan ke AI dan tidak disertakan dalam dokumen ini.`,
          },
        ],
        plainText: `[Data ${ref.label} — ${ref.candidate}${detail}] Rincian angka dilampirkan ke AI, tidak disertakan dalam ekspor.`,
      };
    }

    const blocks = parseMarkdownBlocks(message.content);
    return {
      index: idx + 1,
      role,
      speaker: role === 'user' ? 'Anda' : 'AI Assistant',
      timestamp: formatTimestamp(message.createdAt),
      attachment: null,
      blocks,
      plainText: blocksToPlainText(blocks),
    };
  });
}

const METHOD_LABELS: Record<string, string> = {
  AHP_TOPSIS: 'AHP + TOPSIS',
};

/** Header rows shared by all three formats, so they cannot disagree. */
export function buildSummaryRows(meta: ChatExportMeta, entries: TranscriptEntry[]): { label: string; value: string }[] {
  const questions = entries.filter((e) => e.role === 'user').length;
  const answers = entries.filter((e) => e.role === 'assistant').length;

  return [
    { label: 'Posisi', value: meta.positionTitle },
    { label: 'Departemen', value: meta.department || '-' },
    { label: 'Divisi', value: meta.division || '-' },
    { label: 'Program', value: meta.runProgram || '-' },
    {
      label: 'Metode scoring',
      value: meta.runMethod ? (METHOD_LABELS[meta.runMethod] ?? meta.runMethod) : '-',
    },
    { label: 'Label run', value: meta.runLabel || '-' },
    { label: 'Status run', value: meta.runStatus || '-' },
    { label: 'Run dibuat', value: formatTimestamp(meta.runCreatedAt) ?? '-' },
    { label: 'Run selesai', value: formatTimestamp(meta.runCompletedAt) ?? '-' },
    { label: 'Jumlah kandidat', value: String(meta.candidateCount) },
    { label: 'Jumlah pertanyaan', value: String(questions) },
    { label: 'Jumlah jawaban', value: String(answers) },
    { label: 'Diekspor', value: formatTimestamp(new Date().toISOString()) ?? '-' },
  ];
}
