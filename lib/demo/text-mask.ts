/**
 * Demo mode — text masking for job profiles and the competency dictionary.
 *
 * Pure and client-safe on purpose: the SERVER applies these before the data
 * leaves it (lib/demo-mode.ts decides when), so a demo audience cannot recover
 * the hidden words from the page payload or DevTools; the client only imports
 * the constant to style the placeholder.
 *
 * Two rules, one per surface, both stated by HR:
 *   • job profile content — every point keeps its FIRST THREE words, and a
 *     point that has three words or fewer is never shown whole (it keeps one
 *     word fewer than it has, so a one-word point shows only the mask);
 *   • kamus kompetensi — every description keeps its first 20% and last 20% of
 *     words and hides the 60% in the middle.
 */

/**
 * What stands in for hidden words.
 *
 * Deliberately not "•": both `toStringList` (job profile lists) and the kamus
 * page's `bulletize` SPLIT on "•", so a bullet-dot mask would shatter one point
 * into several on the client.
 */
export const DEMO_MASK = '▒▒▒▒';

/** Words a job-profile point keeps in demo mode. */
export const JOB_PROFILE_VISIBLE_WORDS = 3;

/**
 * A kamus description keeps floor(n / 5) words at each end — 20% each — so the
 * hidden middle is never less than 60%. Integer division on purpose: `n * 0.2`
 * is not exact in floating point.
 */
const KAMUS_EDGE_DIVISOR = 5;

/**
 * A leading list marker ("1.", "a)", "-", "•"…) is kept and NOT counted as one
 * of the visible words — otherwise numbering would spend a third of the budget.
 */
const LIST_MARKER = /^(?:\(?\d{1,3}[.)]|\(?[A-Za-z][.)]|[-–—*▪◦●○■□➢➤►>•])$/;

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * One job-profile point → its first `keep` words plus the mask.
 *
 * "jangan tampilkan semua": a point of `keep` words or fewer would otherwise be
 * shown in full, so it keeps one word fewer than it has. The mask is always
 * appended, so the reader can see that something was withheld.
 */
export function maskLeadingWords(text: string, keep = JOB_PROFILE_VISIBLE_WORDS): string {
  const list = words(text);
  if (list.length === 0) return text;
  let marker = '';
  if (list.length > 1 && LIST_MARKER.test(list[0]!)) marker = `${list.shift()} `;
  const visible = list.length > keep ? keep : list.length - 1;
  const shown = list.slice(0, visible).join(' ');
  return `${marker}${shown ? `${shown} ` : ''}${DEMO_MASK}`;
}

/**
 * A job-profile text field. Each LINE is its own point, because the detail
 * view renders these cells with `whitespace-pre-line` and a multi-line cell
 * reads as a list.
 */
export function maskJobProfileText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line.trim() ? maskLeadingWords(line) : line))
    .join('\n');
}

/**
 * The separators `toStringList` (components/job-profiles/job-profile-detail-content.tsx)
 * splits a plain-string list on. A list stored as one string is masked per
 * point it will be DISPLAYED as, and returned as an array (which `toStringList`
 * accepts as-is), so "first three words of every point" holds for both shapes.
 */
const LIST_SEPARATORS = /\r?\n|•|;|\|/g;

function maskList(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .split(LIST_SEPARATORS)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => maskLeadingWords(item));
  }
  return maskDeep(value);
}

/** Strings anywhere inside `value` are masked point by point; shape is kept. */
function maskDeep(value: unknown): unknown {
  if (typeof value === 'string') return maskJobProfileText(value);
  if (Array.isArray(value)) return value.map((item) => maskDeep(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = maskDeep(item);
    }
    return out;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Mask the sections HR named in a job profile's `extracted_data`:
 *   Informasi Utama  — Tujuan Jabatan, Ikhtisar Bagan Organisasi, Persetujuan & Otorisasi
 *   Tanggung Jawab   — Tanggung Jawab Utama, Indikator Keberhasilan (KPI)
 *   Spesifikasi      — Wewenang Posisi (Authorities)
 *   Hubungan         — Hubungan Kerja Internal / Eksternal, Pemecahan Masalah
 *                      & Pengambilan Keputusan (challenges, references, approvals)
 * Everything else (document info, identity, qualifications, competencies) is
 * left as it is — it was not asked for, and the competency lists are what the
 * rest of the product matches on.
 *
 * Accepts the stored shape (object, or the occasional JSON string) and returns
 * an object; an unparseable string becomes null, which the detail view already
 * renders as "Gagal Membaca Data" rather than leaking the raw text.
 */
export function maskJobProfileExtractedData(raw: unknown): unknown {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const source = asRecord(data);
  if (!source) return data;

  const out: Record<string, unknown> = { ...source };

  if (typeof source.jobPurpose === 'string') out.jobPurpose = maskJobProfileText(source.jobPurpose);

  const org = asRecord(source.organizationStructure);
  if (org) {
    out.organizationStructure = {
      ...org,
      organizationChartSummary:
        typeof org.organizationChartSummary === 'string'
          ? maskJobProfileText(org.organizationChartSummary)
          : org.organizationChartSummary,
    };
  }

  const approvals = asRecord(source.approvals);
  if (approvals) {
    out.approvals = {
      ...approvals,
      preparedBy: maskDeep(approvals.preparedBy),
      checkedBy: maskDeep(approvals.checkedBy),
      approvedBy: maskDeep(approvals.approvedBy),
    };
  }

  if (Array.isArray(source.responsibilities)) {
    out.responsibilities = source.responsibilities.map((item) => {
      const row = asRecord(item);
      if (!row) return maskDeep(item);
      return {
        ...row,
        responsibility: maskDeep(row.responsibility),
        successIndicator: maskDeep(row.successIndicator),
      };
    });
  }

  if (source.authorities != null) out.authorities = maskList(source.authorities);

  const rel = asRecord(source.workingRelationships);
  if (rel) {
    out.workingRelationships = {
      ...rel,
      internal: maskList(rel.internal),
      external: maskList(rel.external),
    };
  }

  const problem = asRecord(source.problemSolving);
  if (problem) {
    out.problemSolving = {
      ...problem,
      references: maskList(problem.references),
      approvalRequired: maskList(problem.approvalRequired),
      challenges: maskList(problem.challenges),
    };
  }

  return out;
}

/**
 * One kamus description → first 20% and last 20% of its words, the middle 60%
 * replaced by the mask. A text too short to have a whole word in 20% (under
 * five words) is hidden entirely: rounding up would show more than was asked.
 */
export function maskMiddleWords(text: string): string {
  const list = words(text);
  if (list.length === 0) return text;
  const edge = Math.floor(list.length / KAMUS_EDGE_DIVISOR);
  if (edge === 0) return DEMO_MASK;
  return [...list.slice(0, edge), DEMO_MASK, ...list.slice(list.length - edge)].join(' ');
}

/**
 * A kamus level definition. The PDF stores each level as one paragraph of
 * "•"-separated items and the page renders one bullet per item, so every item
 * is its own sentence here and the "•" separators are kept for the client.
 */
export function maskKamusText(text: string | null): string | null {
  if (text == null) return text;
  const items = text
    .split(/\s*•\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0) return text;
  if (items.length === 1) return maskMiddleWords(items[0]!);
  return items.map((item) => maskMiddleWords(item)).join(' • ');
}
