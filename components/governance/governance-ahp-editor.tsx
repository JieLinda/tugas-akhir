'use client';

// Weight editor for the program's AHP matrix — the only weighting surface in
// this product (drizzle/0074).
//
// ONE canonical matrix, FOUR projections of it (docs/ahp-input-sync.md):
//   • Urutan      — drag the criteria; the existing weight values are permuted
//     onto the new order and all 15 judgments rewritten as snap(wᵢ/wⱼ).
//   • Slider      — one weight slider (2–65 %) per criterion; releasing it
//     rewrites only that criterion's 5 judgments, snapped to the Saaty scale.
//   • Berpasangan — the 15 judgments themselves, as a list ("Daftar") or the
//     matrix ("Matriks").
//
// `value.pairwise` is the only data. Every write goes through lib/ahp-input.ts
// and leaves all 30 off-diagonal cells on the Saaty scale; every read — slider
// positions, the order, the pairwise views, the CR badge — is derived from the
// matrix on each render, so a change in one mode IS the change in the other
// three. Switching modes never writes and therefore never rounds. What a cell
// shows is exactly what is stored and validated: an older off-scale value is
// shown as itself ("1,25"), never rounded into a judgment it is not.

import { useMemo, useState, useTransition, type DragEvent as ReactDragEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import {
  ArrowLeftRight,
  GripHorizontal,
  GripVertical,
  Loader2,
  Save,
  SlidersHorizontal,
  X,
  List,
  LayoutGrid,
  TriangleAlert,
} from 'lucide-react';
import {
  describeAhpValidation,
  isSaatyValue,
  offScaleUpperCells,
  saatyLabel,
  snapToSaaty,
  validateAhpPairwise,
} from '@/lib/ahp';
import {
  AHP_SHORT_LABELS,
  SLIDER_MAX_PCT,
  SLIDER_MIN_PCT,
  activationMatrix,
  applyOrder,
  applySlider,
  canonicalize,
  describeWrite,
  isCanonical,
  rankGroups,
  setJudgment,
  sliderPositions,
  type WriteResult,
} from '@/lib/ahp-input';
import { saveAhpConfigAction } from '@/lib/program-actions';
import type { AhpConfig } from './governance-types';

// Must match AHP_CRITERIA_ORDER in lib/db/schema.ts
const CRITERIA = [
  { key: 'technical', label: 'Technical Competency' },
  { key: 'career', label: 'Career Relevance' },
  { key: 'behavior', label: 'Behavior Competency' },
  { key: 'performance', label: 'Performance Appraisal' },
  { key: 'hav', label: 'HAV Mapping' },
  { key: 'education', label: 'Education' },
] as const;

const N = CRITERIA.length;

type Mode = 'order' | 'simple' | 'advanced';

const MODE_LABELS: Record<Mode, string> = {
  order: 'Urutan',
  simple: 'Slider',
  advanced: 'Berpasangan',
};

const WEIGHT_COLORS = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
];

/** Criteria indices ordered by weight, heaviest first (display order of the pairwise mode). */
function weightOrder(matrix: number[][] | null): number[] {
  if (!matrix) return Array.from({ length: N }, (_, i) => i);
  return rankGroups(matrix).map((g) => g.criterion);
}

const pct1 = (v: number) => `${v.toFixed(1)}%`;
const pctId = (v: number) => `${v.toFixed(1).replace('.', ',')} %`;

/**
 * One Saaty 1-9 cell.
 *
 * It holds its own draft and commits on BLUR or ENTER — always, even when the
 * digit typed equals the one shown. It never commits from onChange: a
 * controlled input whose value does not change fires no onChange in React, so
 * "retype the 1 you see" used to store nothing, and an off-scale 1.25 sitting
 * behind a displayed "1" could not be overwritten with 1. Keystrokes are read
 * from onKeyDown for the same reason (a typed digit equal to the shown text is
 * no change to the DOM value). Escape reverts; a non-digit reverts.
 */
function PairwiseValueInput({
  display,
  onCommit,
  className,
  title,
  offScale,
}: {
  display: string;
  onCommit: (digit: number) => void;
  className?: string;
  title?: string;
  offScale?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const digit = draft.replace(/[^1-9]/g, '').slice(-1);
    setDraft(null);
    if (digit) onCommit(Number(digit));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      setDraft(e.key);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(null);
      e.currentTarget.blur();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      setDraft('');
    }
  };
  return (
    <Input
      type="text"
      inputMode="numeric"
      value={draft ?? display}
      title={title}
      aria-invalid={offScale || undefined}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={onKeyDown}
      // Paste / IME / mobile keyboards still arrive here; they only move the draft.
      onChange={(e) => setDraft(e.target.value.replace(/[^1-9]/g, '').slice(-1))}
      onBlur={commit}
      className={cn(className, offScale && 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300')}
    />
  );
}

export function AhpMatrixEditor({
  value,
  onChange,
  templateId,
}: {
  value: AhpConfig | null;
  onChange: (next: AhpConfig | null) => void;
  templateId: string;
}) {
  const [saving, startSave] = useTransition();
  const matrix = value?.pairwise ?? null;

  const validation = useMemo(() => (matrix ? validateAhpPairwise(matrix) : null), [matrix]);
  const weights = validation?.result?.weights ?? [];
  const cr = validation?.result?.cr ?? 0;
  const canonical = useMemo(() => isCanonical(matrix), [matrix]);
  const legacy = useMemo(() => {
    if (!matrix || canonical) return null;
    const snapped = canonicalize(matrix);
    return {
      cells: validation ? offScaleUpperCells(validation) : [],
      changes: snapped.changes,
      crBefore: validation?.result?.cr ?? null,
      after: validateAhpPairwise(snapped.matrix),
    };
  }, [matrix, canonical, validation]);

  const [mode, setMode] = useState<Mode>(() => (matrix ? 'advanced' : 'simple'));
  const [viewMode, setViewMode] = useState<'list' | 'matrix'>('list');
  // Display-only arrangement of the pairwise questions; never touches weights.
  const [pairOrder, setPairOrder] = useState<number[]>(() => weightOrder(matrix));
  // The last dragged Urutan order, used only to order criteria INSIDE a tie.
  const [tieOrder, setTieOrder] = useState<number[] | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  // The draft remembers the matrix it was taken from and is ignored once the
  // matrix moves on. Radix fires onValueChange AFTER onValueCommit on a key
  // press, so a draft cleared on commit came straight back and pinned the
  // slider at the requested 34.5 % instead of the snapped-back weight.
  const [rawSliderDraft, setSliderDraft] = useState<{ i: number; pct: number; base: number[][] | null } | null>(null);
  const sliderDraft = rawSliderDraft && rawSliderDraft.base === matrix ? rawSliderDraft : null;
  const [notice, setNotice] = useState<string | null>(null);

  const positions = useMemo(() => (matrix ? sliderPositions(matrix) : []), [matrix]);
  const groups = useMemo(() => (matrix ? rankGroups(matrix, tieOrder ?? undefined) : []), [matrix, tieOrder]);
  const preview = useMemo(
    () => (sliderDraft && matrix ? applySlider(matrix, sliderDraft.i, sliderDraft.pct) : null),
    [sliderDraft, matrix],
  );

  function write(r: WriteResult, extra?: string) {
    onChange({ pairwise: r.matrix });
    setNotice(describeWrite(r, extra));
  }

  // ── writers ──

  function commitPair(hi: number, lo: number, v: number) {
    write(setJudgment(matrix, hi, lo, v));
  }

  function commitOrder(next: number[]) {
    setTieOrder(next);
    write(applyOrder(matrix, next), 'Urutan menulis ulang ke-15 penilaian berpasangan dari bobot.');
  }

  function commitSlider(i: number, pct: number) {
    setSliderDraft(null);
    const r = applySlider(matrix, i, pct);
    const label = CRITERIA[i]!.label;
    let extra = `${label} ${pctId(r.requestedPct)} → ${pctId(r.resultPct)} setelah dibulatkan ke skala Saaty.`;
    if (r.advanced) extra += ` Posisi itu tidak mengubah penilaian apa pun, jadi slider maju ke ${pctId(r.appliedPct)}, titik terdekat yang mengubah penilaian.`;
    if (r.changes.length === 0) extra += ' Tidak ada penilaian yang berubah (ujung rentang skala Saaty).';
    write(r, extra);
  }

  function activate() {
    const m = activationMatrix();
    onChange({ pairwise: m });
    setMode('simple');
    setPairOrder(weightOrder(m));
    setTieOrder(null);
    setNotice(
      'Bobot bawaan sistem (35/25/20/10/5/5) dibulatkan ke skala Saaty; bobot efektifnya tampil di bawah.',
    );
  }

  function roundLegacy() {
    const { matrix: m, changes } = canonicalize(matrix);
    write({ matrix: m, canonicalized: changes, changes: [] });
  }

  function switchMode(next: Mode) {
    setPairOrder(weightOrder(matrix));
    setMode(next);
  }

  function handleSaveAhp() {
    startSave(async () => {
      try {
        await saveAhpConfigAction(templateId, value);
        toast.success('Bobot AHP berhasil disimpan.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal menyimpan bobot AHP.');
      }
    });
  }

  // ── DnD handlers (shared; `commit` decides what a drop means) ──

  function handleDragStart(e: ReactDragEvent, idx: number) {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }

  function handleDragOver(e: ReactDragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  }

  function handleDragLeave() {
    setDragOverIdx(null);
  }

  function makeDrop(current: number[], commit: (next: number[]) => void) {
    return (e: ReactDragEvent, dropIdx: number) => {
      e.preventDefault();
      if (dragIdx === null || dragIdx === dropIdx) {
        setDragIdx(null);
        setDragOverIdx(null);
        return;
      }
      const next = [...current];
      const [removed] = next.splice(dragIdx, 1);
      next.splice(dropIdx, 0, removed!);
      commit(next);
      setDragIdx(null);
      setDragOverIdx(null);
    };
  }

  function handleDragEnd() {
    setDragIdx(null);
    setDragOverIdx(null);
  }

  const rankOrder = groups.map((g) => g.criterion);
  const dropOnRank = makeDrop(rankOrder, commitOrder);
  const dropOnPair = makeDrop(pairOrder, setPairOrder);

  // ── Render ──

  if (!matrix) {
    return (
      <div className="rounded-lg border border-dashed p-4 space-y-2">
        <p className="text-xs text-muted-foreground leading-normal">
          Belum ada bobot khusus — setiap run program ini memakai{' '}
          <strong>bobot built-in sistem</strong>: Behavior 35%, Technical 25%,
          HAV 20%, PA 10%, Career 5%, Pendidikan 5%. Karena sebagian besar program memakai bobot
          yang sama, hasil antar-program tetap sebanding. Aktifkan hanya bila program ini memang
          perlu bobot yang berbeda.
        </p>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={activate}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Atur Bobot AHP
        </Button>
      </div>
    );
  }

  const ok = validation?.ok ?? false;
  const crOk = cr <= 0.1;
  const offScaleCount = validation ? offScaleUpperCells(validation).length : 0;
  const structuralIssue = validation?.issues.some((i) => i.code === 'not_reciprocal' || i.code === 'diagonal') ?? false;

  // Group pairs by position in pairOrder so the leftmore criterion always sits
  // above the ones it is compared against.
  const groupedPairs = pairOrder
    .map((left, pos) => ({ left, rights: pairOrder.slice(pos + 1) }))
    .filter((g) => g.rights.length > 0);

  /** The weight read-out every mode shows, so all four agree on screen. */
  const weightRow = (canonIdx: number) => {
    const w = weights[canonIdx] ?? 0;
    return (
      <>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all', WEIGHT_COLORS[canonIdx])}
            style={{ width: `${Math.round(w * 100)}%` }}
          />
        </div>
        <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums" data-weight={CRITERIA[canonIdx]!.key}>
          {pct1(w * 100)}
        </span>
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* Mode switch — ordered simplest to most exact, and numbered, because
          the three are alternatives for one job rather than separate settings. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded-md border text-xs">
          {(['order', 'simple', 'advanced'] as const).map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={cn(
                'px-3 py-1.5 font-medium transition-colors',
                mode === m ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/60',
              )}
            >
              <span className="mr-1 text-[10px] opacity-60">{i + 1}</span>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {/* One badge for every mode, from the same validateAhpPairwise the save
            actions reject with — the CR shown IS the CR validated. */}
        <Badge
          variant="outline"
          data-testid="ahp-cr-badge"
          className={cn(
            'text-[10px] font-semibold',
            ok
              ? 'border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-300/70 bg-rose-500/10 text-rose-700 dark:text-rose-300',
          )}
        >
          CR = {cr.toFixed(3)} {crOk ? '· konsisten' : '· TIDAK konsisten'}
          {offScaleCount > 0 && ` · ${offScaleCount} nilai di luar skala Saaty`}
          {structuralIssue && ' · tidak resiprokal'}
        </Badge>
      </div>

      {legacy && (
        <div className="space-y-2 rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/20" data-testid="ahp-legacy-banner">
          <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Matriks tersimpan berisi {legacy.changes.length} nilai di luar skala Saaty
            {structuralIssue ? ' atau tidak resiprokal' : ''}. Nilainya ditampilkan apa adanya.
          </p>
          <ul className="ml-5 list-disc text-[11px] text-amber-900 dark:text-amber-200">
            {legacy.changes.map((c) => (
              <li key={`${c.row}-${c.col}`}>
                {AHP_SHORT_LABELS[c.row]} vs {AHP_SHORT_LABELS[c.col]}: {saatyLabel(c.before)} → {saatyLabel(c.after)}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-amber-900 dark:text-amber-200">
            CR tersimpan {legacy.crBefore != null ? legacy.crBefore.toFixed(4) : '—'} → setelah dibulatkan{' '}
            {legacy.after.result ? legacy.after.result.cr.toFixed(4) : '—'}
            {legacy.after.ok ? ' (lolos)' : ' (akan DITOLAK — perbaiki penilaiannya setelah dibulatkan)'}.
            Menyunting sel apa pun juga membulatkan seluruh matriks lebih dulu.
          </p>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={roundLegacy}>
            Bulatkan ke skala Saaty
          </Button>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground" data-testid="ahp-notice">
          <span className="flex-1 leading-normal">{notice}</span>
          <button type="button" className="shrink-0 hover:text-foreground" onClick={() => setNotice(null)} aria-label="Tutup pemberitahuan">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {mode === 'order' ? (
        /* ── 1. Urutan: drag to rank; existing weights permuted onto the order ── */
        <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <p className="text-[11px] text-muted-foreground leading-normal">
            Seret kriteria dari <strong>paling penting</strong> (atas) ke{' '}
            <strong>paling tidak penting</strong> (bawah). Nilai bobot yang ada dipindahkan mengikuti
            urutan baru, lalu ke-15 perbandingan berpasangan <strong>ditulis ulang</strong> pada skala
            Saaty dan bobotnya dihitung ulang — penilaian berpasangan sebelumnya diganti. Pembulatan ke
            skala Saaty dapat membuat dua kriteria <strong>seri</strong>, tetapi tidak pernah membalik
            urutan yang Anda seret.
          </p>
          <div className="space-y-1.5" data-testid="ahp-order-list">
            {groups.map(({ criterion: canonIdx, rank, tied }, pos) => (
              <div
                key={CRITERIA[canonIdx]!.key}
                draggable
                data-criterion={CRITERIA[canonIdx]!.key}
                onDragStart={(e) => handleDragStart(e, pos)}
                onDragOver={(e) => handleDragOver(e, pos)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => dropOnRank(e, pos)}
                onDragEnd={handleDragEnd}
                className={cn(
                  'flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 cursor-grab active:cursor-grabbing transition-all select-none',
                  dragOverIdx === pos && 'border-primary/50 bg-primary/5 shadow-sm',
                  dragIdx === pos && 'opacity-40',
                )}
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="w-6 shrink-0 text-center text-[10px] font-bold tabular-nums text-muted-foreground" data-rank>
                  {tied ? `${rank} =` : rank}
                </span>
                <span className="w-40 shrink-0 truncate text-xs font-medium">
                  {CRITERIA[canonIdx]!.label}
                </span>
                {tied && (
                  <Badge variant="outline" className="h-4 px-1 text-[9px]">
                    seri
                  </Badge>
                )}
                {weightRow(canonIdx)}
              </div>
            ))}
          </div>
        </div>
      ) : mode === 'simple' ? (
        /* ── 2. Slider: one weight slider per criterion, snap-back on release ── */
        <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <p className="text-[11px] text-muted-foreground leading-normal">
            Geser bobot satu aspek ({SLIDER_MIN_PCT}–{SLIDER_MAX_PCT} %, batas yang dapat dicapai skala
            Saaty). Saat dilepas, kelima perbandingan aspek itu dibulatkan ke skala Saaty dan slider
            <strong> melompat ke bobot hasil hitung ulang</strong> — yang tampil adalah yang dipakai.
            Perbandingan antar-aspek lain tidak berubah. Bila posisi yang dipilih tidak mengubah satu
            pun perbandingan, slider maju ke titik terdekat yang mengubahnya.
          </p>
          {CRITERIA.map((c, idx) => {
            const dragging = sliderDraft?.i === idx;
            const pos = dragging ? sliderDraft!.pct : positions[idx] ?? SLIDER_MIN_PCT;
            return (
              <div key={c.key} className="flex items-center gap-3" data-slider={c.key}>
                <span className="w-40 shrink-0 truncate text-xs font-medium">{c.label}</span>
                <Slider
                  className="flex-1"
                  min={SLIDER_MIN_PCT}
                  max={SLIDER_MAX_PCT}
                  step={0.1}
                  value={[pos]}
                  onValueChange={(v) => setSliderDraft({ i: idx, pct: v[0] ?? pos, base: matrix })}
                  onValueCommit={(v) => commitSlider(idx, v[0] ?? pos)}
                />
                <span className="w-24 shrink-0 text-right text-[11px] font-semibold tabular-nums" data-weight={c.key}>
                  {pct1((weights[idx] ?? 0) * 100)}
                  {dragging && preview && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      → {pct1(preview.resultPct)}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── 3. Berpasangan: the 15 judgments themselves ── */
        <div className="space-y-4">
          {/* Weight Preview */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bobot Prioritas (AHP)</p>
            <div className="space-y-1.5">
              {CRITERIA.map((c, idx) => (
                <div key={c.key} className="flex items-center gap-2">
                  <span className="w-44 shrink-0 truncate text-xs">{c.label}</span>
                  {weightRow(idx)}
                </div>
              ))}
            </div>
            {!crOk && (
              <p className="text-[11px] text-rose-600 dark:text-rose-400 leading-normal">
                Penilaian berpasangan saling bertentangan (CR &gt; 0.1). Perbaiki perbandingan yang paling
                bertentangan sebelum menyimpan.
              </p>
            )}
          </div>

          {/* DnD question order — display only, unlike the Urutan mode */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Pengelompokan Pertanyaan
            </p>
            <p className="text-[11px] text-muted-foreground leading-normal">
              Seret untuk menyusun <strong>urutan tampil</strong> pasangan pertanyaan di bawah.
              Ini murni pengelompokan: <strong>tidak mengubah bobot</strong>, dan tidak menentukan
              kriteria mana yang lebih penting — arah setiap baris selalu mengikuti nilai yang
              tersimpan. Untuk membalik satu penilaian, pakai tombol{' '}
              <ArrowLeftRight className="inline h-3 w-3 align-text-bottom" /> di baris itu. Untuk
              menetapkan bobot lewat urutan, pakai mode <strong>Urutan</strong>.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {pairOrder.map((canonIdx, pos) => (
                <div
                  key={CRITERIA[canonIdx]!.key}
                  draggable
                  onDragStart={(e) => handleDragStart(e, pos)}
                  onDragOver={(e) => handleDragOver(e, pos)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => dropOnPair(e, pos)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    'flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium cursor-grab active:cursor-grabbing transition-all select-none',
                    dragOverIdx === pos && 'border-primary/50 bg-primary/5 shadow-sm',
                    dragIdx === pos && 'opacity-40',
                  )}
                >
                  <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {CRITERIA[canonIdx]!.label}
                </div>
              ))}
            </div>
          </div>

          {/* View mode toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tampilan</span>
            <div className="inline-flex overflow-hidden rounded-md border text-xs">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 font-medium transition-colors',
                  viewMode === 'list' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                <List className="h-3 w-3" />
                Daftar
              </button>
              <button
                type="button"
                onClick={() => setViewMode('matrix')}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 font-medium transition-colors',
                  viewMode === 'matrix' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                <LayoutGrid className="h-3 w-3" />
                Matriks
              </button>
            </div>
          </div>

          {viewMode === 'list' ? (
            /* ── List view: paired rows grouped by most-important criterion ── */
            <div className="space-y-4">
              <p className="text-[11px] text-muted-foreground leading-normal">
                Isi berapa kali kriteria kiri <strong>lebih penting</strong> dari kriteria kanan (1–9;
                1 = sama penting); klik kolom angkanya, ketik, lalu tekan Enter atau pindah sel. Sisi
                kiri selalu yang lebih penting menurut nilai tersimpan — tekan{' '}
                <ArrowLeftRight className="inline h-3 w-3 align-text-bottom" /> untuk membalik
                penilaian itu.
              </p>
              {groupedPairs.map(({ left, rights }) => {
                const leftLabel = CRITERIA[left]!.label;
                return (
                  <div key={CRITERIA[left]!.key} className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground border-b pb-1">
                      Pasangan dengan {leftLabel}
                    </p>
                    {rights.map((right) => {
                      // Which side is heavier is the MATRIX's answer, not the
                      // drag's. The intensity shown is the stored value itself
                      // (exact for a canonical matrix); an off-scale stored
                      // value is shown as itself, never rounded into a judgment.
                      const storedRatio = matrix[left]![right]!;
                      const leftIsHeavier = storedRatio >= 1;
                      const hi = leftIsHeavier ? left : right;
                      const lo = leftIsHeavier ? right : left;
                      const intensity = leftIsHeavier ? storedRatio : matrix[right]![left]!;
                      const onScale = isSaatyValue(intensity);
                      const snapped = snapToSaaty(intensity); // ≥ 1, an integer 1–9
                      const hiLabel = CRITERIA[hi]!.label;
                      const loLabel = CRITERIA[lo]!.label;
                      return (
                        <div
                          key={`${left}-${right}`}
                          className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 flex-wrap"
                        >
                          <span className="text-xs font-medium min-w-0">{hiLabel}</span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            lebih penting
                          </span>
                          <PairwiseValueInput
                            display={saatyLabel(intensity)}
                            offScale={!onScale}
                            onCommit={(digit) => commitPair(hi, lo, digit)}
                            title={`Seberapa kali ${hiLabel} lebih penting dari ${loLabel} (1-9)`}
                            className="h-7 w-12 shrink-0 text-xs text-center tabular-nums"
                          />
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            × dibanding
                          </span>
                          <span className="text-xs min-w-0">{loLabel}</span>
                          {onScale && intensity === 1 && (
                            <span className="text-[10px] italic text-muted-foreground">(sama penting)</span>
                          )}
                          {!onScale && (
                            <span className="text-[10px] text-amber-700 dark:text-amber-300">
                              di luar skala Saaty (terdekat {saatyLabel(snapped)})
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => commitPair(lo, hi, Math.round(snapped))}
                            title={`Balik: jadikan ${loLabel} yang lebih penting`}
                            className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <ArrowLeftRight className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Matrix view: upper-right triangle editable ── */
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground leading-normal">
                Isi hanya bagian <strong>kanan-atas</strong> diagonal; klik selnya, ketik angka 1–9, lalu
                tekan Enter atau pindah sel. Sel bertanda <code className="text-[10px]">1/</code> berarti
                kriteria barisnya justru <em>kurang</em> penting sebanyak itu. Bagian kiri-bawah adalah
                kebalikannya dan ikut otomatis. Seret header kolom untuk menyusun tampilan saja (tidak
                mengubah bobot).
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="w-36 p-0" />
                      {pairOrder.map((canonIdx, pos) => (
                        <th key={CRITERIA[canonIdx]!.key} className="p-1 align-top">
                          <div
                            draggable
                            onDragStart={(e) => handleDragStart(e, pos)}
                            onDragOver={(e) => handleDragOver(e, pos)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => dropOnPair(e, pos)}
                            onDragEnd={handleDragEnd}
                            className={cn(
                              'flex items-center justify-center gap-1 rounded px-2 py-1.5 font-medium cursor-grab active:cursor-grabbing select-none bg-muted/30',
                              dragOverIdx === pos && 'bg-primary/10',
                              dragIdx === pos && 'opacity-40',
                            )}
                          >
                            <GripHorizontal className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[80px]">{CRITERIA[canonIdx]!.label}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pairOrder.map((rowCanonIdx, rowPos) => (
                      <tr key={CRITERIA[rowCanonIdx]!.key}>
                        <td className="px-2 py-1 font-medium text-right bg-muted/30 border-r">
                          <span className="truncate max-w-[120px] inline-block">
                            {CRITERIA[rowCanonIdx]!.label}
                          </span>
                        </td>
                        {pairOrder.map((colCanonIdx, colPos) => {
                          if (rowPos === colPos) {
                            return (
                              <td
                                key={colCanonIdx}
                                className="px-2 py-1 text-center bg-muted/10 text-muted-foreground border"
                              >
                                1
                              </td>
                            );
                          }
                          const ratio = matrix[rowCanonIdx]![colCanonIdx]!;
                          const onScale = isSaatyValue(ratio);
                          if (rowPos < colPos) {
                            // "row is a × col". On the scale and below 1, the
                            // cell reads "1/" + n and a typed digit means the
                            // COLUMN is that many times more important.
                            const inverted = onScale && ratio < 1;
                            const display = inverted ? saatyLabel(1 / ratio) : saatyLabel(ratio);
                            const rowLabel = CRITERIA[rowCanonIdx]!.label;
                            const colLabel = CRITERIA[colCanonIdx]!.label;
                            return (
                              <td key={colCanonIdx} className="px-1 py-1 text-center border">
                                <div className="flex items-center justify-center gap-0.5">
                                  {inverted && (
                                    <span className="text-[10px] text-muted-foreground">1/</span>
                                  )}
                                  <PairwiseValueInput
                                    display={display}
                                    offScale={!onScale}
                                    onCommit={(digit) =>
                                      ratio < 1
                                        ? commitPair(colCanonIdx, rowCanonIdx, digit)
                                        : commitPair(rowCanonIdx, colCanonIdx, digit)
                                    }
                                    title={
                                      ratio < 1
                                        ? `${colLabel} lebih penting ${display}× dibanding ${rowLabel}`
                                        : `${rowLabel} lebih penting ${display}× dibanding ${colLabel}`
                                    }
                                    className={cn(
                                      'h-7 text-xs text-center tabular-nums',
                                      inverted ? 'w-11' : 'w-14 mx-auto',
                                    )}
                                  />
                                </div>
                              </td>
                            );
                          }
                          // Lower triangle: the value STORED in this cell (the
                          // exact reciprocal of the one above it), formatted as
                          // a judgment — 2 reads "2", 1/2 reads "1/2". It used
                          // to be "1/" + round(upper) regardless of direction,
                          // so a 2 here read "1/2".
                          return (
                            <td
                              key={colCanonIdx}
                              className={cn(
                                'px-2 py-1 text-center bg-muted/5 text-[10px] text-muted-foreground border',
                                !onScale && 'text-amber-700 dark:text-amber-300',
                              )}
                            >
                              {saatyLabel(ratio)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!ok && validation && (
        <p className="text-[11px] leading-normal text-rose-600 dark:text-rose-400" data-testid="ahp-validation">
          Belum dapat disimpan: {describeAhpValidation(validation, AHP_SHORT_LABELS)}
        </p>
      )}

      <Button
        type="button"
        size="sm"
        variant="default"
        className="gap-1.5 text-xs"
        disabled={saving || !ok}
        onClick={handleSaveAhp}
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        {saving ? 'Menyimpan…' : 'Simpan Bobot AHP'}
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1.5 text-xs text-muted-foreground"
        onClick={() => onChange(null)}
      >
        <X className="h-3.5 w-3.5" />
        Nonaktifkan bobot khusus (kembali ke bobot built-in sistem)
      </Button>
    </div>
  );
}
