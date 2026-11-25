'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  Building2,
  Cake,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  Clock,
  Loader2,
  GraduationCap,
  Hash,
  Heart,
  History,
  IdCard,
  Layers,
  Pencil,
  Scale,
  Target,
  TrendingUp,
  UserCheck,
  Zap,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DashboardHeader } from '@/components/dashboard-header';
import { CandidateFormDialog } from '@/components/candidate-form-dialog';
import { useRouter } from 'next/navigation';
import { useIsDemoMode } from '@/components/app-mode-provider';
import { DemoCandidateActions, DemoStateBadge } from '@/components/demo/demo-candidate-actions';
import { MASKED_CODE, maskNpk } from '@/lib/app-mode-shared';
import { updateCandidateAction } from '@/lib/pulse-crud-actions';
import { formatBirthDate } from '@/lib/age';
import { formatHavQuadrant, getHavQuadrantLabel } from '@/lib/hav-quadrant';
import { talentBoxFromQuadrant } from '@/lib/hav-quadrant-derive';
import { HAV_SOURCE_LABEL } from '@/lib/hav-effective';
import { BOX_META } from '@/lib/hav-box-meta';
import { formatHistoryDate } from '@/lib/datetime';
import { getCandidateRunsForPositionAction } from '@/lib/candidate-run-history-actions';
import type { CandidateTalentPoolStatus } from '@/lib/talent-pool-data';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import type { CandidateProfile } from '@/lib/talent-data';
import { DISCIPLINE_LEVELS, disciplineLevel } from '@/lib/discipline';

/**
 * Candidate detail.
 *
 * The page used to be seven cards of identical weight stacked vertically: a
 * profile card that repeated the header's name, then a flat grid where Usia sat
 * at exactly the size and colour of MCU, then two charts, then two histories.
 * Everything was equally loud, which is the same as nothing being loud — the
 * question a reader actually arrives with ("how does this person stand, and
 * why") was answered by material at the bottom of the page, in the same
 * typeface as their date of birth.
 *
 * It is now three levels, and they are ordered by how often they are the reason
 * somebody opened the page:
 *
 *   1. HERO — who, plus the single standing fact: is this person in the Talent
 *      Pool. Rank and readiness are deliberately NOT here — each belongs to one
 *      run and is read beside the run that produced it. Nothing in the hero
 *      touches `CandidateProfile.readiness` (the hardcoded placeholder
 *      `'Medium'`) or `.programs` (always `[]`, see getCandidateById); either
 *      would put a fabricated verdict at the top of the page.
 *   2. SINYAL PENILAIAN — the attributes scoring actually reads. Tone-coloured,
 *      full width, above the fold.
 *   3. PROFIL — biodata. Real, rarely the reason for the visit, so it is one
 *      compact card rather than four competing with the signals.
 *
 * Then the detail sections, each behind a labelled heading so the page has a
 * spine instead of being a stack of unrelated boxes.
 */

type RunHistoryEntry = {
  runId: string;
  positionId: string;
  positionTitle: string;
  department: string | null;
  program: string | null;
  method: string;
  label: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  rank: number;
  finalScore: number;
  readiness: string;
  totalRanked: number;
};

/** One position's newest run, plus the counts that describe the rest of it. */
type RunSummaryEntry = {
  latest: RunHistoryEntry;
  runCount: number;
  bestRank: number;
};

interface CandidateDetailPageClientProps {
  candidate: CandidateProfile;
  masterDepartments?: string[];
  masterDivisions?: string[];
  masterPositions?: string[];
  masterCompetencies?: { technicalId: string; technicalName: string }[];
  /** Newest run per position. Older runs load on demand — see RunPositionCard. */
  runSummary?: RunSummaryEntry[];
  /** Null when the status could not be read (never "not qualified"). */
  talentPool?: CandidateTalentPoolStatus | null;
}

const METHOD_LABELS: Record<string, string> = {
  AHP_TOPSIS: 'AHP + TOPSIS',
};

const PROGRAM_LABELS: Record<string, string> = {
  talent: 'Talent Pool',
  successor: 'Successor',
  emergency: 'Emergency Position',
};

/**
 * Four semantic tones, and nothing else. Hue here always means the same thing —
 * good / watch / bad / unknown — so a colour is never decoration and two
 * differently-coloured things on this page always differ in that one way.
 */
type Tone = 'good' | 'warn' | 'bad' | 'muted';

const TONE_VALUE: Record<Tone, string> = {
  good: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-700 dark:text-amber-300',
  bad: 'text-rose-700 dark:text-rose-300',
  muted: 'text-muted-foreground',
};

const TONE_CHIP: Record<Tone, string> = {
  good: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  warn: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  bad: 'bg-rose-500/12 text-rose-700 dark:text-rose-300',
  muted: 'bg-muted text-muted-foreground',
};

const TONE_BADGE: Record<Tone, string> = {
  good: 'border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300',
  warn: 'border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/60 dark:text-amber-300',
  bad: 'border-rose-200 bg-rose-500/10 text-rose-700 dark:border-rose-900/60 dark:text-rose-300',
  muted: 'border-slate-200 bg-slate-500/10 text-slate-700 dark:border-slate-800 dark:text-slate-300',
};

function readinessTone(readiness: string): Tone {
  if (readiness === 'Short') return 'good';
  if (readiness === 'Medium') return 'warn';
  if (readiness === 'Long') return 'muted';
  return 'bad';
}

function mcuTone(status: string): Tone {
  if (!status || status === '-') return 'muted';
  if (/unfit/i.test(status)) return 'bad';
  if (/note|catatan/i.test(status)) return 'warn';
  if (/fit/i.test(status)) return 'good';
  return 'muted';
}

// `status` is the LABEL (disciplineLabel), so the level is found by label first.
function disciplineTone(status: string): Tone {
  if (!status || status === '-') return 'muted';
  const level = DISCIPLINE_LEVELS.find((l) => l.label === status) ?? disciplineLevel(status);
  return level?.tone ?? 'bad';
}

function behaviorTone(recommendation: string | null): Tone {
  if (!recommendation) return 'muted';
  if (/ready/i.test(recommendation)) return 'good';
  if (/development/i.test(recommendation)) return 'warn';
  return 'bad';
}

/** Recharts writes these as SVG presentation attributes, which do NOT resolve
 *  `var(--token)` — the old `hsl(var(--border))` produced invalid CSS and the
 *  library silently fell back to its own defaults. Concrete slate values at low
 *  opacity read correctly against both themes. */
const AXIS_INK = '#94a3b8';
const GRID_INK = '#94a3b8';

export function CandidateDetailPageClient({
  candidate,
  masterDepartments = [],
  masterDivisions = [],
  masterPositions = [],
  masterCompetencies = [],
  runSummary = [],
  talentPool = null,
}: CandidateDetailPageClientProps) {
  // Demo mode: Edit / Turnoff / Reload in the header, the NPK masked and position
  // codes masked; the loader has already removed the photo (lib/demo/).
  const demo = useIsDemoMode();
  const router = useRouter();
  // ── Performance appraisal ──────────────────────────────────────
  const paRaw = candidate.raw?.performanceGrade;
  const hasPaData = Boolean(paRaw && paRaw !== '-' && paRaw.includes(','));
  const paValues = hasPaData ? (paRaw as string).split(',') : [];
  const gradeToNumber = (g: string | undefined) => {
    if (!g) return 3;
    const map: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
    return map[g.trim().toUpperCase()] ?? 3;
  };
  const getVal = (i: number) => (hasPaData ? paValues[i]?.trim() : undefined);
  const cy = new Date().getFullYear();

  const paData = [
    { year: String(cy - 3), S2: gradeToNumber(getVal(4)), S2Label: getVal(4) || 'C', S1: gradeToNumber(getVal(5)), S1Label: getVal(5) || 'C' },
    { year: String(cy - 2), S2: gradeToNumber(getVal(2)), S2Label: getVal(2) || 'C', S1: gradeToNumber(getVal(3)), S1Label: getVal(3) || 'C' },
    { year: String(cy - 1), S2: gradeToNumber(getVal(0)), S2Label: getVal(0) || 'C', S1: gradeToNumber(getVal(1)), S1Label: getVal(1) || 'C' },
  ];
  /** Newest recorded semester grade — the one figure the signal row needs. */
  const latestPa = getVal(0) ?? null;
  const paTone: Tone = !latestPa
    ? 'muted'
    : /^[AB]$/i.test(latestPa)
      ? 'good'
      : /^C$/i.test(latestPa)
        ? 'warn'
        : 'bad';

  // ── Technical competencies ─────────────────────────────────────
  const competencies = candidate.technicalCompetencies ?? [];
  const techData = competencies.map((comp) => ({
    name: comp.technicalName.length > 20 ? comp.technicalName.slice(0, 20) + '…' : comp.technicalName,
    fullName: comp.technicalName,
    current: comp.currentScore ?? 0,
    target: comp.score ?? 0,
    gap: comp.gap ?? 0,
  }));
  const gapCount = competencies.filter((c) => (c.gap ?? 0) > 0).length;
  const techTone: Tone =
    competencies.length === 0 ? 'muted' : gapCount === 0 ? 'good' : gapCount <= 2 ? 'warn' : 'bad';

  // ── HAV ────────────────────────────────────────────────────────
  const havBox = talentBoxFromQuadrant(candidate.havQuadrant);
  const havName = getHavQuadrantLabel(candidate.havQuadrant);
  const havTone: Tone = !havBox
    ? 'muted'
    : havBox === 'TOP' || havBox === 'STRONG'
      ? 'good'
      : havBox === 'SOLID'
        ? 'warn'
        : 'bad';

  // ── Run counts, for the history section's header only ──────────
  const totalRuns = runSummary.reduce((n, g) => n + g.runCount, 0);

  // ── Position history ───────────────────────────────────────────
  const historyData = [...(candidate.positionHistory ?? [])].sort((a, b) => {
    const aEnd = a.validTo ? new Date(a.validTo).getTime() : Date.now();
    const bEnd = b.validTo ? new Date(b.validTo).getTime() : Date.now();
    return bEnd - aEnd;
  });

  const tooltipPaFormatter = (
    value: number,
    name: string,
    props: { payload: { S1Label: string; S2Label: string } },
  ) => {
    const label = name === 'S1' ? props.payload.S1Label : props.payload.S2Label;
    return [label, name === 'S1' ? 'S1' : 'S2'];
  };

  const initials = candidate.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <DashboardHeader
        title={candidate.name}
        description={`${candidate.currentPosition} · ${candidate.department}`}
        actions={
          <div className="flex items-center gap-2">
            {demo ? (
              <>
                <DemoStateBadge demo={candidate.demo} />
                <DemoCandidateActions
                  candidate={candidate}
                  lookups={{ departments: masterDepartments, divisions: masterDivisions, positions: masterPositions, masterCompetencies }}
                  onChanged={() => router.refresh()}
                />
              </>
            ) : (
            <CandidateFormDialog
              title="Ubah karyawan"
              description="Perbarui data inti karyawan yang tersimpan di database."
              submitLabel="Simpan perubahan"
              action={updateCandidateAction}
              candidate={candidate}
              departments={masterDepartments}
              divisions={masterDivisions}
              positions={masterPositions}
              masterCompetencies={masterCompetencies}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="mr-1 h-4 w-4" />
                  Edit
                </Button>
              }
            />
            )}
            <Button asChild variant="ghost" size="sm">
              <Link href="/candidates">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Kembali
              </Link>
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl space-y-8 p-6">
          {/* ══ 1 · HERO ══════════════════════════════════════════
              One plain card, no tinted half. An earlier version washed the
              identity side in `bg-primary/[0.05]`, which rendered as a flat
              taupe block with a hard seam down the middle — colour doing
              nothing except drawing attention to itself. Hierarchy here comes
              from the 24px name against 12px chips, and from the card sitting
              above a labelled section spine. */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-5 pt-6">
              {candidate.photoUrl ? (
                <img
                  src={candidate.photoUrl}
                  alt=""
                  className="h-20 w-20 shrink-0 rounded-2xl object-cover"
                  loading="lazy"
                  onError={(e) => e.currentTarget.remove()}
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground">
                  {initials}
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <h2 className="text-2xl font-bold leading-tight tracking-tight">{candidate.name}</h2>
                  <p className="text-sm font-medium text-muted-foreground">{candidate.currentPosition}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                  <IdentityChip icon={<Hash className="h-3.5 w-3.5" />}>{demo ? maskNpk(candidate.employeeId) : candidate.employeeId}</IdentityChip>
                  <IdentityChip icon={<Building2 className="h-3.5 w-3.5" />}>{candidate.department}</IdentityChip>
                  <IdentityChip icon={<Layers className="h-3.5 w-3.5" />}>{candidate.division}</IdentityChip>
                  {candidate.gradeLevel && (
                    <IdentityChip icon={<Award className="h-3.5 w-3.5" />}>
                      {candidate.gradeLevel}
                      {candidate.grade ? ` · Grade ${candidate.grade}` : ''}
                    </IdentityChip>
                  )}
                </div>
              </div>

              {/* The one standing fact worth the top of the page. Rank and
                  readiness were here and are gone: they belong to a single run
                  and are read in the Riwayat section beside the run that
                  produced them, whereas Talent Pool membership is a property of
                  the person right now. Evaluated by the same
                  `applyProgramFilters` the Talent Pool page uses, so the two
                  can never disagree about this candidate. */}
              <TalentPoolStanding status={talentPool} />
            </CardContent>
          </Card>

          {/* ══ 2 · SINYAL PENILAIAN ══════════════════════════════ */}
          <Section
            icon={Target}
            title="Sinyal Penilaian"
            desc="Enam atribut yang dibaca mesin penilaian saat menyusun peringkat. Warna hanya menandai status, bukan hiasan."
          >
            <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
              <Signal
                icon={Heart}
                label="MCU"
                value={candidate.mcuStatus || '—'}
                tone={mcuTone(candidate.mcuStatus)}
                hint="Hasil medical check-up terakhir"
              />
              <Signal
                icon={Scale}
                label="Disiplin"
                value={candidate.disciplinaryStatus || '—'}
                tone={disciplineTone(candidate.disciplinaryStatus)}
                hint="Sanksi aktif menggugurkan pada sebagian program"
              />
              <Signal
                icon={UserCheck}
                label="Behavior"
                value={candidate.behaviorRecommendation ?? '—'}
                tone={behaviorTone(candidate.behaviorRecommendation)}
                hint="Rekomendasi asesmen perilaku"
              />
              <Signal
                icon={Zap}
                label="HAV"
                value={havName || formatHavQuadrant(candidate.havQuadrant) || '—'}
                tone={havTone}
                // The HAV in force, with WHERE it came from — the same value the
                // eligibility rules and scoring read (lib/hav-effective.ts).
                hint={
                  havBox
                    ? `Kuadran ${candidate.havQuadrant} · kategori ${BOX_META[havBox].label}${
                        candidate.havSource ? ` · sumber: ${HAV_SOURCE_LABEL[candidate.havSource]}` : ''
                      }${
                        candidate.havSource !== 'upload' && candidate.uploadedHavQuadrant
                          ? ` (upload HAV: Q${candidate.uploadedHavQuadrant})`
                          : ''
                      } — diatur di Talent Mapping`
                    : 'Kuadran belum terisi — tempatkan di Talent Mapping atau unggah HAV'
                }
              />
              <Signal
                icon={TrendingUp}
                label="Performance Appraisal"
                value={latestPa ? `Grade ${latestPa}` : '—'}
                tone={paTone}
                hint={latestPa ? 'Semester terakhir yang tercatat' : 'Belum ada nilai PA tersinkron'}
              />
              <Signal
                icon={Layers}
                label="Kompetensi Teknis"
                value={
                  competencies.length === 0
                    ? '—'
                    : gapCount === 0
                      ? 'Tidak ada gap'
                      : `${gapCount} gap`
                }
                tone={techTone}
                hint={
                  competencies.length === 0
                    ? 'Belum ada kompetensi tercatat'
                    : `dari ${competencies.length} kompetensi tercatat`
                }
              />
            </div>
          </Section>

          {/* Catatan perilaku, right under the signal it explains. It used to
              be the last block on the page, three sections below the Behavior
              chip it is the prose for — so the one place the recommendation is
              justified sat further from it than anything else. */}
          {candidate.behaviorNotes && (
            <div className="rounded-xl border border-amber-300/60 bg-amber-500/[0.06] p-4 dark:border-amber-900/50 dark:bg-amber-500/10">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                    Catatan perilaku
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                    {candidate.behaviorNotes}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ══ 3 · PROFIL ════════════════════════════════════════
              Biodata in one card, deliberately quieter than the signals: it is
              real and rarely the reason anybody opened this page. It used to be
              four cards the same size as MCU. */}
          <Section
            icon={IdCard}
            title="Profil"
            desc="Data diri dan riwayat kepegawaian dasar."
          >
            <Card>
              <CardContent className="grid gap-x-8 gap-y-5 pt-6 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon={Cake}
                  label="Usia"
                  value={candidate.age != null ? `${candidate.age} tahun` : '—'}
                  sub={
                    candidate.age != null
                      ? (formatBirthDate(candidate.birthDate) ?? undefined)
                      : 'Tanggal lahir belum tersinkron'
                  }
                />
                <Fact
                  icon={Clock}
                  label="Masa kerja"
                  value={`${candidate.yearsOfService} tahun`}
                  sub="Sejak bergabung"
                />
                <Fact
                  icon={GraduationCap}
                  label="Pendidikan"
                  value={candidate.education || '—'}
                  sub={candidate.major && candidate.major !== '-' ? candidate.major : undefined}
                />
                <Fact
                  icon={Award}
                  label="Grade"
                  value={candidate.grade ? `Grade ${candidate.grade}` : '—'}
                  sub={candidate.gradeLevel ?? undefined}
                />
              </CardContent>
            </Card>
          </Section>

          {/* ══ 4 · KOMPETENSI & KINERJA ══════════════════════════ */}
          <Section
            icon={TrendingUp}
            title="Kompetensi & Kinerja"
            desc="Kompetensi teknis terhadap tuntutan jabatan, dan nilai PA tiga tahun terakhir."
          >
            <div className="grid gap-5 xl:grid-cols-2">
              <Panel
                title="Kompetensi Teknis"
                desc="Skor saat ini dibanding target jabatan."
                aside={
                  competencies.length > 0 ? (
                    <Badge variant="outline" className={cn('text-[10px]', TONE_BADGE[techTone])}>
                      {gapCount === 0 ? 'Semua terpenuhi' : `${gapCount} belum terpenuhi`}
                    </Badge>
                  ) : null
                }
              >
                {techData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={techData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_INK} strokeOpacity={0.25} vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: AXIS_INK }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fontSize: 10, fill: AXIS_INK }} axisLine={false} tickLine={false} width={28} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} cursor={{ fill: GRID_INK, fillOpacity: 0.08 }} />
                      <Bar dataKey="current" name="Saat ini" fill="#ea580c" radius={[3, 3, 0, 0]} maxBarSize={24} />
                      <Bar dataKey="target" name="Target" fill="#94a3b8" radius={[3, 3, 0, 0]} maxBarSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty>Belum ada data kompetensi teknis.</Empty>
                )}
                <Legend items={[{ color: '#ea580c', label: 'Saat ini' }, { color: '#94a3b8', label: 'Target jabatan' }]} />
              </Panel>

              <Panel
                title="Performance Appraisal"
                desc="Nilai PA tiga tahun terakhir, per semester."
                aside={
                  latestPa ? (
                    <Badge variant="outline" className={cn('text-[10px]', TONE_BADGE[paTone])}>
                      Terakhir {latestPa}
                    </Badge>
                  ) : null
                }
              >
                {hasPaData ? (
                  <>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={paData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={GRID_INK} strokeOpacity={0.25} vertical={false} />
                        <XAxis dataKey="year" tick={{ fontSize: 10, fill: AXIS_INK }} axisLine={false} tickLine={false} />
                        <YAxis
                          domain={[0.5, 5.5]}
                          ticks={[1, 2, 3, 4, 5]}
                          tickFormatter={(v: number) => ['', 'E', 'D', 'C', 'B', 'A'][v]}
                          tick={{ fontSize: 10, fill: AXIS_INK }}
                          axisLine={false}
                          tickLine={false}
                          width={28}
                        />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={tooltipPaFormatter as never} />
                        <Line type="monotone" dataKey="S1" name="S1" stroke="#ea580c" strokeWidth={2} dot={{ fill: '#ea580c', r: 3 }} connectNulls />
                        <Line type="monotone" dataKey="S2" name="S2" stroke="#0f766e" strokeWidth={2} dot={{ fill: '#0f766e', r: 3 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                    <Legend items={[{ color: '#ea580c', label: 'Semester 1' }, { color: '#0f766e', label: 'Semester 2' }]} />
                  </>
                ) : (
                  <Empty>Belum ada nilai PA tersinkron untuk kandidat ini.</Empty>
                )}
              </Panel>
            </div>
          </Section>

          {/* ══ 5 · RIWAYAT ═══════════════════════════════════════ */}
          <Section
            icon={History}
            title="Riwayat"
            desc="Perjalanan jabatan di perusahaan, dan setiap penilaian yang pernah menyertakan kandidat ini."
          >
            {/* items-start: without it both cards stretch to the taller one,
                so a three-entry job history was padded out to the height of a
                nine-position run list. */}
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <Panel
                title="Riwayat Jabatan"
                desc="Dari yang terbaru."
                aside={
                  historyData.length > 0 ? (
                    <Badge variant="outline" className="text-[10px]">
                      {historyData.length} jabatan
                    </Badge>
                  ) : null
                }
              >
                {historyData.length > 0 ? (
                  <div className="space-y-0">
                    {historyData.map((row, idx) => {
                      const title = row.internalTitle ?? row.externalTitle ?? (demo ? MASKED_CODE : row.positionId);
                      const isLast = idx === historyData.length - 1;
                      const isCurrent = idx === 0;
                      return (
                        <div key={`${row.positionId}-${row.validFrom ?? idx}`} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div
                              className={cn(
                                'mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-background',
                                isCurrent
                                  ? 'bg-primary'
                                  : row.primaryPosition
                                    ? 'bg-muted-foreground/50'
                                    : 'bg-muted-foreground/25',
                              )}
                            />
                            {!isLast && <div className="w-px flex-1 bg-border" />}
                          </div>
                          <div className="min-w-0 pb-4">
                            <p className={cn('text-[13px] leading-snug', isCurrent ? 'font-semibold' : 'font-medium')}>
                              {title}
                              {!row.primaryPosition && (
                                <Badge variant="outline" className="ml-1.5 px-1.5 py-0 align-middle text-[9px] font-bold uppercase tracking-wide">
                                  Non-primary
                                </Badge>
                              )}
                            </p>
                            <p className="mt-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                              {formatHistoryDate(row.validFrom)} → {formatHistoryDate(row.validTo)}
                              {row.gradeId ? ` · Grade ${row.gradeId}` : ''}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Empty>Belum ada riwayat jabatan.</Empty>
                )}
              </Panel>

              <Panel
                title="Riwayat Scoring Run"
                desc="Run terakhir per posisi. Buka satu posisi untuk riwayat lengkapnya."
                aside={
                  runSummary.length > 0 ? (
                    <Badge variant="outline" className="text-[10px] tabular-nums">
                      {totalRuns} run · {runSummary.length} posisi
                    </Badge>
                  ) : null
                }
              >
                {runSummary.length > 0 ? (
                  <div className="space-y-3">
                    {runSummary.map((group) => (
                      <RunPositionCard
                        key={group.latest.positionId}
                        candidateId={candidate.id}
                        group={group}
                      />
                    ))}
                  </div>
                ) : (
                  <Empty>Kandidat ini belum pernah masuk dalam scoring run.</Empty>
                )}
              </Panel>
            </div>
          </Section>

        </div>
      </div>
    </>
  );
}

// ── Building blocks ───────────────────────────────────────────────

/**
 * Section heading — the page's spine. Mirrors the idiom already used by
 * Pengaturan Job Family (`SettingsSection`): an icon in a tinted square, a
 * title, one line of purpose, a rule underneath. Without these the page is a
 * stack of boxes with nothing saying which belong together.
 */
function Section({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3 border-b pb-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <h3 className="flex min-w-0 items-center gap-1.5 text-base font-semibold leading-tight">
          {title}
          <InfoHint title={title}>{desc}</InfoHint>
        </h3>
      </div>
      {children}
    </section>
  );
}

/** A card inside a section: header row + body, no nested section chrome. */
function Panel({
  title,
  desc,
  aside,
  children,
}: {
  title: string;
  desc: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden py-0">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-5 py-2.5">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          {title}
          <InfoHint title={title}>{desc}</InfoHint>
        </p>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function IdentityChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 font-medium">
      <span className="text-muted-foreground/60">{icon}</span>
      {children}
    </span>
  );
}

/**
 * Talent Pool membership — the one standing fact in the hero.
 *
 * `null` means the status could not be read, which is NOT "not qualified": an
 * unreadable answer rendered as a red "Tidak masuk" would be a verdict nobody
 * reached. When rules exist and the candidate fails them the reason is named
 * rather than left to be hunted on another page, and a failure that is only an
 * empty column says so — that is a data-entry gap, not an assessment.
 */
function TalentPoolStanding({ status }: { status: CandidateTalentPoolStatus | null }) {
  if (!status) {
    return (
      <div className="w-full shrink-0 rounded-xl border border-dashed p-3.5 sm:w-64">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Talent Pool
        </p>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">Status tidak terbaca</p>
      </div>
    );
  }

  const inPool = status.qualified;
  const reason = status.failedRules[0]?.label ?? null;

  return (
    <div
      className={cn(
        'w-full shrink-0 rounded-xl border p-3.5 sm:w-64',
        inPool
          ? 'border-emerald-300/70 bg-emerald-500/[0.07] dark:border-emerald-900/60 dark:bg-emerald-500/10'
          : 'border-border bg-muted/40',
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Talent Pool
      </p>
      <p
        className={cn(
          'mt-1 flex items-center gap-1.5 text-base font-bold leading-none',
          inPool ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground',
        )}
      >
        {inPool ? (
          <CircleCheck className="h-4 w-4" />
        ) : (
          <CircleSlash className="h-4 w-4 text-muted-foreground" />
        )}
        {inPool ? 'Masuk' : 'Tidak masuk'}
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {status.ruleCount === 0
          ? 'Program belum punya aturan filter, jadi seluruh kandidat aktif masuk.'
          : inPool
            ? `Lolos ${status.ruleCount} aturan filter.`
            : status.blockedOnlyByMissingData
              ? `Tertahan karena data kosong${reason ? `: ${reason}` : ''}, bukan karena penilaian.`
              : `Gagal ${status.failedRules.length} dari ${status.ruleCount} aturan filter${reason ? ` — ${reason}` : ''}.`}
      </p>
    </div>
  );
}

/**
 * One position's runs. The newest arrives with the page; the rest are fetched
 * when the reader expands it, because a candidate here has 32 runs across 9
 * positions and shipping every one of them answered a question most visits
 * never ask. Fetched once and kept — collapsing does not discard it.
 */
function RunPositionCard({
  candidateId,
  group,
}: {
  candidateId: string;
  group: RunSummaryEntry;
}) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunHistoryEntry[] | null>(null);
  const [loading, startLoading] = useTransition();
  const { latest, runCount, bestRank } = group;
  const hasMore = runCount > 1;

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (runs || !hasMore) return;
    startLoading(async () => {
      try {
        setRuns(await getCandidateRunsForPositionAction(candidateId, latest.positionId));
      } catch {
        // Left as an empty array, which the body below reports as a failed
        // fetch — rendering nothing would read as "no other runs".
        setRuns([]);
      }
    });
  }

  const shown = open && runs && runs.length > 0 ? runs : [latest];

  return (
    <div className="overflow-hidden rounded-xl border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-b bg-muted/40 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/70"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{latest.positionTitle}</p>
          <p className="truncate text-[11px] text-muted-foreground">{latest.department ?? '-'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
            Terbaik <span className="font-bold text-foreground">#{bestRank}</span>
          </span>
          <Badge variant="secondary" className="text-[10px] font-semibold tabular-nums">
            {runCount} run
          </Badge>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </div>
      </button>

      <div className="divide-y">
        {shown.map((run) => (
          <RunRow key={run.runId} run={run} />
        ))}
      </div>

      {open && loading && (
        <p className="flex items-center gap-2 border-t px-3.5 py-2.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Memuat riwayat run posisi ini…
        </p>
      )}
      {open && !loading && runs?.length === 0 && (
        <p className="border-t px-3.5 py-2.5 text-[11px] text-muted-foreground">
          Riwayat run gagal dimuat. Tutup dan buka lagi untuk mencoba ulang.
        </p>
      )}
      {!open && hasMore && (
        <button
          type="button"
          onClick={toggle}
          className="w-full border-t px-3.5 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          Lihat {runCount - 1} run sebelumnya
        </button>
      )}
    </div>
  );
}

function RunRow({ run }: { run: RunHistoryEntry }) {
  const fmtDate = formatHistoryDate(run.completedAt ?? run.createdAt);
  const programLabel = run.program ? (PROGRAM_LABELS[run.program] ?? run.program) : null;
  return (
    <Link
      href={`/positions/${run.positionId}?runId=${run.runId}`}
      className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/50"
    >
      <div className="flex size-9 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
        <span className="text-[8px] font-semibold uppercase leading-none opacity-70">Rank</span>
        <span className="text-sm font-bold leading-none tabular-nums">{run.rank}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{run.label ?? `Run ${fmtDate}`}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {METHOD_LABELS[run.method] ?? run.method}
          {programLabel ? ` · ${programLabel}` : ''}
          {run.totalRanked ? ` · dari ${run.totalRanked} kandidat` : ''} · {fmtDate}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <span className="text-sm font-bold tabular-nums">{Math.round(run.finalScore)}%</span>
        <Badge variant="outline" className={cn('text-[10px]', TONE_BADGE[readinessTone(run.readiness)])}>
          {run.readiness}
        </Badge>
        <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
      </div>
    </Link>
  );
}

/** One assessment attribute. Icon chip carries the tone, so the row scans as a
 *  set of statuses rather than as six paragraphs. */
function Signal({
  icon: Icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: Tone;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3 bg-card p-4">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TONE_CHIP[tone])}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {label}
        </p>
        <p className={cn('mt-0.5 text-sm font-semibold leading-snug', TONE_VALUE[tone])}>{value}</p>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={hint}>
          {hint}
        </p>
      </div>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-semibold leading-snug">{value}</p>
        {sub && <p className="text-[11px] leading-snug text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-[10px] font-medium text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
