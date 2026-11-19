'use client';

import type { CSSProperties } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { Progress } from '@/components/ui/progress';
import {
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Trophy,
  UserCheck,
  Zap,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import type { PositionSummary } from '@/lib/talent-data';
import {
  type AnalysisCandidate,
  getInitials,
  runHavText,
} from '@/lib/analysis-utils';
import { formatHistoryDate } from '@/lib/datetime';

// Readiness-driven accent theme for the hero header + score gauge.
const READINESS_THEME: Record<
  string,
  { hex: string; grad: string; ring: string; text: string; chip: string; glow: string }
> = {
  Short: {
    hex: '#10b981',
    grad: 'from-emerald-500/20 via-emerald-500/[0.06]',
    ring: 'ring-emerald-400/60',
    text: 'text-emerald-600 dark:text-emerald-400',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    glow: 'rgba(16,185,129,0.45)',
  },
  Medium: {
    hex: '#f59e0b',
    grad: 'from-amber-500/20 via-amber-500/[0.06]',
    ring: 'ring-amber-400/60',
    text: 'text-amber-600 dark:text-amber-400',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    glow: 'rgba(245,158,11,0.45)',
  },
  Long: {
    hex: '#0ea5e9',
    grad: 'from-sky-500/20 via-sky-500/[0.06]',
    ring: 'ring-sky-400/60',
    text: 'text-sky-600 dark:text-sky-400',
    chip: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
    glow: 'rgba(14,165,233,0.45)',
  },
  'Not Ready': {
    hex: '#f43f5e',
    grad: 'from-rose-500/20 via-rose-500/[0.06]',
    ring: 'ring-rose-400/60',
    text: 'text-rose-600 dark:text-rose-400',
    chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
    glow: 'rgba(244,63,94,0.45)',
  },
};

function getReadinessTheme(readiness: string) {
  return READINESS_THEME[readiness] ?? READINESS_THEME.Medium!;
}

const GAUGE_R = 40;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

interface DiagnosticDossierProps {
  selectedCandidate: AnalysisCandidate | null;
  rankedCandidates: AnalysisCandidate[];
  selectedPosition: PositionSummary;
}

export function DiagnosticDossier({
  selectedCandidate,
  rankedCandidates,
  selectedPosition,
}: DiagnosticDossierProps) {
  return (
    <Card className="border-slate-200 dark:border-slate-800 shadow-lg">
      <CardHeader className="sticky top-0 z-20 border-b bg-slate-50/85 dark:bg-slate-900/70 backdrop-blur-md p-5 rounded-t-xl">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-primary" />
            Diagnostic Dossier Kandidat
            <InfoHint title="Diagnostic Dossier Kandidat">
              Ringkasan eksekutif kandidat fokus, risiko, kompetensi, dan langkah lanjutan.
            </InfoHint>
          </CardTitle>
          <Badge variant="outline" className="text-[10px] font-mono tracking-wider font-extrabold px-2 py-0.5 uppercase bg-background shrink-0">
            RANK #{rankedCandidates.findIndex((c) => c.id === selectedCandidate?.id) + 1}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {selectedCandidate ? (() => {
          const theme = getReadinessTheme(selectedCandidate.readiness);
          const rank = rankedCandidates.findIndex((c) => c.id === selectedCandidate.id) + 1;
          const score = Math.round(selectedCandidate.weightedScore);
          const gaugeTarget = GAUGE_C * (1 - Math.max(0, Math.min(100, score)) / 100);
          const gaugeStyle = { '--gauge-target': gaugeTarget } as unknown as CSSProperties;
          return (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <style>{`
              @keyframes dossierGaugeFill { from { stroke-dashoffset: ${GAUGE_C}; } to { stroke-dashoffset: var(--gauge-target); } }
              @keyframes dossierHeroRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
              .dossier-gauge-arc { animation: dossierGaugeFill 1.1s cubic-bezier(0.22,1,0.36,1) forwards; }
              .dossier-hero-rise { animation: dossierHeroRise 0.5s ease-out both; }
            `}</style>

            {/* ── Hero header ─────────────────────────────────────── */}
            <div className={`relative overflow-hidden bg-linear-to-br ${theme.grad} to-transparent`}>
              <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full opacity-70 blur-3xl" style={{ background: theme.glow }} />
              <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${theme.hex}, transparent 85%)` }} />
              <div className="dossier-hero-rise relative flex items-center gap-4 p-5">
                {/* Avatar + rank medal */}
                <div className="relative shrink-0">
                  {selectedCandidate.profile?.photoUrl ? (
                    <img
                      src={selectedCandidate.profile.photoUrl}
                      alt=""
                      className={`size-20 rounded-2xl object-cover shadow-lg ring-2 ${theme.ring} ring-offset-2 ring-offset-background`}
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <div className={`flex size-20 items-center justify-center rounded-2xl bg-linear-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 text-2xl font-extrabold text-slate-600 dark:text-slate-200 shadow-lg ring-2 ${theme.ring} ring-offset-2 ring-offset-background`}>
                      {getInitials(selectedCandidate.name)}
                    </div>
                  )}
                  <span className="absolute -bottom-2 -left-2 flex items-center gap-0.5 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-md ring-2 ring-background dark:bg-white dark:text-slate-900">
                    <Trophy className="h-2.5 w-2.5" /> #{rank}
                  </span>
                </div>

                {/* Identity */}
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-50">{selectedCandidate.name}</h3>
                  <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">{selectedCandidate.currentPosition}</p>
                  <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {selectedCandidate.profile?.department ?? selectedPosition.department}
                  </p>
                  <span className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${theme.chip}`}>
                    <span className="size-1.5 rounded-full" style={{ background: theme.hex }} />
                    {selectedCandidate.readiness} · {selectedCandidate.readinessWindow}
                  </span>
                </div>

                {/* Core score gauge */}
                <div key={selectedCandidate.id} className="relative shrink-0">
                  <svg width="88" height="88" viewBox="0 0 96 96" className="-rotate-90">
                    <circle cx="48" cy="48" r={GAUGE_R} fill="none" stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="8" />
                    <circle
                      cx="48"
                      cy="48"
                      r={GAUGE_R}
                      fill="none"
                      stroke={theme.hex}
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={GAUGE_C}
                      className="dossier-gauge-arc"
                      style={gaugeStyle}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-50">{score}</span>
                    <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Core</span>
                  </div>
                </div>
              </div>
            </div>

            {/* No "Quality Score" / "Match Fit" tiles: both were the core score
                above shifted by a few points (see PositionCandidate.jobMatch), so
                they repeated the gauge under names that promised independent
                measurements. Fit to the job is career relevance, listed below. */}

            {/* Middle Critical Assessments */}
            <div className="p-5 space-y-4">
              <div className="space-y-2.5">
                <h4 className="text-[11px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Breakdown Kompetensi Evaluasi</h4>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-slate-600 dark:text-slate-400">Technical Competence</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{Math.round(selectedCandidate.scoreBreakdown.technical)}%</span>
                  </div>
                  <Progress value={selectedCandidate.scoreBreakdown.technical} className="h-1.5" />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-slate-600 dark:text-slate-400">Leadership behavior review</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{Math.round(selectedCandidate.scoreBreakdown.behavior)}%</span>
                  </div>
                  <Progress value={selectedCandidate.scoreBreakdown.behavior} className="h-1.5" />
                </div>

                {selectedCandidate.scoreBreakdown.career != null && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-slate-600 dark:text-slate-400">Career relevance (AHP+TOPSIS)</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{Math.round(selectedCandidate.scoreBreakdown.career)}%</span>
                    </div>
                    <Progress value={selectedCandidate.scoreBreakdown.career} className="h-1.5" />
                  </div>
                )}

                 <div className="space-y-1.5">
                   <div className="flex items-center justify-between text-xs font-medium">
                     <span className="text-slate-600 dark:text-slate-400">HAV Kuadran</span>
                     <span className="font-bold text-slate-800 dark:text-slate-200">{runHavText(selectedCandidate, { withHash: true })}</span>
                   </div>
                 </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-slate-600 dark:text-slate-400">Performance appraisal logs</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{Math.round(selectedCandidate.scoreBreakdown.performance)}%</span>
                  </div>
                  <Progress value={selectedCandidate.scoreBreakdown.performance} className="h-1.5" />
                </div>
              </div>
            </div>

            {/* Behavior Recommendation & Notes */}
            {(() => {
              const rec =
                selectedCandidate.behaviorRecommendation ??
                selectedCandidate.profile?.behaviorRecommendation ??
                null;
              const notes =
                selectedCandidate.behaviorNotes ??
                selectedCandidate.profile?.behaviorNotes ??
                null;
              const hasRec = Boolean(rec && rec.trim() && rec.trim() !== '-');
              if (!hasRec && !notes) return null;
              return (
                <div className="p-5 space-y-2.5">
                  <h4 className="text-[11px] uppercase font-bold tracking-widest text-slate-400 flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5 text-primary" /> Behavior Assessment
                  </h4>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">Rekomendasi</span>
                    <Badge variant="outline" className="text-[10px] font-semibold">
                      {hasRec ? rec : 'Tidak ada data asesmen'}
                    </Badge>
                  </div>
                  {notes && (
                    <div className="rounded-md border border-slate-100 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-900/20 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Catatan</p>
                      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                        {notes}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Technical Competency & Proficiency */}
            {selectedCandidate.profile?.technicalCompetencies &&
              selectedCandidate.profile.technicalCompetencies.length > 0 && (
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] uppercase font-bold tracking-widest text-slate-400">
                      Kompetensi Teknis & Proficiency
                    </h4>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {selectedCandidate.profile.technicalCompetencies.length} kompetensi
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {selectedCandidate.profile.technicalCompetencies.map((tc) => {
                      const proficiency =
                        tc.currentProficiencyName ?? tc.proficiencyName ?? null;
                      const target = tc.proficiencyName ?? null;
                      const gapVal = typeof tc.gap === 'number' ? tc.gap : null;
                      return (
                        <div
                          key={tc.technicalId}
                          className="flex items-center justify-between gap-2 rounded-md border border-slate-100 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-900/20 px-2.5 py-1.5"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-300">
                            {tc.technicalName}
                          </span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className="px-1.5 py-0 text-[10px] font-semibold"
                            >
                              {proficiency ?? '-'}
                            </Badge>
                            {target && target !== proficiency && (
                              <span className="text-[10px] text-muted-foreground">
                                target {target}
                              </span>
                            )}
                            {gapVal !== null && gapVal !== 0 && (
                              <span
                                className={`text-[10px] font-semibold ${
                                  gapVal > 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                gap {gapVal > 0 ? `+${gapVal}` : gapVal}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* Performance Appraisal Chart */}
            {(() => {
              const cy = new Date().getFullYear();
              const paRaw = selectedCandidate.profile?.raw?.performanceGrade;
              const hasPaData = paRaw && paRaw !== '-' && paRaw.includes(',');
              const paValues = hasPaData ? paRaw.split(',') : [];
              const gradeToNumber = (g: string | undefined) => {
                if (!g) return 3; 
                const map: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
                return map[g.trim().toUpperCase()] ?? 3;
              };
              const getVal = (i: number) => hasPaData ? paValues[i]?.trim() : undefined;
              const paData = [
                { year: String(cy - 3), S2: gradeToNumber(getVal(4)), S2Label: getVal(4) || 'C', S1: gradeToNumber(getVal(5)), S1Label: getVal(5) || 'C' },
                { year: String(cy - 2), S2: gradeToNumber(getVal(2)), S2Label: getVal(2) || 'C', S1: gradeToNumber(getVal(3)), S1Label: getVal(3) || 'C' },
                { year: String(cy - 1), S2: gradeToNumber(getVal(0)), S2Label: getVal(0) || 'C', S1: gradeToNumber(getVal(1)), S1Label: getVal(1) || 'C' },
              ];

              const tooltipFormatter = (value: number, name: string, props: { payload: { S1Label: string; S2Label: string } }) => {
                const label = name === 'S1' ? props.payload.S1Label : props.payload.S2Label;
                return [label, name === 'S1' ? 'S1' : 'S2'];
              };

              return (
                <div className="p-5">
                  {/* The candidate's PA history as synced TODAY, not the grades
                      the run scored: the PA score above is the run's own. */}
                  <h4 className="text-[11px] uppercase font-bold tracking-widest text-slate-400 mb-3">
                    Riwayat Performance Appraisal{' '}
                    <span className="normal-case tracking-normal font-medium">(data terkini)</span>
                  </h4>
                  <ResponsiveContainer width="100%" height={148}>
                    <LineChart data={paData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0.5, 5.5]} ticks={[1, 2, 3, 4, 5]} tickFormatter={(v: number) => ['', 'E', 'D', 'C', 'B', 'A'][v]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={28} />
                      <Tooltip
                        contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid hsl(var(--border))', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                        formatter={tooltipFormatter as any}
                      />
                      <Line type="monotone" dataKey="S1" name="S1" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="S2" name="S2" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-muted-foreground font-medium">
                    <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-blue-500 inline-block" /> S1</span>
                    <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500 inline-block" /> S2</span>
                  </div>
                </div>
              );
            })()}

            {/* Who wrote the prose below (FR-RR-14) — it never feeds a number. */}
            <p className="px-5 pt-3 text-[10px] font-medium text-muted-foreground">
              {(() => {
                const src = (selectedCandidate as { ahpTopsis?: { narrativeSource?: 'llm' | 'template' } }).ahpTopsis
                  ?.narrativeSource;
                return src === 'llm'
                  ? 'Narasi model bahasa, tidak memengaruhi angka. Disimpan bersama run dan tidak dibuat ulang saat run dibuka.'
                  : src === 'template'
                    ? 'Narasi templat yang disusun dari angka run, tidak memengaruhi angka.'
                    : 'Narasi ini dapat ditulis model bahasa (run lama tidak mencatat penulisnya); tidak memengaruhi angka.';
              })()}
            </p>
            {/* Strengths & Development Areas */}
            <div className="p-5 grid gap-4 md:grid-cols-2 bg-slate-50/50 dark:bg-slate-900/10">
              <div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mb-2.5">
                  <CheckCircle className="h-3.5 w-3.5" /> Keunggulan Kompetitif
                </span>
                <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 font-medium">
                  {selectedCandidate.strengths.map((item) => (
                    <p key={item} className="leading-relaxed pl-3 border-l-2 border-emerald-500">• {item}</p>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs font-bold text-amber-500 flex items-center gap-1.5 mb-2.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> Kebutuhan Pengembangan
                </span>
                <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 font-medium">
                  {selectedCandidate.weaknesses.length ? (
                    selectedCandidate.weaknesses.map((item) => (
                      <p key={item} className="leading-relaxed pl-3 border-l-2 border-amber-500">• {item}</p>
                    ))
                  ) : (
                    <p className="text-slate-400 italic font-normal pl-3">No material constraint flagged.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Actionable Pipeline Recommendation */}
            <div className="p-5 bg-primary/5">
              <span className="text-xs font-bold text-primary flex items-center gap-1.5 mb-2">
                <Zap className="h-3.5 w-3.5 text-amber-500" /> Arahan Langkah Suksesi & Penugasan
              </span>
              <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-305 font-semibold leading-relaxed">
                {selectedCandidate.recommendation.map((recommendationText, rIdx) => (
                  <div key={rIdx} className="flex gap-2 items-start">
                    <ChevronRight className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                    <p>{recommendationText}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Dossier Registry Detail Info */}
            <div className="p-5 text-xs">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-3">Registri Database Karyawan</span>
              <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-slate-600 dark:text-slate-400 font-medium">
                <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/60 pb-1">
                  <span>ID Pegawai</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedCandidate.profile?.employeeId ?? selectedCandidate.id}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/60 pb-1">
                  <span>Masa Kerja</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedCandidate.yearsOfService} Thn</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/60 pb-1">
                  <span>Status Disiplin</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedCandidate.discipline || selectedCandidate.profile?.disciplinaryStatus || '-'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/60 pb-1">
                  <span>Pendidikan</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-right truncate">
                    {[
                      selectedCandidate.profile?.education ?? selectedPosition.qualifications.education,
                      selectedCandidate.profile?.major,
                    ].filter(Boolean).join(' · ') || '-'}
                  </span>
                </div>
                 <div className="flex justify-between border-b border-slate-100 dark:border-slate-800/60 pb-1">
                    <span>HAV Kuadran</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{runHavText(selectedCandidate, { withHash: true })}</span>
                  </div>
              </div>

              {/* Work History */}
              {selectedCandidate.profile?.positionHistory && selectedCandidate.profile.positionHistory.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
                  <h4 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-3">Riwayat Pekerjaan</h4>
                  <div className="space-y-0">
                    {[...selectedCandidate.profile.positionHistory]
                      .sort((a, b) => {
                        const aEnd = a.validTo ? new Date(a.validTo).getTime() : (a.validFrom ? new Date(a.validFrom).getTime() : 0);
                        const bEnd = b.validTo ? new Date(b.validTo).getTime() : (b.validFrom ? new Date(b.validFrom).getTime() : 0);
                        return bEnd - aEnd;
                      })
                      .map((row, idx, arr) => {
                        const title = row.internalTitle ?? row.externalTitle ?? row.positionId;
                        const isLast = idx === arr.length - 1;
                        return (
                          <div key={`${selectedCandidate.id}-${row.positionId}-${row.validFrom ?? idx}`} className="flex gap-2.5">
                            <div className="flex flex-col items-center">
                              <div className="size-1.5 rounded-full bg-primary ring-2 ring-background shrink-0 mt-1.5" />
                              {!isLast && <div className="w-px flex-1 bg-border" />}
                            </div>
                            <div className={`pb-3 ${isLast ? '' : ''}`}>
                              <p className="text-xs font-semibold text-foreground leading-snug">
                                {title}
                                {!row.primaryPosition && (
                                  <Badge variant="outline" className="ml-1 text-[8px] py-0 px-1 font-bold uppercase tracking-wide align-middle">Non-Primary</Badge>
                                )}
                              </p>
                              <p className="text-[10px] text-muted-foreground font-medium tabular-nums mt-0.5">
                                {formatHistoryDate(row.validFrom)} → {formatHistoryDate(row.validTo)}
                                {row.gradeId ? ` · Grade ${row.gradeId}` : ''}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>
          );
        })() : (
          <div className="p-8 text-center text-sm text-slate-400">
            Tidak ada data kandidat suksesi yang aktif.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
