// The visual editor's model of a restructure template (Pengaturan Job Family →
// Restrukturisasi Dokumen). Plain module so it can be tested outside React.
//
// A template is plain text with {{token}} placeholders (lib/job-family/restructure.ts
// renders it). The visual editor shows it as one card per SECTION, and every
// visual operation — switch a section on or off, move it, edit its text, "Aktifkan
// Semua" — parses the template into sections, changes one, and writes the
// template back out. The rules of that round trip:
//
//   • A section is a known token's FIRST line, plus the non-blank lines without
//     a known token directly above it. That is how a heading such as
//     "Tanggung Jawab dan Indikator Keberhasilan:" travels with
//     {{responsibilities}}, and it is why free text is never dropped: it belongs
//     to the section below it.
//   • Free text after the last section is kept at the end (`tail`).
//   • A line holding only an unknown token, or a known token that already
//     appeared, counts as free text. The renderer still reads it (an unknown
//     token renders empty; a repeated one renders twice).
//   • Blank lines are not kept. The renderer drops empty label lines and
//     collapses blank runs anyway; the editor writes one section per line.
//
// The raw "Teks" editor bypasses all of this: what is typed is what is stored.

import { SECTION_LABELS, TEMPLATE_TOKENS } from './restructure';

export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

export type ParsedTemplate = {
  /** Sections in template order. */
  order: TemplateToken[];
  /** Full text of each section, heading lines included. */
  blocks: Partial<Record<TemplateToken, string>>;
  /** Free text after the last section, or ''. */
  tail: string;
};

const KNOWN = new Set<string>(TEMPLATE_TOKENS);
const TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g;

/** The first known token on a line that has not been claimed by an earlier line. */
function firstUnclaimedToken(line: string, claimed: Set<string>): TemplateToken | null {
  for (const m of line.matchAll(TOKEN_RE)) {
    const t = m[1]!;
    if (KNOWN.has(t)) return claimed.has(t) ? null : (t as TemplateToken);
  }
  return null;
}

export function parseTemplate(template: string): ParsedTemplate {
  const order: TemplateToken[] = [];
  const blocks: Partial<Record<TemplateToken, string>> = {};
  const claimed = new Set<string>();
  let pending: string[] = [];

  for (const line of template.split('\n')) {
    const token = firstUnclaimedToken(line, claimed);
    if (!token) {
      if (line.trim()) pending.push(line.replace(/\s+$/, ''));
      continue;
    }
    claimed.add(token);
    order.push(token);
    blocks[token] = [...pending, line.replace(/\s+$/, '')].join('\n');
    pending = [];
  }
  return { order, blocks, tail: pending.join('\n') };
}

export function buildTemplate(parsed: ParsedTemplate): string {
  const parts = parsed.order.map((t) => parsed.blocks[t] ?? defaultSectionText(t));
  if (parsed.tail) parts.push(parsed.tail);
  return parts.join('\n');
}

/** The text a section gets when it is switched on: its canonical label and token. */
export function defaultSectionText(token: TemplateToken): string {
  const label = SECTION_LABELS[token];
  return token === 'responsibilities' ? `${label}:\n{{${token}}}` : `${label}: {{${token}}}`;
}

/** Switch a section on (appended at the end, default text) or off (removed with its heading). */
export function toggleSection(template: string, token: TemplateToken): string {
  const p = parseTemplate(template);
  if (p.order.includes(token)) {
    const { [token]: _removed, ...blocks } = p.blocks;
    return buildTemplate({ ...p, order: p.order.filter((t) => t !== token), blocks });
  }
  return buildTemplate({
    ...p,
    order: [...p.order, token],
    blocks: { ...p.blocks, [token]: defaultSectionText(token) },
  });
}

/** Move a section one step up (-1) or down (+1). */
export function moveSection(template: string, token: TemplateToken, direction: 1 | -1): string {
  const p = parseTemplate(template);
  const i = p.order.indexOf(token);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= p.order.length) return template;
  const order = [...p.order];
  [order[i], order[j]] = [order[j]!, order[i]!];
  return buildTemplate({ ...p, order });
}

/** Move a section to where another one is (drag and drop). */
export function moveSectionTo(template: string, from: TemplateToken, to: TemplateToken): string {
  const p = parseTemplate(template);
  const i = p.order.indexOf(from);
  const j = p.order.indexOf(to);
  if (i < 0 || j < 0 || i === j) return template;
  const order = [...p.order];
  order.splice(i, 1);
  order.splice(j, 0, from);
  return buildTemplate({ ...p, order });
}

/** Replace one section's text (heading lines included). */
export function setSectionText(template: string, token: TemplateToken, text: string): string {
  const p = parseTemplate(template);
  if (!p.order.includes(token)) return template;
  return buildTemplate({ ...p, blocks: { ...p.blocks, [token]: text } });
}

/** Switch on every section that is off, appended in canonical order; the rest keep their place and text. */
export function enableAllSections(template: string): string {
  const p = parseTemplate(template);
  const missing = TEMPLATE_TOKENS.filter((t) => !p.order.includes(t));
  if (missing.length === 0) return template;
  const blocks = { ...p.blocks };
  for (const t of missing) blocks[t] = defaultSectionText(t);
  return buildTemplate({ ...p, order: [...p.order, ...missing], blocks });
}

/** True when the template names at least one known section; a template without one reads nothing. */
export function hasSectionToken(template: string): boolean {
  for (const m of template.matchAll(TOKEN_RE)) if (KNOWN.has(m[1]!)) return true;
  return false;
}
