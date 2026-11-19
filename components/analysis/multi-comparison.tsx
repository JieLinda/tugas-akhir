'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { Combobox } from '@/components/ui/combobox';
import { Progress } from '@/components/ui/progress';
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Flag,
  Plus,
  Scale,
  Sparkles,
  Star,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { type AnalysisCandidate, getInitials, readinessTone, runHavText } from '@/lib/analysis-utils';
import type { CandidateProfile } from '@/lib/talent-data';
import { formatHavQuadrant } from '@/lib/hav-quadrant';

type IncumbentInfo = { name: string; employeeId: string; profile: CandidateProfile | null };

interface MultiComparisonProps {
  rankedCandidates: AnalysisCandidate[];
  compareIds: string[];
  setCompareIds: (ids: string[]) => void;
  incumbent?: IncumbentInfo | null;
}

// Distinct series palette for up to 5 candidates (stroke + translucent fill).
const SERIES = [
  { name: 'amber', stroke: '#f59e0b', fill: 'rgba(245,158,11,0.30)', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', ring: 'ring-amber-400/40', border: 'border-amber-400/50' },
  { name: 'sky', stroke: '#0ea5e9', fill: 'rgba(14,165,233,0.28)', dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', ring: 'ring-sky-400/40', border: 'border-sky-400/50' },
  { name: 'emerald', stroke: '#10b981', fill: 'rgba(16,185,129,0.26)', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-400/40', border: 'border-emerald-400/50' },
  { name: 'violet', stroke: '#a855f7', fill: 'rgba(168,85,247,0.26)', dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', ring: 'ring-violet-400/40', border: 'border-violet-400/50' },
  { name: 'rose', stroke: '#f43f5e', fill: 'rgba(244,63,94,0.24)', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', ring: 'ring-rose-400/40', border: 'border-rose-400/50' },
] as const;

const readinessEta: Record<string, string> = {
  Short: 'Ready Now',
  Medium: '1-2 Yrs',
  Long: '3-5 Yrs',
  'Not Ready': 'Not Ready',
};

type RadarAxis = { label: string; get: (c: AnalysisCandidate) => number };

/**
 * The axes are the AHP aspects — and only those.
 *
 * "Job Match" used to hold the sixth slot and measured nothing: all three of its
 * producers compute `min(95, max(30, weightedScore − 5))`, i.e. the run's own
 * overall score, which the other axes are the components OF. On a radar that
 * double-counts the total — the axis sits at roughly the weighted mean of the
 * rest, inflating the area under a caption that reads "the wider the web, the
 * stronger the competency profile". Its name also promised a comparison against
 * the job profile that it never performed, while the aspect that genuinely does
 * that (career relevance, from job-profile document similarity × tenure) was
 * missing from the chart entirely. The clamp made it worse: everyone at or above
 * 100 read 95, so the top of the field flattened.
 *
 * It is also TOPSIS-derived, therefore set-relative — it moved when a candidate
 * was added to or excluded from the pool, which a fit-to-job figure must not.
 */
const BASE_RADAR_AXES: RadarAxis[] = [
  { label: 'Technical', get: (c) => Math.round(c.scoreBreakdown.technical) },
  { label: 'Behavior', get: (c) => Math.round(c.scoreBreakdown.behavior) },
  { label: 'HAV', get: (c) => Math.round(c.scoreBreakdown.hav) },
  { label: 'Performance', get: (c) => Math.round(c.scoreBreakdown.performance) },
  { label: 'Education', get: (c) => Math.round(c.scoreBreakdown.education) },
];

const CAREER_AXIS: RadarAxis = {
  label: 'Career Relevance',
  get: (c) => Math.round(c.scoreBreakdown.career ?? 0),
};

export function MultiComparison({ rankedCandidates, compareIds, setCompareIds, incumbent = null }: MultiComparisonProps) {
  const compareCandidates = compareIds
    .map((id) => rankedCandidates.find((c) => c.id === id))
    .filter(Boolean) as AnalysisCandidate[];

  // Per-aspect winner: the sole candidate holding the highest value gets a ★.
  // No "quality" / "match": both were the core score shifted by a few points
  // (PositionCandidate.jobMatch), so they always crowned the core winner again.
  const aspectDefs: { key: string; get: (c: AnalysisCandidate) => number }[] = [
    { key: 'core', get: (c) => c.weightedScore },
    { key: 'technical', get: (c) => c.scoreBreakdown.technical },
    { key: 'behavior', get: (c) => c.scoreBreakdown.behavior },
    { key: 'performance', get: (c) => c.scoreBreakdown.performance },
    { key: 'education', get: (c) => c.scoreBreakdown.education },
    { key: 'career', get: (c) => c.scoreBreakdown.career ?? 0 },
    { key: 'service', get: (c) => c.yearsOfService },
  ];
  const leaders: Record<string, string | null> = {};
  for (const def of aspectDefs) {
    const vals = compareCandidates.map(def.get);
    const max = Math.max(...vals);
    const winners = compareCandidates.filter((_, i) => vals[i] === max);
    leaders[def.key] = winners.length === 1 ? winners[0]!.id : null;
  }

  // Winner (highest weighted score) — highlighted across the view.
  const leaderId = leaders.core;

  // Career can be absent on a legacy run. Pinning the axis at 0 there would
  // assert every candidate has zero relevant experience, so it is dropped
  // instead, the same way the per-candidate breakdown list below omits it.
  // EVERY compared candidate must have it: on a mixed set one polygon would
  // otherwise be drawn through a fabricated zero.
  const radarAxes: RadarAxis[] =
    compareCandidates.length > 0 &&
    compareCandidates.every((c) => c.scoreBreakdown.career != null)
      ? [...BASE_RADAR_AXES, CAREER_AXIS]
      : BASE_RADAR_AXES;

  // Radar dataset: one row per axis, one series key (c0..c4) per candidate.
  const radarData = radarAxes.map((axis) => {
    const row: Record<string, string | number> = { axis: axis.label };
    compareCandidates.forEach((c, idx) => {
      row[`c${idx}`] = axis.get(c);
    });
    return row;
  });

  return (
    <Card className="border-slate-200 dark:border-slate-800 shadow-lg overflow-hidden">
      <CardHeader className="border-b bg-slate-50/50 dark:bg-slate-900/10 p-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />
            Komparasi Multi-Kandidat
            <InfoHint title="Komparasi Multi-Kandidat">
              Perbandingan mendalam hingga 5 kandidat — jejaring kompetensi (spider chart), dossier ringkas, dan matriks metrik.
            </InfoHint>
          </CardTitle>
          {compareIds.length < 5 && (
            <Button
              size="sm"
              variant="outline"
              className="shadow-xs font-semibold text-xs gap-1.5 shrink-0"
              onClick={() => {
                const available = rankedCandidates.find((c) => !compareIds.includes(c.id));
                if (available) setCompareIds([...compareIds, available.id]);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah Kandidat
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {compareCandidates.length === 0 ? (
          <p className="text-center p-8 text-sm text-slate-400 italic">Tidak ada kandidat untuk ditampilkan.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {/* ── Spider / radar competency web ─────────────────────────── */}
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px] divide-y lg:divide-y-0 lg:divide-x divide-slate-100 dark:divide-slate-800">
              <div className="p-5 bg-linear-to-b from-slate-50/40 to-transparent dark:from-slate-900/20">
                <h4 className="text-[11px] uppercase font-bold tracking-widest text-slate-400 mb-1 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Jejaring Kompetensi
                </h4>
                <p className="text-[10px] text-muted-foreground mb-2">Semakin luas jaring, semakin kuat profil kompetensi kandidat.</p>
                <ResponsiveContainer width="100%" height={440}>
                  <RadarChart data={radarData} outerRadius="82%" margin={{ top: 12, right: 32, bottom: 12, left: 32 }}>
                    <PolarGrid stroke="hsl(var(--border))" strokeOpacity={0.85} />
                    <PolarAngleAxis
                      dataKey="axis"
                      tick={{ fontSize: 12, fill: 'hsl(var(--foreground))', fontWeight: 700 }}
                    />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} tickCount={5} />
                    {compareCandidates.map((c, idx) => {
                      const s = SERIES[idx % SERIES.length]!;
                      return (
                        <Radar
                          key={c.id}
                          name={c.name}
                          dataKey={`c${idx}`}
                          stroke={s.stroke}
                          fill={s.fill}
                          fillOpacity={1}
                          strokeWidth={2.75}
                          dot={{ r: 3.5, fill: s.stroke, stroke: 'hsl(var(--background))', strokeWidth: 1.5 }}
                          activeDot={{ r: 5, fill: s.stroke, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                          isAnimationActive={false}
                        />
                      );
                    })}
                    <Tooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 8,
                        border: '1px solid hsl(var(--border))',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                        background: 'hsl(var(--popover))',
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12, fontWeight: 700, paddingTop: 8 }}
                      iconType="circle"
                      iconSize={10}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* Leaderboard rail */}
              <div className="p-5 space-y-2.5 bg-slate-50/30 dark:bg-slate-900/10">
                <h4 className="text-[11px] uppercase font-bold tracking-widest text-slate-400 mb-1">Peringkat Skor</h4>
                {[...compareCandidates]
                  .sort((a, b) => b.weightedScore - a.weightedScore)
                  .map((c, rankIdx) => {
                    const seriesIdx = compareCandidates.findIndex((x) => x.id === c.id);
                    const s = SERIES[seriesIdx % SERIES.length]!;
                    return (
                      <div key={c.id} className="flex items-center gap-2.5">
                        <span className={`size-2.5 rounded-full shrink-0 ${s.dot}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate flex items-center gap-1">
                            {rankIdx === 0 && <Crown className="h-3 w-3 text-amber-500 shrink-0" />}
                            {c.name}
                          </p>
                          <Progress value={c.weightedScore} className="h-1 mt-1" />
                        </div>
                        <span className={`text-xs font-extrabold tabular-nums ${s.text}`}>{c.weightedScore}%</span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* ── Incumbent benchmark ───────────────────────────────────── */}
            {incumbent && (
              <div className="p-5 bg-indigo-50/40 dark:bg-indigo-950/10">
                <div className="rounded-2xl border border-indigo-200/70 dark:border-indigo-900/50 bg-card overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200/60 dark:border-indigo-900/50 bg-indigo-500/5 px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className={`size-12 border-2 shrink-0 border-indigo-400/50 dark:border-indigo-800/50`}>
                            <AvatarImage className="object-cover" src={incumbent.profile?.photoUrl ?? ''} alt={incumbent.name} />
                            <AvatarFallback className="bg-slate-100 dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200">
                              {getInitials(incumbent.name)}
                            </AvatarFallback>
                          </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{incumbent.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {incumbent.profile?.currentPosition ?? 'Pejabat saat ini'} · ID {incumbent.employeeId}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[9px] font-extrabold uppercase tracking-wide gap-1 border-indigo-300 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300">
                      <Flag className="h-2.5 w-2.5" /> Benchmark · Pejabat Saat Ini
                    </Badge>
                  </div>

                  {incumbent.profile ? (
                    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,320px)_1fr]">
                      {/* Registry */}
                      <div className="grid gap-1 text-[11px] text-slate-500 dark:text-slate-400 self-start">
                        {incumbent.profile.gradeLevel && (
                          <div className="flex justify-between gap-2">
                            <span className="shrink-0">Level</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300 truncate text-right">{incumbent.profile.gradeLevel}</span>
                          </div>
                        )}
                        <div className="flex justify-between gap-2">
                          <span className="shrink-0">Masa Kerja</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300 text-right">{incumbent.profile.yearsOfService} Thn</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="shrink-0">Pendidikan</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300 truncate text-right">
                            {[incumbent.profile.education, incumbent.profile.major].filter((x) => x && x !== '-').join(' · ') || '-'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="shrink-0">HAV Kuadran</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300 text-right">#{formatHavQuadrant(incumbent.profile.havQuadrant)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="shrink-0">Disiplin</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300 truncate text-right">{incumbent.profile.disciplinaryStatus || '-'}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="shrink-0">MCU</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300 truncate text-right">{incumbent.profile.mcuStatus || '-'}</span>
                        </div>
                        {incumbent.profile.behaviorRecommendation && incumbent.profile.behaviorRecommendation !== '-' && (
                          <div className="flex justify-between gap-2">
                            <span className="shrink-0">Behavior</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300 truncate text-right">{incumbent.profile.behaviorRecommendation}</span>
                          </div>
                        )}
                      </div>

                      {/* Technical competencies (the benchmark) */}
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          Kompetensi Teknis Incumbent{incumbent.profile.technicalCompetencies?.length ? ` (${incumbent.profile.technicalCompetencies.length})` : ''}
                        </p>
                        {incumbent.profile.technicalCompetencies && incumbent.profile.technicalCompetencies.length > 0 ? (
                          <div className="grid gap-1 sm:grid-cols-2 max-h-44 overflow-y-auto pr-0.5">
                            {incumbent.profile.technicalCompetencies.map((tc) => (
                              <div key={tc.technicalId} className="flex items-center justify-between gap-1.5 rounded-md bg-slate-50/60 dark:bg-slate-900/30 px-2 py-1 text-[10px]">
                                <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-400">{tc.technicalName}</span>
                                <span className="shrink-0 font-semibold text-slate-700 dark:text-slate-300">
                                  {tc.currentProficiencyName ?? tc.proficiencyName ?? '-'}
                                </span>
                                {tc.currentScore != null && (
                                  <span className="shrink-0 font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{tc.currentScore}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground italic">Belum ada data kompetensi teknis incumbent.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="px-4 py-3 text-[11px] text-muted-foreground italic">
                      Data profil incumbent tidak tersedia di database kandidat — hanya nama & ID pegawai yang diketahui.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Rich candidate dossier columns ────────────────────────── */}
            <div className="p-5">
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))' }}
              >
                {compareCandidates.map((candidate, idx) => {
                  const s = SERIES[idx % SERIES.length]!;
                  const isLeader = candidate.id === leaderId;
                  const isLead = (key: string) => leaders[key] === candidate.id;
                  const winStar = <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400 shrink-0" />;
                  return (
                    <div
                      key={candidate.id}
                      className={`w-full rounded-2xl border bg-card overflow-hidden shadow-sm transition-shadow hover:shadow-md ${
                        isLeader ? `${s.border} ring-2 ${s.ring}` : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {/* Column header: series color bar + selector */}
                      <div className={`h-1 w-full ${s.dot}`} />
                      <div className="p-3.5 space-y-3">
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={`text-[9px] font-extrabold uppercase py-0 px-1.5 tracking-wide ${s.text} ${s.border}`}
                            >
                              #{idx + 1}
                            </Badge>
                            {isLeader && (
                              <Badge className="text-[8px] font-extrabold uppercase py-0 px-1.5 tracking-wide bg-amber-500 text-amber-950 gap-0.5">
                                <Crown className="h-2.5 w-2.5" /> Unggul
                              </Badge>
                            )}
                          </div>
                          {compareIds.length > 1 && (
                            <button
                              onClick={() => setCompareIds(compareIds.filter((id) => id !== candidate.id))}
                              className="text-slate-400 hover:text-rose-500 transition-colors"
                              aria-label="Hapus kandidat dari komparasi"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Profile */}
                        <div className="flex items-center gap-3">
                          <Avatar className={`size-12 border-2 shrink-0 ${s.border}`}>
                            <AvatarImage className="object-cover" src={candidate.profile?.photoUrl ?? ''} alt={candidate.name} />
                            <AvatarFallback className="bg-slate-100 dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200">
                              {getInitials(candidate.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <Combobox
                              value={candidate.id}
                              onValueChange={(newId) => {
                                const updated = [...compareIds];
                                updated[idx] = newId;
                                setCompareIds(updated);
                              }}
                              options={rankedCandidates.map((rc) => ({ value: rc.id, label: rc.name }))}
                              placeholder="Pilih kandidat"
                              searchPlaceholder="Cari kandidat..."
                              emptyText="Kandidat tidak ditemukan."
                              triggerClassName="h-auto border-0 bg-transparent px-0 py-0 text-left text-sm font-bold shadow-none hover:bg-transparent [&>span]:truncate"
                              className="w-56"
                            />
                            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{candidate.currentPosition}</p>
                          </div>
                        </div>

                        {/* Key indicator: the final score. Career relevance — the
                            aspect that does measure fit to the job — is in the
                            breakdown below (AHP+TOPSIS runs only). */}
                        <div className="grid grid-cols-1 gap-1.5 text-center">
                          {[
                            { key: 'core', label: 'Core', value: `${candidate.weightedScore}%` },
                          ].map((tile) => (
                            <div
                              key={tile.key}
                              className={`rounded-lg border py-1.5 ${
                                isLead(tile.key)
                                  ? 'bg-emerald-500/10 border-emerald-500/30'
                                  : 'bg-slate-50/40 dark:bg-slate-900/20'
                              }`}
                            >
                              <p className="text-[8px] uppercase font-bold text-slate-400 tracking-wider">{tile.label}</p>
                              <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums flex items-center justify-center gap-0.5">
                                {tile.value}
                                {isLead(tile.key) && winStar}
                              </p>
                            </div>
                          ))}
                        </div>

                        <Badge className={`w-full justify-center font-bold text-[10px] py-0.5 ${readinessTone[candidate.readiness]}`} variant="outline">
                          {readinessEta[candidate.readiness] ?? candidate.readiness} · {candidate.readinessWindow}
                        </Badge>

                        {/* Competency breakdown */}
                        <div className="space-y-1.5 pt-0.5">
                          {[
                            { key: 'technical', label: 'Technical', val: candidate.scoreBreakdown.technical },
                            { key: 'behavior', label: 'Behavior', val: candidate.scoreBreakdown.behavior },
                            { key: 'performance', label: 'Performance', val: candidate.scoreBreakdown.performance },
                            { key: 'education', label: 'Education', val: candidate.scoreBreakdown.education },
                            ...(candidate.scoreBreakdown.career != null
                              ? [{ key: 'career', label: 'Career Relevance', val: candidate.scoreBreakdown.career }]
                              : []),
                          ].map((b) => (
                            <div key={b.key} className="space-y-1">
                              <div className="flex items-center justify-between text-[10px] font-medium">
                                <span className="text-slate-500 dark:text-slate-400">{b.label}</span>
                                <span
                                  className={`font-bold tabular-nums flex items-center gap-0.5 ${
                                    isLead(b.key) ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {Math.round(b.val)}%
                                  {isLead(b.key) && winStar}
                                </span>
                              </div>
                              <Progress value={b.val} className="h-1" />
                            </div>
                          ))}
                          <div className="flex items-center justify-between text-[10px] font-medium pt-0.5">
                            <span className="text-slate-500 dark:text-slate-400">HAV Kuadran</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300">{runHavText(candidate, { withHash: true })}</span>
                          </div>
                        </div>

                        {/* Technical competency & proficiency */}
                        {candidate.profile?.technicalCompetencies &&
                          candidate.profile.technicalCompetencies.length > 0 && (
                            <div className="space-y-1 pt-0.5">
                              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                Kompetensi Teknis ({candidate.profile.technicalCompetencies.length})
                              </p>
                              <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
                                {candidate.profile.technicalCompetencies.map((tc) => {
                                  const proficiency =
                                    tc.currentProficiencyName ?? tc.proficiencyName ?? '-';
                                  const gapVal = typeof tc.gap === 'number' ? tc.gap : null;
                                  return (
                                    <div
                                      key={tc.technicalId}
                                      className="flex items-center justify-between gap-1.5 text-[10px]"
                                    >
                                      <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-400">
                                        {tc.technicalName}
                                      </span>
                                      <span className="shrink-0 font-semibold text-slate-700 dark:text-slate-300">
                                        {proficiency}
                                      </span>
                                      {gapVal !== null && gapVal !== 0 && (
                                        <span
                                          className={`shrink-0 font-bold tabular-nums ${
                                            gapVal > 0
                                              ? 'text-emerald-600 dark:text-emerald-400'
                                              : 'text-rose-600 dark:text-rose-400'
                                          }`}
                                        >
                                          {gapVal > 0 ? `+${gapVal}` : gapVal}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                        {/* Strengths */}
                        {candidate.strengths.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Keunggulan
                            </p>
                            {candidate.strengths.slice(0, 2).map((item) => (
                              <p key={item} className="text-[10px] leading-snug text-slate-600 dark:text-slate-400 pl-2 border-l-2 border-emerald-500/60">
                                {item}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Development areas */}
                        {candidate.weaknesses.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-amber-500 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> Pengembangan
                            </p>
                            {candidate.weaknesses.slice(0, 2).map((item) => (
                              <p key={item} className="text-[10px] leading-snug text-slate-600 dark:text-slate-400 pl-2 border-l-2 border-amber-500/60">
                                {item}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Top recommendation */}
                        {candidate.recommendation.length > 0 && (
                          <div className="rounded-lg bg-primary/5 border border-primary/10 p-2 space-y-1">
                            <p className="text-[10px] font-bold text-primary flex items-center gap-1">
                              <Zap className="h-3 w-3 text-amber-500" /> Arahan Suksesi
                            </p>
                            <p className="text-[10px] leading-snug text-slate-600 dark:text-slate-400 font-medium">
                              {candidate.recommendation[0]}
                            </p>
                          </div>
                        )}

                        {/* Registry footer */}
                        <div className="pt-1 border-t border-slate-100 dark:border-slate-800/60 grid gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                          <div className="flex justify-between">
                            <span>Masa Kerja</span>
                            <span
                              className={`font-bold flex items-center gap-0.5 ${
                                isLead('service') ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {candidate.yearsOfService} Thn
                              {isLead('service') && winStar}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="shrink-0">ID Pegawai</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300 truncate text-right">{candidate.profile?.employeeId ?? candidate.id}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="shrink-0">Pendidikan</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300 truncate text-right">
                              {[candidate.profile?.education, candidate.profile?.major].filter(Boolean).join(' · ') || '-'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="shrink-0">Disiplin</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300 truncate text-right">{candidate.discipline || '-'}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="shrink-0">MCU</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300 truncate text-right">{candidate.mcu || '-'}</span>
                          </div>
                          {candidate.behaviorRecommendation && candidate.behaviorRecommendation !== '-' && (
                            <div className="flex justify-between gap-2">
                              <span className="shrink-0">Behavior</span>
                              <span className="font-bold text-slate-700 dark:text-slate-300 truncate text-right">{candidate.behaviorRecommendation}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Executive recommendation ──────────────────────────────── */}
            {compareCandidates.length >= 2 && (
              <div className="p-4 bg-slate-50/50 dark:bg-slate-900/10 space-y-3">
                <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  Bintang menandai nilai tertinggi di antara kandidat yang dibandingkan untuk setiap aspek.
                </p>
                <div className="p-3.5 border border-dashed border-primary/20 rounded-xl text-xs">
                  <p className="font-bold text-slate-800 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Executive Recommendation
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-semibold">
                    {(() => {
                      const best = [...compareCandidates].sort((a, b) => b.weightedScore - a.weightedScore)[0]!;
                      return (
                        <span>
                          <strong>{best.name}</strong> memimpin komparasi dengan Weighted Core Score tertinggi ({best.weightedScore}%) dan
                          direkomendasikan sebagai prioritas utama suksesi posisi ini.
                        </span>
                      );
                    })()}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
