'use client';

import { useIsDemoMode } from '@/components/app-mode-provider';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Filter,
  Grid2x2,
  RotateCcw,
  Search,
  Trophy,
  XCircle,
} from 'lucide-react';
// Same icon family the Kandidat page uses, so a person moving between the two
// reads the same glyph for the same attribute.
import {
  BriefcaseIcon,
  CakeIcon,
  CalendarCheckIcon,
  HashIcon,
  HeartIcon,
  IdentificationBadgeIcon,
  ListDashesIcon,
  RankingIcon,
  ScalesIcon,
  SquaresFourIcon,
} from '@phosphor-icons/react';

import { DashboardHeader } from '@/components/dashboard-header';
import { TalentPoolFilterPanel } from '@/components/talent-pool-filter-panel';
import { TalentPoolSectionNav } from '@/components/talent-pool-section-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  behaviorLabel,
  disciplineLabel,
  fieldLabel,
  mcuLabel,
} from '@/lib/candidate-labels';
import { formatHavQuadrant, getHavQuadrantLabel, HAV_QUADRANTS } from '@/lib/hav-quadrant';
import { HAV_SOURCE_LABEL } from '@/lib/hav-effective';
import type { TalentPoolCandidate, TalentPoolData } from '@/lib/talent-pool-data';
import { cn } from '@/lib/utils';

/** Per-tab persistence for the reveal toggle; clears when the tab closes. */
const MASK_STORAGE_KEY = 'pulse:talent-pool:masked';

// ── Visual encoding ──────────────────────────────────────────────────────────
// Scanning hundreds of rows is a colour job, not a reading job: the eye finds a
// red cell far faster than it reads the word "unfit". Every mapping below is
// deliberately tri-state (good / caution / bad) with an explicit neutral for
// unknown, so absent data never masquerades as a pass.

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  bad: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  neutral: 'bg-muted text-muted-foreground',
};

// Keyed on the STORED codes, not on substrings of them. A regex over the raw
// value silently mis-tones anything whose code shape it didn't anticipate —
// 'SP_FIRST_LAST' (the heaviest sanction) has no word boundary after "sp", so a
// \bsp\b test misses it and the worst status renders as neutral grey.
const MCU_TONE: Record<string, Tone> = {
  fit: 'good',
  fit_with_note: 'warn',
  expired: 'warn',
  unfit: 'bad',
};
function mcuTone(v: string | null): Tone {
  if (!v) return 'neutral';
  return MCU_TONE[v] ?? 'neutral';
}

const DISCIPLINE_TONE: Record<string, Tone> = {
  CLEAR: 'good',
  // ST is the lightest tier and the Talent Pool rule admits it alongside CLEAR,
  // so it must not look like a disqualification.
  ST: 'warn',
  WARNING: 'warn',
  SP_UNDER_2_YEARS: 'warn',
  ACTIVE_SP: 'bad',
  SP3: 'bad',
  SP_FIRST_LAST: 'bad',
  SANCTION: 'bad',
};
function disciplineTone(v: string | null): Tone {
  if (!v) return 'neutral';
  return DISCIPLINE_TONE[String(v).toUpperCase()] ?? 'neutral';
}

function paTone(letter: string): Tone {
  if (letter === 'A') return 'good';
  if (letter === 'B') return 'good';
  if (letter === 'C') return 'warn';
  return 'bad';
}

/** HAV tone follows the quadrant's own category, not any one program's rules. */
const HAV_CATEGORY = new Map(HAV_QUADRANTS.map((q) => [String(q.number), q.category]));
function havTone(q: string): Tone {
  const cat = HAV_CATEGORY.get(q);
  if (cat === 'TOP' || cat === 'STRONG') return 'good';
  if (cat === 'SOLID') return 'warn';
  if (cat === 'BORDER' || cat === 'BOTTOM') return 'bad';
  return 'neutral';
}

function Chip({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Redacted placeholder. Mirrors the Kandidat page: this list carries the same
 * HAV / MCU / disiplin / PA columns, so it hides them by the same default.
 */
function Mask({ w = 4 }: { w?: number }) {
  return (
    <span
      className="select-none align-middle tracking-[0.2em] text-muted-foreground/60"
      title="Data disamarkan — klik Tampilkan data"
      aria-label="Data disamarkan"
    >
      {'•'.repeat(w)}
    </span>
  );
}

// ── Sorting ──────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'department' | 'position' | 'grade' | 'hav' | 'age' | 'years' | 'failed';
type SortDir = 'asc' | 'desc';

const SORT_LABEL: Record<SortKey, string> = {
  name: 'Nama',
  department: 'Departemen',
  position: 'Posisi',
  grade: 'Grade',
  hav: 'HAV',
  age: 'Usia',
  years: 'Masa kerja',
  failed: 'Jumlah aturan gagal',
};

function compare(a: TalentPoolCandidate, b: TalentPoolCandidate, key: SortKey): number {
  // Nulls sort last regardless of direction — an unknown grade is not "lowest".
  const nullsLast = (x: number | null, y: number | null) => {
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x - y;
  };
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'department':
      return a.department.localeCompare(b.department) || a.name.localeCompare(b.name);
    case 'position':
      return a.currentPosition.localeCompare(b.currentPosition) || a.name.localeCompare(b.name);
    case 'grade':
      return nullsLast(a.gradeNumber, b.gradeNumber) || a.name.localeCompare(b.name);
    case 'hav':
      return (
        nullsLast(a.havQuadrant ? Number(a.havQuadrant) : null, b.havQuadrant ? Number(b.havQuadrant) : null) ||
        a.name.localeCompare(b.name)
      );
    case 'age':
      return nullsLast(a.age, b.age) || a.name.localeCompare(b.name);
    case 'years':
      return nullsLast(a.yearsExperience, b.yearsExperience) || a.name.localeCompare(b.name);
    case 'failed':
      return a.failedRules.length - b.failedRules.length || a.name.localeCompare(b.name);
  }
}

function SortableHead({
  label,
  sortKey,
  active,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const isActive = active === sortKey;
  return (
    <TableHead className={cn('sticky top-0 z-20 bg-card', className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground',
          isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
        aria-label={`Urutkan menurut ${label}`}
      >
        {label}
        {isActive &&
          (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TableHead>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
  bar,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  tone: string;
  /** 0–100; renders a proportion bar under the number. */
  bar?: number;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', tone)}>{icon}</span>
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold leading-none tabular-nums">{value}</p>
        {bar != null && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, bar))}%` }}
            />
          </div>
        )}
        {hint && <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </CardContent>
    </>
  );

  if (!onClick) return <Card>{body}</Card>;
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'cursor-pointer transition-colors hover:border-primary/50',
        active && 'border-primary ring-1 ring-primary/30',
      )}
    >
      {body}
    </Card>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

function CandidateTable({
  rows,
  masked,
  showReasons,
  sort,
  dir,
  onSort,
}: {
  rows: TalentPoolCandidate[];
  masked: boolean;
  showReasons: boolean;
  sort: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm font-medium">Tidak ada kandidat yang cocok</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Longgarkan pencarian atau filter di atas untuk melihat lebih banyak.
        </p>
      </div>
    );
  }

  return (
    // The scroll container has to be THIS element for the sticky header to
    // work: `position: sticky` resolves against its nearest scrolling ancestor,
    // and <Table> wraps itself in an `overflow-x-auto` div that would otherwise
    // claim that role — with no bounded height, so the header would never
    // actually stick. Neutralizing that inner overflow hands both axes here.
    <div className="max-h-[65vh] overflow-auto [&>[data-slot=table-container]]:overflow-visible">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
          <SortableHead label="Nama" sortKey="name" active={sort} dir={dir} onSort={onSort} />
          <SortableHead label="Posisi Saat Ini" sortKey="position" active={sort} dir={dir} onSort={onSort} />
          <SortableHead label="Departemen" sortKey="department" active={sort} dir={dir} onSort={onSort} />
          <SortableHead label="Grade" sortKey="grade" active={sort} dir={dir} onSort={onSort} />
          <SortableHead label="Usia" sortKey="age" active={sort} dir={dir} onSort={onSort} />
          <SortableHead label="Masa" sortKey="years" active={sort} dir={dir} onSort={onSort} />
          <SortableHead label="HAV" sortKey="hav" active={sort} dir={dir} onSort={onSort} />
          <TableHead className="sticky top-0 z-20 bg-card">MCU</TableHead>
          <TableHead className="sticky top-0 z-20 bg-card">Disiplin</TableHead>
          <TableHead className="sticky top-0 z-20 bg-card">PA (terbaru → lama)</TableHead>
          {showReasons && (
            <SortableHead label="Alasan Gagal" sortKey="failed" active={sort} dir={dir} onSort={onSort} />
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="py-2">
              <Link
                href={`/candidates/${c.id}`}
                className="font-medium transition-colors hover:text-primary"
              >
                {c.name || '—'}
              </Link>
              <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">
                {masked ? <Mask w={4} /> : c.employeeId || ''}
              </span>
            </TableCell>
            <TableCell className="max-w-[14rem] truncate py-2 text-muted-foreground" title={c.currentPosition}>
              {c.currentPosition || '—'}
            </TableCell>
            <TableCell className="max-w-[12rem] truncate py-2 text-muted-foreground" title={c.department}>
              {c.department || '—'}
            </TableCell>
            <TableCell className="py-2 tabular-nums">
              {masked ? <Mask w={3} /> : c.grade || '—'}
            </TableCell>
            <TableCell className="py-2 tabular-nums text-muted-foreground">
              {masked ? <Mask w={3} /> : c.age != null ? `${c.age}th` : '—'}
            </TableCell>
            <TableCell className="py-2 tabular-nums text-muted-foreground">
              {masked ? <Mask w={3} /> : c.yearsExperience != null ? `${c.yearsExperience}th` : '—'}
            </TableCell>
            <TableCell className="py-2">
              {masked ? (
                <Mask w={3} />
              ) : c.havQuadrant ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* The table is tight, so the quadrant number carries the
                        cell and the full name lives in the tooltip. The card
                        view has room for the whole label. */}
                    <span className="cursor-help">
                      <Chip tone={havTone(c.havQuadrant)}>Q{c.havQuadrant}</Chip>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{getHavQuadrantLabel(c.havQuadrant)} · sumber: {HAV_SOURCE_LABEL[c.havSource]}</TooltipContent>
                </Tooltip>
              ) : (
                <Chip tone="neutral">—</Chip>
              )}
            </TableCell>
            <TableCell className="py-2">
              {masked ? (
                <Mask w={4} />
              ) : (
                <Chip tone={mcuTone(c.mcuStatus)}>{mcuLabel(c.mcuStatus)}</Chip>
              )}
            </TableCell>
            <TableCell className="py-2">
              {masked ? (
                <Mask w={4} />
              ) : (
                <Chip tone={disciplineTone(c.disciplineStatus)}>
                  {disciplineLabel(c.disciplineStatus)}
                </Chip>
              )}
            </TableCell>
            <TableCell className="py-2">
              {masked ? (
                <Mask w={6} />
              ) : c.performancePeriods.length === 0 ? (
                <Chip tone="neutral">tidak ada</Chip>
              ) : (
                <span className="flex gap-0.5">
                  {c.performancePeriods.map((p, i) => (
                    <Chip key={`${c.id}-pa-${i}`} tone={paTone(p)} className="px-1">
                      {p}
                    </Chip>
                  ))}
                </span>
              )}
            </TableCell>
            {showReasons && (
              <TableCell className="py-2">
                {/* Masked: the COUNT still shows. Which rule a named person
                    failed is personal data (it reveals their MCU / disiplin /
                    PA), but "how far off are they" is what makes the list
                    scannable, and it leaks nothing on its own. */}
                {masked ? (
                  <Chip tone={c.failedRules.length === 1 ? 'warn' : 'bad'}>
                    {c.failedRules.length} aturan
                  </Chip>
                ) : c.failedRules.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {c.failedRules.map((r, i) => (
                      <Tooltip key={`${c.id}-${r.label}-${i}`}>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">
                            {/* A rule judged against an EMPTY column is not the
                                same claim as one judged against the person's
                                actual value — amber, and labelled, so the two
                                are never read as the same rejection. */}
                            <Chip tone={r.dataMissing ? 'warn' : 'bad'}>
                              {r.label}
                              {r.dataMissing ? ' · kosong' : ''}
                            </Chip>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {r.dataMissing
                            ? `Data ${fieldLabel(r.field)} belum terisi untuk kandidat ini, sehingga aturan "${r.label}" tidak dapat dipenuhi. Ini kekosongan data, bukan hasil penilaian.`
                            : r.message}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </TableCell>
            )}
          </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Card view ────────────────────────────────────────────────────────────────
// The default. A dense table is the right tool for comparing a column across
// many rows, but the common question here is "who is this person and why are
// they in (or out of) the pool" — which is a per-person question, and reads far
// better as one block per person than as a row you have to scan sideways.

/** One-glance verdict, ordered so the most informative label wins a tie. */
function statusOf(c: TalentPoolCandidate): { label: string; tone: Tone } {
  if (c.failedRules.length === 0) return { label: 'Lolos', tone: 'good' };
  // An empty column is not a rejection, so it gets its own label rather than
  // being folded into "Tidak lolos" — the fix is data entry, not development.
  if (c.blockedOnlyByMissingData) return { label: 'Data belum lengkap', tone: 'warn' };
  // A "Nyaris lolos" arm used to sit here for candidates failing exactly one
  // rule. It was removed with the near-miss filter: the rules that produced the
  // verdict are listed on the card itself, so counting them added a label
  // without adding an answer.
  return { label: 'Tidak lolos', tone: 'bad' };
}

/** Muted attribute chip with an icon — the one visual language every field on
 *  the card uses, identity or assessment alike, so nothing reads as a
 *  different kind of thing from anything else on the same card. */
function AttrChip({
  icon,
  children,
  tip,
  tone,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  tip: string;
  tone?: Tone;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'flex cursor-default items-center gap-1 rounded-md px-2 py-1',
            tone ? TONE_CLASS[tone] : 'bg-muted',
          )}
        >
          <span className="flex h-3.5 w-3.5 items-center justify-center">{icon}</span>
          <span>{children}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function CandidateCard({
  c,
  masked,
  showReasons,
}: {
  c: TalentPoolCandidate;
  masked: boolean;
  showReasons: boolean;
}) {
  const status = statusOf(c);
  return (
    // min-w-0: this Card is a direct item of the outer `grid xl:grid-cols-2`.
    // CSS Grid gives every item an automatic min-width equal to its content's
    // min-content size (unlike flexbox, on BOTH axes), which overrides the
    // track's own `minmax(0, 1fr)` sizing — so a long department/position
    // string below pushed the whole card wider than its column and spilled
    // past the card's own border, truncate ellipsis or not.
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        {/* Same rule one level in: CardHeader is itself `display: grid`, so
            this row is CardHeader's grid item and needs the same override. */}
        <div className="min-w-0 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">
              <Link
                href={`/candidates/${c.id}`}
                className="underline transition-colors hover:text-primary"
              >
                {c.name || '—'}
              </Link>
            </CardTitle>
            <p className="truncate text-sm text-muted-foreground">
              {[c.currentPosition, c.department].filter(Boolean).join(' · ') || '—'}
            </p>
            {c.division && (
              <p className="truncate text-xs text-muted-foreground/80">{c.division}</p>
            )}
          </div>
          <Chip tone={status.tone} className="shrink-0 px-2 py-1">
            {status.label}
          </Chip>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Identity chips and assessment chips share one visual language —
            same shape, same size, same icon+label layout — so the eye reads
            the whole card as one consistent system instead of two. */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <AttrChip
            icon={<IdentificationBadgeIcon className="h-3.5 w-3.5" weight="duotone" />}
            tip="NPK"
            tone="neutral"
          >
            {masked ? <Mask w={4} /> : c.employeeId || '—'}
          </AttrChip>
          <AttrChip
            icon={<RankingIcon className="h-3.5 w-3.5" weight="duotone" />}
            tip="Grade"
            tone="neutral"
          >
            {masked ? <Mask w={3} /> : c.grade || '—'}
          </AttrChip>
          <AttrChip
            icon={<CakeIcon className="h-3.5 w-3.5" weight="duotone" />}
            tip={c.age != null ? 'Usia' : 'Usia — tanggal lahir belum tersinkron'}
            tone="neutral"
          >
            {masked ? <Mask w={3} /> : c.age != null ? `${c.age} th` : '—'}
          </AttrChip>
          <AttrChip
            icon={<BriefcaseIcon className="h-3.5 w-3.5" weight="duotone" />}
            tip="Masa kerja"
            tone="neutral"
          >
            {masked ? <Mask w={3} /> : c.yearsExperience != null ? `${c.yearsExperience} th` : '—'}
          </AttrChip>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <AttrChip
            icon={<HashIcon className="h-3.5 w-3.5" weight="duotone" />}
            tip={
              masked
                ? 'Data disamarkan'
                : c.havQuadrant
                  ? `HAV — ${getHavQuadrantLabel(c.havQuadrant)} · sumber: ${HAV_SOURCE_LABEL[c.havSource]}`
                  : 'HAV belum terisi'
            }
            tone={masked ? undefined : c.havQuadrant ? havTone(c.havQuadrant) : 'neutral'}
          >
            {/* Same formatter the Kandidat page uses: "8 STRONG PERFORMER
                (SOLID)" rather than a bare quadrant number. */}
            {masked ? <Mask w={3} /> : formatHavQuadrant(c.havQuadrant)}
          </AttrChip>
          <AttrChip
            icon={<HeartIcon className="h-3.5 w-3.5" weight="duotone" />}
            tip="MCU"
            tone={masked ? undefined : mcuTone(c.mcuStatus)}
          >
            {masked ? <Mask w={4} /> : mcuLabel(c.mcuStatus)}
          </AttrChip>
          <AttrChip
            icon={<ScalesIcon className="h-3.5 w-3.5" weight="duotone" />}
            tip="Disiplin"
            tone={masked ? undefined : disciplineTone(c.disciplineStatus)}
          >
            {masked ? <Mask w={4} /> : disciplineLabel(c.disciplineStatus)}
          </AttrChip>
          <AttrChip
            icon={<CalendarCheckIcon className="h-3.5 w-3.5" weight="duotone" />}
            tip="Rekomendasi behavior"
          >
            {masked ? <Mask w={5} /> : behaviorLabel(c.behaviorRecommendation)}
          </AttrChip>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            PA
          </span>
          {masked ? (
            <Mask w={6} />
          ) : c.performancePeriods.length === 0 ? (
            <Chip tone="neutral">belum ada</Chip>
          ) : (
            c.performancePeriods.map((p, i) => (
              <Chip key={`${c.id}-pa-${i}`} tone={paTone(p)} className="px-1.5">
                {p}
              </Chip>
            ))
          )}
        </div>

        {showReasons && c.failedRules.length > 0 && (
          <div className="rounded-lg border border-dashed p-2.5">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Alasan tidak lolos ({c.failedRules.length})
            </p>
            {masked ? (
              <Chip tone={c.blockedOnlyByMissingData ? 'warn' : 'bad'}>
                {c.failedRules.length} aturan
              </Chip>
            ) : (
              <div className="space-y-1.5">
                {c.failedRules.map((r, i) => (
                  <div key={`${c.id}-${r.label}-${i}`} className="flex items-center gap-2">
                    <Chip tone={r.dataMissing ? 'warn' : 'bad'} className="mt-0.5 shrink-0">
                      {r.label}
                      {r.dataMissing ? ' · kosong' : ''}
                    </Chip>
                    <p className="min-w-0 text-[11px] leading-snug text-muted-foreground">
                      {r.dataMissing
                        ? `Data ${fieldLabel(r.field)} belum terisi — kekosongan data, bukan hasil penilaian.`
                        : r.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CardGrid({
  rows,
  masked,
  showReasons,
}: {
  rows: TalentPoolCandidate[];
  masked: boolean;
  showReasons: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
        <p className="text-sm font-medium text-muted-foreground">Tidak ada kandidat yang cocok</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Longgarkan pencarian atau filter di atas untuk melihat lebih banyak.
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {rows.map((c) => (
        <CandidateCard key={c.id} c={c} masked={masked} showReasons={showReasons} />
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

/** Cards are taller than rows, so they page in smaller batches (as on Kandidat). */
const PAGE_SIZE_CARDS = 8;
const PAGE_SIZES = [25, 50, 100, 0] as const; // 0 = semua (table view only)

/**
 * Sentinel for "no filter". Radix Select forbids an empty-string item value, and
 * the Combobox needs a value it can resolve to a label for its trigger — so the
 * unfiltered state is a real value rather than ''.
 */
const ALL = 'all';

export function TalentPoolPageClient({
  data: initialData,
  fieldValues = {},
  canManageFilter = false,
}: {
  data: TalentPoolData;
  /** Distinct values present in candidate data, per field — for the rule editor. */
  fieldValues?: Partial<Record<string, string[]>>;
  /** governance.manage — without it the rules panel is read-only. */
  canManageFilter?: boolean;
}) {
  const demoSearch = useIsDemoMode();
  // Held in state, not read straight from props: saving the eligibility rules
  // returns the recomputed pool, and swapping it in here is what makes the list
  // below answer to the new rules immediately instead of after a reload.
  const [data, setData] = useState<TalentPoolData>(initialData);
  useEffect(() => setData(initialData), [initialData]);

  const [tab, setTab] = useState<'qualified' | 'not-qualified'>('qualified');
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState(ALL);
  const [division, setDivision] = useState(ALL);
  const [sort, setSort] = useState<SortKey>('name');
  const [dir, setDir] = useState<SortDir>('asc');
  // Cards by default: this page is read person-by-person far more often than it
  // is read column-by-column. The table stays one click away for comparison.
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [tablePageSize, setTablePageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  // Privacy: everything except name, position and department starts hidden.
  const [masked, setMasked] = useState(true);

  // Restore the reveal choice for this tab. Deliberately not read in the
  // useState initializer: the server renders masked, so reading storage during
  // render would risk a hydration mismatch. Starting hidden also means a failed
  // read can never expose data — it only ever falls back to safe.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(MASK_STORAGE_KEY) === 'false') setMasked(false);
    } catch {
      // Storage blocked (private mode / strict cookie policy) — stay masked.
    }
  }, []);

  const toggleMasked = useCallback(() => {
    setMasked((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(MASK_STORAGE_KEY, String(next));
      } catch {
        // Ignore — the toggle still works for this render.
      }
      return next;
    });
  }, []);

  // Facets come from the evaluated set itself, so the pickers can only ever
  // offer values that actually exist in this tenant's data.
  const { departments, divisions } = useMemo(() => {
    const d = new Set<string>();
    const v = new Set<string>();
    for (const c of [...data.qualified, ...data.notQualified]) {
      if (c.department) d.add(c.department);
      if (c.division) v.add(c.division);
    }
    return {
      departments: Array.from(d).sort((a, b) => a.localeCompare(b)),
      divisions: Array.from(v).sort((a, b) => a.localeCompare(b)),
    };
  }, [data.qualified, data.notQualified]);

  const departmentOptions = useMemo(
    () => [
      { value: ALL, label: 'Semua departemen' },
      ...departments.map((d) => ({ value: d, label: d })),
    ],
    [departments],
  );
  const divisionOptions = useMemo(
    () => [
      { value: ALL, label: 'Semua divisi' },
      ...divisions.map((d) => ({ value: d, label: d })),
    ],
    [divisions],
  );

  const filtersActive = query.trim() !== '' || department !== ALL || division !== ALL;

  const resetFilters = useCallback(() => {
    setQuery('');
    setDepartment(ALL);
    setDivision(ALL);
  }, []);

  // Any change to what's being filtered — or to how many fit on a page —
  // invalidates the current page offset.
  useEffect(() => {
    setPage(1);
  }, [query, department, division, tab, tablePageSize, viewMode, sort, dir]);

  // "Jumlah aturan gagal" only exists on the Tidak Lolos tab, and the card
  // view's sort picker hides options it cannot offer. Leaving the state on a
  // hidden value would render an empty Select trigger, so fall back.
  useEffect(() => {
    if (tab === 'qualified' && sort === 'failed') setSort('name');
  }, [tab, sort]);

  const applyFilters = useCallback(
    (list: TalentPoolCandidate[]) => {
      const q = query.trim().toLowerCase();
      const out = list.filter((c) => {
        if (department !== ALL && c.department !== department) return false;
        if (division !== ALL && c.division !== division) return false;
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.currentPosition.toLowerCase().includes(q) ||
          c.department.toLowerCase().includes(q) ||
          c.division.toLowerCase().includes(q) ||
          c.employeeId.toLowerCase().includes(q)
        );
      });
      const sorted = [...out].sort((a, b) => compare(a, b, sort));
      return dir === 'asc' ? sorted : sorted.reverse();
    },
    [query, department, division, sort, dir],
  );

  const qualified = useMemo(
    () => applyFilters(data.qualified),
    [applyFilters, data.qualified],
  );
  const notQualified = useMemo(
    () => applyFilters(data.notQualified),
    [applyFilters, data.notQualified],
  );

  const active = tab === 'qualified' ? qualified : notQualified;
  const totalForTab = tab === 'qualified' ? data.qualified.length : data.notQualified.length;
  const pageSize = viewMode === 'cards' ? PAGE_SIZE_CARDS : tablePageSize;
  const effectivePageSize = pageSize === 0 ? active.length || 1 : pageSize;
  const pageCount = Math.max(1, Math.ceil(active.length / effectivePageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = active.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);

  const onSort = useCallback((k: SortKey) => {
    setSort((prevKey) => {
      if (prevKey === k) {
        setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setDir('asc');
      return k;
    });
  }, []);

  const passRate =
    data.totalEvaluated > 0 ? Math.round((data.qualified.length / data.totalEvaluated) * 100) : 0;

  return (
    <>
      <DashboardHeader
        title="Talent Pool"
        info={
          data.program
            ? `Gambaran terima/tolak kandidat aktif atas aturan filter lengkap program "${data.program.name}" — dihitung langsung dari data saat ini, bukan dari hasil scoring. Daftar ini tidak menyaring Talent Mapping: peta memuat semua kandidat yang lolos aturan Disiplin.`
            : undefined
        }
        // A missing program is a finding about this business unit, not an
        // explanation of the page, so it stays printed under the title.
        description={data.program ? undefined : 'Program Talent Pool belum tersedia pada unit bisnis ini'}
        actions={
          <Button
            variant={masked ? 'outline' : 'secondary'}
            size="sm"
            onClick={toggleMasked}
            className="gap-1.5"
          >
            {masked ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {masked ? 'Tampilkan data' : 'Samarkan data'}
          </Button>
        }
      />
      {/* Talent Pool → Talent Mapping. The second section is NOT this
          "Lolos" list on a grid: it maps everyone who passes the Talent Pool's
          discipline rule, and shows this page's verdict beside each person as
          information (HR decision, 2026-10 — lib/talent-pool-data.ts). */}
      <TalentPoolSectionNav />

      <div className="space-y-4 p-4">
        {/* Banners: each states a condition under which the split below means
            something other than what it looks like. */}
        {/* Both banners used to send the reader to Tata Kelola. The Talent Pool
            program is no longer listed there — its rules are edited in the
            panel below — so they point at the panel instead. */}
        {!data.program && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            Program dengan kode <code className="text-xs">talent</code> tidak ditemukan pada Company
            ini. Program ini biasanya dibuat otomatis saat halaman pertama kali dibuka — muat ulang
            halaman, dan hubungi administrator bila pesan ini bertahan.
          </div>
        )}
        {data.program && data.program.ruleCount === 0 && (
          <div className="rounded-lg border border-muted-foreground/30 bg-muted/40 px-4 py-3 text-sm">
            {data.program.disabledRuleCount > 0
              ? `Semua aturan filter program ${data.program.name} sedang nonaktif (${data.program.disabledRuleCount} aturan), jadi seluruh kandidat aktif masuk pool. `
              : `Program ${data.program.name} belum punya aturan filter, jadi seluruh kandidat aktif masuk pool. `}
            Atur pada panel <strong>Aturan Filter Talent Pool</strong> di bawah.
          </div>
        )}
        {/* An "Aturan filter tidak ditegakkan" banner used to sit here, warning
            that failing candidates would still be scored. It was describing a
            consequence this program cannot have: `talent` is in
            NON_POSITION_PROGRAM_CODES, so no scoring run is ever started under
            it and `enforceFilterRules` has no reader. The flag is still real
            for the programs that do score, and Tata Kelola still shows it. */}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<Trophy className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
            tone="bg-emerald-500/15"
            label="Lolos filter"
            value={data.qualified.length}
            bar={passRate}
            hint={`${passRate}% dari ${data.totalEvaluated} kandidat aktif`}
          />
          <StatCard
            icon={<XCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />}
            tone="bg-rose-500/15"
            label="Tidak lolos"
            value={data.notQualified.length}
            hint={
              data.blockedOnlyByMissingData > 0
                ? `${data.blockedOnlyByMissingData} di antaranya HANYA karena data kosong`
                : 'Gagal minimal satu aturan filter'
            }
          />
          <StatCard
            icon={<Filter className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />}
            tone="bg-violet-500/15"
            label="Aturan filter aktif"
            value={data.program?.ruleCount ?? 0}
            hint={
              data.program
                ? `${data.program.name}${data.program.disabledRuleCount > 0 ? ` · ${data.program.disabledRuleCount} nonaktif` : ''}`
                : '—'
            }
          />
          {/* Says, in numbers, that the next section is not this list: the map
              takes everyone the discipline rule admits, which is normally far
              more than "Lolos". */}
          <Link href="/talent-pool/mapping" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatCard
              icon={<Grid2x2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />}
              tone="bg-indigo-500/15"
              label="Di Talent Mapping"
              value={data.mappingPopulation}
              hint="Lolos aturan Disiplin — dipetakan pada 16-box HAV, apa pun status Talent Pool-nya"
            />
          </Link>
        </div>

        {/* The rules themselves, where their consequence is displayed. This
            replaced a "Aturan paling sering menggugurkan" tally: that card
            answered which rule rejects most people, which is a question only
            worth asking in order to CHANGE the rule — and changing it meant
            leaving for Tata Kelola. The tree is the thing, and it is editable
            in place, so the loop closes here. */}
        <TalentPoolFilterPanel
          data={data}
          canManage={canManageFilter}
          fieldValues={fieldValues}
          onDataChange={setData}
        />

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={demoSearch ? 'Cari nama, posisi, departemen…' : 'Cari nama, posisi, departemen, NPK…'}
              className="pl-8"
            />
          </div>

          {/* Departemen / divisi are searchable: the option list comes from the
              data, so it can run to dozens of entries. */}

          <div className="w-[13rem]">
            <Combobox
              options={divisionOptions}
              value={division}
              onValueChange={setDivision}
              placeholder="Semua divisi"
              searchPlaceholder="Cari divisi…"
              emptyText="Divisi tidak ditemukan."
              triggerClassName="h-9 text-sm"
              className="w-md"
            />
          </div>

          <div className="w-[13rem]">
            <Combobox
              options={departmentOptions}
              value={department}
              onValueChange={setDepartment}
              placeholder="Semua departemen"
              searchPlaceholder="Cari departemen…"
              emptyText="Departemen tidak ditemukan."
              triggerClassName="h-9 text-sm"
              className="w-md"
            />
          </div>

         

          {/* Cards have no clickable column headers, so sorting needs an explicit
              control in that mode. In table mode the headers already do it. */}
          {viewMode === 'cards' && (
            <div className="flex items-center gap-1">
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger size="sm" className="h-9 w-[12rem] text-sm" aria-label="Urutkan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABEL) as SortKey[])
                    // "Jumlah aturan gagal" is meaningless on the Lolos tab —
                    // every candidate there failed nothing.
                    .filter((k) => k !== 'failed' || tab === 'not-qualified')
                    .map((k) => (
                      <SelectItem key={k} value={k}>
                        Urut: {SORT_LABEL[k]}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                aria-label={dir === 'asc' ? 'Urut naik' : 'Urut turun'}
              >
                {dir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              </Button>
            </div>
          )}

          {/* Fixed four-value list — a plain Select, no search worth the weight.
              Card mode pages in fixed batches, so this belongs to the table. */}
          {viewMode === 'table' && (
            <Select value={String(tablePageSize)} onValueChange={(v) => setTablePageSize(Number(v))}>
              <SelectTrigger size="sm" className="h-9 w-[10rem] text-sm" aria-label="Baris per halaman">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s === 0 ? 'Semua baris' : `${s} / halaman`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}

          <div className="flex items-center gap-1 rounded-md border border-input p-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === 'cards' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setViewMode('cards')}
                >
                  <SquaresFourIcon className="h-4 w-4" weight="duotone" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tampilan kartu</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setViewMode('table')}
                >
                  <ListDashesIcon className="h-4 w-4" weight="duotone" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tampilan tabel</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Masking is on by default, so say so in place — the redacted bullets
            otherwise read as missing data, and the toggle is easy to miss. */}
        {masked && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <EyeOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                Data kandidat disamarkan
              </p>
              <p className="text-xs text-muted-foreground">
                Hanya nama, posisi, dan departemen yang ditampilkan. NPK, grade, HAV, MCU, disiplin,
                PA, dan rincian alasan tidak lolos disembunyikan.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={toggleMasked}
              className="shrink-0 gap-2 border-amber-500/40 bg-background font-semibold text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
            >
              <Eye className="h-4 w-4" />
              Tampilkan data
            </Button>
          </div>
        )}

        {/* Active filter summary — a filtered count that doesn't say it is
            filtered is how people misread a pool as smaller than it is. */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Menampilkan{' '}
            <strong className="tabular-nums text-foreground">
              {active.length === 0 ? 0 : (safePage - 1) * effectivePageSize + 1}–
              {Math.min(safePage * effectivePageSize, active.length)}
            </strong>{' '}
            dari <strong className="tabular-nums text-foreground">{active.length}</strong>
            {active.length !== totalForTab && <> (disaring dari {totalForTab})</>}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span>
            Urut: {SORT_LABEL[sort]} {dir === 'asc' ? '↑' : '↓'}
          </span>
        </div>

        {/* Sized and coloured up from the default Tabs: this pair IS the page's
            primary split (everything below belongs to one or the other), so it
            needs to read at a glance, not like a third-level filter control.
            Colours match the Lolos/Tidak-lolos StatCards above rather than
            introducing a new palette for the same two concepts. */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="h-11 gap-1 bg-muted/70 p-1">
            <TabsTrigger
              value="qualified"
              className="gap-2 rounded-md text-sm font-bold data-[state=active]:bg-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-md dark:data-[state=active]:bg-emerald-500"
            >
              <Trophy className="h-4 w-4" />
              Lolos
              <Badge
                variant="secondary"
                className={cn(
                  'tabular-nums',
                  tab === 'qualified'
                    ? 'bg-white/25 text-white'
                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                )}
              >
                {data.qualified.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="not-qualified"
              className="gap-2 rounded-md text-sm font-bold data-[state=active]:bg-rose-500 data-[state=active]:text-white data-[state=active]:shadow-md dark:data-[state=active]:bg-rose-500"
            >
              <XCircle className="h-4 w-4" />
              Tidak Lolos
              <Badge
                variant="secondary"
                className={cn(
                  'tabular-nums',
                  tab === 'not-qualified'
                    ? 'bg-white/25 text-white'
                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
                )}
              >
                {data.notQualified.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="qualified" className="mt-3">
            {viewMode === 'cards' ? (
              <CardGrid rows={pageRows} masked={masked} showReasons={false} />
            ) : (
              <Card className="overflow-hidden py-0">
                <CandidateTable
                  rows={pageRows}
                  masked={masked}
                  showReasons={false}
                  sort={sort}
                  dir={dir}
                  onSort={onSort}
                />
              </Card>
            )}
          </TabsContent>

          <TabsContent value="not-qualified" className="mt-3">
            {viewMode === 'cards' ? (
              <CardGrid rows={pageRows} masked={masked} showReasons />
            ) : (
              <Card className="overflow-hidden py-0">
                <CandidateTable
                  rows={pageRows}
                  masked={masked}
                  showReasons
                  sort={sort}
                  dir={dir}
                  onSort={onSort}
                />
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {pageCount > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Halaman <strong className="tabular-nums text-foreground">{safePage}</strong> dari{' '}
              <strong className="tabular-nums text-foreground">{pageCount}</strong>
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                className="gap-1"
              >
                Berikutnya
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
