'use client';

// "Ringkasan" — the first thing the comparison shows, ordered by the questions
// a forum asks and weighted the same way:
//
//   1. the verdict — who is first in A and in B, set large, with the four
//      facts that qualify it (moved, in/out of N, the comparison candidates,
//      sources that differ) beside it; a freeze violation outranks all of it;
//   2. why — the template sentences (T-01…T-11), right under the verdict
//      because a number without its reason is the thing people misquote;
//   3. the forum's own choices, seen in A and in B;
//   4. the picture of the movement;
//   5. the five sources a rank can move for, with the provenance caveats.
//
// Every number here is read off the same ComparisonDto the detail sections use
// (FR-CMP); nothing is recomputed, and no sentence is composed outside the
// template catalogue (docs/rerun-explanation-templates.md).

import type { ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  CheckCircle2,
  Crown,
  Layers,
  MessageSquareText,
  Shuffle,
  ShieldAlert,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComparisonDto } from '@/lib/run-compare-dto';
import type { DecisionSummary } from '@/lib/run-history-actions';
import { InfoHint } from '@/components/ui/info-hint';
import { ExplanationList, LiveValuesNotice, ReproducibilityLine, SourceSummary } from './parts';
import { RankSlopeChart } from './rank-slope-chart';
import { SideBadge } from './lineage-navigator';
import { PairDecisions } from '../decision-summary';
import { overviewFacts } from '@/lib/run-compare-overview';
import type { CompareTarget } from './run-compare-workspace';

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

function Card({
  icon: Icon,
  title,
  info,
  aside,
  tone,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  info?: ReactNode;
  aside?: ReactNode;
  tone: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border bg-card p-4 shadow-xs transition-shadow duration-300 hover:shadow-md', className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', tone)}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          {title}
          {info ? <InfoHint title={title}>{info}</InfoHint> : null}
        </h4>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function ComparisonOverview({
  dto,
  decisions,
  onOpenDecisions,
  onOpenSection,
}: {
  dto: ComparisonDto;
  decisions: DecisionSummary | null;
  onOpenDecisions: () => void;
  onOpenSection: (target: CompareTarget) => void;
}) {
  const f = overviewFacts(dto);
  const sameTop = f.topA != null && f.topA === f.topB;
  const violated = dto.freezeViolations.length > 0;

  return (
    <div className="space-y-3">
      {violated && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-rose-500/60 bg-rose-500/10 p-3.5 text-xs text-rose-900 shadow-sm dark:text-rose-100"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 animate-pulse" aria-hidden />
          <span>
            <strong>Pelanggaran pembekuan.</strong> Run B adalah turunan Tambah Kandidat Pembanding dari A, tetapi selain
            komposisi pool ada sumber lain yang berbeda. Rinciannya di bagian Sumber perubahan di bawah; laporkan kedua nomor
            run ke tim aplikasi sebelum hasilnya dipakai.
          </span>
        </div>
      )}

      {/* ── 1. The verdict ── */}
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border p-4 shadow-sm',
          sameTop
            ? 'border-emerald-300/70 bg-linear-to-br from-emerald-500/15 via-teal-500/6 to-card dark:border-emerald-900/60'
            : 'border-indigo-300/70 bg-linear-to-br from-indigo-500/15 via-fuchsia-500/6 to-card dark:border-indigo-900/60',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full blur-3xl',
            sameTop ? 'bg-emerald-400/25' : 'bg-indigo-400/25',
          )}
        />
        <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <Crown className={cn('h-3.5 w-3.5', sameTop ? 'text-emerald-600' : 'text-indigo-600 dark:text-indigo-300')} aria-hidden />
              Peringkat teratas
            </p>
            {sameTop ? (
              <div className="mt-2">
                <p className="flex min-w-0 items-center gap-2 text-2xl font-bold tracking-tight">
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
                  <span className="truncate">{f.topB}</span>
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-800 dark:text-emerald-200">Sama di A dan B.</p>
              </div>
            ) : (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-xl border bg-background/70 px-2.5 py-1.5">
                  <SideBadge side="a" />
                  <span className="truncate text-sm font-semibold">{f.topA ?? '—'}</span>
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden />
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-xl border-2 border-indigo-500/50 bg-background/80 px-2.5 py-1.5 shadow-sm">
                  <SideBadge side="b" />
                  <span className="truncate text-lg font-bold">{f.topB ?? '—'}</span>
                </span>
                <p className="w-full text-xs font-medium text-indigo-800 dark:text-indigo-200">Peringkat 1 berganti dari A ke B.</p>
              </div>
            )}
            {/* The size of the two pools — the denominator every count beside
                it is read against. */}
            <button
              type="button"
              onClick={() => onOpenSection('pool')}
              title="Seluruh pool yang diperingkat di A lalu di B."
              className="mt-3 inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
            >
              <Users className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" aria-hidden />
              <span className="font-semibold text-muted-foreground">Kandidat dinilai</span>
              <span className="font-bold tabular-nums">
                {f.poolA} <span className="text-muted-foreground">→</span> {f.poolB}
              </span>
              <span className="tabular-nums text-muted-foreground">({signed(f.poolB - f.poolA)})</span>
            </button>
          </div>

          {/* The four facts that qualify the verdict, each a door to its detail. */}
          <div className="grid grid-cols-2 gap-2">
            <VerdictFact
              icon={ArrowUpDown}
              label="Peringkat bergeser"
              value={`${f.moved} kandidat`}
              sub={`${f.movedFinalists} di antaranya finalis A atau B. Kandidat yang hanya ada di satu run tidak dihitung.`}
              onClick={() => onOpenSection('peringkat')}
            />
            <VerdictFact
              icon={Shuffle}
              label="N besar"
              value={`${f.entered} masuk · ${f.left} keluar`}
              sub={`N di A = ${f.nA}, N di B = ${f.nB}.${
                f.enteredComparison > 0 ? ` Yang masuk termasuk ${f.enteredComparison} kandidat pembanding.` : ''
              }`}
              onClick={() => onOpenSection('peringkat')}
            />
            <VerdictFact
              icon={UserPlus}
              label="Kandidat pembanding"
              value={f.comparison}
              sub={f.comparison === 0 ? 'Tidak ada kandidat pembanding di antara A dan B.' : `${f.comparisonInTopN} masuk N besar run B.`}
              onClick={() => onOpenSection('pool')}
            />
            <VerdictFact
              icon={violated ? AlertTriangle : Layers}
              label="Sumber perubahan"
              value={`${f.differing.length} dari 5 berbeda`}
              sub={
                f.differing.length === 0
                  ? 'Tidak ada sumber yang berbeda.'
                  : f.differing.map((d) => `${d.key} ${d.label.toLowerCase()}`).join(' · ')
              }
              alert={violated}
              onClick={() => onOpenSection('konfigurasi')}
            />
          </div>
        </div>
      </div>

      {/* ── 2. Why ── */}
      <Card
        icon={MessageSquareText}
        title="Mengapa A dan B berbeda"
        tone="bg-cyan-500/12 text-cyan-700 dark:text-cyan-300"
        info="Kalimat disusun dari templat (kode T-xx) dan angka hasil hitungan, tanpa model bahasa. Kode di depan setiap kalimat merujuk katalog templat penjelasan."
      >
        {dto.explanations.summary.length === 0 ? (
          <p className="text-xs text-muted-foreground">Tidak ada perbedaan yang perlu dijelaskan antara A dan B.</p>
        ) : (
          <ExplanationList items={dto.explanations.summary} title="" />
        )}
      </Card>

      {/* ── 3. The forum's choices in this pair ── */}
      <PairDecisions data={decisions} dto={dto} onOpenRecord={onOpenDecisions} />

      {/* ── 4. The picture ── */}
      <section className="rounded-2xl border bg-card p-4 shadow-xs">
        <RankSlopeChart dto={dto} />
      </section>

      {/* ── 5. The five sources ── */}
      <Card
        icon={Layers}
        title="Sumber perubahan"
        tone="bg-amber-500/12 text-amber-700 dark:text-amber-300"
        info="Pergeseran peringkat hanya dapat bersumber dari lima hal ini. Komposisi pool, nilai aspek, dan penyesuaian adalah perubahan data; bobot dan penyajian adalah perubahan konfigurasi. Pada pasangan induk dan run pembanding, hanya komposisi pool (S1) yang boleh berbeda."
        aside={
          <button
            type="button"
            onClick={() => onOpenSection('konfigurasi')}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            Bandingkan konfigurasi <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        }
        className={violated ? 'border-rose-400/60' : undefined}
      >
        <div className="space-y-3">
          {!dto.structured && dto.unavailableReason && (
            <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
              Perbandingan per kriteria tidak tersedia: {dto.unavailableReason} Peringkat dan konfigurasi tetap dibandingkan dari
              yang tersimpan.
            </p>
          )}
          <SourceSummary sources={dto.sources} freezeViolations={[]} />
          <LiveValuesNotice dto={dto} />
          <ReproducibilityLine dto={dto} />
        </div>
      </Card>
    </div>
  );
}

function VerdictFact({
  icon: Icon,
  label,
  value,
  sub,
  onClick,
  alert = false,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub: ReactNode;
  onClick: () => void;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group min-w-0 rounded-xl border bg-background/75 p-2.5 text-left backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        alert ? 'border-rose-400/70 bg-rose-500/8' : 'hover:border-foreground/20',
      )}
    >
      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className={cn('h-3 w-3', alert ? 'text-rose-600' : 'text-muted-foreground')} aria-hidden />
        <span className="truncate">{label}</span>
        <ArrowRight className="ml-auto h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" aria-hidden />
      </span>
      <span className="mt-0.5 block text-sm font-bold tabular-nums">{value}</span>
      <span className="line-clamp-2 block text-[10px] leading-snug text-muted-foreground" title={typeof sub === 'string' ? sub : undefined}>
        {sub}
      </span>
    </button>
  );
}
