'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowsDownUpIcon,
  BriefcaseIcon,
  CalendarCheckIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CakeIcon,
  CertificateIcon,
  GraduationCapIcon,
  HashIcon,
  HeartIcon,
  IdentificationBadgeIcon,
  ListDashesIcon,
  MagnifyingGlassIcon,
  RankingIcon,
  ScalesIcon,
  SquaresFourIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { Loader2, Pencil, Plus, Trash2, Building2, Layers, Eye, EyeOff, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBirthDate } from '@/lib/age';
import { CandidateFormDialog } from '@/components/candidate-form-dialog';
import { CandidateSuccessorBadge } from '@/components/candidate-successor-badge';
import { DashboardHeader } from '@/components/dashboard-header';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DeleteConfirmDialog } from '@/components/delete-confirm-dialog';
import { useIsDemoMode } from '@/components/app-mode-provider';
import { DemoBulkBar, DemoCandidateActions, DemoStateBadge } from '@/components/demo/demo-candidate-actions';
import { Checkbox } from '@/components/ui/checkbox';
import { MASKED_CODE } from '@/lib/app-mode-shared';
import {
  createCandidateAction,
  deleteCandidateAction,
  updateCandidateAction,
} from '@/lib/pulse-crud-actions';
import { getFilteredCandidatesAction } from '@/lib/pulse-actions';
import { getHavQuadrantLabel, formatHavQuadrant } from '@/lib/hav-quadrant';
import { HAV_SOURCE_LABEL } from '@/lib/hav-effective';
import { type CandidateProfile } from '@/lib/talent-data';
import type { CandidateSuccessorFilter, CandidateSuccessorSeat } from '@/lib/pulse-data';
import { formatHistoryDate } from '@/lib/datetime';

type CandidateLevelOption = { level: string };

const PAGE_SIZE_CARDS = 8;
const PAGE_SIZE_TABLE = 20;

/** Per-tab persistence for the reveal toggle; clears when the tab closes. */
const MASK_STORAGE_KEY = 'pulse:candidates:masked';

/**
 * Redacted placeholder. Candidate data is masked by default — only name and
 * current position stay readable until the user explicitly reveals the rest.
 */
function Mask({ w = 5 }: { w?: number }) {
  return (
    <span
      className="select-none align-middle tracking-[0.2em] text-muted-foreground/60"
      title="Data disamarkan — klik ikon mata untuk menampilkan"
      aria-label="Data disamarkan"
    >
      {'•'.repeat(w)}
    </span>
  );
}

interface CandidatesPageClientProps {
  initialCandidates: CandidateProfile[];
  initialTotal: number;
  /** Seats each candidate on the first page has been picked for (position_picks). */
  initialSuccessorSeats?: Record<string, CandidateSuccessorSeat[]>;
  masterDepartments?: string[];
  masterDivisions?: string[];
  masterPositions?: string[];
  masterCompetencies?: { technicalId: string; technicalName: string }[];
  levelOptions?: CandidateLevelOption[];
}

export function CandidatesPageClient({
  initialCandidates,
  initialTotal,
  initialSuccessorSeats = {},
  masterDepartments = [],
  masterDivisions = [],
  masterPositions = [],
  masterCompetencies = [],
  levelOptions = [],
}: CandidatesPageClientProps) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [total, setTotal] = useState(initialTotal);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'department'>('name');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [successorFilter, setSuccessorFilter] = useState<CandidateSuccessorFilter | ''>('');
  // Keyed by candidate id and replaced on every fetch together with the list,
  // so a row can never show the seats of whoever sat in that slot last page.
  const [successorSeats, setSuccessorSeats] = useState(initialSuccessorSeats);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  // Privacy: everything except name + current position starts hidden.
  const [masked, setMasked] = useState(true);
  // Demo mode (lib/demo/): Edit / Turnoff / Reload instead of Edit / Delete,
  // NPKs masked whatever the reveal toggle says, and an ON/OFF filter plus a
  // selection for bulk actions — every candidate starts OFF in demo mode.
  const demo = useIsDemoMode();
  const [demoState, setDemoState] = useState<'' | 'on' | 'off'>('');
  const demoStateRef = useRef<'' | 'on' | 'off'>('');
  const [demoSelected, setDemoSelected] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [expandedPaId, setExpandedPaId] = useState<string | null>(null);
  const [expandedTechId, setExpandedTechId] = useState<string | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const pageSize = viewMode === 'cards' ? PAGE_SIZE_CARDS : PAGE_SIZE_TABLE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const fetchCandidates = useCallback(async (searchVal: string, pageVal: number, sortVal: 'name' | 'department', mode: 'cards' | 'table', dept?: string, div?: string, level?: string, successor?: CandidateSuccessorFilter | '') => {
    setLoading(true);
    const fd = new FormData();
    fd.set('query', searchVal);
    fd.set('page', String(pageVal));
    fd.set('pageSize', String(mode === 'cards' ? PAGE_SIZE_CARDS : PAGE_SIZE_TABLE));
    fd.set('sortBy', sortVal);
    fd.set('department', dept ?? '');
    fd.set('division', div ?? '');
    fd.set('level', level ?? '');
    fd.set('successor', successor ?? '');
    fd.set('demoState', demoStateRef.current);
    try {
      const result = await getFilteredCandidatesAction(fd);
      setCandidates(result.candidates);
      setTotal(result.total);
      setSuccessorSeats(result.successorSeats);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

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

  // Written here rather than in an effect on `masked`: an effect would fire on
  // mount with the pre-restore value and clobber the stored choice.
  const toggleMasked = useCallback(() => {
    setMasked((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(MASK_STORAGE_KEY, String(next));
      } catch {
        // Non-fatal: the toggle still works for this page view.
      }
      return next;
    });
  }, []);

  // The candidate list is client-fetched state, so server-side
  // revalidatePath alone leaves the on-screen data stale after a mutation.
  // Wrap each write action so it refetches the current page afterwards.
  const handleDeleteCandidate = useCallback(
    async (fd: FormData) => {
      try {
        await deleteCandidateAction(fd);
        toast.success('Kandidat berhasil dihapus.');
        await fetchCandidates(search, safePage, sortBy, viewMode, departmentFilter, divisionFilter, levelFilter, successorFilter);
      } catch (err: any) {
        toast.error(err?.message ?? 'Gagal menghapus kandidat.');
        throw err;
      }
    },
    [fetchCandidates, search, safePage, sortBy, viewMode, departmentFilter, divisionFilter, levelFilter, successorFilter],
  );

  const handleCreateCandidate = useCallback(
    async (fd: FormData) => {
      try {
        await createCandidateAction(fd);
        toast.success('Kandidat berhasil ditambahkan.');
        await fetchCandidates(search, safePage, sortBy, viewMode, departmentFilter, divisionFilter, levelFilter, successorFilter);
      } catch (err: any) {
        toast.error(err?.message ?? 'Gagal menambahkan kandidat.');
        throw err;
      }
    },
    [fetchCandidates, search, safePage, sortBy, viewMode, departmentFilter, divisionFilter, levelFilter, successorFilter],
  );

  const handleUpdateCandidate = useCallback(
    async (fd: FormData) => {
      try {
        await updateCandidateAction(fd);
        toast.success('Kandidat berhasil diperbarui.');
        await fetchCandidates(search, safePage, sortBy, viewMode, departmentFilter, divisionFilter, levelFilter, successorFilter);
      } catch (err: any) {
        toast.error(err?.message ?? 'Gagal memperbarui kandidat.');
        throw err;
      }
    },
    [fetchCandidates, search, safePage, sortBy, viewMode, departmentFilter, divisionFilter, levelFilter, successorFilter],
  );

  function triggerFetch(
    searchVal: string,
    pageVal: number,
    sortVal: 'name' | 'department',
    mode: 'cards' | 'table',
    dept: string = departmentFilter,
    div: string = divisionFilter,
    level: string = levelFilter,
    successor: CandidateSuccessorFilter | '' = successorFilter,
  ) {
    // Keep the current rows on screen while the next page loads — blanking the
    // list collapses the page and reads as "nothing found" for the length of the
    // request. See the same note in positions-page-client.
    fetchCandidates(searchVal, pageVal, sortVal, mode, dept, div, level, successor);
  }

  const refetchCurrent = useCallback(
    () => fetchCandidates(search, safePage, sortBy, viewMode, departmentFilter, divisionFilter, levelFilter, successorFilter),
    [fetchCandidates, search, safePage, sortBy, viewMode, departmentFilter, divisionFilter, levelFilter, successorFilter],
  );

  const departmentsList = useMemo(() => {
    const list = masterDepartments.length > 0 ? masterDepartments : [];
    const set = new Set<string>(list);
    return Array.from(set).sort();
  }, [masterDepartments]);

  const divisionsList = useMemo(() => {
    const list = masterDivisions.length > 0 ? masterDivisions : [];
    const set = new Set<string>(list);
    return Array.from(set).sort();
  }, [masterDivisions]);

  const currentPositionsList = useMemo(() => {
    const list = masterPositions.length > 0 ? masterPositions : [];
    const set = new Set<string>(list);
    return Array.from(set).sort();
  }, [masterPositions]);

  const demoLookups = useMemo(
    () => ({ departments: departmentsList, divisions: divisionsList, positions: currentPositionsList, masterCompetencies }),
    [departmentsList, divisionsList, currentPositionsList, masterCompetencies],
  );

  const levelComboOptions = useMemo(
    () => [
      { value: '', label: 'Semua Level' },
      ...levelOptions.map((l) => ({ value: l.level, label: l.level })),
    ],
    [levelOptions],
  );

  return (
    <>
      <DashboardHeader
        title="Kandidat"
        actions={
          <div className="flex items-center gap-2">
            {!demo && (
            <CandidateFormDialog
              title="Tambah kandidat"
              description="Simpan data inti kandidat ke database. Nilai readiness dan turunan dashboard akan dihitung dari data yang tersedia."
              submitLabel="Simpan kandidat"
              action={handleCreateCandidate}
              departments={departmentsList}
              divisions={divisionsList}
              positions={currentPositionsList}
              masterCompetencies={masterCompetencies}
              trigger={
                <Button size="sm">
                  <Plus className="mr-1 h-4 w-4" />
                  Tambah
                </Button>
              }
            />
            )}

          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full space-y-6 p-6">
          <Card>
            {/* Two rows. With a fifth filter the single seven-column row
                squeezed the search box to a sliver and wrapped its placeholder
                onto four lines: search + view controls first, filters below. */}
            <CardContent className="space-y-3 pt-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" weight="duotone" />
                    <Input
                      value={search}
                      onChange={(event) => {
                        const val = event.target.value;
                        setSearch(val);
                        clearTimeout(debounceRef.current);
                        debounceRef.current = setTimeout(() => {
                          setPage(1);
                          triggerFetch(val, 1, sortBy, viewMode);
                        }, 300);
                      }}
                      placeholder={demo ? 'Cari nama, posisi, atau departemen' : 'Cari nama, NPK, posisi, atau departemen'}
                      className="pl-9"
                    />
                </div>
                <div className="flex items-center gap-2">
                  {/* Labeled, colour-coded toggle rather than a bare icon: masking
                      is ON by default, so the control has to announce the current
                      state or the redacted bullets look like missing data. */}
                  <Button
                    variant="outline"
                    size="sm"
                    aria-pressed={!masked}
                    onClick={toggleMasked}
                    className={cn(
                      'h-9 shrink-0 gap-2 font-semibold transition-colors',
                      masked
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300',
                    )}
                  >
                    {masked ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    <span className="hidden sm:inline">
                      {masked ? 'Data disamarkan' : 'Data terlihat'}
                    </span>
                  </Button>
                  <div className="flex items-center gap-1 rounded-md border p-1 border-input">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={viewMode === 'cards' ? 'secondary' : 'ghost'}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          if (viewMode !== 'cards') {
                            setViewMode('cards');
                            setPage(1);
                            triggerFetch(search, 1, sortBy, 'cards');
                          }
                        }}
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
                        onClick={() => {
                          if (viewMode !== 'table') {
                            setViewMode('table');
                            setPage(1);
                            triggerFetch(search, 1, sortBy, 'table');
                          }
                        }}
                      >
                        <ListDashesIcon className="h-4 w-4" weight="duotone" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Tampilan tabel</TooltipContent>
                  </Tooltip>
                </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Combobox
                  value={divisionFilter}
                  onValueChange={(value: string) => {
                    setDivisionFilter(value);
                    setPage(1);
                    triggerFetch(search, 1, sortBy, viewMode, departmentFilter, value);
                  }}
                  options={[
                    { value: '', label: 'Semua Divisi' },
                    ...divisionsList.map((div) => ({ value: div, label: div })),
                  ]}
                  placeholder="Semua Divisi"
                  searchPlaceholder="Cari divisi..."
                  emptyText="Divisi tidak ditemukan."
                  triggerPrefix={<Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  triggerClassName="justify-start w-full"
                  className="w-md"
                />

                <Combobox
                  value={departmentFilter}
                  onValueChange={(value: string) => {
                    setDepartmentFilter(value);
                    setPage(1);
                    triggerFetch(search, 1, sortBy, viewMode, value, divisionFilter);
                  }}
                  options={[
                    { value: '', label: 'Semua Departemen' },
                    ...departmentsList.map((dept) => ({ value: dept, label: dept })),
                  ]}
                  placeholder="Semua Departemen"
                  searchPlaceholder="Cari departemen..."
                  emptyText="Departemen tidak ditemukan."
                  triggerPrefix={<Layers className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  triggerClassName="justify-start w-full"
                  className="w-md"
                />

                <Combobox
                  value={levelFilter}
                  onValueChange={(value: string) => {
                    setLevelFilter(value);
                    setPage(1);
                    triggerFetch(search, 1, sortBy, viewMode, departmentFilter, divisionFilter, value);
                  }}
                  options={levelComboOptions}
                  placeholder="Semua Level"
                  searchPlaceholder="Cari level..."
                  emptyText="Level tidak ditemukan."
                  triggerPrefix={<RankingIcon className="h-4 w-4 shrink-0 text-muted-foreground" weight="duotone" />}
                  triggerClassName="justify-start w-full"
                  className="w-xs"
                />

                {/* Same position_picks rows Position Management shows as
                    "Suksesor terpilih", read from the candidate's end. */}
                <Combobox
                  value={successorFilter}
                  onValueChange={(value: string) => {
                    const next = value === 'chosen' || value === 'not_chosen' ? value : '';
                    setSuccessorFilter(next);
                    setPage(1);
                    triggerFetch(search, 1, sortBy, viewMode, departmentFilter, divisionFilter, levelFilter, next);
                  }}
                  options={[
                    { value: '', label: 'Semua status suksesor' },
                    { value: 'chosen', label: 'Sudah dipilih suksesor' },
                    { value: 'not_chosen', label: 'Belum dipilih' },
                  ]}
                  placeholder="Semua status suksesor"
                  searchPlaceholder="Cari status..."
                  emptyText="Status tidak ditemukan."
                  triggerPrefix={<UserCheck className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />}
                  triggerClassName="justify-start w-full"
                  className="w-xs"
                />

                <Combobox
                  value={sortBy}
                  onValueChange={(value: string) => {
                    const newSort = value as typeof sortBy;
                    setSortBy(newSort);
                    setPage(1);
                    triggerFetch(search, 1, newSort, viewMode);
                  }}
                  options={[
                    { value: 'name', label: 'Nama' },
                    { value: 'department', label: 'Departemen' },
                  ]}
                  placeholder="Urutkan"
                  searchPlaceholder="Cari metode urutan..."
                  emptyText="Pilihan urutan tidak ditemukan."
                  triggerPrefix={<ArrowsDownUpIcon className="h-4 w-4 shrink-0" weight="duotone" />}
                  triggerClassName="justify-start w-full"
                />
              </div>
            </CardContent>
          </Card>

          {/* Masking is on by default, so say so in place. Without this the
              redacted bullets read as missing data rather than a deliberate
              privacy setting, and the toggle is easy to miss entirely. */}
          {masked && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <EyeOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  Data kandidat disamarkan
                </p>
                <p className="text-xs text-muted-foreground">
                  Hanya nama, posisi, dan departemen yang ditampilkan. Riwayat PA, riwayat jabatan,
                  dan kompetensi teknis disembunyikan.
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

          <div className="flex items-center text-sm text-muted-foreground">
            {loading ? (
              <span
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-sm font-medium text-primary"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat karyawan...
              </span>
            ) : (
              <span>
                {total == 0
                  ? 'Tidak ada karyawan ditemukan'
                  : `Menampilkan ${Math.min((safePage - 1) * pageSize + 1, total)}-${Math.min(safePage * pageSize, total)} dari ${total} karyawan`}
              </span>
            )}
          </div>

          {/* First load has no stale rows to keep, so say what is happening
              instead of rendering an empty grid. */}
          {demo && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
                {(['', 'on', 'off'] as const).map((v) => (
                  <Button
                    key={v || 'all'}
                    variant={demoState === v ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => {
                      setDemoState(v);
                      demoStateRef.current = v;
                      setDemoSelected(new Set());
                      setPage(1);
                      triggerFetch(search, 1, sortBy, viewMode);
                    }}
                  >
                    {v === '' ? 'Semua' : v === 'on' ? 'On' : 'Off'}
                  </Button>
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <DemoBulkBar
                  selectedIds={demoSelected}
                  pageIds={candidates.map((c) => c.id)}
                  onSelectionChange={setDemoSelected}
                  onChanged={refetchCurrent}
                />
              </div>
            </div>
          )}

          {loading && candidates.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-12 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Memuat karyawan...
            </div>
          )}

          {viewMode === 'cards' && (
            <div
              className={cn(
                'grid gap-4 transition-opacity xl:grid-cols-2',
                loading && 'pointer-events-none opacity-50',
              )}
            >
              {candidates.map((candidate) => {
                const isPaExpanded = expandedPaId === candidate.id;
                const isTechExpanded = expandedTechId === candidate.id;
                const isHistoryExpanded = expandedHistoryId === candidate.id;
                return (
                    <Card key={candidate.id}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {candidate.photoUrl && !masked && (
                              <div className="h-18 w-18 shrink-0 rounded-full bg-muted">
                                <img
                                  src={candidate.photoUrl}
                                  alt=""
                                  className="h-full w-full rounded-full object-cover"
                                  loading="lazy"
                                  onError={(e) => {
                                    e.currentTarget.remove();
                                  }}
                                />
                              </div>
                            )}
                            <div className="min-w-0">
                              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                                {demo && (
                                  <Checkbox
                                    checked={demoSelected.has(candidate.id)}
                                    onCheckedChange={(v) => {
                                      const next = new Set(demoSelected);
                                      if (v) next.add(candidate.id);
                                      else next.delete(candidate.id);
                                      setDemoSelected(next);
                                    }}
                                    aria-label={`Pilih ${candidate.name}`}
                                  />
                                )}
                                <Link href={`/candidates/${candidate.id}`} className="hover:text-primary transition-colors underline">
                                  {candidate.name}
                                </Link>
                                <DemoStateBadge demo={candidate.demo} />
                              </CardTitle>
                              <p className="text-sm text-muted-foreground">{candidate.currentPosition} · {candidate.department}</p>
                              {(candidate.gradeLevel || successorSeats[candidate.id]) && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  {candidate.gradeLevel && (
                                    <Badge variant="secondary" className="text-[10px] font-semibold">
                                      <RankingIcon className="mr-0.5 h-3 w-3" weight="duotone" />
                                      {masked ? <Mask w={4} /> : candidate.gradeLevel}
                                    </Badge>
                                  )}
                                  <CandidateSuccessorBadge seats={successorSeats[candidate.id]} masked={masked} />
                                </div>
                              )}
                            </div>
                          </div>
                        <div className="flex items-center gap-1">
                            {demo ? (
                              <DemoCandidateActions candidate={candidate} lookups={demoLookups} onChanged={refetchCurrent} />
                            ) : (
                            <>
                            <CandidateFormDialog
                              title="Ubah karyawan"
                              description="Perbarui data inti karyawan yang tersimpan di database."
                              submitLabel="Simpan perubahan"
                              action={handleUpdateCandidate}
                              candidate={candidate}
                              departments={departmentsList}
                              divisions={divisionsList}
                              positions={currentPositionsList}
                              masterCompetencies={masterCompetencies}
                              trigger={
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              }
                            />
                            <DeleteConfirmDialog
                              title="Hapus karyawan"
                              description={`Hapus ${candidate.name} dari database? Tindakan ini tidak bisa dibatalkan.`}
                              confirmLabel="Hapus karyawan"
                              action={handleDeleteCandidate}
                              itemId={candidate.id}
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
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-4 gap-3 text-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-default rounded-lg border p-2">
                              <IdentificationBadgeIcon className="mx-auto h-4 w-4 text-muted-foreground" weight="duotone" />
                              <p className="mt-1 text-xs font-medium">{masked || demo ? <Mask /> : candidate.employeeId}</p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>Employee ID</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-default rounded-lg border p-2">
                              <CakeIcon className="mx-auto h-4 w-4 text-muted-foreground" weight="duotone" />
                              <p className="mt-1 text-xs font-medium">
                                {masked ? <Mask w={3} /> : candidate.age != null ? `${candidate.age} th` : '—'}
                              </p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            {masked
                              ? 'Data disamarkan'
                              : candidate.age != null
                                ? `Usia · lahir ${formatBirthDate(candidate.birthDate) ?? '—'}`
                                : 'Usia — tanggal lahir belum tersinkron'}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-default rounded-lg border p-2">
                              <BriefcaseIcon className="mx-auto h-4 w-4 text-muted-foreground" weight="duotone" />
                              <p className="mt-1 text-xs font-medium">{masked ? <Mask w={3} /> : `${candidate.yearsOfService}y`}</p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>Masa kerja</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-default rounded-lg border p-2">
                              <GraduationCapIcon className="mx-auto h-4 w-4 text-muted-foreground" weight="duotone" />
                              <p className="mt-1 text-xs font-medium">{masked ? <Mask w={4} /> : candidate.education}</p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>{masked ? 'Data disamarkan' : candidate.major}</TooltipContent>
                        </Tooltip>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex cursor-default items-center gap-1 rounded-md bg-muted px-2 py-1">
                              <HashIcon className="h-3.5 w-3.5" weight="duotone" />
                              <span>{masked ? <Mask w={4} /> : formatHavQuadrant(candidate.havQuadrant)}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            {/* The HAV in force and its source — the value scoring reads. */}
                            {masked || !candidate.havSource
                              ? 'HAV Kuadran'
                              : `HAV Kuadran · sumber: ${HAV_SOURCE_LABEL[candidate.havSource]}`}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex cursor-default items-center gap-1 rounded-md bg-muted px-2 py-1">
                              <HeartIcon className="h-3.5 w-3.5" weight="duotone" />
                              <span>{masked ? <Mask w={4} /> : candidate.mcuStatus}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>MCU Status</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex cursor-default items-center gap-1 rounded-md bg-muted px-2 py-1">
                              <ScalesIcon className="h-3.5 w-3.5" weight="duotone" />
                              <span>{masked ? <Mask w={4} /> : candidate.disciplinaryStatus}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>Disciplinary</TooltipContent>
                        </Tooltip>
                        {candidate.raw?.behaviorRecommendation && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex cursor-default items-center gap-1 rounded-md bg-muted px-2 py-1">
                                <CalendarCheckIcon className="h-3.5 w-3.5" weight="duotone" />
                                <span>{masked ? <Mask w={4} /> : candidate.raw.behaviorRecommendation}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              {masked ? (
                                'Data disamarkan'
                              ) : candidate.raw.behaviorNotes ? (
                                <div className="max-w-xs whitespace-pre-wrap">{candidate.raw.behaviorNotes}</div>
                              ) : (
                                'Behavior Recommendation'
                              )}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {/* Riwayat PA / Jabatan / Technical Competencies are hidden
                          outright while masked - every value inside is sensitive. */}
                      {!masked && (
                      <>
                      <button
                        type="button"
                        onClick={() => setExpandedPaId(isPaExpanded ? null : candidate.id)}
                        className="flex w-full items-center justify-between text-xs text-muted-foreground transition-colors hover:text-foreground font-semibold uppercase tracking-wider"
                      >
                        <span>Riwayat Performance Appraisal (3 Tahun)</span>
                        <CaretDownIcon
                          className={`h-3.5 w-3.5 transition-transform ${isPaExpanded ? 'rotate-180' : ''}`}
                          weight="bold"
                        />
                      </button>
                      {isPaExpanded && (
                        <div className="grid grid-cols-3 gap-2">
                          {(() => {
                            const paValues = candidate.raw?.performanceGrade ? candidate.raw.performanceGrade.split(',') : ['', '', '', '', '', ''];
                            const cy = new Date().getFullYear();
                            return [
                              { year: cy - 1, s2: paValues[0], s1: paValues[1] },
                              { year: cy - 2, s2: paValues[2], s1: paValues[3] },
                              { year: cy - 3, s2: paValues[4], s1: paValues[5] },
                            ].map((item) => {
                              const s1Val = item.s1 && item.s1.trim() !== '' ? item.s1 : null;
                              const s2Val = item.s2 && item.s2.trim() !== '' ? item.s2 : null;
                              return (
                                <div key={item.year} className="rounded border bg-card p-1.5 text-center text-xs">
                                  <span className="block font-semibold text-[10px] text-muted-foreground">{item.year}</span>
                                  <div className="mt-1 space-y-0.5 text-[11px]">
                                    <div className="flex items-center justify-between gap-1 px-1">
                                      <span className="text-muted-foreground font-medium text-[10px]">S1:</span>
                                      {s1Val ? (
                                        <span className="font-bold text-primary">{s1Val}</span>
                                      ) : (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className="font-bold text-muted-foreground/60 cursor-help decoration-dotted underline select-none text-[10px]">C*</span>
                                          </TooltipTrigger>
                                          <TooltipContent>Tidak ada PA (Otomatis C)</TooltipContent>
                                        </Tooltip>
                                      )}
                                    </div>
                                    <div className="flex items-center justify-between gap-1 px-1">
                                      <span className="text-muted-foreground font-medium text-[10px]">S2:</span>
                                      {s2Val ? (
                                        <span className="font-bold text-primary">{s2Val}</span>
                                      ) : (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className="font-bold text-muted-foreground/60 cursor-help decoration-dotted underline select-none text-[10px]">C*</span>
                                          </TooltipTrigger>
                                          <TooltipContent>Tidak ada PA (Otomatis C)</TooltipContent>
                                        </Tooltip>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}
                      </>
                      )}

                      {!masked && candidate.positionHistory != null && candidate.positionHistory.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-muted/50 mt-1">
                          <button
                            type="button"
                            onClick={() => setExpandedHistoryId(isHistoryExpanded ? null : candidate.id)}
                            className="flex w-full items-center justify-between text-xs text-muted-foreground transition-colors hover:text-foreground font-semibold uppercase tracking-wider"
                          >
                            <span>Riwayat Jabatan ({candidate.positionHistory.length})</span>
                            <CaretDownIcon
                              className={`h-3.5 w-3.5 transition-transform ${isHistoryExpanded ? 'rotate-180' : ''}`}
                              weight="bold"
                            />
                          </button>
                          {isHistoryExpanded && (() => {
                            const hist = candidate.positionHistory!.slice().sort((a, b) => {
                              const aEnd = a.validTo ? new Date(a.validTo).getTime() : (a.validFrom ? new Date(a.validFrom).getTime() : 0);
                              const bEnd = b.validTo ? new Date(b.validTo).getTime() : (b.validFrom ? new Date(b.validFrom).getTime() : 0);
                              return bEnd - aEnd;
                            });
                            return (
                              <div className="mt-2 space-y-0">
                                {hist.map((row, idx) => {
                                  const title = row.internalTitle ?? row.externalTitle ?? (demo ? MASKED_CODE : row.positionId);
                                  const isLast = idx === hist.length - 1;
                                  return (
                                    <div key={`${candidate.id}-${row.positionId}-${row.validFrom ?? idx}`} className="flex gap-3">
                                      <div className="flex flex-col items-center">
                                        <div className="size-2 rounded-full bg-primary ring-2 ring-background shrink-0 mt-1.5" />
                                        {!isLast && <div className="w-px flex-1 bg-border" />}
                                      </div>
                                      <div className={`pb-3 ${isLast ? '' : ''}`}>
                                        <p className="text-xs font-semibold text-foreground leading-snug">
                                          {title}
                                          {!row.primaryPosition && (
                                            <Badge variant="outline" className="ml-1.5 text-[9px] py-0 px-1.5 font-bold uppercase tracking-wide align-middle">
                                              Non-Primary
                                            </Badge>
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
                            );
                          })()}
                        </div>
                      )}

                      {!masked && candidate.technicalCompetencies && candidate.technicalCompetencies.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-muted/50 mt-1">
                          <button
                            type="button"
                            onClick={() => setExpandedTechId(isTechExpanded ? null : candidate.id)}
                            className="flex w-full items-center justify-between text-xs text-muted-foreground transition-colors hover:text-foreground font-semibold uppercase tracking-wider"
                          >
                            <span>Technical Competencies ({candidate.technicalCompetencies.length})</span>
                            <CaretDownIcon
                              className={`h-3.5 w-3.5 transition-transform ${isTechExpanded ? 'rotate-180' : ''}`}
                              weight="bold"
                            />
                          </button>
                          {isTechExpanded && (
                            <div className="max-h-72 space-y-2 overflow-y-auto pr-1 mt-2">
                              {candidate.technicalCompetencies.map((item) => (
                                <details
                                  key={`${candidate.id}-${item.technicalId}`}
                                  className="group rounded-lg border bg-card px-3 py-2"
                                >
                                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-semibold text-foreground">
                                        {item.technicalName}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground">
                                        Proficiency: {item.currentProficiencyName ?? '-'}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      {item.currentScore !== null && (
                                        <Badge variant="secondary" className="text-[10px]">
                                          {item.currentScore}
                                        </Badge>
                                      )}
                                      <CaretDownIcon
                                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                                        weight="bold"
                                      />
                                    </div>
                                  </summary>
                                  <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                                    <div className="rounded-md bg-muted/40 px-2 py-1.5">
                                      <p className="font-medium text-foreground">Current Score</p>
                                      <p>{item.currentScore ?? '-'}</p>
                                    </div>
                                    <div className="rounded-md bg-muted/40 px-2 py-1.5">
                                      <p className="font-medium text-foreground">Target Score</p>
                                      <p>{item.score ?? '-'}</p>
                                    </div>
                                    <div className="rounded-md bg-muted/40 px-2 py-1.5">
                                      <p className="font-medium text-foreground">Gap</p>
                                      <p>{item.gap ?? '-'}</p>
                                    </div>
                                    <div className="rounded-md bg-muted/40 px-2 py-1.5">
                                      <p className="font-medium text-foreground">Proficiency</p>
                                      <p>{item.proficiencyName ?? '-'}</p>
                                    </div>
                                  </div>
                                </details>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {viewMode === 'table' && (
            <Card className={cn('transition-opacity', loading && 'pointer-events-none opacity-50')}>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Karyawan</TableHead>
                      <TableHead>Departemen</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>MCU</TableHead>
                      <TableHead>Behavior</TableHead>
                      <TableHead>Usia</TableHead>
                      <TableHead>Masa</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.map((candidate) => (
                      <TableRow key={candidate.id}>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                          {demo && (
                            <Checkbox
                              checked={demoSelected.has(candidate.id)}
                              onCheckedChange={(v) => {
                                const next = new Set(demoSelected);
                                if (v) next.add(candidate.id);
                                else next.delete(candidate.id);
                                setDemoSelected(next);
                              }}
                              aria-label={`Pilih ${candidate.name}`}
                            />
                          )}
                          <Link href={`/candidates/${candidate.id}`} className="font-medium hover:text-primary transition-colors underline">
                            {candidate.name}
                          </Link>
                          <DemoStateBadge demo={candidate.demo} />
                          </div>
                          <p className="text-xs text-muted-foreground">{candidate.currentPosition}</p>
                          <CandidateSuccessorBadge
                            seats={successorSeats[candidate.id]}
                            masked={masked}
                            className="mt-1"
                          />
                        </TableCell>
                        <TableCell className="text-sm">{candidate.department}</TableCell>
                        <TableCell className="text-sm">
                          {masked ? (
                            <Mask w={4} />
                          ) : candidate.gradeLevel ? (
                            <span className="font-medium">{candidate.gradeLevel}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{masked ? <Mask w={4} /> : candidate.mcuStatus}</TableCell>
                        <TableCell className="text-sm">{masked ? <Mask w={4} /> : (candidate.raw?.behaviorRecommendation ?? '—')}</TableCell>
                        <TableCell className="text-sm">
                          {masked ? <Mask w={3} /> : candidate.age != null ? `${candidate.age} th` : '—'}
                        </TableCell>
                        <TableCell className="text-sm">{masked ? <Mask w={3} /> : `${candidate.yearsOfService}y`}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {demo ? (
                              <DemoCandidateActions candidate={candidate} lookups={demoLookups} onChanged={refetchCurrent} />
                            ) : (
                            <>
                            <CandidateFormDialog
                              title="Ubah karyawan"
                              description="Perbarui data inti karyawan yang tersimpan di database."
                              submitLabel="Simpan perubahan"
                              action={handleUpdateCandidate}
                              candidate={candidate}
                              departments={departmentsList}
                              divisions={divisionsList}
                              positions={currentPositionsList}
                              masterCompetencies={masterCompetencies}
                              trigger={
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              }
                            />
                            <DeleteConfirmDialog
                              title="Hapus karyawan"
                              description={`Hapus ${candidate.name} dari database? Tindakan ini tidak bisa dibatalkan.`}
                              confirmLabel="Hapus karyawan"
                              action={handleDeleteCandidate}
                              itemId={candidate.id}
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
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1 || loading}
                onClick={() => {
                  const next = Math.max(1, safePage - 1);
                  setPage(next);
                  triggerFetch(search, next, sortBy, viewMode);
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
                  triggerFetch(search, next, sortBy, viewMode);
                }}
              >
                <CaretRightIcon className="h-4 w-4" weight="bold" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
