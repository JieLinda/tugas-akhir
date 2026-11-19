/**
 * Export of a Job Family clustering run — spreadsheet, printable report, or a
 * flat CSV.
 *
 * Everything here runs in the browser off the payload the map is already
 * holding (`TopicResults` carries families, members, incumbents, keywords and
 * the placement reasons), so an export costs no extra query and can never
 * disagree with what is on screen. Same shape as lib/analysis-export.ts: a
 * dynamic `import('xlsx')` so the library is not in the page bundle, and a Blob
 * the browser downloads or opens.
 *
 * The two audiences are deliberately different. The workbook is for someone who
 * wants to pivot the placement themselves — one row per thing, no formatting
 * cleverness. The HTML report is for someone reading the result: it opens with
 * how the corpus split across families, then gives each family its own page
 * with its members and the people sitting in them, and closes with a glossary,
 * because every number on it (keanggotaan, kedekatan, family alternatif) is
 * meaningless to a reader who was not in the room when the map was built.
 */

import type {
  Incumbent,
  TopicMember,
  TopicResult,
  TopicResults,
  TopicRunSummary,
} from '@/lib/job-family-topics-actions';
import { colorForTopic, familyOrder } from '@/lib/job-family/palette';
import { formatDate, formatDateCompact, formatDateTime } from '@/lib/datetime';

// ── Options ────────────────────────────────────────────────────────

export type JobFamilyExportFormat = 'xlsx' | 'html' | 'csv';

export type JobFamilyExportOptions = {
  format: JobFamilyExportFormat;
  /** 'all', or one topicId to export a single family. */
  scope: 'all' | number;
  /** Per-person rows / lists. Off makes the export a purely structural one. */
  includeIncumbents: boolean;
  /** c-TF-IDF keywords per family. */
  includeKeywords: boolean;
  /** The topic -1 bucket. Off drops it from every sheet and the report. */
  includeOutliers: boolean;
  /** Tujuan jabatan + kompetensi teknis from each job profile document. */
  includeProfileSummary: boolean;
  /** Why a document landed where it did: membership, centroid closeness, runner-up family. */
  includePlacementReason: boolean;
};

export const DEFAULT_JOB_FAMILY_EXPORT_OPTIONS: JobFamilyExportOptions = {
  format: 'xlsx',
  scope: 'all',
  includeIncumbents: true,
  includeKeywords: true,
  includeOutliers: true,
  includeProfileSummary: false,
  includePlacementReason: true,
};

export type JobFamilyExportPayload = {
  run: TopicRunSummary;
  results: TopicResults;
  /** Business unit the map is being read as — printed on the report header. */
  tenantLabel?: string | null;
};

// ── Shared helpers ─────────────────────────────────────────────────

const DASH = '—';

function familyTitle(t: TopicResult): string {
  if (t.topicId === -1) return 'Outlier (tanpa family)';
  return t.generalTitle || t.label || `Job Family ${t.topicId}`;
}

/** The keyword label always shown under the paraphrased title, when it adds anything. */
function familySubtitle(t: TopicResult): string {
  if (!t.label) return '';
  return t.generalTitle && t.generalTitle !== t.label ? t.label : '';
}

function pctText(v: number | null | undefined, digits = 1): string {
  return v == null ? DASH : `${(v * 100).toFixed(digits)}%`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stamp(): string {
  return formatDateCompact(new Date());
}

function baseName(payload: JobFamilyExportPayload, opts: JobFamilyExportOptions): string {
  const unit = payload.tenantLabel ? `-${slugify(payload.tenantLabel)}` : '';
  const scoped =
    typeof opts.scope === 'number'
      ? payload.results.topics.find((t) => t.topicId === opts.scope) ?? null
      : null;
  const one = scoped ? `-${slugify(familyTitle(scoped)) || `topic-${scoped.topicId}`}` : '';
  return `pulse-job-family${unit}${one}-${stamp()}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * The families this export covers, in display order, with the outlier bucket
 * kept separate — it is not a family and every sheet that treats it as one
 * would report a cluster that the algorithm explicitly refused to form.
 */
function selectFamilies(payload: JobFamilyExportPayload, opts: JobFamilyExportOptions) {
  const real = payload.results.topics.filter((t) => t.topicId !== -1);
  const noise = payload.results.topics.find((t) => t.topicId === -1) ?? null;
  const order = familyOrder(real.map((t) => t.topicId));
  const scoped = typeof opts.scope === 'number' ? real.filter((t) => t.topicId === opts.scope) : real;
  return {
    families: scoped,
    /** Outliers ride along only on a whole-run export — a single-family export is about that family. */
    noise: opts.includeOutliers && opts.scope === 'all' ? noise : null,
    order,
    colorOf: (topicId: number) => colorForTopic(topicId, order),
    /** Denominator for "share of corpus": what the export actually covers. */
    totalProfiles: real.reduce((s, t) => s + t.size, 0),
  };
}

// ── Row builders (shared by xlsx and csv) ──────────────────────────

function runInfoRows(payload: JobFamilyExportPayload, opts: JobFamilyExportOptions) {
  const { run, results } = payload;
  const real = results.topics.filter((t) => t.topicId !== -1);
  const noise = results.topics.find((t) => t.topicId === -1) ?? null;
  const incumbents = results.topics.reduce((s, t) => s + t.incumbentCount, 0);
  return [
    { Keterangan: 'Business unit', Nilai: payload.tenantLabel ?? 'Seluruh unit' },
    { Keterangan: 'Cakupan proses', Nilai: run.tenantName ? `Khusus ${run.tenantName}` : 'Global (semua unit)' },
    { Keterangan: 'Job family terbentuk', Nilai: real.length },
    { Keterangan: 'Job profile terpetakan', Nilai: real.reduce((s, t) => s + t.size, 0) },
    { Keterangan: 'Outlier (tanpa family)', Nilai: noise?.size ?? 0 },
    { Keterangan: 'Incumbent tercocok', Nilai: incumbents },
    { Keterangan: 'Dokumen pada proses', Nilai: run.numDocuments },
    { Keterangan: 'Model embedding', Nilai: run.embeddingModel ?? DASH },
    { Keterangan: 'Proses selesai', Nilai: run.completedAt ? formatDateTime(run.completedAt) : DASH },
    { Keterangan: 'ID proses', Nilai: run.runId },
    { Keterangan: 'Diekspor', Nilai: formatDateTime(new Date()) },
    {
      Keterangan: 'Cakupan ekspor',
      Nilai: opts.scope === 'all' ? 'Seluruh job family' : `Hanya 1 job family (topic ${opts.scope})`,
    },
  ];
}

function familyRows(payload: JobFamilyExportPayload, opts: JobFamilyExportOptions) {
  const { families, totalProfiles } = selectFamilies(payload, opts);
  return families.map((t, i) => {
    const row: Record<string, string | number> = {
      No: i + 1,
      'Topic ID': t.topicId,
      'Job Family': familyTitle(t),
      'Label Kata Kunci': t.label ?? DASH,
      'Jumlah Job Profile': t.size,
      'Porsi Korpus': totalProfiles ? `${((t.size / totalProfiles) * 100).toFixed(1)}%` : DASH,
      'Jumlah Incumbent': t.incumbentCount,
      'Divisi Terbanyak': t.divisions
        .slice(0, 3)
        .map((d) => `${d.name} (${d.count})`)
        .join('; ') || DASH,
      'Business Unit Incumbent': t.tenantCounts
        .map((c) => `${c.name} (${c.count})`)
        .join('; ') || DASH,
      Deskripsi: t.generalDescription ?? DASH,
    };
    if (opts.includeKeywords) {
      row['Kata Kunci'] = t.keywords.slice(0, 12).map((k) => k.word).join(', ') || DASH;
    }
    return row;
  });
}

function memberRows(payload: JobFamilyExportPayload, opts: JobFamilyExportOptions) {
  const { families, noise } = selectFamilies(payload, opts);
  const groups = noise ? [...families, noise] : families;
  return groups.flatMap((t) =>
    t.members.map((m) => {
      const row: Record<string, string | number> = {
        'Job Family': familyTitle(t),
        'Topic ID': t.topicId,
        'Job Profile ID': m.jobProfileId,
        Jabatan: m.positionName ?? DASH,
        'Divisi / Departemen': m.divisionDepartment ?? DASH,
        'Jumlah Incumbent': m.incumbents.length,
      };
      if (opts.includePlacementReason) {
        row['Keanggotaan'] = pctText(m.probability, 0);
        row['Kedekatan ke Pusat Family'] = pctText(m.reason.centroidSimilarity);
        row['Family Alternatif'] =
          m.reason.altTopicGeneralTitle || m.reason.altTopicLabel || DASH;
        row['Kedekatan ke Alternatif'] = pctText(m.reason.altSimilarity);
        row['Kata Kunci Cocok'] =
          m.reason.matchedKeywords.map((k) => k.word).join(', ') || DASH;
      }
      if (opts.includeIncumbents) {
        row['Nama Incumbent'] =
          m.incumbents.map((i) => i.candidateName ?? DASH).join('; ') || DASH;
      }
      if (opts.includeProfileSummary) {
        row['Tujuan Jabatan'] = m.summary.jobPurpose ?? DASH;
        row['Tanggung Jawab'] = m.summary.responsibilities.join('; ') || DASH;
        row['Kompetensi Teknis'] = m.summary.competencies.join('; ') || DASH;
      }
      return row;
    }),
  );
}

function incumbentRows(payload: JobFamilyExportPayload, opts: JobFamilyExportOptions) {
  const { families, noise } = selectFamilies(payload, opts);
  const groups = noise ? [...families, noise] : families;
  const matchLabel: Record<string, string> = {
    filename: 'Kode posisi pada nama berkas',
    exact: 'Judul identik',
    embedding: 'Kemiripan embedding',
    manual: 'Disematkan manual',
    ai: 'Dipilih AI',
  };
  return groups.flatMap((t) =>
    t.members.flatMap((m) =>
      m.incumbents.map((inc: Incumbent) => ({
        Nama: inc.candidateName ?? DASH,
        'Jabatan Saat Ini': inc.candidatePosition ?? DASH,
        'Business Unit': inc.tenantName ?? inc.companyId ?? DASH,
        'Job Family': familyTitle(t),
        'Job Profile': m.positionName ?? DASH,
        'Divisi / Departemen': m.divisionDepartment ?? DASH,
        'Dasar Pencocokan': matchLabel[inc.matchType] ?? inc.matchType,
        'Kemiripan Pencocokan': pctText(inc.similarity),
      })),
    ),
  );
}

function outlierRows(payload: JobFamilyExportPayload, opts: JobFamilyExportOptions) {
  const { noise } = selectFamilies(payload, opts);
  if (!noise) return [];
  return noise.members.map((m) => ({
    'Job Profile ID': m.jobProfileId,
    Jabatan: m.positionName ?? DASH,
    'Divisi / Departemen': m.divisionDepartment ?? DASH,
    'Family Terdekat': m.reason.altTopicGeneralTitle || m.reason.altTopicLabel || DASH,
    'Kedekatan ke Family Terdekat': pctText(m.reason.altSimilarity),
    'Jumlah Incumbent': m.incumbents.length,
    'Nama Incumbent': opts.includeIncumbents
      ? m.incumbents.map((i) => i.candidateName ?? DASH).join('; ') || DASH
      : DASH,
  }));
}

/**
 * Family × division cross-tab — the sheet that answers "did this split follow
 * the org chart or cut across it?", which no per-row sheet shows.
 */
function divisionMatrixRows(payload: JobFamilyExportPayload, opts: JobFamilyExportOptions) {
  const { families } = selectFamilies(payload, opts);
  const divisions = new Map<string, number>();
  for (const t of families) {
    for (const m of t.members) {
      const name = m.divisionDepartment?.trim() || 'Tanpa divisi';
      divisions.set(name, (divisions.get(name) ?? 0) + 1);
    }
  }
  const cols = [...divisions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name]) => name);

  return families.map((t) => {
    const counts = new Map<string, number>();
    for (const m of t.members) {
      const name = m.divisionDepartment?.trim() || 'Tanpa divisi';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const row: Record<string, string | number> = { 'Job Family': familyTitle(t) };
    for (const c of cols) row[c] = counts.get(c) ?? 0;
    row['Total'] = t.members.length;
    return row;
  });
}

// ── Excel ──────────────────────────────────────────────────────────

/** Column widths from content, so a sheet opens readable instead of all 8ch. */
function autoWidths(rows: Record<string, unknown>[]): { wch: number }[] {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]!);
  return keys.map((k) => {
    const longest = rows.reduce((max, r) => {
      const v = r[k];
      return Math.max(max, v == null ? 0 : String(v).length);
    }, k.length);
    return { wch: Math.min(Math.max(longest + 2, 10), 60) };
  });
}

export async function exportJobFamilyWorkbook(
  payload: JobFamilyExportPayload,
  opts: JobFamilyExportOptions,
) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const add = (name: string, rows: Record<string, unknown>[]) => {
    if (rows.length === 0) return;
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = autoWidths(rows);
    XLSX.utils.book_append_sheet(wb, sheet, name);
  };

  add('Ringkasan Proses', runInfoRows(payload, opts));
  add('Job Family', familyRows(payload, opts));
  add('Job Profile', memberRows(payload, opts));
  if (opts.includeIncumbents) add('Incumbent', incumbentRows(payload, opts));
  if (opts.includeOutliers) add('Outlier', outlierRows(payload, opts));
  if (opts.scope === 'all') add('Sebaran Divisi', divisionMatrixRows(payload, opts));

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  downloadBlob(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${baseName(payload, opts)}.xlsx`,
  );
}

// ── CSV ────────────────────────────────────────────────────────────

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const keys = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\r\n');
}

/**
 * One flat table — the job-profile level, which is the grain everything else
 * aggregates from, so a pivot in Excel can rebuild any of the other sheets.
 * `﻿` because Excel reads a BOM-less UTF-8 CSV as the local codepage and
 * mangles every accented name.
 */
export function exportJobFamilyCsv(
  payload: JobFamilyExportPayload,
  opts: JobFamilyExportOptions,
) {
  const csv = toCsv(memberRows(payload, opts));
  downloadBlob(
    new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }),
    `${baseName(payload, opts)}.csv`,
  );
}

// ── HTML report ────────────────────────────────────────────────────

/** Job profile titles are free text from a PDF — one stray `&` or `<` would
 *  otherwise silently swallow the rest of a row. */
function esc(v: unknown): string {
  if (v == null) return DASH;
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statTile(label: string, value: string | number, hint?: string): string {
  return `<div class="tile">
    <div class="tile-label">${esc(label)}</div>
    <div class="tile-value">${esc(value)}</div>
    ${hint ? `<div class="tile-hint">${esc(hint)}</div>` : ''}
  </div>`;
}

function memberTable(t: TopicResult, opts: JobFamilyExportOptions): string {
  const reasonHead = opts.includePlacementReason
    ? '<th class="num">Keanggotaan</th><th class="num">Kedekatan Pusat</th><th>Family Alternatif</th>'
    : '';
  const rows = t.members
    .map((m: TopicMember) => {
      const reason = opts.includePlacementReason
        ? `<td class="num">${esc(pctText(m.probability, 0))}</td>
           <td class="num">${esc(pctText(m.reason.centroidSimilarity))}</td>
           <td class="muted">${esc(
             m.reason.altTopicGeneralTitle || m.reason.altTopicLabel || DASH,
           )}${
             m.reason.altSimilarity != null
               ? ` <span class="muted">(${esc(pctText(m.reason.altSimilarity, 0))})</span>`
               : ''
           }</td>`
        : '';
      const people =
        opts.includeIncumbents && m.incumbents.length > 0
          ? `<div class="people">${m.incumbents
              .map(
                (i) =>
                  `<span class="chip"><strong>${esc(i.candidateName ?? DASH)}</strong>${
                    i.candidatePosition ? ` · ${esc(i.candidatePosition)}` : ''
                  }${i.tenantName ? ` · ${esc(i.tenantName)}` : ''}</span>`,
              )
              .join('')}</div>`
          : opts.includeIncumbents
            ? '<div class="people muted">Belum ada incumbent tercocok.</div>'
            : '';
      const purpose =
        opts.includeProfileSummary && m.summary.jobPurpose
          ? `<div class="purpose">${esc(m.summary.jobPurpose)}</div>`
          : '';
      const comps =
        opts.includeProfileSummary && m.summary.competencies.length > 0
          ? `<div class="people">${m.summary.competencies
              .map((c) => `<span class="chip chip-alt">${esc(c)}</span>`)
              .join('')}</div>`
          : '';
      return `<tr>
        <td>
          <div class="pos">${esc(m.positionName ?? `Job Profile #${m.jobProfileId}`)}</div>
          <div class="muted small">${esc(m.divisionDepartment ?? DASH)}</div>
          ${purpose}${people}${comps}
        </td>
        ${reason}
        <td class="num">${m.incumbents.length}</td>
      </tr>`;
    })
    .join('');

  return `<table class="grid">
    <thead><tr>
      <th>Jabatan / Job Profile</th>
      ${reasonHead}
      <th class="num">Incumbent</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function keywordBars(t: TopicResult): string {
  if (t.keywords.length === 0) return '';
  const max = t.keywords[0]?.score ?? 1;
  return `<div class="kw">${t.keywords
    .slice(0, 10)
    .map(
      (k) => `<div class="kw-row">
        <span class="kw-word">${esc(k.word)}</span>
        <span class="kw-bar"><i style="width:${Math.max(4, (k.score / (max || 1)) * 100).toFixed(0)}%"></i></span>
      </div>`,
    )
    .join('')}</div>`;
}

export function exportJobFamilyHtml(
  payload: JobFamilyExportPayload,
  opts: JobFamilyExportOptions,
) {
  const { run } = payload;
  const { families, noise, colorOf, totalProfiles } = selectFamilies(payload, opts);
  const today = formatDate(new Date());
  const totalIncumbents = families.reduce((s, t) => s + t.incumbentCount, 0);
  const largest = families.reduce<TopicResult | null>(
    (best, t) => (!best || t.size > best.size ? t : best),
    null,
  );
  const unmanned = families.filter((t) => t.incumbentCount === 0).length;

  // Overall distribution — the part that answers "how did the corpus split?"
  const distribution = families
    .map((t) => {
      const share = totalProfiles ? (t.size / totalProfiles) * 100 : 0;
      return `<div class="dist-row">
        <span class="dot" style="background:${colorOf(t.topicId)}"></span>
        <span class="dist-name">${esc(familyTitle(t))}</span>
        <span class="dist-bar"><i style="width:${share.toFixed(1)}%;background:${colorOf(t.topicId)}"></i></span>
        <span class="dist-num">${t.size} profil · ${t.incumbentCount} org · ${share.toFixed(1)}%</span>
      </div>`;
    })
    .join('');

  const sections = families
    .map((t, i) => {
      const share = totalProfiles ? ((t.size / totalProfiles) * 100).toFixed(1) : DASH;
      const sub = familySubtitle(t);
      return `<section class="family" style="${i > 0 ? 'page-break-before:always;' : ''}">
      <div class="family-head" style="border-left-color:${colorOf(t.topicId)}">
        <div>
          <div class="eyebrow">Job Family ${i + 1} dari ${families.length} · topic ${t.topicId}</div>
          <h2>${esc(familyTitle(t))}</h2>
          ${sub ? `<div class="muted small">${esc(sub)}</div>` : ''}
        </div>
        <div class="family-nums">
          <div><strong>${t.size}</strong><span>job profile</span></div>
          <div><strong>${t.incumbentCount}</strong><span>incumbent</span></div>
          <div><strong>${share}%</strong><span>porsi korpus</span></div>
        </div>
      </div>
      ${t.generalDescription ? `<p class="desc">${esc(t.generalDescription)}</p>` : ''}
      ${
        t.divisions.length > 0
          ? `<p class="small muted"><strong>Sebaran divisi:</strong> ${t.divisions
              .map((d) => `${esc(d.name)} (${d.count})`)
              .join(' · ')}</p>`
          : ''
      }
      ${
        opts.includeIncumbents && t.tenantCounts.length > 0
          ? `<p class="small muted"><strong>Incumbent per unit:</strong> ${t.tenantCounts
              .map((c) => `${esc(c.name)} (${c.count})`)
              .join(' · ')}</p>`
          : ''
      }
      ${opts.includeKeywords ? `<h3>Kata kunci pembentuk family</h3>${keywordBars(t)}` : ''}
      <h3>Anggota job family</h3>
      ${memberTable(t, opts)}
    </section>`;
    })
    .join('');

  const noiseSection =
    noise && noise.members.length > 0
      ? `<section class="family" style="page-break-before:always;">
      <div class="family-head" style="border-left-color:#94a3b8">
        <div>
          <div class="eyebrow">Di luar pengelompokan</div>
          <h2>Outlier — ${noise.members.length} job profile</h2>
          <div class="muted small">Dokumen yang tidak cukup mirip dengan kelompok mana pun. Bukan kesalahan: biasanya jabatan unik, atau uraian job profile-nya terlalu umum.</div>
        </div>
      </div>
      ${memberTable(noise, opts)}
    </section>`
      : '';

  const html = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>PULSE — Laporan Pemetaan Job Family</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#1e293b;background:#fff;padding:36px;max-width:1000px;margin:0 auto;font-size:12px}
  h1{font-size:21px;color:#0f172a}
  h2{font-size:16px;color:#0f172a}
  h3{font-size:12px;color:#0f172a;margin:14px 0 6px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}
  .muted{color:#64748b}
  .small{font-size:10px}
  .header{border-bottom:3px solid #0f172a;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px}
  .tiles{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
  .tile{flex:1 1 130px;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;background:#f8fafc}
  .tile-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8}
  .tile-value{font-size:19px;font-weight:800;color:#0f172a;line-height:1.15;margin-top:2px}
  .tile-hint{font-size:9px;color:#64748b;margin-top:2px}
  .panel{border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:14px}
  .dist-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
  .dot{width:9px;height:9px;border-radius:50%;flex:none}
  .dist-name{flex:0 0 210px;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dist-bar{flex:1;height:9px;background:#f1f5f9;border-radius:99px;overflow:hidden}
  .dist-bar i{display:block;height:100%;border-radius:99px}
  .dist-num{flex:0 0 175px;text-align:right;font-size:10px;color:#64748b;font-variant-numeric:tabular-nums}
  .family{margin-top:18px}
  .family-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;border-left:5px solid #2563eb;background:#f8fafc;border-radius:0 8px 8px 0;padding:11px 14px}
  .eyebrow{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8}
  .family-nums{display:flex;gap:16px;text-align:right}
  .family-nums div{display:flex;flex-direction:column}
  .family-nums strong{font-size:17px;color:#0f172a;line-height:1}
  .family-nums span{font-size:9px;color:#64748b}
  .desc{margin:9px 0;font-size:11px;line-height:1.55;color:#475569}
  .kw{display:grid;grid-template-columns:repeat(2,1fr);gap:3px 18px}
  .kw-row{display:flex;align-items:center;gap:7px}
  .kw-word{flex:0 0 110px;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .kw-bar{flex:1;height:6px;background:#f1f5f9;border-radius:99px;overflow:hidden}
  .kw-bar i{display:block;height:100%;background:#2563eb;border-radius:99px}
  table.grid{width:100%;border-collapse:collapse;border:1px solid #e2e8f0;margin-top:4px}
  table.grid th{background:#f1f5f9;padding:6px 9px;font-size:9px;text-align:left;text-transform:uppercase;letter-spacing:.03em;color:#475569;border:1px solid #e2e8f0}
  table.grid td{padding:6px 9px;font-size:11px;border:1px solid #e2e8f0;vertical-align:top}
  table.grid th.num,table.grid td.num{text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}
  .pos{font-weight:600;color:#0f172a}
  .purpose{margin-top:4px;font-size:10px;line-height:1.5;color:#475569}
  .people{margin-top:5px;display:flex;flex-wrap:wrap;gap:4px}
  .chip{display:inline-block;padding:1px 7px;border-radius:99px;background:#eff6ff;border:1px solid #bfdbfe;font-size:9px;color:#1e40af}
  .chip-alt{background:#f5f3ff;border-color:#ddd6fe;color:#5b21b6}
  .glossary{margin-top:20px;border-top:2px solid #e2e8f0;padding-top:10px}
  .glossary dt{font-size:10px;font-weight:700;color:#0f172a;margin-top:6px}
  .glossary dd{font-size:10px;color:#64748b;line-height:1.5}
  @media print{
    body{padding:10px!important;font-size:10px}
    .no-print{display:none!important}
    .family{margin-top:0}
    table.grid{page-break-inside:auto}
    tr{page-break-inside:avoid}
  }
</style></head>
<body>
  <div class="no-print" style="text-align:right;margin-bottom:14px;">
    <button onclick="window.print()" style="padding:8px 20px;background:#0f172a;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;">🖨 Cetak / Simpan PDF</button>
  </div>

  <div class="header">
    <div>
      <h1>Laporan Pemetaan Job Family</h1>
      <p class="small muted">${esc(today)} · ${esc(payload.tenantLabel ?? 'Seluruh business unit')}${
        opts.scope === 'all' ? '' : ' · ekspor satu job family'
      }</p>
    </div>
    <div style="text-align:right">
      <div class="small"><strong>Model:</strong> ${esc(run.embeddingModel ?? DASH)}</div>
      <div class="small muted">Proses selesai ${esc(
        run.completedAt ? formatDateTime(run.completedAt) : DASH,
      )}</div>
      <div class="small muted">${esc(
        run.tenantName ? `Pemetaan khusus ${run.tenantName}` : 'Pemetaan global (semua unit)',
      )}</div>
    </div>
  </div>

  <div class="tiles">
    ${statTile('Job Family', families.length, 'kelompok terbentuk')}
    ${statTile('Job Profile', totalProfiles, 'dokumen terpetakan')}
    ${statTile('Incumbent', totalIncumbents, 'karyawan tercocok')}
    ${statTile('Outlier', noise?.size ?? 0, 'di luar kelompok')}
    ${statTile(
      'Family Terbesar',
      largest ? `${totalProfiles ? ((largest.size / totalProfiles) * 100).toFixed(0) : 0}%` : DASH,
      largest ? familyTitle(largest) : undefined,
    )}
  </div>

  <div class="panel">
    <h3 style="margin-top:0">Sebaran job profile per family</h3>
    ${distribution || '<p class="muted small">Tidak ada job family pada cakupan ini.</p>'}
    <p class="small muted" style="margin-top:8px">
      Bacaan cepat: satu family yang menguasai sebagian besar korpus biasanya berarti pengelompokan terlalu longgar,
      sedangkan banyak family berisi 1–2 dokumen berarti terlalu ketat — keduanya diatur lewat ukuran klaster minimum di halaman Konfigurasi.
      ${unmanned > 0 ? `Saat ini <strong>${unmanned}</strong> family belum punya incumbent tercocok sama sekali.` : ''}
    </p>
  </div>

  ${sections}
  ${noiseSection}

  <div class="glossary">
    <h3 style="border:none;margin-bottom:2px">Cara membaca angka pada laporan ini</h3>
    <dl>
      <dt>Porsi korpus</dt>
      <dd>Bagian dokumen job profile yang jatuh ke family tersebut, dari seluruh dokumen yang terpetakan.</dd>
      <dt>Keanggotaan</dt>
      <dd>Seberapa khas sebuah dokumen bagi family-nya menurut hasil klasterisasi. 100% = sangat khas; nilai rendah = berada di pinggir kelompok. Kosong bila proses tidak menghitung probabilitas.</dd>
      <dt>Kedekatan pusat</dt>
      <dd>Kemiripan dokumen terhadap rata-rata seluruh anggota family-nya. Makin tinggi makin mewakili family itu.</dd>
      <dt>Family alternatif</dt>
      <dd>Rumpun lain yang paling dekat dengan jabatan tersebut. Bila persentasenya hampir sama dengan kedekatan pusat, jabatan itu memang berada di perbatasan dua rumpun.</dd>
      <dt>Kata kunci</dt>
      <dd>Istilah yang paling membedakan family ini dari family lain (c-TF-IDF), bukan sekadar kata yang paling sering muncul. Panjang batang = kekuatan relatifnya.</dd>
      <dt>Incumbent</dt>
      <dd>Karyawan business unit aktif yang tercocok ke job profile tersebut. Nol berarti pencocokan jabatan ↔ job profile belum tersimpan, bukan berarti kursinya kosong.</dd>
    </dl>
  </div>

  <script>setTimeout(function(){window.print()},500);</script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'width=1100,height=850');
  if (w) {
    w.onload = () => URL.revokeObjectURL(url);
  } else {
    window.open(url, '_blank');
  }
}

// ── Dispatcher ─────────────────────────────────────────────────────

export async function exportJobFamily(
  payload: JobFamilyExportPayload,
  opts: JobFamilyExportOptions,
) {
  if (opts.format === 'xlsx') return exportJobFamilyWorkbook(payload, opts);
  if (opts.format === 'csv') return exportJobFamilyCsv(payload, opts);
  return exportJobFamilyHtml(payload, opts);
}

/** What the dialog shows as the size of the export before it runs. */
export function describeJobFamilyExport(
  payload: JobFamilyExportPayload,
  opts: JobFamilyExportOptions,
): { families: number; profiles: number; incumbents: number; outliers: number } {
  const { families, noise } = selectFamilies(payload, opts);
  return {
    families: families.length,
    profiles: families.reduce((s, t) => s + t.size, 0),
    incumbents: families.reduce((s, t) => s + t.incumbentCount, 0),
    outliers: noise?.members.length ?? 0,
  };
}
