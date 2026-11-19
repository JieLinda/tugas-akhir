'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  BriefcaseIcon,
  ChartBarIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  TargetIcon,
  CaretLeftIcon,
  CaretRightIcon,
} from '@phosphor-icons/react';
import { Calculator, Loader2, Pencil, Plus, RotateCcw, Trash2, TriangleAlert, Building2, Layers } from 'lucide-react';
import { DashboardHeader } from '@/components/dashboard-header';
import { PositionFormDialog, type ProgramOption } from '@/components/position-form-dialog';
import { PositionsBulkAddDialog } from '@/components/positions-bulk-add-dialog';
import { useIsDemoMode } from '@/components/app-mode-provider';
import { PositionsRescoreDialog } from '@/components/positions-rescore-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { InfoTip } from '@/components/ui/info-tip';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { ChosenSuccessorsButton } from '@/components/position-chosen-successors';
import {
  createPositionAction,
  deletePositionAction,
  updatePositionAction,
} from '@/lib/pulse-crud-actions';
import { getFilteredPositionsAction } from '@/lib/pulse-actions';
import type { GradeLevelOption, PositionBenchCounts, PositionBenchKey, ReadinessBandKey } from '@/lib/pulse-data';
import type { CandidateLookupItem, MasterPosition, PositionHolderInfo, PositionSummary } from '@/lib/talent-data';
import { cn } from '@/lib/utils';
import type { PositionFlagCounts, PositionFlagKey } from '@/lib/pulse-data';
import { EMPTY_DATE, formatDateTime } from '@/lib/datetime';

const PAGE_SIZE = 20;

/** Why a missing job profile matters — the same explanation the bulk dialogs
 *  give, so the badge is not just a label. */
/** Names the people behind a "retiring soon" badge — a count alone would send
 *  the reader hunting through the position to find out who. */
function retirementSummary(holders: { name: string; age: number | null; retirementMinAge: number | null }[]): string {
  return holders
    .map(
      (h) =>
        `${h.name || 'Tanpa nama'}${h.age != null ? ` (${h.age} th` : ''}` +
        `${h.age != null && h.retirementMinAge != null ? `, batas ${h.retirementMinAge}` : ''}` +
        `${h.age != null ? ')' : ''}`,
    )
    .join(', ');
}

/**
 * Splits a position's incumbents into the ones flagged as retiring and the rest.
 *
 * The two groups render in different badges — rose "Pensiun: …" and sky
 * "Holder: …" — and a retiring incumbent used to appear in BOTH, so a
 * single-incumbent seat printed the same person's name twice in one row, and a
 * three-incumbent seat with one retiring claimed "+2 lainnya" while the retiring
 * badge counted one of those two again.
 *
 * `holders` arrives primary-first (`getHoldersByPosition` orders `isPrimary`
 * DESC), so `active[0]` is the most senior remaining incumbent — which is who
 * the Holder badge should lead with once a retiring primary is taken out of it.
 * That is also why the badge can no longer just print `currentHolder.name`:
 * `currentHolder` IS the primary, retiring or not.
 */
function splitHolders(holders: PositionHolderInfo[] | undefined) {
  const all = holders ?? [];
  const retiring = all.filter((holder) => holder.retiringSoon);
  const active = all.filter((holder) => !holder.retiringSoon);
  return {
    retiring,
    active,
    /** Every incumbent is retiring, so the Holder badge has nobody left to name. */
    allRetiring: all.length > 0 && active.length === 0,
  };
}

/** Lists holders for a badge tooltip: "Name (NPK), Name (NPK)". */
function holderNames(holders: PositionHolderInfo[]): string {
  return holders
    .map((holder) => `${holder.name || '—'}${holder.employeeId ? ` (${holder.employeeId})` : ''}`)
    .join(', ');
}

const NO_JD_HINT =
  'Belum ada job profile terpetakan untuk posisi ini. Scoring tetap bisa berjalan, tetapi aspek Kompetensi Teknis dan Relevansi Karier dihitung dari kompetensi pemangku jabatan, bukan dari tuntutan JD. Pasangkan di Job Profile → Job Profile Match.';

/**
 * The three derived states the summary lines above the table report — and, since
 * each is a reason to want only those rows, filter by.
 *
 * One table rather than three hand-written blocks: they were three
 * near-identical spans whose wording, colour and tooltip had to be kept in step
 * by hand, and giving each an active/inactive state would have doubled that
 * again. A fourth summary line is now a row here.
 *
 * `key` is the value the server understands (`parsePositionFlag`), so the label
 * a reader clicks and the set the query selects cannot drift apart.
 */
const POSITION_FLAG_META: {
  key: PositionFlagKey;
  count: (n: number) => string;
  active: string;
  hint: string;
  /** Text colour — applies in both states. */
  tone: string;
  /** Border + fill, applied only while the filter is on. */
  activeTone: string;
  /** Fill on hover while the filter is off. */
  hoverTone: string;
}[] = [
  {
    key: 'no_jd',
    count: (n) => `${n} posisi belum punya job profile`,
    active: 'Hanya posisi tanpa job profile',
    hint: NO_JD_HINT,
    tone: 'text-amber-700 dark:text-amber-300',
    activeTone: 'border-amber-300/70 bg-amber-500/10 dark:border-amber-800',
    hoverTone: 'hover:bg-amber-500/10',
  },
  {
    key: 'retiring',
    count: (n) => `${n} posisi dengan pejabat mendekati pensiun`,
    active: 'Hanya posisi dengan pejabat mendekati pensiun',
    hint:
      'Usia pejabat sudah mencapai ambang pensiun untuk levelnya. Ambang usia per level ditetapkan administrator. Pejabat tanpa tanggal lahir tersinkron tidak pernah ditandai — data yang tidak diketahui bukan temuan.',
    tone: 'text-rose-700 dark:text-rose-300',
    activeTone: 'border-rose-300/70 bg-rose-500/10 dark:border-rose-800',
    hoverTone: 'hover:bg-rose-500/10',
  },
  {
    key: 'awaiting_pick',
    count: (n) => `${n} posisi sudah scoring tapi belum dipilih suksesornya`,
    active: 'Hanya posisi yang sudah scoring tanpa suksesor terpilih',
    hint:
      'Hasil scoring sudah ada, tetapi belum ada suksesor yang ditetapkan — peringkat sudah dibuat dan keputusan yang menjadi alasannya belum diambil.',
    tone: 'text-amber-700 dark:text-amber-300',
    activeTone: 'border-amber-300/70 bg-amber-500/10 dark:border-amber-800',
    hoverTone: 'hover:bg-amber-500/10',
  },
];

const EMPTY_FLAG_COUNTS: PositionFlagCounts = { no_jd: 0, retiring: 0, awaiting_pick: 0 };
const EMPTY_BENCH_COUNTS: PositionBenchCounts = { ready: 0, not_ready: 0, unscored: 0 };

const programTone: Record<string, string> = {
  talent: 'border-sky-300 bg-sky-500/10 text-sky-700 dark:border-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  successor: 'border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  emergency: 'border-amber-300 bg-amber-500/10 text-amber-700 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

const PROGRAM_TONE_FALLBACK =
  'border-slate-300 bg-slate-500/10 text-slate-700 dark:border-slate-700 dark:bg-slate-500/15 dark:text-slate-300';

const PROGRAM_HINT =
  'Program suksesi tempat posisi ini terdaftar. Satu posisi hanya bisa berada di satu program, dan program itu terkunci begitu posisi punya run scoring — sebuah peringkat adalah penilaian yang dibuat di bawah aturan satu program, jadi memindahkannya akan mengubah arti riwayat itu. Untuk menilai jabatan yang sama di bawah program lain, tambahkan posisinya sekali lagi dengan program tersebut.';

/**
 * The program a position is FILED under.
 *
 * Rendered unlike the badges beside it on purpose. Those report transient state
 * — scoring status, missing JD, a retiring holder, no successor picked yet — and
 * change on their own. This one is part of what the row IS: it decides which
 * positions the program chips show, which positions the scoring wizard offers,
 * and which template a run is allowed to use. It used to be the same
 * `variant="outline" font-normal` pill as all four of them, so answering "which
 * program is this position under?" meant reading every badge in the row and
 * knowing which of the five was the program.
 *
 * Hence: an icon, semibold, always first, and a divider between it and the
 * state badges.
 */
function ProgramBadge({
  code,
  name,
  label,
  className,
}: {
  code: string;
  name?: string | null;
  label: (code: string) => string;
  className?: string;
}) {
  return (
    <Badge
      variant="ghost"
      className={cn('gap-1 border font-semibold text-[10px]', programTone[code] ?? PROGRAM_TONE_FALLBACK, className)}
      title={PROGRAM_HINT}
    >
      <TargetIcon weight="bold" />
      {name || label(code)}
    </Badge>
  );
}

/** Separates the identity badge above from the state badges after it. */
function BadgeDivider() {
  return <span aria-hidden className="h-3 w-px shrink-0 bg-border" />;
}

interface PositionsPageClientProps {
  initialPositions: PositionSummary[];
  initialTotal: number;
  initialCandidates?: CandidateLookupItem[];
  masterPositions: MasterPosition[];
  gradeLevels: GradeLevelOption[];
  masterDepartments?: string[];
  masterDivisions?: string[];
  availablePrograms?: string[];
  /** Program code → display name (from tenant program templates) */
  programLabels?: Record<string, string>;
  /** Full program templates — a position is filed under exactly one of them. */
  programs?: ProgramOption[];
  /** Summary-line drill-down active on first paint (from ?flag=). */
  initialFlag?: PositionFlagKey | null;
  /** Flag counts over the whole filtered set, measured server-side. */
  initialFlagCounts?: PositionFlagCounts;
  /** Bench-overview drill-down active on first paint (?bench=, or the dashboard's ?readiness=ready). */
  initialBench?: PositionBenchKey | null;
  /** Bench states over the whole filtered set, measured server-side. */
  initialBenchCounts?: PositionBenchCounts;
  /** Dashboard "Readiness Bands" drill-down (?band=strong|watchlist|critical). */
  initialBand?: ReadinessBandKey | null;
}

const bandChipMeta: Record<ReadinessBandKey, { label: string; hint: string; tone: string }> = {
  strong: {
    label: 'Strong bench',
    hint: 'coverage ≥ 80%',
    tone: 'border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  watchlist: {
    label: 'Watchlist',
    hint: 'coverage 50–79%',
    tone: 'border-amber-300 bg-amber-500/10 text-amber-700 dark:border-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  critical: {
    label: 'Critical gap',
    hint: 'coverage < 50%',
    tone: 'border-rose-300 bg-rose-500/10 text-rose-700 dark:border-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  },
};

/**
 * The three bench states, in the order they are read: what is covered, what is
 * assessed but thin, what has not been looked at.
 *
 * Each label is a sentence about positions, not a metric name — "Coverage
 * readiness 100%" was true, precise and told nobody what to do next, while
 * "12 posisi belum pernah dinilai" names both the finding and its fix. `hint`
 * states the rule the count obeys, because every one of these is clickable and
 * a filter whose predicate is a guess is a filter nobody trusts.
 */
const benchMeta: Record<
  PositionBenchKey,
  { label: string; hint: string; bar: string; text: string; tile: string }
> = {
  ready: {
    label: 'Sudah ada kandidat siap',
    hint: 'minimal 1 kandidat Short atau Medium di run terakhir',
    bar: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
    tile: 'border-emerald-200/70 bg-emerald-500/[0.07] hover:border-emerald-400 dark:border-emerald-900/60',
  },
  not_ready: {
    label: 'Dinilai, belum ada yang siap',
    hint: 'sudah punya run selesai, tapi semua kandidat Long atau Not Ready',
    bar: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    tile: 'border-amber-200/70 bg-amber-500/[0.07] hover:border-amber-400 dark:border-amber-900/60',
  },
  unscored: {
    label: 'Belum pernah dinilai',
    hint: 'belum punya satu pun run yang selesai',
    bar: 'bg-slate-400',
    text: 'text-slate-600 dark:text-slate-300',
    tile: 'border-slate-200/70 bg-slate-500/[0.06] hover:border-slate-400 dark:border-slate-800',
  },
};

const BENCH_ORDER: PositionBenchKey[] = ['ready', 'not_ready', 'unscored'];

function getStatusTone(hasScoring: boolean, scoringInProgress?: boolean) {
  if (scoringInProgress) {
    return 'border-sky-200 bg-sky-500/10 text-sky-700 dark:border-sky-900/60 dark:bg-sky-500/15 dark:text-sky-300';
  }
  return hasScoring
    ? 'border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-500/15 dark:text-emerald-300'
    : 'border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/60 dark:bg-amber-500/15 dark:text-amber-300';
}

function getCoverageTone(coverage: number) {
  if (coverage >= 80) return 'text-emerald-700 dark:text-emerald-300';
  if (coverage >= 50) return 'text-amber-700 dark:text-amber-300';
  return 'text-rose-700 dark:text-rose-300';
}

function getCoverageBarColor(coverage: number) {
  if (coverage >= 80) return 'bg-emerald-500';
  if (coverage >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

const methodMeta: Record<string, { label: string; tone: string }> = {
  AHP_TOPSIS: {
    label: 'AHP + TOPSIS',
    tone: 'border-violet-200 bg-violet-500/10 text-violet-700 dark:border-violet-900/60 dark:bg-violet-500/15 dark:text-violet-300',
  },
};

function getMethodMeta(method: string) {
  return methodMeta[method] ?? {
    label: method,
    tone: 'border-slate-200 bg-slate-500/10 text-slate-700 dark:border-slate-800 dark:bg-slate-500/15 dark:text-slate-300',
  };
}

function formatRunDate(iso: string) {
  const text = formatDateTime(iso);
  return text === EMPTY_DATE ? '' : text;
}

function getReadinessBadge(readiness: string) {
  if (readiness === 'Short') return 'border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-500/15 dark:text-emerald-300';
  if (readiness === 'Medium') return 'border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/60 dark:bg-amber-500/15 dark:text-amber-300';
  if (readiness === 'Long') return 'border-sky-200 bg-sky-500/10 text-sky-700 dark:border-sky-900/60 dark:bg-sky-500/15 dark:text-sky-300';
  return 'border-slate-200 bg-slate-500/10 text-slate-700 dark:border-slate-800 dark:bg-slate-500/15 dark:text-slate-300';
}

export function PositionsPageClient({
  initialPositions,
  initialTotal,
  initialCandidates = [],
  masterPositions,
  gradeLevels,
  masterDepartments = [],
  masterDivisions = [],
  availablePrograms = [],
  programLabels = {},
  programs = [],
  initialBench = null,
  initialBenchCounts = EMPTY_BENCH_COUNTS,
  initialBand = null,
  initialFlag = null,
  initialFlagCounts = EMPTY_FLAG_COUNTS,
}: PositionsPageClientProps) {
  // Demo mode (lib/demo/): no position writes offered; holder NPKs arrive masked.
  const demo = useIsDemoMode();
  const programLabel = (code: string): string =>
    programLabels[code] ??
    { talent: 'Talent Pool', successor: 'Critical Position', emergency: 'Emergency Position' }[code] ??
    code.charAt(0).toUpperCase() + code.slice(1);
  const [positions, setPositions] = useState(initialPositions);
  const [total, setTotal] = useState(initialTotal);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  // Drill-down filters arrive from the dashboard as query params; they stay
  // sticky until dismissed, and every refetch has to carry them along.
  const [benchFilter, setBenchFilter] = useState<PositionBenchKey | null>(initialBench);
  const [bandFilter, setBandFilter] = useState<ReadinessBandKey | null>(initialBand);
  const [flagFilter, setFlagFilter] = useState<PositionFlagKey | null>(initialFlag);
  // Counted by the server over every position matching the current
  // search/department/division/program filters — NOT over the twenty rows on
  // screen. These used to be derived client-side from `positions` and labelled
  // "di halaman ini", which was survivable while they were only a hint. It is
  // not survivable now that they are the filter control: clicking "4 posisi
  // belum punya job profile" and landing on twelve rows means the number was
  // wrong, and the number is what needed fixing.
  const [flagCounts, setFlagCounts] = useState<PositionFlagCounts>(initialFlagCounts);
  const [benchCounts, setBenchCounts] = useState<PositionBenchCounts>(initialBenchCounts);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  /**
   * Denominator for the bench bar. Deliberately the sum of the three states
   * rather than `total`: when a drill-down is active `total` is the selected
   * subset, while these counts describe the search/department/division/program
   * set the drill-down selects FROM — so dividing by `total` would send the
   * segments past 100% the moment somebody clicks one.
   */
  const benchTotal = benchCounts.ready + benchCounts.not_ready + benchCounts.unscored;

  const departmentsList = useMemo(() => {
    const set = new Set<string>(masterDepartments);
    return Array.from(set).sort();
  }, [masterDepartments]);

  const divisionsList = useMemo(() => {
    const set = new Set<string>(masterDivisions);
    return Array.from(set).sort();
  }, [masterDivisions]);

  const programsList = useMemo(() => {
    const set = new Set<string>(availablePrograms);
    return Array.from(set).sort();
  }, [availablePrograms]);

  const fetchPositions = useCallback(async (
    searchVal: string,
    pageVal: number,
    dept?: string,
    div?: string,
    prog?: string,
    bench: PositionBenchKey | null = benchFilter,
    band: ReadinessBandKey | null = bandFilter,
    flag: PositionFlagKey | null = flagFilter,
  ) => {
    setLoading(true);
    const fd = new FormData();
    fd.set('query', searchVal);
    fd.set('page', String(pageVal));
    fd.set('pageSize', String(PAGE_SIZE));
    fd.set('department', dept ?? '');
    fd.set('division', div ?? '');
    fd.set('program', prog ?? '');
    if (bench) fd.set('bench', bench);
    if (band) fd.set('band', band);
    if (flag) fd.set('flag', flag);
    try {
      const result = await getFilteredPositionsAction(fd);
      setPositions(result.positions);
      setTotal(result.total);
      // Recount on every fetch: narrowing by department or search changes what
      // "4 posisi belum punya job profile" is counting over. A stale count next
      // to a fresh list is worse than no count.
      setFlagCounts(result.flagCounts);
      setBenchCounts(result.benchCounts);
    } finally {
      setLoading(false);
    }
  }, [benchFilter, bandFilter, flagFilter]);

  const handleCreatePosition = useCallback(
    async (fd: FormData) => {
      try {
        await createPositionAction(fd);
        toast.success('Posisi berhasil ditambahkan.');
        await fetchPositions(search, safePage);
      } catch (err: any) {
        toast.error(err?.message ?? 'Gagal menambahkan posisi.');
        throw err;
      }
    },
    [fetchPositions, search, safePage],
  );

  const handleUpdatePosition = useCallback(
    async (fd: FormData) => {
      try {
        await updatePositionAction(fd);
        toast.success('Posisi berhasil diperbarui.');
        await fetchPositions(search, safePage);
      } catch (err: any) {
        toast.error(err?.message ?? 'Gagal memperbarui posisi.');
        throw err;
      }
    },
    [fetchPositions, search, safePage],
  );

  const handleDeletePosition = useCallback(
    async (fd: FormData) => {
      try {
        await deletePositionAction(fd);
        toast.success('Posisi berhasil dihapus.');
        await fetchPositions(search, safePage);
      } catch (err: any) {
        toast.error(err?.message ?? 'Gagal menghapus posisi.');
        throw err;
      }
    },
    [fetchPositions, search, safePage],
  );

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  function triggerFetch(
    searchVal: string,
    pageVal: number,
    dept: string = departmentFilter,
    div: string = divisionFilter,
    prog: string = programFilter,
    bench: PositionBenchKey | null = benchFilter,
    band: ReadinessBandKey | null = bandFilter,
    flag: PositionFlagKey | null = flagFilter,
  ) {
    // Deliberately NOT clearing the list first: blanking it drops the table to
    // zero height, the page jumps, and for the ~300ms of a page change the user
    // is looking at an empty result that reads like "nothing found". The stale
    // rows stay, dimmed, until the new ones replace them.
    fetchPositions(searchVal, pageVal, dept, div, prog, bench, band, flag);
  }

  /**
   * Toggle one of the summary-line drill-downs.
   *
   * Goes through the URL like the dashboard drill-downs do, and for the same
   * reason: a filtered list has to survive a refresh and be sendable to someone
   * else. Clicking the active line clears it, so the control that got you here
   * is also the way out — there is no separate dismiss to hunt for.
   */
  function toggleFlag(next: PositionFlagKey) {
    const value = flagFilter === next ? null : next;
    setFlagFilter(value);
    setPage(1);
    triggerFetch(search, 1, departmentFilter, divisionFilter, programFilter, benchFilter, bandFilter, value);
    const params = new URLSearchParams(window.location.search);
    if (value) params.set('flag', value);
    else params.delete('flag');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `/positions?${qs}` : '/positions');
  }

  /**
   * Toggle one bench state. Goes through the URL like every other drill-down
   * here, so a filtered list survives a refresh and can be sent to someone
   * else, and clicking the active tile clears it — the control that got you
   * here is the way out.
   */
  function toggleBench(next: PositionBenchKey) {
    const value = benchFilter === next ? null : next;
    setBenchFilter(value);
    setPage(1);
    triggerFetch(search, 1, departmentFilter, divisionFilter, programFilter, value, bandFilter, flagFilter);
    const params = new URLSearchParams(window.location.search);
    // `readiness` is the dashboard's older spelling of the same predicate;
    // leaving it behind would let it win on the next refresh.
    params.delete('readiness');
    if (value) params.set('bench', value);
    else params.delete('bench');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `/positions?${qs}` : '/positions');
  }

  /** Drop every drill-down and reload the unfiltered list. */
  function clearDrillDown() {
    setBenchFilter(null);
    setBandFilter(null);
    setFlagFilter(null);
    setPage(1);
    triggerFetch(search, 1, departmentFilter, divisionFilter, programFilter, null, null, null);
    // Keep the URL honest so a refresh doesn't reinstate the filter.
    window.history.replaceState(null, '', '/positions');
  }

  return (
    <>
      <DashboardHeader
        title="Manajemen Posisi"
        actions={
          <div className="flex items-center gap-2">
            {/* Positions are real records; demo mode never writes them (the server
                refuses too), so their write controls are not offered there. */}
            {!demo && (
            <PositionFormDialog
              title="Tambah posisi"
              description="Masukkan pejabat yang akan digantikan (incumbent)."
              submitLabel="Simpan posisi"
              action={handleCreatePosition}
              positions={masterPositions}
              candidates={initialCandidates}
              gradeLevels={gradeLevels}
              programs={programs}
              trigger={
                <Button size="sm">
                  <Plus className="mr-1 h-4 w-4" />
                  Tambah
                </Button>
              }
            />
            )}

            {!demo && (
            <PositionsBulkAddDialog
              programs={programs}
              onDone={() => {
                setPage(1);
                triggerFetch(search, 1);
              }}
              trigger={
                <Button size="sm" variant="outline">
                  <Layers className="mr-1 h-4 w-4" />
                  Tambah Batch
                </Button>
              }
            />
            )}

            <PositionsRescoreDialog
              programs={programs}
              onDone={() => {
                setPage(1);
                triggerFetch(search, 1);
              }}
              trigger={
                <Button size="sm" variant="outline">
                  <RotateCcw className="mr-1 h-4 w-4" />
                  Scoring Ulang
                </Button>
              }
            />

            {/* "Reset Scoring" is built and working — components/positions-reset-scoring-dialog.tsx
                + resetProgramScoringAction — but deliberately NOT surfaced: it is the
                only irreversible action on this page and is not needed day to day.
                Import PositionsResetScoringDialog and render it here to bring it back. */}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full space-y-6 p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <Card className="border-primary/25 bg-linear-to-br from-primary/10 via-card to-card py-4">
              <CardContent>
                <div className="flex items-center justify-between">
                  <BriefcaseIcon className="h-5 w-5 text-primary" weight="duotone" />
                  <InfoTip content="Semua posisi otomatis aktif dan siap dipakai untuk perhitungan." />
                </div>
                <p className="mt-3 text-3xl font-semibold">{total}</p>
                <p className="mt-1 text-sm text-muted-foreground">Total posisi</p>
              </CardContent>
            </Card>

            {/* Replaces the old "Coverage readiness %" card. One percentage
                could not say whether a thin bench means the people are not
                ready or nobody has looked yet, and those have opposite fixes —
                so the three states are named, counted over the whole filtered
                set, and each one is the filter for its own list. */}
            <Card className="py-4">
              <CardContent>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <TargetIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" weight="duotone" />
                    <div>
                      <p className="text-sm font-semibold leading-tight">Kesiapan suksesor</p>
                      <p className="text-[11px] text-muted-foreground">
                        {benchTotal} posisi sesuai filter saat ini
                      </p>
                    </div>
                  </div>
                  <InfoTip content="Dihitung dari run terakhir yang selesai di setiap posisi. Siap = readiness Short atau Medium. Angkanya mencakup seluruh posisi yang cocok dengan pencarian dan filter, bukan hanya yang tampil di halaman ini. Klik salah satu status untuk menyaring daftar." />
                </div>

                {benchTotal > 0 ? (
                  <>
                    {/* One bar, three segments — the proportion is the thing
                        the old percentage was reaching for, and here it can be
                        read without being reduced to a single number. */}
                    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
                      {BENCH_ORDER.map((key) =>
                        benchCounts[key] > 0 ? (
                          <div
                            key={key}
                            className={benchMeta[key].bar}
                            style={{ width: `${(benchCounts[key] / benchTotal) * 100}%` }}
                          />
                        ) : null,
                      )}
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {BENCH_ORDER.map((key) => {
                        const meta = benchMeta[key];
                        const count = benchCounts[key];
                        const active = benchFilter === key;
                        const share = Math.round((count / benchTotal) * 100);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleBench(key)}
                            aria-pressed={active}
                            title={`${meta.label} — ${meta.hint}`}
                            className={cn(
                              'rounded-xl border p-3 text-left transition-all',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                              meta.tile,
                              active && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                            )}
                          >
                            <div className="flex items-baseline gap-1.5">
                              <span className={cn('text-2xl font-semibold tabular-nums', meta.text)}>{count}</span>
                              <span className="text-[11px] font-medium text-muted-foreground tabular-nums">{share}%</span>
                            </div>
                            <p className="mt-0.5 text-xs font-medium leading-snug">{meta.label}</p>
                            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{meta.hint}</p>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Belum ada posisi yang cocok dengan filter saat ini.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-sky-200/60 bg-linear-to-r from-sky-500/5 via-card to-card dark:border-sky-900/60">
            <CardContent className="grid gap-3 pt-0 lg:grid-cols-[1.5fr_200px_200px]">
              <div className="relative">
                <MagnifyingGlassIcon
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-600 dark:text-sky-400"
                  weight="duotone"
                />
                <Input
                  value={search}
                  onChange={(event) => {
                    const val = event.target.value;
                    setSearch(val);
                    clearTimeout(debounceRef.current);
                    debounceRef.current = setTimeout(() => {
                      setPage(1);
                      triggerFetch(val, 1);
                    }, 300);
                  }}
                  placeholder="Cari posisi, current holder, departemen, atau divisi"
                  className="border-sky-200/60 bg-white/80 pl-9 dark:border-sky-900/60 dark:bg-slate-950/40"
                />
              </div>

              <Combobox
                value={divisionFilter}
                onValueChange={(value: string) => {
                  setDivisionFilter(value);
                  setPage(1);
                  triggerFetch(search, 1, departmentFilter, value);
                }}
                options={[
                  { value: '', label: 'Semua Divisi' },
                  ...divisionsList.map((div) => ({ value: div, label: div })),
                ]}
                placeholder="Semua Divisi"
                searchPlaceholder="Cari divisi..."
                emptyText="Divisi tidak ditemukan."
                triggerPrefix={<Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />}
                triggerClassName="justify-start w-full border-sky-200/60 dark:border-sky-900/60"
                className="w-md"
              />

              <Combobox
                value={departmentFilter}
                onValueChange={(value: string) => {
                  setDepartmentFilter(value);
                  setPage(1);
                  triggerFetch(search, 1, value, divisionFilter);
                }}
                options={[
                  { value: '', label: 'Semua Departemen' },
                  ...departmentsList.map((dept) => ({ value: dept, label: dept })),
                ]}
                placeholder="Semua Departemen"
                searchPlaceholder="Cari departemen..."
                emptyText="Departemen tidak ditemukan."
                triggerPrefix={<Layers className="h-4 w-4 shrink-0 text-muted-foreground" />}
                triggerClassName="justify-start w-full border-sky-200/60 dark:border-sky-900/60"
                className="w-md"
              />
            </CardContent>
          </Card>

          {/* Program filter.
              These chips filter the POSITION LIST, not the runs — a position
              belongs to exactly one program, so choosing one here narrows which
              seats are listed. That is worth stating: the row also shows each
              position's latest run with its own program label, so "filter by
              program" plausibly reads as "show runs of this program", which it
              is not. Hence an explicit "Semua program" chip too, rather than
              leaving "no filter" as the invisible state you reach by clicking
              the active chip again. */}
          {programsList.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <TargetIcon className="h-3.5 w-3.5" weight="bold" />
                Program posisi
                <InfoTip
                  side="bottom"
                  content="Setiap posisi terdaftar di tepat satu program suksesi, dan filter ini memilih posisi berdasarkan program tersebut — bukan berdasarkan program run-nya. Sebuah posisi bisa punya run lama dari program lain; run itu tetap memakai label programnya sendiri dan ditandai di kolom Hasil Run Terbaru."
                />
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!programFilter) return;
                  setProgramFilter('');
                  setPage(1);
                  triggerFetch(search, 1, departmentFilter, divisionFilter, '');
                }}
                aria-pressed={!programFilter}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
                  !programFilter
                    ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/20'
                    : 'border-slate-200/60 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900/40',
                )}
              >
                Semua program
              </button>
              {programsList.map((prog) => {
                const active = programFilter === prog;
                return (
                  <button
                    key={prog}
                    type="button"
                    onClick={() => {
                      const next = active ? '' : prog;
                      setProgramFilter(next);
                      setPage(1);
                      triggerFetch(search, 1, departmentFilter, divisionFilter, next);
                    }}
                    aria-pressed={active}
                    title={active ? `Hanya posisi program ${programLabel(prog)} — klik untuk menampilkan semua` : `Tampilkan hanya posisi program ${programLabel(prog)}`}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
                      active
                        ? `${programTone[prog] ?? 'border-primary bg-primary/10 text-primary'} ring-1 ring-primary/20`
                        : 'border-slate-200/60 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900/40',
                    )}
                  >
                    {programLabel(prog)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Drill-down chip — tells the user why the list is short, and how to undo it. */}
          {(benchFilter || bandFilter) && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Daftar sedang disaring
              </span>
              {benchFilter && (
                <Badge variant="outline" className={cn('border-current/30', benchMeta[benchFilter].text)}>
                  {benchMeta[benchFilter].label} · {benchMeta[benchFilter].hint}
                </Badge>
              )}
              {bandFilter && (
                <Badge variant="outline" className={bandChipMeta[bandFilter].tone}>
                  {bandChipMeta[bandFilter].label} · {bandChipMeta[bandFilter].hint}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2 text-xs"
                onClick={clearDrillDown}
              >
                Tampilkan semua posisi
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {loading ? (
              <span
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-sm font-medium text-primary"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat posisi...
              </span>
            ) : (
              <span>
                {total == 0
                  ? 'Tidak ada posisi ditemukan'
                  : `Menampilkan ${Math.min((safePage - 1) * PAGE_SIZE + 1, total)}-${Math.min(safePage * PAGE_SIZE, total)} dari ${total} posisi`}
              </span>
            )}
            {/* Each of these is both a finding and a filter. They report states
                that are invisible until you open a row — no job profile, a
                holder past their retirement threshold, a ranking nobody acted
                on — so the next thing a reader wants is that subset, and the
                sentence they just read is the most obvious thing to click.
                Counts come from the server over the whole filtered set; see the
                note on `flagCounts`. */}
            {POSITION_FLAG_META.map((meta) => {
              const count = flagCounts[meta.key];
              const active = flagFilter === meta.key;
              // A zero is worth nothing to read, but while its filter is ON the
              // line must stay — it is the only way back out.
              if (count === 0 && !active) return null;
              return (
                <button
                  key={meta.key}
                  type="button"
                  onClick={() => toggleFlag(meta.key)}
                  aria-pressed={active}
                  title={`${meta.hint}\n\n${active ? 'Klik untuk menampilkan semua posisi lagi.' : 'Klik untuk menyaring daftar ke posisi ini saja.'}`}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs transition-colors',
                    meta.tone,
                    active ? cn('font-semibold', meta.activeTone) : meta.hoverTone,
                  )}
                >
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  {active ? meta.active : meta.count(count)}
                  {active && <span aria-hidden className="ml-0.5 font-bold">×</span>}
                </button>
              );
            })}
          </div>

          
          <Card
            className={cn(
              'hidden border-slate-200/70 shadow-xs transition-opacity xl:block dark:border-slate-800/80',
              loading && 'pointer-events-none opacity-50',
            )}
          >
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Positions</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200/70 bg-slate-50/80 dark:border-slate-800/80 dark:bg-slate-900/50">
                    <TableHead className="w-[36%] text-slate-600 dark:text-slate-300">Posisi & Holder</TableHead>
                    <TableHead className="w-[23%] text-slate-600 dark:text-slate-300">Readiness Pipeline</TableHead>
                    <TableHead className="w-[31%] text-slate-600 dark:text-slate-300">
                      RTC · Suksesor Terpilih
                    </TableHead>
                    <TableHead className="w-[10%] text-right text-slate-600 dark:text-slate-300">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.length === 0 && loading && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
                        Memuat posisi...
                      </TableCell>
                    </TableRow>
                  )}
                  {positions.map((position) => {
                    const topCandidate = position.topCandidates?.[0];
                    const hasScoring = Boolean(topCandidate);
                    const isScoring = position.scoringInProgress && !hasScoring;
                    const coverage = position.readinessCoverage;
                    const chosenCount = position.chosenCandidates?.length ?? 0;
                    // Scored, but nobody has been named yet — a ranking exists
                    // and the decision it exists for has not been made. Easy to
                    // lose track of across dozens of positions.
                    const needsPick = hasScoring && chosenCount === 0;
                    const { retiring, active: activeHolders, allRetiring } = splitHolders(position.holders);

                    const run = position.latestRun;

                    return (
                      <Fragment key={position.id}>
                        {/* Header sub-row: position · run-terbaru header (spans the 2 result columns) · actions */}
                        <TableRow className="border-0 transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-900/30">
                          <TableCell rowSpan={2} className="border-b border-slate-200/60 align-top dark:border-slate-800/70">
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <Link href={`/positions/${position.id}`} className="font-medium hover:text-primary underline transition-all">
                                  {position.title}
                                </Link>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {position.department}<br />
                                  {position.division}
                                </p>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <ProgramBadge
                                code={position.programCode}
                                name={position.programName}
                                label={programLabel}
                              />
                              <BadgeDivider />
                              {isScoring && (
                                <Badge
                                  variant="outline"
                                  className="font-normal text-[10px] border-blue-300/70 bg-blue-500/10 text-blue-700 dark:border-blue-800 dark:text-blue-300"
                                >
                                  Sedang scoring...
                                </Badge>
                              )}
                              {position.jobProfileId == null && (
                                <Badge
                                  variant="outline"
                                  className="font-normal text-[10px] border-amber-300/70 bg-amber-500/10 text-amber-700 dark:border-amber-800 dark:text-amber-300"
                                  title={NO_JD_HINT}
                                >
                                  Tanpa job profile
                                </Badge>
                              )}
                              {retiring.length > 0 && (
                                <Badge
                                  variant="outline"
                                  className="font-normal text-[10px] border-rose-300/70 bg-rose-500/10 text-rose-700 dark:border-rose-800 dark:text-rose-300"
                                  title={
                                    `Mendekati usia pensiun: ${retirementSummary(retiring)}` +
                                    // Without this the badge beside it simply
                                    // vanishes and the seat reads as having no
                                    // incumbent at all.
                                    (allRetiring
                                      ? '\n\nSemua pejabat aktif posisi ini ada di daftar ini, jadi tidak ada badge Holder terpisah.'
                                      : '')
                                  }
                                >
                                  {retiring.length === 1
                                    ? `Pensiun: ${retiring[0]!.name || 'pejabat'}${retiring[0]!.age != null ? ` (${retiring[0]!.age})` : ''}`
                                    : `${retiring.length} pejabat mendekati pensiun`}
                                </Badge>
                              )}
                              {/* Only the incumbents NOT already named by the
                                  retiring badge. A non-unique role has several sitting
                                  holders, so this names the most senior remaining one
                                  and counts the rest. Nothing renders when every
                                  incumbent is retiring — they are all in the badge
                                  above, and repeating them here was the duplication
                                  this split exists to remove. */}
                              {activeHolders.length > 0 && (
                                <Badge
                                  variant="outline"
                                  className="font-normal text-[10px] border-sky-200/60 bg-sky-500/5 text-sky-700 dark:border-sky-900/60 dark:bg-sky-500/10 dark:text-sky-300"
                                  title={
                                    holderNames(activeHolders) +
                                    (retiring.length > 0
                                      ? `\n\n${retiring.length} pejabat lain mendekati pensiun — lihat badge Pensiun.`
                                      : '')
                                  }
                                >
                                  <span className="text-[9px] text-muted-foreground mr-0.5">Holder: </span>
                                  {activeHolders[0]!.name}
                                  {activeHolders.length > 1 && (
                                    <span className="ml-1 text-[9px] text-muted-foreground">
                                      +{activeHolders.length - 1} lainnya
                                    </span>
                                  )}
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          {/* Run terbaru — header spanning Readiness Pipeline + Top Candidate */}
                          <TableCell colSpan={2} className="pb-1.5 pt-3 align-bottom">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Hasil Run Terbaru
                              </span>
                              {run ? (
                                <>
                                  <Badge variant="outline" className={`font-normal text-[9px] ${getMethodMeta(run.method).tone}`}>
                                    {getMethodMeta(run.method).label}
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground">
                                    · {formatRunDate(run.createdAt)}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[10px] italic text-muted-foreground/70">belum ada run</span>
                              )}
                            </div>
                          </TableCell>

                          <TableCell rowSpan={2} className="border-b border-slate-200/60 align-top dark:border-slate-800/70">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Mulai Scoring" asChild>
                                <Link href={`/scoring/new?positionId=${position.id}`}>
                                  <Calculator className="h-4 w-4" />
                                </Link>
                              </Button>
                              {!demo && (
                              <>
                              <PositionFormDialog
                                title="Ubah posisi"
                                description="Perbarui data inti posisi yang tersimpan di database."
                                submitLabel="Simpan perubahan"
                                action={handleUpdatePosition}
                                position={position}
                                positions={initialPositions}
                                candidates={initialCandidates}
                                gradeLevels={gradeLevels}
                                programs={programs}
                                trigger={
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                }
                              />
                              <DeleteConfirmDialog
                                title="Hapus posisi"
                                description={`Hapus posisi ${position.title}? Tindakan ini tidak bisa dibatalkan.`}
                                confirmLabel="Hapus posisi"
                                action={handleDeletePosition}
                                itemId={position.id}
                                trigger={
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                }
                              />
                              </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Data sub-row: readiness pipeline + top candidate (both from the latest run) */}
                        <TableRow className="border-slate-200/60 transition-colors hover:bg-slate-50/60 dark:border-slate-800/70 dark:hover:bg-slate-900/30">
                          <TableCell className="pt-0 align-top">
                            <div className="space-y-2">
                              <div className="flex items-center gap-3 text-xs">
                                <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{position.readyNow}</span>
                                <span className="text-muted-foreground">siap dari</span>
                                <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{position.candidates}</span>
                                <span className="text-muted-foreground">kandidat</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 rounded-full bg-muted">
                                  <div
                                    className={`h-full rounded-full ${getCoverageBarColor(coverage)}`}
                                    style={{ width: `${Math.min(coverage, 100)}%` }}
                                  />
                                </div>
                                <span className={`shrink-0 text-xs font-semibold tabular-nums ${getCoverageTone(coverage)}`}>
                                  {coverage}%
                                </span>
                              </div>
                              <p className="text-[10px] text-muted-foreground">Readiness coverage</p>
                            </div>
                          </TableCell>

                          {/* RTC — Replacement Table Chart: how many successors
                              have actually been CHOSEN for this seat. The old
                              "top candidate" showed the highest-ranked person,
                              which is an output of the last run rather than a
                              decision; a bench is only real once somebody picks. */}
                          <TableCell className="pt-0 align-top">
                            <div className="space-y-1.5">
                              {chosenCount > 0 && (
                              <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-100">
                                  {chosenCount}
                                </span>
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                  suksesor terpilih
                                </span>
                              </div>
                              )}
                              {chosenCount > 0 ? (
                                <ChosenSuccessorsButton
                                  positionId={position.id}
                                  positionTitle={position.title}
                                  chosen={position.chosenCandidates ?? []}
                                  programLabel={programLabel}
                                />
                              ) : isScoring ? (
                                <p className="text-[10px] text-sky-700 dark:text-sky-300">
                                  Scoring berjalan — pilih suksesor setelah selesai.
                                </p>
                              ) : needsPick ? (
                                <div className="rounded-lg border border-amber-200/60 bg-amber-500/5 p-2 dark:border-amber-900/60 dark:bg-amber-500/10">
                                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                                    Sudah scoring, kandidat final belum dipilih
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    Buka hasil run lalu tetapkan suksesornya.
                                  </p>
                                </div>
                              ) : (
                                <div className="rounded-lg border border-amber-200/60 bg-amber-500/5 p-2 dark:border-amber-900/60 dark:bg-amber-500/10">
                                <p className="text-[10px] text-muted-foreground">
                                  Belum scoring — jalankan scoring dulu.
                                </p>
                              </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1 || loading}
                onClick={() => {
                  const next = Math.max(1, safePage - 1);
                  setPage(next);
                  triggerFetch(search, next);
                }}
              >
                <CaretLeftIcon className="h-4 w-4" weight="bold" />
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums">
                {safePage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages || loading}
                onClick={() => {
                  const next = Math.min(totalPages, safePage + 1);
                  setPage(next);
                  triggerFetch(search, next);
                }}
              >
                <CaretRightIcon className="h-4 w-4" weight="bold" />
              </Button>
            </div>
          )}

          <div className={cn('space-y-3 transition-opacity xl:hidden', loading && 'pointer-events-none opacity-50')}>
            {positions.map((position) => {
              const topCandidate = position.topCandidates?.[0];
              const isScoring = position.scoringInProgress && !topCandidate;
              const coverage = position.readinessCoverage;
              const chosenCount = position.chosenCandidates?.length ?? 0;
              const needsPick = Boolean(topCandidate) && chosenCount === 0;
              const { retiring, active: activeHolders, allRetiring } = splitHolders(position.holders);

              return (
                <div key={position.id} className="rounded-2xl border border-slate-200/70 bg-linear-to-br from-white to-slate-50/80 p-4 shadow-xs transition-colors hover:bg-muted/50 dark:border-slate-800/80 dark:from-slate-950 dark:to-slate-900/80">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/positions/${position.id}`} className="truncate font-medium hover:text-primary">
                          {position.title}
                        </Link>
                        <ProgramBadge
                          code={position.programCode}
                          name={position.programName}
                          label={programLabel}
                        />
                        <BadgeDivider />
                        <Badge variant="outline" className={`font-normal ${getStatusTone(Boolean(topCandidate), isScoring)}`}>
                          {topCandidate ? 'Sudah scoring' : isScoring ? 'Sedang scoring...' : 'Belum scoring'}
                        </Badge>
                        {position.jobProfileId == null && (
                          <Badge
                            variant="outline"
                            className="font-normal text-[10px] border-amber-300/70 bg-amber-500/10 text-amber-700 dark:border-amber-800 dark:text-amber-300"
                            title={NO_JD_HINT}
                          >
                            Tanpa job profile
                          </Badge>
                        )}
                        {retiring.length > 0 && (
                          <Badge
                            variant="outline"
                            className="font-normal text-[10px] border-rose-300/70 bg-rose-500/10 text-rose-700 dark:border-rose-800 dark:text-rose-300"
                            title={`Mendekati usia pensiun: ${retirementSummary(retiring)}`}
                          >
                            {retiring.length === 1 ? 'Pejabat mendekati pensiun' : `${retiring.length} pejabat mendekati pensiun`}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {position.department} · {position.division}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border bg-muted/20 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Holder</p>
                      {/* The retiring line below already names its people, so the
                          main line covers only the incumbents it does not. When
                          they are all retiring there is nobody left to lead with
                          and the panel says so instead of repeating a name. */}
                      {activeHolders.length > 0 ? (
                        <>
                          <p className="mt-1 truncate text-sm font-medium">{activeHolders[0]!.name}</p>
                          {activeHolders[0]!.employeeId && (
                            <p className="text-[10px] text-muted-foreground">{activeHolders[0]!.employeeId}</p>
                          )}
                          {activeHolders.length > 1 && (
                            <p
                              className="text-[10px] text-muted-foreground"
                              title={holderNames(activeHolders)}
                            >
                              +{activeHolders.length - 1} pejabat lainnya
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="mt-1 text-sm font-medium text-muted-foreground">
                          {allRetiring ? 'Semua mendekati pensiun' : 'Belum diisi'}
                        </p>
                      )}
                      {retiring.length > 0 && (
                        <p className="mt-1 text-[10px] leading-normal text-rose-700 dark:text-rose-300">
                          Mendekati pensiun: {retirementSummary(retiring)}
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl border bg-muted/20 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</p>
                      <p className="mt-1 text-sm font-medium">
                        <span className="font-semibold tabular-nums">{position.readyNow}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="font-semibold tabular-nums">{position.candidates}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">siap dari total kandidat</p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">Readiness coverage</span>
                      <span className={`font-semibold tabular-nums ${getCoverageTone(coverage)}`}>{coverage}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div className={`h-full rounded-full ${getCoverageBarColor(coverage)}`} style={{ width: `${Math.min(coverage, 100)}%` }} />
                    </div>
                  </div>

                  {/* RTC — the count of successors actually chosen, replacing
                      the old top-candidate preview (a run output, not a decision). */}
                  <div className="mt-3 rounded-xl border border-emerald-200/70 bg-linear-to-r from-emerald-500/10 to-transparent p-3 dark:border-emerald-900/60 dark:from-emerald-500/15">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        RTC · Suksesor terpilih
                      </p>
                      {position.latestRun && (
                        <>
                          <span className="text-muted-foreground/50">·</span>
                          <Badge variant="outline" className={`font-normal text-[9px] ${getMethodMeta(position.latestRun.method).tone}`}>
                            {getMethodMeta(position.latestRun.method).label}
                          </Badge>
                          <span className="text-[9px] text-muted-foreground">
                            · {formatRunDate(position.latestRun.createdAt)}
                          </span>
                        </>
                      )}
                    </div>
                    {chosenCount > 0 && (
                    <p className="mt-1 text-2xl font-semibold tabular-nums leading-none">{chosenCount}</p>
                    )}
                    {chosenCount > 0 ? (
                      <div className="mt-2">
                        <ChosenSuccessorsButton
                          positionId={position.id}
                          positionTitle={position.title}
                          chosen={position.chosenCandidates ?? []}
                          programLabel={programLabel}
                        />
                      </div>
                    ) : needsPick ? (
                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                        Sudah scoring, belum ada suksesor dipilih — buka hasil run lalu tetapkan suksesornya.
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Belum ada suksesor yang ditetapkan untuk posisi ini.
                      </p>
                    )}
                  </div>

                  {isScoring && (
                    <div className="mt-3 rounded-xl border border-sky-200/70 bg-sky-500/5 p-3 dark:border-sky-900/60 dark:bg-sky-500/10">
                      <p className="text-sm font-medium text-sky-700 dark:text-sky-300">Scoring sedang berjalan</p>
                      <p className="text-xs text-muted-foreground">Hasil akan muncul setelah scoring selesai diproses.</p>
                    </div>
                  )}

                  {!topCandidate && !isScoring && (
                    <div className="mt-3 rounded-xl border border-amber-200/70 bg-linear-to-r from-amber-500/10 to-transparent p-3 dark:border-amber-900/60 dark:from-amber-500/15">
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Belum ada hasil scoring</p>
                      <p className="text-xs text-muted-foreground">Detail kandidat akan muncul setelah scoring dijalankan.</p>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Mulai Scoring" asChild>
                      <Link href={`/scoring/new?positionId=${position.id}`}>
                        <Calculator className="h-4 w-4" />
                      </Link>
                    </Button>
                    {!demo && (
                    <>
                    <PositionFormDialog
                      title="Ubah posisi"
                      description="Perbarui data inti posisi yang tersimpan di database."
                      submitLabel="Simpan perubahan"
                      action={handleUpdatePosition}
                      position={position}
                      positions={initialPositions}
                      candidates={initialCandidates}
                      gradeLevels={gradeLevels}
                      programs={programs}
                      trigger={
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      }
                    />
                    <DeleteConfirmDialog
                      title="Hapus posisi"
                      description={`Hapus posisi ${position.title}? Tindakan ini tidak bisa dibatalkan.`}
                      confirmLabel="Hapus posisi"
                      action={handleDeletePosition}
                      itemId={position.id}
                      trigger={
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      }
                    />
                    </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
