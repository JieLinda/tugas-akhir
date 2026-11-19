'use client';

import { useIdentifierDisplay } from '@/components/app-mode-provider';
import { maskJobProfileFileName } from '@/lib/demo/mask';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Filter,
  FileText,
  LayoutGrid,
  List,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronRight,
  User,
  Building,
  Building2,
  ArrowUpDown,
  BookOpen,
  Calendar,
  X,
  Copy,
  Check,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { setJobProfileTenantsAction } from '@/lib/job-profile-tenant-actions';
import {
  JobProfileDetailContent,
  type JobProfileRow,
  type ExtractedJobProfile,
} from '@/components/job-profiles/job-profile-detail-content';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  deleteJobProfileAction,
  reextractJobProfileAction,
  retryFailedJobProfilesAction,
} from '@/lib/job-profile-actions';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import { DemoMaskedText } from '@/components/demo/demo-masked-text';

// JobProfileRow + ExtractedJobProfile live with the reusable detail renderer
// (job-profile-detail-content). Re-exported so the section page
// (app/(dashboard)/job-profiles/page.tsx) keeps resolving them from here.
export type { JobProfileRow, ExtractedJobProfile };

const statusTone: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  processing: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
  pending: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
  failed: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
};

const statusIcons: Record<string, any> = {
  completed: CheckCircle2,
  processing: Clock,
  pending: Clock,
  failed: AlertCircle,
};

/**
 * A destructive or expensive action awaiting confirmation.
 *
 * One piece of state and one dialog for the whole page rather than a dialog per
 * row: both actions are reachable from the card list, the table AND the open
 * detail dialog, so per-row dialogs would mean three mounted copies of each and
 * a focus trap fighting the detail dialog's own.
 */
type PendingConfirm =
  | { kind: 'delete'; id: number }
  | { kind: 'reextract'; id: number }
  | { kind: 'retryAllFailed'; count: number };

/** Copy for each confirmation, so the dialog body is a lookup, not a ternary. */
const CONFIRM_COPY: Record<
  PendingConfirm['kind'],
  { title: string; description: string; action: string; destructive: boolean }
> = {
  delete: {
    title: 'Hapus job profile ini?',
    description:
      'Baris hasil ekstraksi ini dihapus permanen dan tidak bisa dikembalikan. ' +
      'Berkas PDF-nya sendiri tidak ikut terhapus, jadi dokumen ini akan terbaca ' +
      'lagi sebagai entri baru pada sinkronisasi berikutnya.',
    action: 'Hapus',
    destructive: true,
  },
  reextract: {
    title: 'Baca ulang job profile ini dari PDF-nya?',
    description:
      'Hasil ekstraksi yang sekarang akan DIGANTI. Prosesnya memanggil model AI ' +
      'sekali untuk seluruh halaman dokumen, jadi bisa memakan waktu hingga ' +
      'beberapa menit.',
    action: 'Baca Ulang',
    destructive: false,
  },
  retryAllFailed: {
    title: 'Coba baca ulang semua yang gagal?',
    description:
      'Setiap berkas dibaca ulang dengan model AI — satu panggilan per dokumen, ' +
      'jadi prosesnya bisa memakan waktu lama untuk banyak berkas. Prosesnya ' +
      'berjalan di latar belakang dan bisa dipantau lewat kartu "Dalam Proses". ' +
      'Dokumen yang berkas PDF-nya sudah tidak ada di server akan dilewati — ' +
      'itu hanya bisa diperbaiki dengan mengunggah ulang.',
    action: 'Coba Lagi Semua',
    destructive: false,
  },
};

/**
 * What a row's state actually is, for the badge and its icon.
 *
 * A file can be queued for re-extraction while its PREVIOUS extraction is still
 * `completed` and still being served to job-family matching and scoring —
 * `status` describes the CONTENT, `queuedAt` describes the WORK. Without the
 * queue arm a file waiting an hour renders as "Selesai" and the backlog is
 * invisible in the list even while the card counts it.
 */
function profileState(p: { status: string; queuedAt?: unknown }): { key: string; label: string } {
  if (p.status === 'processing') return { key: 'processing', label: 'Proses' };
  if (p.queuedAt != null) return { key: 'pending', label: 'Antre' };
  if (p.status === 'completed') return { key: 'completed', label: 'Selesai' };
  if (p.status === 'failed') return { key: 'failed', label: 'Gagal' };
  return { key: 'pending', label: 'Proses' };
}

const PAGE_SIZE_CARDS = 8;
const PAGE_SIZE_TABLE = 15;

/**
 * Which tenant(s) own a document, editable in place. Replaces the old
 * "belum dipetakan → go set it up in Tata Kelola" badge: assignment now
 * happens right where the document already is, via setJobProfileTenantsAction.
 *
 * An empty selection is a valid, deliberate state (visible to every tenant),
 * not an error — the control says so rather than nagging for a value.
 */
function TenantAssignmentControl({
  jobProfileId,
  tenantIds,
  tenants,
  onChange,
}: {
  jobProfileId: number;
  tenantIds: string[];
  tenants: { id: string; name: string }[];
  onChange: (jobProfileId: number, nextTenantIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(tenantIds);
  const [saving, setSaving] = useState(false);

  // Reset the draft to the current server state each time the popover opens,
  // so a discarded edit (closed without saving) never lingers into the next open.
  useEffect(() => {
    if (open) setDraft(tenantIds);
  }, [open, tenantIds]);

  async function save() {
    setSaving(true);
    try {
      const res = await setJobProfileTenantsAction(jobProfileId, draft);
      if (res.success) {
        onChange(jobProfileId, draft);
        setOpen(false);
        toast.success(
          draft.length === 0
            ? 'Dokumen tampil di semua Company.'
            : `Dipetakan ke ${draft.length} Company.`,
        );
      } else {
        toast.error(res.error ?? 'Gagal menyimpan pemetaan.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan pemetaan.');
    } finally {
      setSaving(false);
    }
  }

  const label =
    tenantIds.length === 0
      ? 'belum dipetakan'
      : tenantIds.map((id) => tenants.find((t) => t.id === id)?.name ?? id).join(', ');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={
            tenantIds.length === 0
              ? 'Belum dipetakan ke Company manapun — dokumen ini tampil di semua Company. Klik untuk mengatur.'
              : `Dipetakan ke: ${label}. Klik untuk mengubah.`
          }
          className={cn(
            'inline-flex items-center gap-1 rounded border px-1.5 py-px text-[9px] font-bold normal-case tracking-normal transition-colors',
            tenantIds.length === 0
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400'
              : 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300',
          )}
        >
          <Building2 className="h-2.5 w-2.5 shrink-0" />
          <span className="max-w-[10rem] truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-3"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Company pemilik dokumen
        </p>
        <div className="space-y-1.5">
          {tenants.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox
                checked={draft.includes(t.id)}
                onCheckedChange={(checked) =>
                  setDraft((prev) => (checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)))
                }
              />
              {t.name}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          Kosongkan semua kotak untuk menampilkan dokumen ini di semua Company.
        </p>
        <Button size="sm" className="mt-2.5 h-7 w-full text-xs" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Simpan'}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

interface JobProfileDocumentsClientProps {
  initialProfiles: JobProfileRow[];
  /** Business units, for the per-document tenant-assignment picker. */
  tenants: { id: string; name: string }[];
}

/**
 * The "Dokumen Job Profile" section of the Dokumen menu: the job-profile catalog with its
 * extraction queue, tenant assignment and re-read controls. Job Profile Match
 * used to be a tab inside this component; it is now a sibling route with its
 * own data loading (see ../../app/(dashboard)/job-profiles).
 */
export function JobProfileDocumentsClient({ initialProfiles, tenants }: JobProfileDocumentsClientProps) {
  // Demo mode masks the position code and JD number a document is filed under.
  const ids = useIdentifierDisplay();
  const fileNameOf = (fileName: string) => (ids.demo ? maskJobProfileFileName(fileName) : fileName);
  const [profiles, setProfiles] = useState<JobProfileRow[]>(initialProfiles);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  /** Tenant id, 'unassigned', or 'all'. */
  const [tenantFilter, setTenantFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'updated' | 'position' | 'department'>('updated');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [page, setPage] = useState(1);
  const [selectedProfile, setSelectedProfile] = useState<JobProfileRow | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isDeleting, setIsDeleting] = useState<number | null>(null);
  const [isReextracting, setIsReextracting] = useState<number | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const router = useRouter();

  // Sync statistics
  const metrics = useMemo(() => {
    const total = profiles.length;
    const completed = profiles.filter((p) => p.status === 'completed').length;
    const failed = profiles.filter((p) => p.status === 'failed').length;
    // Two different questions, and conflating them is what made this card
    // useless: `processing` is the ONE file the sync is extracting right now,
    // while `queued` is the backlog behind it. The old count was
    // status-in-('processing','pending'), and since the sync marks exactly one
    // row at a time it read "1" for an hour — the number changed which file it
    // referred to, never how many were left.
    const processing = profiles.filter((p) => p.status === 'processing').length;
    const waiting = profiles.filter((p) => p.queuedAt != null && p.status !== 'processing');
    // "Dalam Proses" answers ONE question: how many documents do not have a
    // usable extraction yet. A queued file whose previous extraction still says
    // `completed` is a RE-READ — it already has content, it is already counted
    // under "Selesai Ekstraksi", and counting it here too made a force re-sync
    // report 234 in progress against 275 total with 255 of them finished, which
    // reads as broken arithmetic. Re-reads are still real queued work (one
    // vision call each), so they are reported — just not as a gap in the data.
    const awaitingFirst = waiting.filter((p) => p.status !== 'completed').length;
    const queuedRefresh = waiting.filter((p) => p.status === 'completed').length;
    return { total, completed, failed, processing, awaitingFirst, queuedRefresh };
  }, [profiles]);

  // The list is server-rendered, so it is stale the moment an extraction starts
  // and only a reload moves it. Poll while the queue has anything in it — that
  // is the whole window in which this page is worth watching — and stop dead
  // when it drains, so an idle page costs nothing.
  // Includes re-reads on purpose, unlike the card's headline: a force re-sync of
  // 216 already-extracted files is exactly when somebody sits on this page
  // watching, even though none of those count as a gap in the data.
  const inFlight = metrics.processing + metrics.awaitingFirst + metrics.queuedRefresh;
  useEffect(() => {
    if (inFlight === 0) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [inFlight, router]);

  // Filtering
  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      const normalizedSearch = search.toLowerCase();
      const matchesSearch =
        // Demo mode searches only what it shows: no code, no JD number.
        fileNameOf(p.fileName).toLowerCase().includes(normalizedSearch) ||
        (p.positionName || '').toLowerCase().includes(normalizedSearch) ||
        (p.divisionDepartment || '').toLowerCase().includes(normalizedSearch) ||
        (!ids.demo && (p.jobProfileNumber || '').toLowerCase().includes(normalizedSearch));

      // 'queued' is not a `status` value — it is the queue column — so it
      // cannot go through the same equality test as the others.
      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'queued'
            ? p.queuedAt != null && p.status !== 'processing'
            : p.status === statusFilter;
      const matchesTenant =
        tenantFilter === 'all' ||
        (tenantFilter === 'unassigned'
          ? (p.tenantIds ?? []).length === 0
          : (p.tenantIds ?? []).includes(tenantFilter));

      return matchesSearch && matchesStatus && matchesTenant;
    });
  }, [profiles, search, statusFilter, tenantFilter]);

  // Sorting
  const sortedProfiles = useMemo(() => {
    return [...filteredProfiles].sort((a, b) => {
      if (sortBy === 'position') {
        return (a.positionName || '').localeCompare(b.positionName || '');
      }
      if (sortBy === 'department') {
        return (a.divisionDepartment || '').localeCompare(b.divisionDepartment || '');
      }
      // default: updated/synced date descending
      const dateA = a.processedAt ? new Date(a.processedAt).getTime() : new Date(a.syncedAt).getTime();
      const dateB = b.processedAt ? new Date(b.processedAt).getTime() : new Date(b.syncedAt).getTime();
      return dateB - dateA;
    });
  }, [filteredProfiles, sortBy]);

  const pageSize = viewMode === 'cards' ? PAGE_SIZE_CARDS : PAGE_SIZE_TABLE;
  const totalPages = Math.max(1, Math.ceil(sortedProfiles.length / pageSize));
  const paginatedProfiles = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedProfiles.slice(start, start + pageSize);
  }, [sortedProfiles, page, pageSize]);

  // Handle deletions
  const handleDelete = (id: number, e: React.MouseEvent) => {
    // The row itself is a click target (it opens the detail dialog), so the
    // delete button must not also select the profile it is about to remove.
    e.stopPropagation();
    setPendingConfirm({ kind: 'delete', id });
  };

  const runDelete = async (id: number) => {
    setIsDeleting(id);
    const result = await deleteJobProfileAction(id);
    setIsDeleting(null);

    if (result.success) {
      toast.success('Job profile berhasil dihapus');
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      if (selectedProfile?.id === id) setSelectedProfile(null);
    } else {
      toast.error('Gagal menghapus job profile: ' + result.error);
    }
  };

  // Re-read ONE profile whose extraction is wrong. Deliberately NOT optimistic:
  // the new extraction is what the server produces, so the page is refreshed
  // from it rather than guessed at — and a re-read that silently changed
  // nothing on screen would be indistinguishable from one that failed.
  const handleReextract = (id: number) => {
    setPendingConfirm({ kind: 'reextract', id });
  };

  // Bulk retry. The action returns once the batch is QUEUED, not when it
  // finishes — the queue is what the user watches from here, so the toast says
  // how many were queued rather than pretending the work is done.
  const runRetryAllFailed = async () => {
    setIsRetryingAll(true);
    const result = await retryFailedJobProfilesAction();
    setIsRetryingAll(false);

    if (result.success) {
      toast.success(result.message, { duration: 10000 });
      router.refresh();
    } else {
      toast.error(result.message, { duration: 10000 });
    }
  };

  const runReextract = async (id: number) => {
    setIsReextracting(id);
    const result = await reextractJobProfileAction(id);
    setIsReextracting(null);

    if (result.success) {
      toast.success(result.message);
      // Server-rendered props feed this list, so a refresh is what shows the
      // new extraction — both in the row and in the open dialog.
      router.refresh();
    } else if (result.missingFile) {
      // Not a failure to retry: the PDF is gone and only a re-upload fixes it.
      // Longer toast because the message names the action the user has to take.
      toast.error(result.message, { duration: 12000 });
    } else {
      toast.error(result.message);
    }
  };

  // Optimistic local update after a tenant assignment save — updates both the
  // list and the open detail dialog (if it's showing this same document) so
  // neither one shows a stale "belum dipetakan" a moment after it was fixed.
  const handleTenantsChanged = useCallback((jobProfileId: number, nextTenantIds: string[]) => {
    const patch = (p: JobProfileRow) =>
      p.id === jobProfileId ? { ...p, tenantIds: nextTenantIds, unmapped: nextTenantIds.length === 0 } : p;
    setProfiles((prev) => prev.map(patch));
    setSelectedProfile((prev) => (prev ? patch(prev) : prev));
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    toast.success('JSON berhasil disalin');
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Header and section strip come from the hub layout (../../app/(dashboard)/job-profiles/layout.tsx).
  return (
    <div className="flex-1 flex flex-col">
      <div className="p-6 space-y-6 flex-1 max-w-7xl mx-auto w-full">
        {/* Metrik Section */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="shadow-sm border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-700 dark:text-slate-300">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Total Dokumen</p>
                <p className="text-2xl font-bold tracking-tight mt-0.5">{metrics.total}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Selesai Ekstraksi</p>
                <p className="text-2xl font-bold tracking-tight mt-0.5 text-emerald-600 dark:text-emerald-400">
                  {metrics.completed}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl text-amber-600 dark:text-amber-400">
                <Clock className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Dalam Proses</p>
                <p className="text-2xl font-bold tracking-tight mt-0.5 text-amber-600 dark:text-amber-400">
                  {metrics.processing + metrics.awaitingFirst}
                </p>
                {/* The headline is the whole backlog, because "how long until
                    this finishes" is the question the card is read for. The
                    split is spelled out underneath so the number is not just a
                    bigger mystery: one file is being extracted, the rest are
                    waiting. Silent when nothing is queued. */}
                {metrics.processing + metrics.awaitingFirst + metrics.queuedRefresh > 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {metrics.processing > 0
                      ? `${metrics.processing} diekstrak, ${metrics.awaitingFirst} menunggu`
                      : `${metrics.awaitingFirst} menunggu giliran`}
                    {/* Subordinate, and worded as scheduled work rather than a
                        gap: these documents are readable right now. */}
                    {metrics.queuedRefresh > 0
                      ? ` · ${metrics.queuedRefresh} baca ulang terjadwal`
                      : ''}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 bg-rose-50 dark:bg-rose-950/30 rounded-xl text-rose-600 dark:text-rose-400">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Gagal Ekstraksi</p>
                <p className="text-2xl font-bold tracking-tight mt-0.5 text-rose-600 dark:text-rose-400 font-sans">
                  {metrics.failed}
                </p>
                {/* The retry lives ON the count, because that is where the
                    failure is noticed. Hidden at zero rather than disabled: a
                    permanently greyed button on a healthy page is noise. */}
                {metrics.failed > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isRetryingAll}
                    onClick={() =>
                      setPendingConfirm({ kind: 'retryAllFailed', count: metrics.failed })
                    }
                    className="mt-1.5 h-7 px-2 text-[11px] font-semibold"
                  >
                    {isRetryingAll ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3 w-3" />
                    )}
                    Coba Lagi Semua
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
            {/* Kontrol & Filter */}
            <Card className="shadow-sm border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900">
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Search Bar */}
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Cari posisi, divisi, nomor profil..."
                      className="pl-9 bg-slate-50 dark:bg-slate-950/40 border-slate-200/80 dark:border-slate-800/80 rounded-lg"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                    />
                  </div>

                  {/* Filters */}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase hidden md:inline">Filter:</span>
                    </div>

                    {/* Status Filter */}
                    <Select
                      value={statusFilter}
                      onValueChange={(value) => {
                        setStatusFilter(value);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="h-9 w-45 bg-slate-50 dark:bg-slate-950/45 text-xs font-medium">
                        <SelectValue placeholder="Semua Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua Status</SelectItem>
                        <SelectItem value="completed">Selesai (Completed)</SelectItem>
                        <SelectItem value="processing">Dalam Proses (Processing)</SelectItem>
                        <SelectItem value="queued">Antre (Queued)</SelectItem>
                        <SelectItem value="failed">Gagal (Failed)</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Tenant Filter — replaces the old source-folder filter now
                        that ownership is a direct assignment, not a folder. */}
                    <Select
                      value={tenantFilter}
                      onValueChange={(value) => {
                        setTenantFilter(value);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="h-9 w-45 bg-slate-50 dark:bg-slate-950/45 text-xs font-medium">
                        <SelectValue placeholder="Semua Company" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua Company</SelectItem>
                        <SelectItem value="unassigned">Belum Dipetakan</SelectItem>
                        {tenants.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Sort Filter */}
                    <Select
                      value={sortBy}
                      onValueChange={(value) => {
                        setSortBy(value as 'updated' | 'position' | 'department');
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="h-9 w-45 bg-slate-50 dark:bg-slate-950/45 text-xs font-medium">
                        <SelectValue placeholder="Terbaru Sinc" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="updated">Terbaru Sync</SelectItem>
                        <SelectItem value="position">Nama Posisi</SelectItem>
                        <SelectItem value="department">Divisi / Dep</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* View Mode */}
                    <div className="flex border border-slate-200 dark:border-slate-800 p-0.5 rounded-lg bg-slate-100/50 dark:bg-slate-950/20">
                      <Button
                        variant={viewMode === 'cards' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 w-8 p-0"
                        onClick={() => {
                          setViewMode('cards');
                          setPage(1);
                        }}
                      >
                        <LayoutGrid className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 w-8 p-0"
                        onClick={() => {
                          setViewMode('table');
                          setPage(1);
                        }}
                      >
                        <List className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* List Grid / Table */}
            {sortedProfiles.length === 0 ? (
              <Card className="shadow-sm border-slate-200/60 dark:border-slate-800/80 py-16 text-center bg-white dark:bg-slate-900">
                <CardContent className="space-y-4 max-w-sm mx-auto">
                  <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full w-14 h-14 flex items-center justify-center mx-auto text-muted-foreground">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">Tidak ada job profile ditemukan</h3>
                    <p className="text-sm text-muted-foreground mt-1.5">
                      Coba sesuaikan kata kunci pencarian Anda atau periksa sinkronisasi file pada menu Sinkronisasi.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : viewMode === 'cards' ? (
              /* GRID CARDS VIEW */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {paginatedProfiles.map((p) => {
                  const state = profileState(p);
                  const Icon = statusIcons[state.key] || FileText;
                  return (
                    <Card
                      key={p.id}
                      className="shadow-sm hover:shadow-md transition-all cursor-pointer border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 flex flex-col justify-between group overflow-hidden"
                      onClick={() => setSelectedProfile(p)}
                    >
                      <div className="p-5 flex-1 space-y-4">
                        {/* Tenant & Status */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <TenantAssignmentControl
                              jobProfileId={p.id}
                              tenantIds={p.tenantIds ?? []}
                              tenants={tenants}
                              onChange={handleTenantsChanged}
                            />
                          </div>
                          <Badge className={`text-[10px] px-2 py-0.5 font-bold capitalize border ${statusTone[state.key]} shrink-0`}>
                            <Icon className="h-3 w-3 mr-1 inline shrink-0" />
                            {state.label}
                          </Badge>
                        </div>

                        {/* Title */}
                        <div className="space-y-1.5">
                          {p.jobProfileNumber && (
                            <code className="inline-block text-[10px] font-mono font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {ids.code(p.jobProfileNumber)}
                            </code>
                          )}
                          <h4 className="font-bold text-sm text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-2">
                            {p.positionName || fileNameOf(p.fileName)}
                          </h4>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Building className="h-3.5 w-3.5 shrink-0" />
                            <span className="line-clamp-1">{p.divisionDepartment || 'Divisi tidak tersedia'}</span>
                          </p>
                        </div>

                        {/* Purpose Statement */}
                        {p.jobPurpose && (
                          <p className="text-xs text-muted-foreground/80 line-clamp-3 italic leading-relaxed border-l-2 border-slate-200 dark:border-slate-800 pl-2.5">
                            &ldquo;<DemoMaskedText text={p.jobPurpose} />&rdquo;
                          </p>
                        )}
                      </div>

                      {/* Card Footer */}
                      <div className="border-t border-slate-100 dark:border-slate-800/70 bg-slate-50/50 dark:bg-slate-950/20 px-5 py-3.5 flex items-center justify-between">
                        <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>
                            {formatDate(p.syncedAt)}
                          </span>
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => handleDelete(p.id, e)}
                            disabled={isDeleting === p.id}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <span className="text-xs font-bold text-primary flex items-center gap-0.5 group-hover:translate-x-1.5 transition-transform">
                            <span>Lihat</span>
                            <ChevronRight className="h-3 w-3" />
                          </span>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              /* TABLE VIEW */
              <Card className="shadow-sm border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 overflow-hidden">
                <ScrollArea className="w-full">
                  <Table>
                    <TableHeader className="bg-slate-50/70 dark:bg-slate-950/40">
                      <TableRow className="border-b border-slate-200 dark:border-slate-800">
                        <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground py-4">Nomor Dokumen</TableHead>
                        <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground py-4">Nama Posisi</TableHead>
                        <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground py-4">Divisi / Departemen</TableHead>
                        <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground py-4">Company</TableHead>
                        <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground py-4">Status</TableHead>
                        <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground py-4">Disinkronkan</TableHead>
                        <TableHead className="font-bold text-xs uppercase tracking-wider text-muted-foreground py-4 text-right pr-6">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedProfiles.map((p) => {
                        const state = profileState(p);
                        const Icon = statusIcons[state.key] || FileText;
                        return (
                          <TableRow
                            key={p.id}
                            className="border-b border-slate-100 dark:border-slate-800/65 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-950/10"
                            onClick={() => setSelectedProfile(p)}
                          >
                            <TableCell className="py-4 font-mono text-xs font-medium text-slate-500">
                              {p.jobProfileNumber ? ids.code(p.jobProfileNumber) : 'N/A'}
                            </TableCell>
                            <TableCell className="py-4 font-bold text-sm text-foreground max-w-xs truncate">
                              {p.positionName || fileNameOf(p.fileName)}
                            </TableCell>
                            <TableCell className="py-4 text-xs text-muted-foreground">
                              {p.divisionDepartment || 'N/A'}
                            </TableCell>
                            <TableCell className="py-4" onClick={(e) => e.stopPropagation()}>
                              <TenantAssignmentControl
                                jobProfileId={p.id}
                                tenantIds={p.tenantIds ?? []}
                                tenants={tenants}
                                onChange={handleTenantsChanged}
                              />
                            </TableCell>
                            <TableCell className="py-4">
                              <Badge className={`text-[10px] px-2 py-0.5 font-bold capitalize border ${statusTone[state.key]}`}>
                                <Icon className="h-3 w-3 mr-1 inline shrink-0" />
                                {state.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-4 text-xs text-muted-foreground">
                              {formatDate(p.syncedAt)}
                            </TableCell>
                            <TableCell className="py-4 text-right pr-6" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary font-bold text-xs h-8 px-3"
                                  onClick={() => setSelectedProfile(p)}
                                >
                                  Detail
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 h-8 w-8 p-0"
                                  onClick={(e) => handleDelete(p.id, e)}
                                  disabled={isDeleting === p.id}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </Card>
            )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4">
            <p className="text-xs text-muted-foreground">
              Menampilkan <span className="font-semibold text-foreground">{(page - 1) * pageSize + 1}</span>-
              <span className="font-semibold text-foreground">
                {Math.min(page * pageSize, sortedProfiles.length)}
              </span>{' '}
              dari <span className="font-semibold text-foreground">{sortedProfiles.length}</span> dokumen
            </p>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg text-xs"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg text-xs"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Selanjutnya
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* DETAIL DRAWER / DIALOG */}
      <Dialog open={selectedProfile !== null} onOpenChange={(open) => !open && setSelectedProfile(null)}>
        {selectedProfile && (
          <DialogContent className="min-w-5xl h-[88vh] flex flex-col p-0 overflow-hidden bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="border-b border-slate-100 dark:border-slate-800 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 bg-slate-50/50 dark:bg-slate-950/25">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedProfile.jobProfileNumber && (
                    <code className="text-xs font-mono font-bold bg-primary/10 text-primary px-2 py-0.5 rounded">
                      {ids.code(selectedProfile.jobProfileNumber)}
                    </code>
                  )}
                  <Badge className={`text-[10px] px-2 py-0.5 font-bold capitalize border ${statusTone[profileState(selectedProfile).key]}`}>
                    {profileState(selectedProfile).label}
                  </Badge>
                  <TenantAssignmentControl
                    jobProfileId={selectedProfile.id}
                    tenantIds={selectedProfile.tenantIds ?? []}
                    tenants={tenants}
                    onChange={handleTenantsChanged}
                  />
                </div>
                <DialogTitle className="text-xl font-extrabold text-foreground leading-tight">
                  {selectedProfile.positionName || fileNameOf(selectedProfile.fileName)}
                </DialogTitle>
                <p className="text-xs text-muted-foreground flex items-center gap-2 font-medium">
                  <span>{selectedProfile.divisionDepartment || 'Tanpa Divisi'}</span>
                  {selectedProfile.supervisor && (
                    <>
                      <span>•</span>
                      <span>Atasan: {selectedProfile.supervisor}</span>
                    </>
                  )}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pr-6">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg h-9 px-3 gap-1.5 text-xs text-slate-700 dark:text-slate-300"
                  onClick={() => selectedProfile.extractedData && copyToClipboard(JSON.stringify(selectedProfile.extractedData, null, 2))}
                  // Demo mode: the content is masked server-side; copying the
                  // JSON out would still hand over everything that was not.
                  disabled={ids.demo}
                  title={ids.demo ? 'Tidak tersedia dalam mode demo' : undefined}
                >
                  {isCopied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  <span>Salin JSON</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg h-9 px-3 gap-1.5 text-xs text-slate-700 dark:text-slate-300"
                  onClick={() => handleReextract(selectedProfile.id)}
                  disabled={isReextracting === selectedProfile.id}
                  title="Baca ulang dokumen PDF ini dan ganti hasil ekstraksinya. Pakai ini bila kompetensi tertukar atau levelnya salah."
                >
                  {isReextracting === selectedProfile.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span>{isReextracting === selectedProfile.id ? 'Membaca…' : 'Baca Ulang'}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-lg h-9 w-9 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                  onClick={(e) => selectedProfile && handleDelete(selectedProfile.id, e)}
                  disabled={isDeleting === selectedProfile.id}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Reusable read-only detail body (error banner + tabbed view). */}
            <JobProfileDetailContent profile={selectedProfile} />
            
            {/* Modal footer wrapper */}
            <div className="border-t border-slate-100 dark:border-slate-800/80 p-4 bg-slate-50/50 dark:bg-slate-950/20 flex justify-end shrink-0">
              <Button onClick={() => setSelectedProfile(null)} className="h-9 px-4 text-xs font-semibold rounded-lg">
                Tutup Katalog
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* One confirmation dialog for the whole page, driven by `pendingConfirm`.
          Replaces the browser's native confirm(), which could not be styled,
          could not be themed, and on some browsers is suppressible — so a
          permanent delete could go through with no prompt at all. */}
      <AlertDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
      >
        {pendingConfirm && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{CONFIRM_COPY[pendingConfirm.kind].title}</AlertDialogTitle>
              <AlertDialogDescription>
                {CONFIRM_COPY[pendingConfirm.kind].description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                variant={CONFIRM_COPY[pendingConfirm.kind].destructive ? 'destructive' : 'default'}
                onClick={() => {
                  // Read the target before the dialog closes and clears it.
                  const target = pendingConfirm;
                  setPendingConfirm(null);
                  if (target.kind === 'delete') void runDelete(target.id);
                  else if (target.kind === 'reextract') void runReextract(target.id);
                  else void runRetryAllFailed();
                }}
              >
                {CONFIRM_COPY[pendingConfirm.kind].action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
