'use client';

// ── "Komparasi Versi" — the tab that compares two versions of a ranking ──
//
// Formerly "Perbandingan Run" (`?tab=perbandingan-run`, still honoured). What
// used to be two places — the standalone comparison page
// (/positions/[id]/compare) and the "Rekomendasi sistem dan keputusan forum"
// card above every tab — is one tab of the scoring-results page, because they
// answer one question from two ends: what the system recommended in each run,
// how those recommendations differ, and what the forum chose from them.
//
// The tab was rebuilt around the order a forum asks its questions in, and the
// visual weight follows that order:
//
//   1. WHICH two versions — the A | B bar, sticky, the one control that is
//      always in reach. The lineage tree that used to sit above it, 28rem
//      tall, is a picking tool rather than an answer: it now folds away behind
//      "Silsilah" once a pair is chosen, and opens by itself when none is.
//   2. WHAT changed — "Ringkasan" opens on a verdict (the top candidate, how
//      much moved, which sources differ), then the template sentences that say
//      why, the forum's own choices in A and B, the picture, and the five
//      sources.
//   3. The EVIDENCE — five sections instead of eight equal tabs: Peringkat,
//      Analisis (per kriteria · per kandidat · atribusi), Konfigurasi & Pool,
//      and the forum's record.
//
// The pair lives in the page's URL (FR-CMP-11), kept there by the page, not by
// this component, so a run switch or a refresh does not lose it. Everything is
// computed by `compareRuns` from what the two runs stored (lib/run-compare.ts):
// no model, no recomputed aspect.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  BarChart3,
  Gavel,
  GitBranch,
  GitCompare,
  LayoutDashboard,
  ListOrdered,
  Loader2,
  Microscope,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InfoHint } from '@/components/ui/info-hint';
import { getRunComparisonAction, type RunComparisonResult } from '@/lib/run-compare-actions';
import { defaultComparePair, nextPair, runNeighbours, type ComparePair } from '@/lib/run-history';
import type { RunTree } from '@/lib/run-tree';
import { LineageNavigator, type PairSide } from './lineage-navigator';
import { PairBar } from './pair-bar';
import { ComparisonOverview } from './comparison-overview';
import { ComparisonRankingTable } from './ranking-table';
import { CandidateBreakdownCompare } from './topsis-breakdown';
import { AttributionTable, ConfigCompare, CriteriaTable, PoolTable } from './tables';
import { DecisionRecord, decisionCount, useDecisionSummary } from '../decision-summary';
import { SectionShellStyles } from '../section-shell';

export type { ComparePair } from '@/lib/run-history';

type Section = 'ringkasan' | 'peringkat' | 'analisis' | 'konfigurasi' | 'keputusan';
type AnalysisLens = 'kriteria' | 'rincian' | 'atribusi';
type SetupLens = 'config' | 'pool';
/** What the overview may jump to — a section, or a lens inside one. */
export type CompareTarget = 'peringkat' | 'konfigurasi' | 'pool' | 'keputusan';

const SECTION_TONE: Record<Section, { on: string; badge: string }> = {
  ringkasan: {
    on: 'bg-cyan-600 text-white shadow-md shadow-cyan-600/25 dark:bg-cyan-500 dark:text-cyan-950',
    badge: 'bg-white/25 text-white dark:bg-cyan-950/30 dark:text-cyan-950',
  },
  peringkat: {
    on: 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25 dark:bg-indigo-500 dark:text-indigo-950',
    badge: 'bg-white/25 text-white dark:bg-indigo-950/30 dark:text-indigo-950',
  },
  analisis: {
    on: 'bg-violet-600 text-white shadow-md shadow-violet-600/25 dark:bg-violet-500 dark:text-violet-950',
    badge: 'bg-white/25 text-white dark:bg-violet-950/30 dark:text-violet-950',
  },
  konfigurasi: {
    on: 'bg-amber-500 text-white shadow-md shadow-amber-500/25 dark:bg-amber-400 dark:text-amber-950',
    badge: 'bg-white/25 text-white dark:bg-amber-950/30 dark:text-amber-950',
  },
  keputusan: {
    on: 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25 dark:bg-emerald-500 dark:text-emerald-950',
    badge: 'bg-white/25 text-white dark:bg-emerald-950/30 dark:text-emerald-950',
  },
};

export function RunCompareWorkspace({
  positionId,
  positionTitle,
  tree,
  openRunId,
  pair,
  onPairChange,
  programLabels,
  decisionsRefreshKey,
}: {
  positionId: string;
  positionTitle: string;
  /** null while loading. */
  tree: RunTree | null;
  /** The run open on the page. */
  openRunId: string | null;
  pair: ComparePair;
  onPairChange: (pair: ComparePair) => void;
  programLabels: Record<string, string>;
  /** Changes when the picks change, so the decision record re-reads. */
  decisionsRefreshKey: string;
}) {
  const { a, b } = pair;
  const roots = useMemo(() => tree?.roots ?? [], [tree]);
  const [section, setSection] = useState<Section>('ringkasan');
  const [analysisLens, setAnalysisLens] = useState<AnalysisLens>('kriteria');
  const [setupLens, setSetupLens] = useState<SetupLens>('config');
  const [result, setResult] = useState<RunComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [candidateId, setCandidateId] = useState('');
  const [exporting, setExporting] = useState(false);
  // The lineage tree is a picking tool: open while no pair is chosen, folded
  // once one is — the reader can always reopen it from the header.
  const [treeOpen, setTreeOpen] = useState(!(a && b));
  const decisions = useDecisionSummary(positionId, decisionsRefreshKey);

  // No pair in the URL: open on the run on screen against its parent (or the
  // nearest thing to one). Once — the reader's own choice is never overridden.
  const defaulted = useRef(false);
  useEffect(() => {
    if (!tree || defaulted.current) return;
    defaulted.current = true;
    if (a || b) return;
    const def = defaultComparePair(tree.roots, openRunId);
    if (def) {
      onPairChange(def);
      setTreeOpen(false);
    } else {
      setSection('keputusan');
      setTreeOpen(true);
    }
  }, [tree, a, b, openRunId, onPairChange]);

  useEffect(() => {
    let active = true;
    if (!a || !b || a === b) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    getRunComparisonAction({ aRunId: a, bRunId: b })
      .then((r) => {
        if (!active) return;
        setResult(r);
        // Default to someone both runs ranked — the case the breakdown explains.
        if (r.ok)
          setCandidateId((prev) =>
            prev && r.comparison.ranking.some((x) => x.candidateId === prev)
              ? prev
              : (r.comparison.ranking.find((x) => x.membership === 'both')?.candidateId ??
                r.comparison.ranking[0]?.candidateId ??
                ''),
          );
      })
      .catch(() => active && setResult({ ok: false, reason: 'Perbandingan tidak dapat dimuat. Muat ulang halaman untuk mencoba lagi.' }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [a, b]);

  const dto = result?.ok ? result.comparison : null;
  const breakdown = dto?.breakdowns.find((x) => x.candidateId === candidateId) ?? null;

  const fillA = (id: string) => {
    const nb = runNeighbours(roots, id);
    return nb.parentId ?? nb.rootId ?? nb.previousId;
  };
  const pick = (side: PairSide, id: string) => onPairChange(nextPair(pair, side, id, fillA));

  async function exportXlsx() {
    if (!dto) return;
    setExporting(true);
    try {
      const { exportComparisonWorkbook } = await import('@/lib/run-compare-export');
      await exportComparisonWorkbook(dto, positionTitle);
    } catch {
      toast.error('Ekspor gagal. Coba lagi.');
    } finally {
      setExporting(false);
    }
  }

  const nDecisions = decisionCount(decisions.data);
  const configDiffers = dto ? dto.config.filter((c) => !c.same && c.recordedA && c.recordedB).length : null;
  const poolOnly = dto ? dto.ranking.filter((r) => r.membership !== 'both').length : null;
  const moved = dto
    ? dto.ranking.filter((r) => r.membership === 'both' && (r.deltaRank ?? 0) !== 0).length
    : null;

  const SECTIONS: { key: Section; label: string; icon: LucideIcon; count?: number | null; hint?: string; needsPair: boolean }[] = [
    { key: 'ringkasan', label: 'Ringkasan', icon: LayoutDashboard, needsPair: true },
    { key: 'peringkat', label: 'Peringkat', icon: ListOrdered, count: moved, hint: 'kandidat bergeser peringkat', needsPair: true },
    { key: 'analisis', label: 'Analisis', icon: Microscope, needsPair: true },
    {
      key: 'konfigurasi',
      label: 'Konfigurasi & Pool',
      icon: Settings2,
      count: configDiffers != null && poolOnly != null ? configDiffers + poolOnly : null,
      hint: 'butir konfigurasi yang berbeda + kandidat yang hanya ada di satu run',
      needsPair: true,
    },
    {
      key: 'keputusan',
      label: 'Keputusan forum',
      icon: Gavel,
      count: decisions.data ? nDecisions : null,
      hint: 'keputusan forum',
      needsPair: false,
    },
  ];

  const openTarget = (t: CompareTarget) => {
    if (t === 'peringkat' || t === 'keputusan') setSection(t);
    else {
      setSection('konfigurasi');
      setSetupLens(t === 'pool' ? 'pool' : 'config');
    }
  };

  // Arrow keys move between sections, as a tab list should.
  const tabRefs = useRef(new Map<Section, HTMLButtonElement>());
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const keys = SECTIONS.map((s) => s.key);
    const at = keys.indexOf(section);
    const next =
      e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : keys[(at + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length];
    setSection(next);
    tabRefs.current.get(next)?.focus();
  };

  const current = SECTIONS.find((s) => s.key === section)!;
  const pairBody = (() => {
    if (!a || !b)
      return (
        <EmptyState>
          {tree && defaultComparePair(tree.roots, null) == null
            ? 'Posisi ini belum punya dua run AHP + TOPSIS yang sudah selesai, jadi belum ada yang dapat dibandingkan. Rekomendasi sistem dan keputusan forum tetap dapat dilihat di bagian Keputusan forum.'
            : 'Pilih dua run: lewat bilah A | B di atas, atau pada silsilah — klik kartu untuk menjadikannya B, tekan tombol A untuk menjadikannya pembanding.'}
        </EmptyState>
      );
    if (loading && !dto)
      return (
        <EmptyState>
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Membandingkan dari data tersimpan…
          </span>
        </EmptyState>
      );
    if (result && !result.ok)
      return (
        <div className="rounded-2xl border border-amber-500/50 bg-amber-500/5 p-6 text-center text-sm">
          <p className="font-semibold">Perbandingan tidak dapat dibuat</p>
          <p className="mt-1 text-muted-foreground">{result.reason}</p>
        </div>
      );
    return null;
  })();

  return (
    <div className="space-y-3">
      <SectionShellStyles />

      {/* ── Header: what this tab is, and the two doors out of it ── */}
      <div className="relative overflow-hidden rounded-2xl border border-cyan-200/70 bg-linear-to-r from-cyan-500/12 via-indigo-500/8 to-card px-4 py-3 shadow-xs dark:border-cyan-900/60 dark:from-cyan-500/15 dark:via-indigo-500/10">
        <span aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-cyan-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/25">
            <GitCompare className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-1.5 text-base font-bold tracking-tight">
              Komparasi Versi
              <InfoHint title="Komparasi Versi">
                <p>
                  Bandingkan dua versi peringkat (run) mana pun pada posisi ini: <strong>A</strong> sebagai pembanding,{' '}
                  <strong>B</strong> sebagai yang dibandingkan. Lihat siapa yang naik, turun, masuk, atau keluar dari N
                  besar, dan dari sumber mana perubahan itu datang.
                </p>
                <p>
                  Rekomendasi sistem tampil berdampingan dengan keputusan forum. Semua angka dihitung dari data yang
                  disimpan masing-masing run, dengan fungsi TOPSIS yang sama dengan layanan scoring — tanpa model bahasa.
                </p>
              </InfoHint>
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {tree ? `${tree.totalRuns} run tersimpan pada posisi ini` : 'Menyusun silsilah run…'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTreeOpen((v) => !v)}
              aria-expanded={treeOpen}
              aria-controls="komparasi-silsilah"
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all duration-200',
                treeOpen
                  ? 'border-indigo-500/50 bg-indigo-600 text-white shadow-md shadow-indigo-600/20 dark:bg-indigo-500'
                  : 'border-indigo-500/30 bg-background/70 text-indigo-800 hover:bg-indigo-500/10 dark:text-indigo-200',
              )}
            >
              <GitBranch className="h-3.5 w-3.5" aria-hidden />
              {treeOpen ? 'Tutup silsilah' : 'Pilih dari silsilah'}
            </button>
            <button
              type="button"
              onClick={() => setSection('keputusan')}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-500/20 dark:text-emerald-200"
            >
              <Gavel className="h-3.5 w-3.5" aria-hidden />
              {decisions.data ? `${nDecisions} keputusan forum` : 'Keputusan forum'}
            </button>
          </div>
        </div>
      </div>

      <PairBar
        tree={tree}
        a={a}
        b={b}
        openRunId={openRunId}
        dto={dto}
        loading={loading}
        onPick={pick}
        onSwap={() => onPairChange({ a: b, b: a })}
        onSetA={(id) => pick('a', id)}
        exporting={exporting}
        onExport={exportXlsx}
      />

      {treeOpen && (
        <div id="komparasi-silsilah" className="animate-in fade-in-0 slide-in-from-top-2 duration-300">
          <LineageNavigator tree={tree} a={a} b={b} openRunId={openRunId} onPick={pick} />
        </div>
      )}

      {/* ── Five sections: the answer first, the evidence after ── */}
      <div
        role="tablist"
        aria-label="Bagian komparasi"
        onKeyDown={onTabKey}
        className="flex flex-wrap items-center gap-1 rounded-2xl border bg-muted/40 p-1"
      >
        {SECTIONS.map((s) => {
          const on = s.key === section;
          const Icon = s.icon;
          const disabled = s.needsPair && !dto;
          return (
            <button
              key={s.key}
              ref={(el) => {
                if (el) tabRefs.current.set(s.key, el);
                else tabRefs.current.delete(s.key);
              }}
              type="button"
              role="tab"
              id={`cmp-tab-${s.key}`}
              aria-selected={on}
              aria-controls={`cmp-panel-${s.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setSection(s.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-primary',
                on ? SECTION_TONE[s.key].on : 'text-muted-foreground hover:bg-background hover:text-foreground',
                !on && disabled && 'opacity-60',
                s.key === 'keputusan' && 'sm:ml-auto',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {s.label}
              {s.count != null && s.count > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] tabular-nums',
                    on ? SECTION_TONE[s.key].badge : 'bg-foreground/10 text-foreground/70',
                  )}
                  title={s.hint ? `${s.count} ${s.hint}` : undefined}
                >
                  {s.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`cmp-panel-${section}`} aria-labelledby={`cmp-tab-${section}`} className="min-h-40">
        {section === 'keputusan' ? (
          <div className="space-y-3 animate-in fade-in-0 duration-300">
            <PanelTitle
              icon={Gavel}
              title="Rekomendasi sistem dan keputusan forum"
              tone="text-emerald-700 dark:text-emerald-300"
              info="Setiap keputusan forum dibuat DARI sebuah ranking, jadi ditampilkan di samping ranking itu: N besar rekomendasi sistem pada run yang dirujuk keputusan, siapa yang dipilih forum, peringkatnya di run yang sama, dan justifikasinya. Bila forum tidak mengambil pilihan pertama sistem, justifikasinya ditonjolkan sebagai “Alasan berbeda dari rekomendasi”."
            />
            <DecisionRecord
              data={decisions.data}
              error={decisions.error}
              programLabels={programLabels}
              a={a}
              b={b}
              onCompare={(side, id) => {
                pick(side, id);
                setSection('ringkasan');
              }}
            />
          </div>
        ) : current.needsPair && pairBody ? (
          pairBody
        ) : dto ? (
          <div className={cn('space-y-3 animate-in fade-in-0 duration-300', loading && 'opacity-60 transition-opacity')} key={section}>
            {section === 'ringkasan' && (
              <ComparisonOverview
                dto={dto}
                decisions={decisions.data}
                onOpenDecisions={() => setSection('keputusan')}
                onOpenSection={openTarget}
              />
            )}
            {section === 'peringkat' && (
              <>
                <PanelTitle
                  icon={ListOrdered}
                  title="Peringkat A → B"
                  tone="text-indigo-700 dark:text-indigo-300"
                  info="Setiap kandidat dari gabungan pool A dan B: keanggotaan, peringkat A → B dengan selisihnya, kecocokan A → B dalam poin persen, status finalis, readiness, dan keputusan forum di kedua sisi. Diurutkan menurut peringkat B. Klik nama untuk membuka rincian perhitungannya."
                />
                <ComparisonRankingTable
                  dto={dto}
                  onSelectCandidate={(id) => {
                    setCandidateId(id);
                    setAnalysisLens('rincian');
                    setSection('analisis');
                  }}
                />
              </>
            )}
            {section === 'analisis' && (
              <>
                <LensBar
                  label="Lensa analisis"
                  value={analysisLens}
                  onChange={setAnalysisLens}
                  options={[
                    { key: 'kriteria', label: 'Per kriteria', icon: BarChart3 },
                    { key: 'rincian', label: 'Per kandidat', icon: Microscope },
                    { key: 'atribusi', label: 'Atribusi bertahap', icon: GitBranch },
                  ]}
                  tone="violet"
                />
                {analysisLens === 'kriteria' && <CriteriaTable dto={dto} />}
                {analysisLens === 'rincian' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={candidateId} onValueChange={setCandidateId}>
                        <SelectTrigger className="h-9 w-full max-w-sm text-xs" aria-label="Pilih kandidat">
                          <SelectValue placeholder="Pilih kandidat" />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                          {dto.ranking.map((r) => (
                            <SelectItem key={r.candidateId} value={r.candidateId} className="text-xs">
                              A {r.rankA ?? '—'} → B {r.rankB ?? '—'} · {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <InfoHint title="Rincian kandidat">
                        Cara kecocokan satu kandidat terbentuk di A dan di B, kriteria demi kriteria: nilai aspek,
                        nilai ternormalisasi, nilai terbobot, dan sumbangannya pada jarak D⁺ dan D⁻ — lalu selisih B − A
                        per kriteria.
                      </InfoHint>
                    </div>
                    {dto.explanations.perCandidate[candidateId]?.length ? (
                      <ul className="space-y-1.5 rounded-xl border border-violet-200/60 bg-violet-500/5 p-3 dark:border-violet-900/50">
                        {dto.explanations.perCandidate[candidateId].map((e, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                            <span className="mt-px shrink-0 rounded bg-violet-500/15 px-1 font-mono text-[9px] text-violet-800 dark:text-violet-200">
                              {e.id}
                            </span>
                            {e.text}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {breakdown ? (
                      <CandidateBreakdownCompare breakdown={breakdown} />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Rincian perhitungan memerlukan kedua run dapat dihitung ulang dari data tersimpan.
                      </p>
                    )}
                  </div>
                )}
                {analysisLens === 'atribusi' && <AttributionTable dto={dto} />}
              </>
            )}
            {section === 'konfigurasi' && (
              <>
                <LensBar
                  label="Konfigurasi atau pool"
                  value={setupLens}
                  onChange={setSetupLens}
                  options={[
                    { key: 'config', label: 'Konfigurasi', icon: Settings2, count: configDiffers, hint: 'butir yang berbeda' },
                    { key: 'pool', label: 'Pool', icon: ListOrdered, count: poolOnly, hint: 'kandidat yang hanya ada di satu run' },
                  ]}
                  tone="amber"
                />
                {setupLens === 'config' ? <ConfigCompare dto={dto} /> : <PoolTable dto={dto} />}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">{children}</div>
  );
}

/** A panel heading with its explanation behind a "?". */
function PanelTitle({ icon: Icon, title, info, tone }: { icon: LucideIcon; title: string; info: ReactNode; tone: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      <Icon className={cn('h-4 w-4', tone)} aria-hidden />
      {title}
      <InfoHint title={title}>{info}</InfoHint>
    </h3>
  );
}

const LENS_TONE = {
  violet: 'bg-violet-600 text-white shadow-sm dark:bg-violet-500 dark:text-violet-950',
  amber: 'bg-amber-500 text-white shadow-sm dark:bg-amber-400 dark:text-amber-950',
} as const;

/** The second-level choice inside a section — smaller than the section tabs, on purpose. */
function LensBar<K extends string>({
  label,
  value,
  onChange,
  options,
  tone,
}: {
  label: string;
  value: K;
  onChange: (k: K) => void;
  options: { key: K; label: string; icon: LucideIcon; count?: number | null; hint?: string }[];
  tone: keyof typeof LENS_TONE;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap items-center gap-1 rounded-full border bg-background p-0.5">
      {options.map((o) => {
        const on = o.key === value;
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all duration-200',
              on ? LENS_TONE[tone] : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-3 w-3" aria-hidden />
            {o.label}
            {o.count != null && o.count > 0 && (
              <span
                className={cn('rounded-full px-1.5 text-[10px] tabular-nums', on ? 'bg-white/25' : 'bg-foreground/10')}
                title={o.hint ? `${o.count} ${o.hint}` : undefined}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
