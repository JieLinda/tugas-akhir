import { displayRank, runHavText, type AnalysisCandidate } from '@/lib/analysis-utils';
import type { PositionSummary, CandidateProfile } from '@/lib/talent-data';
import type { PositionPick } from '@/lib/position-pick-actions';
import { formatHavQuadrant } from '@/lib/hav-quadrant';
import { downloadBlob, slugify } from '@/lib/file-download';
import { formatDate, formatHistoryDate } from '@/lib/datetime';

type FilterSummary = {
  qualified: number;
  rejected: number;
  topScore: number;
};

export interface ExportPayload {
  position: PositionSummary;
  /**
   * In the order the Kandidat tab shows them (tie order applied), so the rows of
   * the file follow the rows of the screen.
   */
  rankedCandidates: AnalysisCandidate[];
  selectedCandidate: AnalysisCandidate | null;
  compareCandidate: AnalysisCandidate | null;
  filterSummary: FilterSummary;
  /** The run's scoring method (`AHP_TOPSIS`); printed in the report header. */
  method: string | null;
  /**
   * Candidates marked "dikecualikan" on this run: id → the reason as the page
   * words it. A mark changes no number, so the row keeps its rank and score; the
   * column exists so the file does not present a marked person as a live one.
   */
  exclusions?: ReadonlyMap<string, string>;
}

function exportBaseName(position: PositionSummary) {
  return `pulse-analysis-${slugify(position.title)}`;
}

const METHOD_LABELS: Record<string, string> = {
  AHP_TOPSIS: 'AHP + TOPSIS (deterministik)',
};

/**
 * The quadrant the RUN scored, worded exactly as the Kandidat tab's HAV chip
 * words it ("tidak tercatat di run" for a row that recorded none).
 */
function havQuadrantText(candidate: AnalysisCandidate): string {
  const text = runHavText(candidate);
  return text === '—' ? '-' : text;
}

/**
 * The HAV a printed report shows for a picked successor. A candidate in the run
 * on screen shows that run's quadrant; one who is not (a pick made from another
 * run) has only the profile to go on, which is TODAY's HAV — and says so.
 */
function printedHavText(
  candidate: AnalysisCandidate | null | undefined,
  profile: CandidateProfile | null | undefined,
): string {
  if (candidate) return runHavText(candidate);
  return profile?.havQuadrant ? `${formatHavQuadrant(profile.havQuadrant)} (data terkini)` : '—';
}

function buildCandidateRows(
  rankedCandidates: AnalysisCandidate[],
  exclusions?: ReadonlyMap<string, string>,
) {
  return rankedCandidates.map((candidate, index) => {
    const exclusion = exclusions?.get(candidate.id);
    return {
      // The rank the screen prints: against the whole scored pool on AHP+TOPSIS.
      Rank: displayRank(candidate, index),
      Candidate: candidate.name,
      'Current Position': candidate.currentPosition,
      Department: candidate.profile?.department ?? '-',
      Readiness: candidate.readiness,
      'Weighted Score': candidate.weightedScore,
      'Tech Score': candidate.scoreBreakdown?.technical ?? '-',
      'Behavior Score': candidate.scoreBreakdown?.behavior ?? '-',
      // The quadrant is what the screen shows; the score is what the ranking used.
      'HAV Quadrant': havQuadrantText(candidate),
      'HAV Score': candidate.scoreBreakdown?.hav ?? '-',
      'PA Score': candidate.scoreBreakdown?.performance ?? '-',
      'Edu Score': candidate.scoreBreakdown?.education ?? '-',
      // Left EMPTY rather than 0 or "-" when a row carries no career value.
      // (This column replaced "Job Match", which was the weighted score minus 5.)
      'Career Relevance': candidate.scoreBreakdown?.career ?? null,
      'Ditandai Dikecualikan': exclusion ? `Ya — ${exclusion}` : null,
      Constraint: candidate.constraint,
    };
  });
}

function buildProgramRows(rankedCandidates: AnalysisCandidate[]) {
  return rankedCandidates.flatMap((candidate) =>
    (candidate.profile?.programs ?? []).map((program) => ({
      Candidate: candidate.name,
      Program: program.code,
      Status: program.status,
      Note: program.note,
    }))
  );
}

function buildSummaryRows(payload: ExportPayload) {
  const { position, selectedCandidate, compareCandidate, filterSummary, rankedCandidates, method } = payload;

  return [
    { Metric: 'Position', Value: position.title },
    { Metric: 'Department', Value: position.department },
    { Metric: 'Division', Value: position.division },
    { Metric: 'Scoring Method', Value: method ? (METHOD_LABELS[method] ?? method) : '-' },
    { Metric: 'Qualified Candidates', Value: filterSummary.qualified },
    { Metric: 'Rejected Candidates', Value: filterSummary.rejected },
    { Metric: 'Top Score', Value: `${filterSummary.topScore}%` },
    { Metric: 'Primary Focus Candidate', Value: selectedCandidate?.name ?? '-' },
    { Metric: 'Comparison Candidate', Value: compareCandidate?.name ?? '-' },
    { Metric: 'Candidate Count', Value: rankedCandidates.length },
  ];
}

export async function exportAnalysisWorkbook(payload: ExportPayload) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(buildSummaryRows(payload));
  const candidatesSheet = XLSX.utils.json_to_sheet(
    buildCandidateRows(payload.rankedCandidates, payload.exclusions),
  );
  const programsSheet = XLSX.utils.json_to_sheet(buildProgramRows(payload.rankedCandidates));

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(workbook, candidatesSheet, 'Candidates');
  XLSX.utils.book_append_sheet(workbook, programsSheet, 'Programs');

  const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  downloadBlob(blob, `${exportBaseName(payload.position)}.xlsx`);
}

export async function exportAnalysisPdf(payload: ExportPayload) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const summaryRows = buildSummaryRows(payload).map((item) => [item.Metric, String(item.Value)]);
  const candidateRows = buildCandidateRows(payload.rankedCandidates, payload.exclusions).map((c) => [
    String(c.Rank),
    c['Ditandai Dikecualikan'] ? `${c.Candidate} (dikecualikan)` : c.Candidate,
    c.Readiness,
    `${c['Weighted Score']}%`,
    `${c['Tech Score']}`,
    `${c['Behavior Score']}`,
    `${c['HAV Score']}`,
    `${c['PA Score']}`,
    `${c['Edu Score']}`,
    c['Career Relevance'] == null ? '' : `${c['Career Relevance']}`,
  ]);

  doc.setFontSize(18);
  doc.text('PULSE Analysis Report', 40, 40);
  doc.setFontSize(11);
  doc.text(payload.position.title, 40, 58);
  doc.text(`${payload.position.department}  |  ${payload.position.division}`, 40, 72);
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${formatDate(new Date())}  |  ${payload.rankedCandidates.length} candidates`, 40, 84);

  autoTable(doc, {
    startY: 100,
    head: [['Metric', 'Value']],
    body: summaryRows,
    theme: 'grid',
    headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
    styles: { fontSize: 9 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 140 },
      1: { cellWidth: 480 },
    },
  });

  autoTable(doc, {
    startY: (doc as any).lastAutoTable?.finalY
      ? ((doc as any).lastAutoTable?.finalY ?? 0) + 14
      : 280,
    head: [['#', 'Candidate', 'Readiness', 'Score', 'Tech', 'Beh', 'HAV', 'PA', 'Edu', 'Career']],
    body: candidateRows,
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    styles: { fontSize: 8, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      1: { cellWidth: 140 },
      2: { cellWidth: 55, halign: 'center' },
      3: { cellWidth: 38, halign: 'center' },
      4: { cellWidth: 32, halign: 'center' },
      5: { cellWidth: 32, halign: 'center' },
      6: { cellWidth: 32, halign: 'center' },
      7: { cellWidth: 32, halign: 'center' },
      8: { cellWidth: 32, halign: 'center' },
      9: { cellWidth: 38, halign: 'center' },
    },
  });

  doc.save(`${exportBaseName(payload.position)}.pdf`);
}

// ─── HTML Print Export (Kandidat Terpilih) ───────────────────────

// ─── Score Breakdown table (shared by both printed reports) ──────
//
// The note beside each aspect says HOW that number was produced. HAV prints the
// quadrant exactly as the Kandidat tab does.

type AspectNotes = Record<'technical' | 'career' | 'behavior' | 'performance' | 'education', string>;

const AHP_ASPECT_NOTES: AspectNotes = {
  technical: 'Pencocokan kompetensi teknis terhadap acuan posisi (deterministik)',
  career: 'Pengalaman relevan: kemiripan job profile × lama menjabat (deterministik)',
  behavior: 'Kategori rekomendasi asesmen perilaku (deterministik)',
  performance: 'TOPSIS atas riwayat grade PA, berbobot per periode (deterministik)',
  education: 'Kecocokan pendidikan dengan syarat posisi: pencocokan persis, lalu penilaian AI',
};

function scoreBreakdownTableHtml(candidate: AnalysisCandidate): string {
  const sb = candidate.scoreBreakdown;
  const notes = AHP_ASPECT_NOTES;
  // The quadrant the run scored, beside the score computed from it.
  const havText = runHavText(candidate);
  const cell = 'padding:5px 10px;font-size:11px;';
  const row = (label: string, score: number | string | null | undefined, note: string) =>
    `<tr><td style="${cell}">${label}</td><td style="${cell}text-align:center;font-weight:600;">${score ?? '-'}</td><td style="padding:5px 10px;font-size:10px;color:#64748b;">${note}</td></tr>`;
  return `
      <div style="margin-bottom:12px;">
        <h4 style="font-size:12px;color:#0f172a;margin:0 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">Score Breakdown</h4>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
          <thead><tr style="background:#f1f5f9;">
            <th style="padding:5px 10px;font-size:10px;text-align:left;">Aspek</th>
            <th style="padding:5px 10px;font-size:10px;text-align:center;width:60px;">Skor</th>
            <th style="padding:5px 10px;font-size:10px;text-align:left;">Keterangan</th>
          </tr></thead>
          <tbody>
            ${row('Technical Competency', sb?.technical, notes.technical)}
            ${row('Career Relevance', sb?.career ?? '—', notes.career)}
            ${row('Behavior Competency', sb?.behavior, notes.behavior)}
            ${row('Performance Appraisal', sb?.performance, notes.performance)}
            ${row('HAV Mapping', sb?.hav, havText === '—' ? 'Kuadran tidak tersedia' : `Kuadran ${havText}`)}
            ${row('Education', sb?.education, notes.education)}
          </tbody>
        </table>
      </div>`;
}

function exclusionNoteHtml(reason: string | undefined): string {
  return reason
    ? `<div style="margin-bottom:10px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#f1f5f9;font-size:11px;color:#475569;"><strong>Ditandai dikecualikan (tidak memengaruhi angka):</strong> ${reason}</div>`
    : '';
}

const CODE_LABELS: Record<string, string> = {
  talent: 'Talent Pool',
  successor: 'Critical Position',
  emergency: 'Emergency Position',
};

interface PickedCandidateExport {
  pick: PositionPick;
  candidate?: AnalysisCandidate | null;
  profile?: CandidateProfile | null;
}

export function exportPickedCandidatesHtml(
  position: PositionSummary,
  picks: PickedCandidateExport[],
  programLabel: string,
) {
  const today = formatDate(new Date());

  const candidatesHtml = picks.map((p, idx) => {
    const pageBreak = idx > 0 ? 'page-break-before:always;' : '';
    const c = p.candidate;
    const profile = p.profile;
    const havText = printedHavText(c, profile);
    const savedScore = p.pick.score;
    const savedReadiness = p.pick.readiness;
    const effectiveScore = c?.weightedScore ?? savedScore;
    const effectiveReadiness = c?.readiness ?? savedReadiness ?? 'Medium';

    // Calculate readiness color
    const readinessColor =
      effectiveReadiness === 'Short' ? '#059669' :
      effectiveReadiness === 'Medium' ? '#d97706' :
      effectiveReadiness === 'Long' ? '#0284c7' : '#64748b';

    // Format PA grade history
    const paRaw = profile?.raw?.performanceGrade;
    const paValues = paRaw && paRaw.includes(',') ? paRaw.split(',') : [];
    const cy = new Date().getFullYear();
    const paRows = [
      { year: cy - 1, s1: paValues[1] || '—', s2: paValues[0] || '—' },
      { year: cy - 2, s1: paValues[3] || '—', s2: paValues[2] || '—' },
      { year: cy - 3, s1: paValues[5] || '—', s2: paValues[4] || '—' },
    ];

    const competenciesRows = (profile?.technicalCompetencies ?? []).map(comp =>
      `<tr>
        <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;">${comp.technicalName ?? '-'}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;text-align:center;">${comp.currentScore ?? '-'}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;text-align:center;">${comp.score ?? '-'}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;text-align:center;">${comp.gap ?? '-'}</td>
      </tr>`
    ).join('');

    const historyRows = (profile?.positionHistory ?? [])
      .sort((a, b) => { const ae = a.validTo ? new Date(a.validTo).getTime() : Date.now(); const be = b.validTo ? new Date(b.validTo).getTime() : Date.now(); return be - ae; })
      .slice(0, 8)
      .map(row => {
        const title = row.internalTitle ?? row.externalTitle ?? row.positionId;
        return `<tr>
          <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;">${title}${row.primaryPosition ? '' : ' <span style="font-size:9px;color:#94a3b8;">(Non-Primary)</span>'}</td>
          <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;text-align:center;">${formatHistoryDate(row.validFrom)} → ${formatHistoryDate(row.validTo)}</td>
          <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;text-align:center;">${row.gradeId ?? '-'}</td>
        </tr>`;
      }).join('');

    return `
    <div style="${pageBreak}page-break-inside:auto;margin-bottom:20px;">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;">Suksesor #${idx + 1} · ${CODE_LABELS[p.pick.programCode] ?? p.pick.programCode}</div>
            <h3 style="margin:4px 0 0;font-size:16px;color:#0f172a;">${c?.name ?? p.pick.candidateName}</h3>
            <p style="margin:2px 0 0;font-size:12px;color:#64748b;">${c?.currentPosition ?? profile?.currentPosition ?? '—'}</p>
          </div>
          <div style="text-align:right;">
            ${effectiveScore != null ? `<div style="font-size:22px;font-weight:800;color:#0f172a;">${effectiveScore}%</div>` : ''}
            <span style="display:inline-block;padding:2px 12px;border-radius:99px;font-size:11px;font-weight:700;color:white;background:${readinessColor};">${effectiveReadiness}</span>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;font-size:10px;color:#475569;">
          <span><strong>NPK:</strong> ${profile?.employeeId ?? '—'}</span>
          <span>·</span>
          <span><strong>Dept:</strong> ${profile?.department ?? position.department ?? '—'}</span>
          <span>·</span>
          <span><strong>Divisi:</strong> ${profile?.division ?? '—'}</span>
          <span>·</span>
          <span><strong>Masa Kerja:</strong> ${profile?.yearsOfService ?? c?.yearsOfService ?? '—'} thn</span>
          <span>·</span>
          <span><strong>Pendidikan:</strong> ${profile?.education ?? '—'}</span>
          ${p.pick.notes ? `<span>·</span><span><strong>Catatan:</strong> ${p.pick.notes}</span>` : ''}
          <span>·</span>
          <span><strong>Disiplin:</strong> ${profile?.disciplinaryStatus ?? c?.discipline ?? '—'}</span>
        </div>
      </div>

      <!-- Score Breakdown -->
      ${c ? scoreBreakdownTableHtml(c) : ''}

      <!-- Key Metrics -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:600;">HAV Kuadran</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;">${havText}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:600;">MCU</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;">${profile?.mcuStatus ?? '—'}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:600;">Behavior</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;">${profile?.behaviorRecommendation ?? '—'}</div>
        </div>
      </div>

      <!-- Technical Competencies -->
      ${competenciesRows ? `
      <div style="margin-bottom:12px;">
        <h4 style="font-size:12px;color:#0f172a;margin:0 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">Technical Competencies</h4>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
          <thead><tr style="background:#f1f5f9;">
            <th style="padding:4px 8px;font-size:10px;text-align:left;">Kompetensi</th>
            <th style="padding:4px 8px;font-size:10px;text-align:center;">Current</th>
            <th style="padding:4px 8px;font-size:10px;text-align:center;">Target</th>
            <th style="padding:4px 8px;font-size:10px;text-align:center;">Gap</th>
          </tr></thead>
          <tbody>${competenciesRows}</tbody>
        </table>
      </div>
      ` : ''}

      <!-- PA History -->
      <div style="margin-bottom:12px;">
        <h4 style="font-size:12px;color:#0f172a;margin:0 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">Riwayat Performance Appraisal (3 Tahun, data terkini)</h4>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
          <thead><tr style="background:#f1f5f9;">
            <th style="padding:4px 8px;font-size:10px;text-align:center;">Tahun</th>
            <th style="padding:4px 8px;font-size:10px;text-align:center;">S1</th>
            <th style="padding:4px 8px;font-size:10px;text-align:center;">S2</th>
          </tr></thead>
          <tbody>${paRows.map(r => `<tr><td style="padding:4px 8px;font-size:11px;text-align:center;">${r.year}</td><td style="padding:4px 8px;font-size:11px;text-align:center;font-weight:600;">${r.s1}</td><td style="padding:4px 8px;font-size:11px;text-align:center;font-weight:600;">${r.s2}</td></tr>`).join('')}</tbody>
        </table>
      </div>

      <!-- Position History -->
      ${historyRows ? `
      <div style="margin-bottom:8px;">
        <h4 style="font-size:12px;color:#0f172a;margin:0 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">Position History</h4>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
          <thead><tr style="background:#f1f5f9;">
            <th style="padding:4px 8px;font-size:10px;text-align:left;">Jabatan</th>
            <th style="padding:4px 8px;font-size:10px;text-align:center;">Periode</th>
            <th style="padding:4px 8px;font-size:10px;text-align:center;">Grade</th>
          </tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>
      ` : ''}
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>PULSE — Laporan Kandidat Terpilih</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #1e293b; background: #fff; padding: 36px; max-width: 900px; margin: 0 auto; }
  @media print { body { padding: 12px !important; font-size: 9px; } .no-print { display: none !important; } }
  .header { border-bottom: 3px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 8px; }
  .header h1 { font-size: 20px; color: #0f172a; } .header p { font-size: 11px; color: #64748b; }
  .tag { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 10px; font-weight: 700; background: #dbeafe; color: #1e40af; }
  @media print { body { padding: 8px !important; } .header { margin-bottom: 6px; } }
</style></head>
<body>
  <div class="no-print" style="text-align:right;margin-bottom:16px;">
    <button onclick="window.print()" style="padding:8px 20px;background:#0f172a;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;">🖨 Cetak / Simpan PDF</button>
  </div>
  <div class="header">
    <div>
      <h1>Laporan Kandidat Terpilih</h1>
      <p>${today} &mdash; Program: ${programLabel}</p>
    </div>
    <div style="text-align:right;">
      <div style="font-size:12px;font-weight:600;color:#0f172a;">${position.title}</div>
      <div style="font-size:11px;color:#64748b;">${position.department} · ${position.division}</div>
    </div>
  </div>
  ${candidatesHtml}
  <script>setTimeout(() => window.print(), 400);</script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'width=1000,height=800');
  if (w) {
    w.onload = () => { URL.revokeObjectURL(url); };
  } else {
    window.open(url, '_blank');
  }
}

// ─── HTML Print Export (Full Run) ────────────────────────────────

export function exportRunHtml(payload: ExportPayload) {
  const { position, rankedCandidates, filterSummary, method, exclusions } = payload;
  const today = formatDate(new Date());

  const candidatesHtml = rankedCandidates.map((c, idx) => {
    const pageBreak = idx > 0 ? 'page-break-before:always;' : '';
    const profile = c.profile;
    // The run's quadrant — never the profile's (today's) HAV.
    const havText = runHavText(c);

    const readinessColor =
      c.readiness === 'Short' ? '#059669' :
      c.readiness === 'Medium' ? '#d97706' :
      c.readiness === 'Long' ? '#0284c7' : '#64748b';

    const paRaw = profile?.raw?.performanceGrade;
    const paValues = paRaw && paRaw.includes(',') ? paRaw.split(',') : [];
    const cy = new Date().getFullYear();
    const paRows = [
      { year: cy - 1, s1: paValues[1] || '—', s2: paValues[0] || '—' },
      { year: cy - 2, s1: paValues[3] || '—', s2: paValues[2] || '—' },
      { year: cy - 3, s1: paValues[5] || '—', s2: paValues[4] || '—' },
    ];

    const competenciesRows = (profile?.technicalCompetencies ?? []).map(comp =>
      `<tr><td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;">${comp.technicalName ?? '-'}</td>
       <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;text-align:center;">${comp.currentScore ?? '-'}</td>
       <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;text-align:center;">${comp.score ?? '-'}</td>
       <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;text-align:center;">${comp.gap ?? '-'}</td></tr>`
    ).join('');

    const historyRows = (profile?.positionHistory ?? [])
      .sort((a, b) => { const ae = a.validTo ? new Date(a.validTo).getTime() : Date.now(); const be = b.validTo ? new Date(b.validTo).getTime() : Date.now(); return be - ae; })
      .slice(0, 8)
      .map(row => {
        const title = row.internalTitle ?? row.externalTitle ?? row.positionId;
        return `<tr><td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;">${title}${row.primaryPosition ? '' : ' <span style="font-size:9px;color:#94a3b8;">(Non-Primary)</span>'}</td>
          <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;text-align:center;">${formatHistoryDate(row.validFrom)} → ${formatHistoryDate(row.validTo)}</td>
          <td style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;text-align:center;">${row.gradeId ?? '-'}</td></tr>`;
      }).join('');

    return `
    <div style="${pageBreak}page-break-inside:auto;margin-bottom:20px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;margin-bottom:10px;">
        <div>
          <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;">Peringkat #${displayRank(c, idx)}</div>
          <h3 style="margin:4px 0 0;font-size:16px;color:#0f172a;">${c.name}</h3>
          <p style="margin:2px 0 0;font-size:12px;color:#64748b;">${c.currentPosition ?? '-'}</p>
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:800;color:#0f172a;">${c.weightedScore}%</div>
          <span style="display:inline-block;padding:2px 12px;border-radius:99px;font-size:11px;font-weight:700;color:white;background:${readinessColor};">${c.readiness}</span>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;font-size:10px;color:#475569;">
        <span><strong>NPK:</strong> ${profile?.employeeId ?? '-'}</span><span>·</span>
        <span><strong>Dept:</strong> ${profile?.department ?? '-'}</span><span>·</span>
        <span><strong>Divisi:</strong> ${profile?.division ?? '-'}</span><span>·</span>
        <span><strong>Masa Kerja:</strong> ${profile?.yearsOfService ?? c.yearsOfService ?? '-'} thn</span><span>·</span>
        <span><strong>Pendidikan:</strong> ${profile?.education ?? '-'}</span><span>·</span>
        <span><strong>Disiplin:</strong> ${profile?.disciplinaryStatus ?? c.discipline ?? '-'}</span>
      </div>
      ${exclusionNoteHtml(exclusions?.get(c.id))}
      ${scoreBreakdownTableHtml(c)}
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:600;">HAV Kuadran</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;">${havText}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:600;">MCU</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;">${profile?.mcuStatus ?? '—'}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:600;">Behavior</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;">${profile?.behaviorRecommendation ?? '—'}</div>
        </div>
      </div>
      ${competenciesRows ? `
      <div style="margin-bottom:10px;">
        <h4 style="font-size:12px;color:#0f172a;margin:0 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">Technical Competencies</h4>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
          <thead><tr style="background:#f1f5f9;">
            <th style="padding:4px 8px;font-size:10px;text-align:left;">Kompetensi</th>
            <th style="padding:4px 8px;font-size:10px;text-align:center;">Current</th><th style="padding:4px 8px;font-size:10px;text-align:center;">Target</th><th style="padding:4px 8px;font-size:10px;text-align:center;">Gap</th>
          </tr></thead>
          <tbody>${competenciesRows}</tbody>
        </table>
      </div>` : ''}
      <div style="margin-bottom:10px;">
        <h4 style="font-size:12px;color:#0f172a;margin:0 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">Riwayat Performance Appraisal (3 Tahun, data terkini)</h4>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
          <thead><tr style="background:#f1f5f9;">
            <th style="padding:4px 8px;font-size:10px;text-align:center;">Tahun</th><th style="padding:4px 8px;font-size:10px;text-align:center;">S1</th><th style="padding:4px 8px;font-size:10px;text-align:center;">S2</th>
          </tr></thead>
          <tbody>${paRows.map(r => `<tr><td style="padding:4px 8px;font-size:11px;text-align:center;">${r.year}</td><td style="padding:4px 8px;font-size:11px;text-align:center;font-weight:600;">${r.s1}</td><td style="padding:4px 8px;font-size:11px;text-align:center;font-weight:600;">${r.s2}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      ${historyRows ? `
      <div style="margin-bottom:8px;">
        <h4 style="font-size:12px;color:#0f172a;margin:0 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">Position History</h4>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
          <thead><tr style="background:#f1f5f9;">
            <th style="padding:4px 8px;font-size:10px;text-align:left;">Jabatan</th><th style="padding:4px 8px;font-size:10px;text-align:center;">Periode</th><th style="padding:4px 8px;font-size:10px;text-align:center;">Grade</th>
          </tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>` : ''}
      <p style="font-size:11px;color:#475569;line-height:1.5;border-left:3px solid #3b82f6;padding-left:12px;">${c.constraint}</p>
    </div>`;
  }).join('');

  const summaryCards = [
    { label: 'Total Kandidat', value: rankedCandidates.length, color: '#0f172a' },
    { label: 'Lolos (Qualified)', value: filterSummary.qualified, color: '#059669' },
    { label: 'Tidak Lolos', value: filterSummary.rejected, color: '#dc2626' },
    { label: 'Skor Tertinggi', value: `${filterSummary.topScore}%`, color: '#d97706' },
  ];

  const readinessCounts = ['Short', 'Medium', 'Long', 'Not Ready'].map(level => ({
    level,
    label: level === 'Short' ? '0-1 thn' : level === 'Medium' ? '1-2 thn' : level === 'Long' ? '3-5 thn' : '>5 thn',
    count: rankedCandidates.filter(c => c.readiness === level).length,
    color: level === 'Short' ? '#059669' : level === 'Medium' ? '#d97706' : level === 'Long' ? '#0284c7' : '#64748b',
  }));

  const html = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>PULSE — Laporan Hasil Scoring</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#1e293b;background:#fff;padding:36px;max-width:900px;margin:0 auto;}
  @media screen{body{padding:36px;}}
  @media print{body{padding:8px!important;font-size:9px;}.no-print{display:none!important;}}
  .header{border-bottom:3px solid #0f172a;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px;}
  .header h1{font-size:20px;color:#0f172a;}.header p{font-size:11px;color:#64748b;}
  @media print{.header{margin-bottom:8px;}}
</style></head>
<body>
  <div class="no-print" style="text-align:right;margin-bottom:16px;">
    <button onclick="window.print()" style="padding:8px 20px;background:#0f172a;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;">🖨 Cetak / Simpan PDF</button>
  </div>
  <div class="header">
    <div>
      <h1>Laporan Hasil Scoring</h1>
      <p>${today}${method ? ` &mdash; Metode: ${METHOD_LABELS[method] ?? method}` : ''}</p>
    </div>
    <div style="text-align:right;">
      <div style="font-size:13px;font-weight:600;color:#0f172a;">${position.title}</div>
      <div style="font-size:11px;color:#64748b;">${position.department} · ${position.division}</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
    ${summaryCards.map(s => `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center;">
      <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;">${s.label}</div>
      <div style="font-size:20px;font-weight:800;color:${s.color};margin-top:4px;">${s.value}</div>
    </div>`).join('')}
  </div>
  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
    ${readinessCounts.map(r => `
    <div style="flex:1;min-width:100px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:${r.color};"></span>
        <span style="font-size:10px;color:#64748b;">${r.label}</span>
      </div>
      <div style="font-size:16px;font-weight:700;color:${r.color};margin-top:2px;">${r.count} kandidat</div>
    </div>`).join('')}
  </div>
  ${candidatesHtml}
  <script>setTimeout(() => window.print(), 400);</script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'width=1000,height=800');
  if (w) { w.onload = () => { URL.revokeObjectURL(url); }; } else { window.open(url, '_blank'); }
}
