"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { startOfMonth, endOfMonth } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  CalendarIcon,
  GitBranch,
  List,
  Loader2,
  Trash2,
  UserPlus,
} from "lucide-react";
import { NewRootRunButton } from "@/components/new-root-run-dialog";
import { RunProgressStages } from "@/components/run-progress-stages";
import { RunTree as RunTreeView } from "@/components/analysis/run-tree";
import type { RunTree } from "@/lib/run-tree-actions";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import { formatDate, formatDateTime, toDayKey } from '@/lib/datetime';

export type RunRow = {
  id: string;
  label: string | null;
  program: string | null;
  method: string;
  status: string;
  candidateCount: number;
  createdAt: string;
  completedAt: string | null;
  /** Settings snapshot written at run creation (subset used for display) */
  filterSummary?: {
    minGradeId?: string | null;
    maxGradeId?: string | null;
    /** Everyone looked at BEFORE the program filters ran. */
    totalEvaluated?: number;
    /**
     * Everyone who cleared the filters and was actually scored — the run's real
     * alternative set, and what both re-run modes are sized against. Absent on
     * runs written before this field existed.
     */
    qualifiedCount?: number;
  } | null;
  /** Set when the run stopped before finishing (FR-RR-12) — never shown as "Berjalan". */
  failure?: { kind: "error" | "cancelled"; message: string } | null;
};

interface PositionRunTableProps {
  positionId: string;
  positionTitle: string;
  runs: RunRow[];
  availablePrograms: string[];
  selectedRunId: string | null;
  qualifiedCount: number;
  readinessCoverage: number;
  /** Opens "Tambah Kandidat Pembanding"; absent when the selected run cannot take it. */
  onAddCandidates?: () => void;
  /** Why the selected run cannot take comparison candidates (shown in the action's place). */
  rerunBlockedReason?: string | null;
  defaultProgram?: string;
  defaultDateFrom?: string;
  defaultDateTo?: string;
  /** Grade level lookup (gradeId → levelName) for the run's grade range */
  gradeLevels?: { gradeId: string; levelName: string | null }[];
  /** Program code → display name (from tenant program templates) */
  programLabels?: Record<string, string>;
  /** Lineage forest for the "Silsilah" view; null while loading. */
  tree?: RunTree | null;
  /** Runs the active date/program filter is hiding — dimmed, never dropped. */
  filteredOutIds?: Set<string>;
  onSelectRun?: (runId: string) => void;
}

/** Fallback labels for the built-in program codes. */
const defaultProgramLabels: Record<string, string> = {
  talent: "Talent Pool",
  successor: "Critical Position",
  emergency: "Emergency Position",
};

/** Friendly names for the scoring-method codes stored on a run. */
const methodLabels: Record<string, string> = {
  AHP_TOPSIS: "AHP + TOPSIS",
};

const methodLabel = (method: string): string =>
  methodLabels[method] ?? methodLabels[method?.toUpperCase()] ?? method;

const programTone: Record<string, string> = {
  talent:
    "border-sky-300 bg-sky-500/10 text-sky-700 dark:border-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  successor:
    "border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  emergency:
    "border-amber-300 bg-amber-500/10 text-amber-700 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
};

export function PositionRunTable({
  positionId,
  positionTitle,
  runs,
  availablePrograms,
  selectedRunId,
  qualifiedCount,
  readinessCoverage,
  onAddCandidates,
  rerunBlockedReason = null,
  defaultProgram = "",
  defaultDateFrom = "",
  defaultDateTo = "",
  gradeLevels = [],
  programLabels = {},
  tree,
  filteredOutIds,
  onSelectRun,
}: PositionRunTableProps) {
  const router = useRouter();
  const [view, setView] = useState<'list' | 'tree'>('list');

  const programLabel = (code: string): string =>
    programLabels[code] ?? defaultProgramLabels[code] ?? code;

  // gradeId → levelName lookup; also keyed by numeric form ("5a" → "5")
  // so stored IDs match even when the letter suffix differs.
  const gradeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of gradeLevels) {
      if (!g.levelName) continue;
      if (!map.has(g.gradeId)) map.set(g.gradeId, g.levelName);
      const numeric = String(parseInt(g.gradeId, 10));
      if (numeric !== "NaN" && !map.has(numeric)) map.set(numeric, g.levelName);
    }
    return map;
  }, [gradeLevels]);

  const resolveGradeName = (id: string): string =>
    gradeNameMap.get(id) ??
    gradeNameMap.get(String(parseInt(id, 10))) ??
    `Level ${id}`;

  /** Human label for the grade range a run was scored with. */
  function gradeRangeLabel(filterSummary: RunRow["filterSummary"]): string | null {
    const min = filterSummary?.minGradeId ?? null;
    const max = filterSummary?.maxGradeId ?? null;
    if (!min && !max) return null;
    if (min && max) {
      const minName = resolveGradeName(min);
      const maxName = resolveGradeName(max);
      return minName === maxName ? minName : `${minName} – ${maxName}`;
    }
    return min ? `≥ ${resolveGradeName(min)}` : `≤ ${resolveGradeName(max!)}`;
  }
  const [navigating, startTransition] = useTransition();
  // Which run the user just clicked, so we can show a pronounced loading state
  // on it while the new run's results are fetched. Cleared once navigation ends.
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  useEffect(() => {
    if (!navigating) setPendingRunId(null);
  }, [navigating]);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [page, setPage] = useState(0);
  const PER_PAGE = 5;

  const dateFrom = defaultDateFrom ? new Date(defaultDateFrom) : undefined;
  const dateTo = defaultDateTo ? new Date(defaultDateTo) : undefined;

  // Reset page when runs change (filters changed)
  // runs already server-filtered, page resets from URL change
  const totalPages = Math.max(1, Math.ceil(runs.length / PER_PAGE));
  const paginatedRuns = runs.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  const isDefaultMonth =
    !defaultDateFrom && !defaultDateTo && !defaultProgram;

  function buildUrl(overrides: { program?: string; dateFrom?: string; dateTo?: string; pageReset?: boolean }) {
    const params = new URLSearchParams();
    if (selectedRunId) params.set("runId", selectedRunId);
    if (overrides.program ?? defaultProgram) params.set("program", overrides.program ?? defaultProgram);
    if (overrides.dateFrom ?? defaultDateFrom) params.set("dateFrom", overrides.dateFrom ?? defaultDateFrom);
    if (overrides.dateTo ?? defaultDateTo) params.set("dateTo", overrides.dateTo ?? defaultDateTo);
    return `/positions/${positionId}?${params.toString()}`;
  }

  function handleProgramChange(value: string) {
    const program = value === "__all__" ? "" : value;
    setPage(0);
    startTransition(() => {
      router.push(buildUrl({ program, dateFrom: !program && !defaultDateFrom && !defaultDateTo ? "" : undefined }));
    });
  }

  function handleDateFromChange(date: Date | undefined) {
    setPage(0);
    startTransition(() => {
      router.push(buildUrl({ dateFrom: date ? (toDayKey(date) ?? "") : "" }));
    });
  }

  function handleDateToChange(date: Date | undefined) {
    setPage(0);
    startTransition(() => {
      router.push(buildUrl({ dateTo: date ? (toDayKey(date) ?? "") : "" }));
    });
  }

  function resetFilters() {
    setPage(0);
    startTransition(() => {
      router.push(`/positions/${positionId}?runId=${selectedRunId ?? ""}`);
    });
  }

  async function handleConfirmDelete() {
    if (!deleteTargetId) return;
    const runId = deleteTargetId;
    setDeleteTargetId(null);
    setDeletingRun(true);
    try {
      const { deleteScoringRunAction } = await import('@/lib/scoring-engine');
      const fd = new FormData();
      fd.set('id', runId);
      await deleteScoringRunAction(fd);
      toast.success('Run scoring berhasil dihapus.');
      if (runId === selectedRunId) {
        startTransition(() => router.push(`/positions/${positionId}`));
      } else {
        router.refresh();
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Gagal menghapus run.');
    } finally {
      setDeletingRun(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      {/* Run history table */}
      <Card className="col-span-2 border-slate-200/80 dark:border-slate-800 shadow-xs">
        <CardHeader className="pb-4 border-b border-slate-200/60 dark:border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-1.5 text-base font-semibold">
                Riwayat Scoring
                <InfoHint title="Riwayat Scoring">
                  <p>Pilih run untuk menampilkan hasil scoring yang sesuai.</p>
                  <p>
                    <strong>Daftar</strong> menampilkan run yang cocok dengan filter tanggal dan program;{' '}
                    <strong>Silsilah</strong> menampilkan seluruh keturunan run tanpa filter, supaya tidak ada cabang yang
                    tampak terputus.
                  </p>
                </InfoHint>
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {/* Daftar = the filtered, paginated, sortable record. Silsilah =
                  the structure. They answer different questions, so neither
                  replaces the other and the toggle keeps both one click away. */}
              <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-800 p-0.5">
                {(
                  [
                    ['list', 'Daftar', List],
                    ['tree', 'Silsilah', GitBranch],
                  ] as const
                ).map(([key, text, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setView(key)}
                    aria-pressed={view === key}
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors',
                      view === key
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {text}
                  </button>
                ))}
              </div>
              <NewRootRunButton positionId={positionId} positionTitle={positionTitle} />
              {onAddCandidates && selectedRunId ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onAddCandidates}
                  className="h-8 gap-1.5 text-xs font-semibold"
                  title="Bandingkan run ini dengan kandidat lain — run induk dibekukan, hanya himpunan kandidat yang bertambah"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Tambah Kandidat Pembanding
                </Button>
              ) : (
                selectedRunId &&
                rerunBlockedReason && (
                  // FR-RR-01: the action stays where it always is, disabled, with
                  // its reason beside it — not a tooltip, which a disabled button
                  // never fires and a touch screen never opens.
                  <div className="flex max-w-xs flex-col items-start gap-0.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled
                      aria-describedby="rerun-blocked-reason"
                      className="h-8 gap-1.5 text-xs font-semibold"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Tambah Kandidat Pembanding
                    </Button>
                    <span
                      id="rerun-blocked-reason"
                      className="line-clamp-2 text-[10px] leading-snug text-muted-foreground"
                      title={rerunBlockedReason}
                    >
                      {rerunBlockedReason}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        </CardHeader>
        {navigating && (
          <div className="h-0.5 bg-primary animate-pulse w-full" />
        )}
        <CardContent className="pt-4 flex-1 flex flex-col justify-between">
          {view === "tree" ? (
            /* The structure, not the record: unfiltered, unpaginated, and the
               only view in which a chain of reruns is legible at a glance. */
            <RunTreeView
              tree={tree ?? null}
              positionId={positionId}
              selectedRunId={selectedRunId}
              onSelect={(id) =>
                onSelectRun
                  ? onSelectRun(id)
                  : startTransition(() => router.push(`/positions/${positionId}?runId=${id}`))
              }
              filteredOutIds={filteredOutIds}
              className="-mx-6 -mb-4"
            />
          ) : (
            <>
          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {/* Date from */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 justify-start gap-1.5 text-xs font-normal",
                    !dateFrom && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="size-3.5 shrink-0" />
                  {dateFrom ? formatDate(dateFrom) : "Dari"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateFrom}
                  onSelect={handleDateFromChange}
                  autoFocus
                />
              </PopoverContent>
            </Popover>

            <span className="text-xs text-muted-foreground">—</span>

            {/* Date to */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 justify-start gap-1.5 text-xs font-normal",
                    !dateTo && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="size-3.5 shrink-0" />
                  {dateTo ? formatDate(dateTo) : "Sampai"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateTo}
                  onSelect={handleDateToChange}
                  autoFocus
                />
              </PopoverContent>
            </Popover>

            {/* Program filter */}
            <Select
              value={defaultProgram || "__all__"}
              onValueChange={handleProgramChange}
            >
              <SelectTrigger className="h-8 w-36 text-xs bg-background">
                <SelectValue placeholder="Semua program" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">
                  Semua program
                </SelectItem>
                {availablePrograms.map((p) => (
                  <SelectItem key={p} value={p} className="text-xs">
                    {programLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!isDefaultMonth && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-[11px] font-medium text-rose-600 hover:underline"
              >
                Reset
              </button>
            )}
          </div>

          {/* Table */}
          {runs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground flex-1">
              {runs.length === 0
                ? "Belum ada scoring run untuk posisi ini."
                : "Tidak ada run yang cocok dengan filter."}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
              {paginatedRuns.map((run) => {
                const isSelected = run.id === selectedRunId;
                const isPending = pendingRunId === run.id;
                // Dim other rows while a run is loading so the pending one stands out.
                const isDimmed = navigating && !isPending;
                return (
                  <button
                    key={run.id}
                    type="button"
                    disabled={navigating}
                      onClick={() => {
                        if (run.id === selectedRunId) return;
                        setPendingRunId(run.id);
                        startTransition(() => router.push(`/positions/${positionId}?runId=${run.id}`));
                      }}
                    className={`w-full flex items-center gap-4 px-3 py-3 text-left transition-all hover:bg-slate-50 dark:hover:bg-slate-900/40 ${
                      isPending
                        ? "bg-primary/10 ring-2 ring-primary/40 animate-pulse"
                        : isSelected
                          ? "bg-primary/5 ring-1 ring-primary/20"
                          : ""
                    } ${isDimmed ? "opacity-40" : ""}`}
                  >
                    {isPending ? (
                      <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                    ) : (
                      <div
                        className={`size-3 shrink-0 rounded-full border-2 ${
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-slate-300 dark:border-slate-600"
                        }`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p
                          className={`truncate text-sm font-semibold ${
                            isSelected
                              ? "text-primary"
                              : "text-slate-900 dark:text-slate-100"
                          }`}
                        >
                          {run.label ??
                            `Run ${formatDateTime(run.createdAt)}`}
                        </p>
                        {run.program && (
                          <Badge
                            className={`text-[10px] font-bold px-1.5 py-0 ${programTone[run.program] ?? "border-slate-300 bg-slate-500/10 text-slate-700"}`}
                            variant="outline"
                          >
                            {programLabel(run.program)}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatDateTime(run.createdAt)} · {methodLabel(run.method)} ·{" "}
                        {run.candidateCount} kandidat
                        {gradeRangeLabel(run.filterSummary) && (
                          <> · {gradeRangeLabel(run.filterSummary)}</>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isPending && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-bold bg-primary/15 text-primary border-primary/30"
                        >
                          <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                          Memuat hasil…
                        </Badge>
                      )}
                      {isSelected && !isPending && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-bold bg-primary/10 text-primary border-primary/20"
                        >
                          Aktif
                        </Badge>
                      )}
                      {run.status === 'in_progress' && !run.failure && (
                        <Badge variant="outline" className="text-[10px] font-bold border-amber-400/50 text-amber-700 dark:text-amber-400 bg-amber-500/5 animate-pulse">
                          <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                          Berjalan
                        </Badge>
                      )}
                      {run.failure && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold border-rose-400/60 text-rose-700 dark:text-rose-300 bg-rose-500/5"
                          title={run.failure.message}
                        >
                          <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                          {run.failure.kind === 'cancelled' ? 'Dibatalkan' : 'Gagal'}
                        </Badge>
                      )}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setDeleteTargetId(run.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setDeleteTargetId(run.id); } }}
                        className="inline-flex items-center justify-center p-1.5 rounded-md text-slate-400 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                        title="Hapus run"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {runs.length > PER_PAGE && (
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 mt-3">
              <p className="text-[11px] text-muted-foreground">
                {runs.length} run · Halaman {page + 1} dari {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-background hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  Sebelumnya
                </button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPage(i)}
                    className={`w-7 h-7 text-xs font-semibold rounded-md transition-colors ${
                      i === page
                        ? 'bg-primary text-primary-foreground'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page + 1 >= totalPages}
                  className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-background hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  Selanjutnya
                </button>
              </div>
            </div>
          )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Summary card */}
      <Card className="border-slate-200/80 dark:border-slate-800 shadow-xs">
        <CardHeader className="pb-4 border-b border-slate-200/60 dark:border-slate-800">
          <CardTitle className="flex items-center gap-1.5 text-base font-semibold">
            Ringkasan Run Aktif
            <InfoHint title="Ringkasan Run Aktif" align="end">
              Informasi run scoring yang sedang dipilih: label, program dan metode, jumlah kandidat yang diranking,
              dan cakupan readiness.
            </InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          {selectedRun ? (
            selectedRun.failure ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <AlertTriangle className="h-8 w-8 text-rose-500 mb-3" />
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {selectedRun.failure.kind === 'cancelled' ? 'Penilaian Dibatalkan' : 'Penilaian Gagal'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground max-w-xs">{selectedRun.failure.message}</p>
                <p className="mt-2 text-[11px] text-muted-foreground max-w-xs">
                  Run lain, termasuk induknya, tidak berubah.
                </p>
              </div>
            ) : selectedRun.status === 'in_progress' ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500 mb-3" />
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Scoring Sedang Berjalan
                </p>
                <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                  Hasil scoring akan muncul secara otomatis setelah proses selesai. Silakan pilih run lain dari daftar untuk melihat hasil yang sudah selesai.
                </p>
                <RunProgressStages runId={selectedRun.id} />
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-sky-200/60 dark:border-sky-900/50 p-4 bg-linear-to-br from-sky-500/8 to-card">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 dark:text-sky-300">
                    Run Aktif
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedRun.label ?? "Run terbaru"}
                  </p>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {formatDateTime(selectedRun.createdAt)}
                  </span>
                </div>
                <div className="rounded-xl border border-amber-200/60 dark:border-amber-900/50 p-4 bg-linear-to-br from-amber-500/8 to-card">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                    Program & Metode
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedRun.program ? programLabel(selectedRun.program) : "-"}
                  </p>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {methodLabel(selectedRun.method)}
                    {gradeRangeLabel(selectedRun.filterSummary) && (
                      <> · Rentang {gradeRangeLabel(selectedRun.filterSummary)}</>
                    )}
                  </span>
                </div>
                <div className="rounded-xl border border-emerald-200/60 dark:border-emerald-900/50 p-4 bg-linear-to-br from-emerald-500/8 to-card">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                    Kandidat Diranking
                  </p>
                  <p className="mt-1 text-md font-semibold text-slate-900 dark:text-slate-100">
                    {selectedRun.candidateCount}
                  </p>
                  <span className="mt-0.5 block text-[11px] text-emerald-600 dark:text-emerald-400">
                    {qualifiedCount} lolos readiness
                  </span>
                </div>
                <div className="rounded-xl border border-blue-200/60 dark:border-blue-900/50 p-4 bg-linear-to-br from-blue-500/8 to-card">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">
                    Coverage readiness
                  </p>
                  <p className="mt-1 text-md font-semibold text-slate-900 dark:text-slate-100">
                    {readinessCoverage}%
                  </p>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {qualifiedCount} kandidat qualified
                  </span>
                </div>
              </>
            )
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Belum ada run yang dipilih.
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTargetId} onOpenChange={(o) => { if (!o) setDeleteTargetId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus run scoring</AlertDialogTitle>
            <AlertDialogDescription>
              Run ini beserta seluruh hasil scoring dan riwayat chat akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">Batal</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button type="button" onClick={handleConfirmDelete} disabled={deletingRun}>
                {deletingRun ? (
                  <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Menghapus...</>
                ) : 'Hapus'}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
