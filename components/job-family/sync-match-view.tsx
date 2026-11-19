'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { InfoHint } from '@/components/ui/info-hint';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Users,
  FileText,
  Briefcase,
  Link2,
  Unlink,
  RefreshCw,
  Loader2,
  Search,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Network,
  Save,
  Filter,
  Check,
  XCircle,
  Building,
  Database,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  runJobProfileMatchAction,
  getCandidateDetailAction,
  getJobProfileByIdAction,
  getUnmatchedProfileDiagnosisAction,
  getUnmatchedCandidateDiagnosisAction,
  saveMatchesToDbAction,
  getSavedMatchStatsAction,
  searchJobProfilesForMatchAction,
  setManualMatchAction,
  removeManualMatchAction,
  type JobProfileOption,
  type JobFamilyMatchReport,
  type MatchType,
  type MatchTenant,
  type MatchedPair,
  type CandidateEnrichmentDetail,
  type SavedMatchStats,
  type UnmatchedProfileDiagnosis,
  type UnmatchedCandidateDiagnosis,
  type CandidateScenario,
  type ProfileScenario,
} from '@/lib/job-family-sync-actions';
import {
  JobProfileDetailContent,
  type JobProfileRow,
} from '@/components/job-profiles/job-profile-detail-content';
import { formatDate, formatDateTime } from '@/lib/datetime';
import { useIdentifierDisplay } from '@/components/app-mode-provider';
import { maskJobProfileFileName } from '@/lib/demo/mask';

const MATCH_TONE: Record<MatchType, string> = {
  filename: 'border-amber-300/60 bg-amber-500/10 text-amber-700 dark:border-amber-800 dark:text-amber-300',
  exact: 'border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300',
  // Teal, next to `exact` in the palette rather than beside the fuzzy tiers:
  // this is still an EXACT string equality, just against the file name instead
  // of the extracted position_name.
  'file-alias': 'border-teal-300/60 bg-teal-500/10 text-teal-700 dark:border-teal-800 dark:text-teal-300',
  embedding: 'border-violet-300/60 bg-violet-500/10 text-violet-700 dark:border-violet-800 dark:text-violet-300',
  manual: 'border-sky-300/60 bg-sky-500/10 text-sky-700 dark:border-sky-800 dark:text-sky-300',
  ai: 'border-fuchsia-300/60 bg-fuchsia-500/10 text-fuchsia-700 dark:border-fuchsia-800 dark:text-fuchsia-300',
};

const MATCH_LABEL: Record<MatchType, string> = {
  filename: 'ID Posisi (nama file)',
  exact: 'Nama Posisi',
  'file-alias': 'Nama Berkas',
  embedding: 'Embedding >98%',
  manual: 'Manual',
  ai: 'AI',
};

const CANDIDATE_SCENARIO_LABEL: Record<CandidateScenario, string> = {
  'no-active-position': 'Tanpa posisi aktif',
  'no-jd': 'Posisi tanpa JD cocok',
};

const PROFILE_SCENARIO_LABEL: Record<ProfileScenario, string> = {
  'candidate-other-tenant': 'Kandidat Company lain',
  'non-candidate-incumbent': 'Incumbent non-kandidat',
  'no-active-incumbent': 'Tanpa incumbent aktif',
};

const PROFILE_SCENARIO_TONE: Record<ProfileScenario, string> = {
  'candidate-other-tenant': 'border-sky-300/60 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'non-candidate-incumbent': 'border-amber-300/60 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'no-active-incumbent': 'border-muted-foreground/30 text-muted-foreground',
};

type ModalKey = 'unmatchedCandidates' | 'unmatchedProfiles' | 'unmatchedPositions' | null;

function StatCard({
  icon: Icon,
  label,
  value,
  display,
  tone,
  hint,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  /** Replaces the number (e.g. "—" when a snapshot cannot answer this card). */
  display?: string;
  tone?: 'default' | 'warn' | 'good';
  hint?: string;
  onClick?: () => void;
}) {
  const valueTone =
    tone === 'warn'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'good'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-foreground';
  const clickable = typeof onClick === 'function';
  return (
    <Card
      onClick={onClick}
      className={`p-3 ${clickable ? 'cursor-pointer transition-all hover:border-primary/50 hover:shadow-md' : ''}`}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        {clickable && <Search className="ml-auto h-3 w-3 shrink-0 opacity-40" />}
      </div>
      <p className={`mt-1 text-xl font-bold leading-none tabular-nums ${valueTone}`}>{display ?? value}</p>
      {hint && <p className="mt-1 truncate text-[10px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/** Integer percentage of a/b (0 when b is 0). */
function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

function useTitleFilter<T>(items: T[], get: (item: T) => string, q: string): T[] {
  const query = q.trim().toLowerCase();
  if (!query) return items;
  return items.filter((it) => get(it).toLowerCase().includes(query));
}

export function SyncMatchView({
  initialReport,
  tenants,
}: {
  initialReport: JobFamilyMatchReport;
  /**
   * Tenants offered by the in-view tenant (company) scope selector, so a match
   * run can span companies. Empty (e.g. the lookup failed) hides the selector
   * and the report stays on whatever scope it was built with.
   */
  tenants: MatchTenant[];
}) {
  const ids = useIdentifierDisplay();
  const [report, setReport] = useState<JobFamilyMatchReport>(initialReport);
  const [running, startRun] = useTransition();
  // Local tenant scope (only used when `tenants` is provided). Kept in sync with
  // whatever the last run actually included.
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>(
    initialReport.selectedTenantIds,
  );
  const [modal, setModal] = useState<ModalKey>(null);
  const [modalQuery, setModalQuery] = useState('');
  const [matchedQuery, setMatchedQuery] = useState('');
  const [jobProfileFilter, setJobProfileFilter] = useState('all');
  const [positionFilter, setPositionFilter] = useState('all');
  const [matchTypeFilter, setMatchTypeFilter] = useState<'all' | MatchType>('all');
  // Last-resort tier: on by default so every position ends up with a JD, but an
  // operator can turn it off to see purely deterministic pairings.
  const [useAi, setUseAi] = useState(true);

  // Persisted-match snapshot state.
  const [savedStats, setSavedStats] = useState<SavedMatchStats | null>(null);
  const [saving, setSaving] = useState(false);

  // Job profile detail dialog (reuses the catalog's detail renderer).
  const [profileDetail, setProfileDetail] = useState<JobProfileRow | null>(null);
  const [loadingProfileId, setLoadingProfileId] = useState<number | null>(null);
  // Why-unmatched diagnosis shown atop the detail when opened from that list.
  const [profileDiagnosis, setProfileDiagnosis] = useState<UnmatchedProfileDiagnosis | null>(null);

  // Matched-pair detail dialog (candidate + profile + match reason).
  const [selectedMatch, setSelectedMatch] = useState<MatchedPair | null>(null);

  // Manual matching — one picker per direction (candidate→JD, JD→candidate).
  const [manualForCandidate, setManualForCandidate] = useState<{
    candidateId: string;
    candidateName: string;
    currentPosition: string | null;
  } | null>(null);
  const [manualForProfile, setManualForProfile] = useState<{
    jobProfileId: number;
    positionName: string;
  } | null>(null);

  function openModal(key: ModalKey) {
    setModalQuery('');
    setModal(key);
  }

  function runReport(tenantIds: string[], quiet = false, aiMode = useAi) {
    startRun(async () => {
      try {
        // Every run goes through the persisting action, so the result the user
        // is looking at is also what the section opens on next time.
        const next = await runJobProfileMatchAction({ tenantIds, useAi: aiMode });
        setReport(next);
        if (!next.embeddingAvailable) {
          toast.warning('Layanan embedding tidak tersedia — pencocokan embedding (>98%) dilewati.');
        } else if (aiMode && !next.aiAvailable) {
          toast.warning('Model AI tidak dapat dihubungi — tier AI dilewati (LLM_BASE_URL/LLM_MODEL).');
        } else if (next.aiDeferredTitles > 0) {
          toast.info(
            `${next.aiDeferredTitles} jabatan menunggu giliran AI — jalankan sinkronisasi lagi untuk melanjutkan.`,
          );
        } else if (!quiet) {
          toast.success('Sinkronisasi pencocokan selesai.');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal menjalankan sinkronisasi.');
      }
    });
  }

  function handleRun() {
    // In embedded mode the scope comes from the in-view selector; on the
    // standalone page it mirrors the sidebar cookie (both start from the report).
    runReport(selectedTenantIds);
  }

  // Toggle a tenant in/out of scope and immediately re-run against the new set.
  function toggleTenant(tenantId: string) {
    const has = selectedTenantIds.includes(tenantId);
    if (has && selectedTenantIds.length === 1) return; // keep at least one
    const next = has
      ? selectedTenantIds.filter((id) => id !== tenantId)
      : [...selectedTenantIds, tenantId];
    setSelectedTenantIds(next);
    runReport(next);
  }

  async function openProfileDetail(jobProfileId: number) {
    setLoadingProfileId(jobProfileId);
    setProfileDiagnosis(null);
    try {
      const detail = await getJobProfileByIdAction(jobProfileId);
      if (!detail) {
        toast.error('Job profile tidak ditemukan.');
        return;
      }
      setProfileDetail(detail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat job profile.');
    } finally {
      setLoadingProfileId(null);
    }
  }

  // From the "Profil tanpa incumbent" list — load detail + why-unmatched diagnosis.
  async function openUnmatchedProfile(jobProfileId: number) {
    setLoadingProfileId(jobProfileId);
    setProfileDiagnosis(null);
    try {
      const [detail, diagnosis] = await Promise.all([
        getJobProfileByIdAction(jobProfileId),
        getUnmatchedProfileDiagnosisAction({
          jobProfileId,
          selectedTenantIds: report.selectedTenantIds,
        }).catch(() => null),
      ]);
      if (!detail) {
        toast.error('Job profile tidak ditemukan.');
        return;
      }
      setProfileDetail(detail);
      setProfileDiagnosis(diagnosis);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat job profile.');
    } finally {
      setLoadingProfileId(null);
    }
  }

  // Load persisted-match stats once (best-effort).
  useEffect(() => {
    getSavedMatchStatsAction()
      .then(setSavedStats)
      .catch(() => {});
  }, []);

  // A manual pin is written straight to the DB, so the on-screen report is stale
  // the moment it lands. Re-running is what moves the candidate out of the
  // unmatched list and into `matched` — quiet, because the operator asked for a
  // pin, not for a full sync they need to be told about.
  function refreshAfterManual() {
    runReport(selectedTenantIds, true);
    getSavedMatchStatsAction().then(setSavedStats).catch(() => {});
  }

  async function handleRemoveManual(candidateId: string) {
    try {
      const res = await removeManualMatchAction(candidateId);
      if (res.ok) {
        toast.success(res.message);
        setSelectedMatch(null);
        refreshAfterManual();
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal melepas pemetaan manual.');
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveMatchesToDbAction(report.matched);
      if (res.ok) {
        toast.success(res.message);
        getSavedMatchStatsAction().then(setSavedStats).catch(() => {});
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan pemetaan.');
    } finally {
      setSaving(false);
    }
  }

  const { stats } = report;

  // Distinct filter options derived from the full matched set.
  const jobProfileOptions = Array.from(new Set(report.matched.map((m) => m.jobProfileName))).sort((a, b) =>
    a.localeCompare(b),
  );
  const positionOptions = Array.from(new Set(report.matched.map((m) => m.currentPosition))).sort((a, b) =>
    a.localeCompare(b),
  );

  // Combobox shapes. 'all' is a real option value, not '' — the trigger has to
  // resolve the current value to a label, and an empty value has none.
  const jobProfileFilterOptions = [
    { value: 'all', label: 'Semua Job Profile' },
    ...jobProfileOptions.map((p) => ({ value: p, label: p })),
  ];
  const positionFilterOptions = [
    { value: 'all', label: 'Semua Posisi Kandidat' },
    ...positionOptions.map((p) => ({ value: p, label: p })),
  ];

  // Count matches per tier (for the match-type filter labels).
  const matchTypeCounts = countBy(report.matched, (m) => m.matchType);

  // Apply the dropdown filters (job profile, candidate position, match tier),
  // then the free-text search.
  const matched = useTitleFilter(
    report.matched.filter(
      (m) =>
        (jobProfileFilter === 'all' || m.jobProfileName === jobProfileFilter) &&
        (positionFilter === 'all' || m.currentPosition === positionFilter) &&
        (matchTypeFilter === 'all' || m.matchType === matchTypeFilter),
    ),
    (m) => `${m.candidateName} ${m.currentPosition} ${m.jobProfileName}`,
    matchedQuery,
  );

  const isSnapshot = report.source === 'saved';

  return (
    <div className="space-y-4">
      {/* A stored (or just-finished) run: say when it was made and by whom, so
          a reader knows how old the picture is before deciding to re-run.
          Nothing here is disabled — the report is complete. */}
      {!isSnapshot && report.runAt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Hasil pencocokan <strong className="text-foreground">{formatDateTime(report.runAt)} WIB</strong>
              {report.runBy ? ` oleh ${report.runBy}` : ''} — {report.stats.matchedCandidates} pasangan,{' '}
              {report.stats.unmatchedCandidates} kandidat tanpa profil.{' '}
              <InfoHint title="Hasil pencocokan tersimpan" size="xs">
                <p>
                  Tersimpan dan tampil lagi di kunjungan berikutnya; jalankan ulang bila data posisi
                  atau job profile berubah.
                </p>
              </InfoHint>
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={handleRun} disabled={running} className="shrink-0">
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {running ? 'Menjalankan...' : 'Jalankan Ulang'}
          </Button>
        </div>
      )}

      {isSnapshot && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-300/70 bg-sky-500/5 p-3 dark:border-sky-900/50">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <p className="text-xs leading-relaxed text-sky-800/90 dark:text-sky-200/90">
              Menampilkan <strong>pemetaan tersimpan</strong> — {report.stats.matchedCandidates} pasangan
              {report.savedAt ? `, terakhir disimpan ${formatDateTime(report.savedAt)} WIB` : ''}. Belum ada
              pencocokan yang dihitung ulang di sesi ini; angka &ldquo;Posisi Aktif tanpa Profil&rdquo; dan
              &ldquo;Profil Tanpa Incumbent&rdquo; baru terisi setelah sinkronisasi dijalankan.
            </p>
          </div>
          <Button size="sm" onClick={handleRun} disabled={running} className="shrink-0">
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {running ? 'Menjalankan...' : 'Jalankan Sinkronisasi'}
          </Button>
        </div>
      )}

      {!report.embeddingAvailable && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-500/5 p-3 dark:border-amber-900/50">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
            Tier embedding (&gt;98%) dilewati — <strong>scoring-service</strong> tak dapat dihubungi
            (<code className="font-mono">SCORING_SERVICE_URL</code> belum di-set atau service mati).
          </p>
        </div>
      )}

      {report.aiEnabled && !report.aiAvailable && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-500/5 p-3 dark:border-amber-900/50">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-700/90 dark:text-amber-300/90">
            Tier AI dilewati — model tidak dapat dihubungi
            (<code className="font-mono">LLM_BASE_URL</code> / <code className="font-mono">LLM_MODEL</code>{' '}
            belum di-set atau layanan mati). Jabatan sisa tetap tampil sebagai belum cocok, bukan
            dipasangkan asal.
          </p>
        </div>
      )}

      {/* Statistics — one compact row. Unmatched cards open modals. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={Users}
          label="Kandidat"
          value={stats.totalCandidates}
          hint={`${report.selectedTenantIds.length} Company terpilih`}
        />
        <StatCard
          icon={FileText}
          label="Job Profile"
          value={stats.totalProfiles}
          hint="completed & bernama"
        />
        <StatCard
          icon={Link2}
          label="Cocok"
          value={stats.matchedCandidates}
          tone="good"
          hint={`${pct(stats.matchedCandidates, stats.totalCandidates)}% kandidat`}
        />
        <StatCard
          icon={Briefcase}
          label="Posisi Aktif tanpa Profil"
          value={stats.unmatchedPositions}
          display={isSnapshot ? '—' : undefined}
          hint={isSnapshot ? 'jalankan sinkronisasi' : 'klik untuk rincian'}
          onClick={isSnapshot ? undefined : () => openModal('unmatchedPositions')}
        />
        <StatCard
          icon={Unlink}
          label="Kandidat Tanpa Profil"
          value={stats.unmatchedCandidates}
          tone="warn"
          hint={`${pct(stats.unmatchedCandidates, stats.totalCandidates)}% · klik untuk rincian`}
          onClick={() => openModal('unmatchedCandidates')}
        />
        <StatCard
          icon={Unlink}
          label="Profil Tanpa Incumbent"
          value={stats.unmatchedProfiles}
          display={isSnapshot ? '—' : undefined}
          tone="warn"
          hint={
            isSnapshot
              ? 'jalankan sinkronisasi'
              : `${pct(stats.unmatchedProfiles, stats.totalProfiles)}% · klik untuk rincian`
          }
          onClick={isSnapshot ? undefined : () => openModal('unmatchedProfiles')}
        />
      </div>

      {/* ── Main highlight: matched pairs (succession-need potential) ── */}
      <Card className="overflow-hidden border-emerald-300/50 dark:border-emerald-900/50">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-emerald-500/5 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Link2 className="h-5 w-5" />
            </div>
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold">
              <span className="inline-flex items-center gap-1.5">
                Pasangan Kandidat ↔ Job Profile
                <InfoHint title="Pasangan Kandidat ↔ Job Profile">
                  <p>
                    Kandidat aktif yang cocok dengan job profile — indikasi potensi kebutuhan suksesi
                    &amp; basis clustering job family.
                  </p>
                </InfoHint>
              </span>
              <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                {stats.matchedCandidates}
              </Badge>
              {savedStats && savedStats.total > 0 && (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Save className="h-3 w-3" /> {savedStats.total} tersimpan
                </Badge>
              )}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {/* Last-resort tier. Off = deterministic tiers only, which is how the
                report behaved before the AI tier existed. */}
            <label
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"
              title="Sisa jabatan yang tidak cocok lewat ID posisi / nama / embedding dipasangkan oleh AI dari daftar JD terdekat."
            >
              <Checkbox
                checked={useAi}
                disabled={running}
                onCheckedChange={(next) => {
                  const enabled = next === true;
                  setUseAi(enabled);
                  runReport(selectedTenantIds, false, enabled);
                }}
              />
              <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" />
              <span>Cocokkan sisa dengan AI</span>
            </label>
            {tenants && tenants.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={running}>
                    <Building className="mr-1.5 h-3.5 w-3.5 text-primary" />
                    {selectedTenantIds.length === 1
                      ? tenants.find((t) => t.tenantId === selectedTenantIds[0])?.tenantName ??
                        '1 Company'
                      : `${selectedTenantIds.length} Company`}
                    <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {tenants.map((t) => (
                    <DropdownMenuCheckboxItem
                      key={t.tenantId}
                      checked={selectedTenantIds.includes(t.tenantId)}
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={() => toggleTenant(t.tenantId)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{t.tenantName}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {t.candidateCount} kandidat
                          {t.companyIds.length > 0 ? ` · ${t.companyIds.join(', ')}` : ''}
                        </span>
                      </span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button size="sm" variant="outline" onClick={handleRun} disabled={running}>
              {running ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              {running ? 'Menjalankan...' : 'Jalankan Sinkronisasi'}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || report.matched.length === 0 || isSnapshot}
              title={isSnapshot ? 'Ini sudah pemetaan tersimpan — jalankan sinkronisasi dulu untuk menyimpan hasil baru.' : undefined}
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Simpan Pemetaan
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-5 py-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Filter className="h-3.5 w-3.5" /> Filter:
          </span>
          {/* Fixed set (the four match tiers + "all") — plain Select. */}
          <Select
            value={matchTypeFilter}
            onValueChange={(v) => setMatchTypeFilter(v as 'all' | MatchType)}
          >
            <SelectTrigger size="sm" className="h-8 w-[13rem] text-xs" aria-label="Filter jalur kecocokan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                Semua jalur ({report.matched.length})
              </SelectItem>
              {(Object.keys(MATCH_LABEL) as MatchType[]).map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {MATCH_LABEL[t]} ({matchTypeCounts.get(t) ?? 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Both lists are derived from the matched pairs, so they grow with the
              data — searchable Combobox rather than a scroll-hunt. */}
          <div className="w-[14rem]">
            <Combobox
              options={jobProfileFilterOptions}
              value={jobProfileFilter}
              onValueChange={setJobProfileFilter}
              placeholder="Semua Job Profile"
              searchPlaceholder="Cari job profile…"
              emptyText="Job profile tidak ditemukan."
              triggerClassName="h-8 text-xs"
            />
          </div>
          <div className="w-[14rem]">
            <Combobox
              options={positionFilterOptions}
              value={positionFilter}
              onValueChange={setPositionFilter}
              placeholder="Semua Posisi Kandidat"
              searchPlaceholder="Cari posisi kandidat…"
              emptyText="Posisi tidak ditemukan."
              triggerClassName="h-8 text-xs"
            />
          </div>
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={matchedQuery}
              onChange={(e) => setMatchedQuery(e.target.value)}
              placeholder="Cari..."
              className="h-8 w-48 pl-8 text-xs"
            />
          </div>
          {(jobProfileFilter !== 'all' || positionFilter !== 'all' || matchTypeFilter !== 'all' || matchedQuery) && (
            <span className="text-[11px] text-muted-foreground">{matched.length} hasil</span>
          )}
        </div>

        <div className="p-5">
          {matched.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
              <Network className="mb-3 h-9 w-9 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">
                {report.matched.length === 0
                  ? 'Belum ada pasangan cocok. Klik "Jalankan Sinkronisasi".'
                  : 'Tidak ada hasil untuk filter ini.'}
              </p>
            </div>
          ) : (
            <div className="grid max-h-[32rem] gap-2 overflow-auto pr-1 lg:grid-cols-2">
              {matched.map((m) => (
                <button
                  key={m.candidateId}
                  type="button"
                  onClick={() => setSelectedMatch(m)}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-emerald-400/60 hover:bg-emerald-500/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {m.candidateName}
                      {m.companyId && (
                        <Badge variant="secondary" className="shrink-0 text-[9px] font-mono">{m.companyId}</Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.currentPosition}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1 text-right">
                    <p className="truncate text-sm font-medium">{m.jobProfileName}</p>
                    <Badge variant="outline" className={`mt-0.5 text-[10px] ${MATCH_TONE[m.matchType]}`}>
                      {MATCH_LABEL[m.matchType]}
                      {m.matchType === 'embedding' && m.similarity != null
                        ? ` · ${Math.round(m.similarity * 100)}%`
                        : m.matchType === 'ai' && m.aiConfidence != null
                          ? ` · ${Math.round(m.aiConfidence * 100)}%`
                          : ''}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Modals */}
      <UnmatchedCandidatesModal
        open={modal === 'unmatchedCandidates'}
        onClose={() => setModal(null)}
        candidates={report.unmatchedCandidates}
        query={modalQuery}
        onQuery={setModalQuery}
        onManualMatch={(c) =>
          setManualForCandidate({
            candidateId: c.candidateId,
            candidateName: c.candidateName,
            currentPosition: c.currentPosition,
          })
        }
      />
      <UnmatchedProfilesModal
        open={modal === 'unmatchedProfiles'}
        onClose={() => setModal(null)}
        profiles={report.unmatchedProfiles}
        onManualMatch={(p) =>
          setManualForProfile({ jobProfileId: p.jobProfileId, positionName: p.positionName })
        }
        query={modalQuery}
        onQuery={setModalQuery}
        onOpenProfile={openUnmatchedProfile}
        loadingProfileId={loadingProfileId}
      />
      <UnmatchedPositionsModal
        open={modal === 'unmatchedPositions'}
        onClose={() => setModal(null)}
        positions={report.unmatchedPositions}
        totalPositions={report.stats.totalCurrentPositions}
        query={modalQuery}
        onQuery={setModalQuery}
      />

      {/* Reused job profile detail dialog (+ why-unmatched diagnosis) */}
      <Dialog
        open={profileDetail !== null}
        onOpenChange={(open) => {
          if (!open) {
            setProfileDetail(null);
            setProfileDiagnosis(null);
          }
        }}
      >
        {profileDetail && (
          <DialogContent className="flex max-h-[88vh] min-w-[min(56rem,92vw)] flex-col gap-0 p-0">
            <DialogHeader className="border-b p-5">
              <DialogTitle className="text-base">{profileDetail.positionName ?? (ids.demo ? maskJobProfileFileName(profileDetail.fileName) : profileDetail.fileName)}</DialogTitle>
              <DialogDescription className="text-xs">
                {profileDetail.divisionDepartment ?? 'Detail job profile'}
              </DialogDescription>
            </DialogHeader>
            {profileDiagnosis && (
              <div className="max-h-[40vh] overflow-auto border-b p-5">
                <UnmatchedDiagnosisCard diagnosis={profileDiagnosis} />
              </div>
            )}
            <JobProfileDetailContent profile={profileDetail} />
          </DialogContent>
        )}
      </Dialog>

      {/* Matched-pair detail: candidate + profile + match reason */}
      <MatchDetailModal
        pair={selectedMatch}
        onClose={() => setSelectedMatch(null)}
        onRepin={(pair) =>
          setManualForCandidate({
            candidateId: pair.candidateId,
            candidateName: pair.candidateName,
            currentPosition: pair.currentPosition,
          })
        }
        onRemoveManual={handleRemoveManual}
      />

      <ManualMatchProfileDialog
        candidate={manualForCandidate}
        onClose={() => setManualForCandidate(null)}
        onDone={refreshAfterManual}
      />
      <ManualMatchCandidateDialog
        profile={manualForProfile}
        candidates={report.unmatchedCandidates}
        onClose={() => setManualForProfile(null)}
        onDone={refreshAfterManual}
      />
    </div>
  );
}

// ── Matched-pair detail (candidate + job profile + why they matched) ──

/** Renders the type-specific "alasan kecocokan" block. */
function MatchReason({ pair }: { pair: MatchedPair }) {
  const ids = useIdentifierDisplay();
  if (pair.matchType === 'filename') {
    return (
      <div className="rounded-lg border border-amber-300/50 bg-amber-500/5 p-4 space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
          <FileText className="h-4 w-4" /> Cocok via kode nama file
        </p>
        <p className="text-xs text-muted-foreground">
          Kode posisi kandidat (<span className="font-mono">position_id</span>) identik dengan kode di
          awal nama file job profile.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border bg-background/60 p-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Kode posisi</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-amber-700 dark:text-amber-300">
              {ids.code(pair.matchedCode)}
            </p>
          </div>
          {pair.jdNumber && (
            <div className="rounded-md border bg-background/60 p-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nomor JD</p>
              <p className="mt-0.5 font-mono text-sm font-semibold">{ids.code(pair.jdNumber)}</p>
            </div>
          )}
        </div>
        {pair.fileName && (
          <div className="rounded-md border bg-background/60 p-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nama file</p>
            <p className="mt-0.5 break-all font-mono text-xs">{ids.demo ? maskJobProfileFileName(pair.fileName) : pair.fileName}</p>
          </div>
        )}
      </div>
    );
  }

  if (pair.matchType === 'exact') {
    return (
      <div className="rounded-lg border border-emerald-300/50 bg-emerald-500/5 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <Link2 className="h-4 w-4" /> Sama persis
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Judul jabatan kandidat identik dengan nama job profile — basis kecocokan adalah profil pekerjaan di bawah.
        </p>
        <p className="mt-2 rounded-md bg-background/60 px-2 py-1 font-mono text-xs">{pair.jobProfileName}</p>
      </div>
    );
  }

  if (pair.matchType === 'ai') {
    const confPct = pair.aiConfidence != null ? Math.round(pair.aiConfidence * 100) : null;
    return (
      <div className="space-y-3 rounded-lg border border-fuchsia-300/50 bg-fuchsia-500/5 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-fuchsia-700 dark:text-fuchsia-300">
            <Sparkles className="h-4 w-4" /> Dipasangkan oleh AI
          </p>
          {confPct != null && (
            <Badge variant="outline" className={MATCH_TONE.ai}>
              Keyakinan {confPct}%
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Tidak ada kecocokan lewat ID posisi, nama persis, maupun embedding &gt;98%. AI memilih dari
          daftar JD terdekat berdasarkan kesamaan fungsi dan level jabatan.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border bg-background/60 p-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Posisi kandidat</p>
            <p className="mt-0.5 text-sm font-medium">{pair.currentPosition}</p>
          </div>
          <div className="rounded-md border bg-background/60 p-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nama job profile</p>
            <p className="mt-0.5 text-sm font-medium">{pair.jobProfileName}</p>
          </div>
        </div>
        {pair.aiReason && (
          <div className="rounded-md border bg-background/60 p-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Alasan AI</p>
            <p className="mt-0.5 text-sm leading-relaxed">{pair.aiReason}</p>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Keputusan AI disimpan per nama jabatan, jadi hasilnya tetap sama pada sinkronisasi
          berikutnya. Bila keliru, gunakan <strong>Timpa manual</strong> — pin manual tidak pernah
          ditimpa tier otomatis mana pun.
        </p>
      </div>
    );
  }

  // embedding
  const simPct = pair.similarity != null ? Math.round(pair.similarity * 100) : null;
  return (
    <div className="rounded-lg border border-violet-300/50 bg-violet-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
          <Sparkles className="h-4 w-4" /> Kecocokan embedding (&gt;98%)
        </p>
        {simPct != null && (
          <Badge variant="outline" className={MATCH_TONE.embedding}>
            Similaritas {simPct}%
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Dua teks yang dicocokkan melalui kemiripan vektor:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border bg-background/60 p-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Posisi kandidat</p>
          <p className="mt-0.5 text-sm font-medium">{pair.currentPosition}</p>
        </div>
        <div className="rounded-md border bg-background/60 p-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nama job profile</p>
          <p className="mt-0.5 text-sm font-medium">{pair.jobProfileName}</p>
        </div>
      </div>
      {simPct != null && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${simPct}%` }} />
        </div>
      )}
    </div>
  );
}

function MatchDetailModal({
  pair,
  onClose,
  onRepin,
  onRemoveManual,
}: {
  pair: MatchedPair | null;
  onClose: () => void;
  /** Re-pin this candidate to a different JD — also the fix for a WRONG automatic match. */
  onRepin: (pair: MatchedPair) => void;
  onRemoveManual: (candidateId: string) => void;
}) {
  const [candidate, setCandidate] = useState<CandidateEnrichmentDetail | null>(null);
  const [profile, setProfile] = useState<JobProfileRow | null>(null);
  const [loadingCand, setLoadingCand] = useState(false);
  const [loadingProf, setLoadingProf] = useState(false);

  useEffect(() => {
    if (!pair) return;
    let alive = true;
    setCandidate(null);
    setProfile(null);
    setLoadingCand(true);
    setLoadingProf(true);
    getCandidateDetailAction(pair.candidateId)
      .then((d) => alive && setCandidate(d))
      .catch(() => {})
      .finally(() => alive && setLoadingCand(false));
    getJobProfileByIdAction(pair.jobProfileId)
      .then((d) => alive && setProfile(d))
      .catch(() => {})
      .finally(() => alive && setLoadingProf(false));
    return () => {
      alive = false;
    };
  }, [pair]);

  // For exact matches the spec asks to show just the job profile info.
  const showCandidate = pair ? pair.matchType !== 'exact' : false;

  return (
    <Dialog open={pair !== null} onOpenChange={(open) => !open && onClose()}>
      {pair && (
        <DialogContent className="flex max-h-[90vh] min-w-[min(60rem,94vw)] flex-col gap-0 p-0">
          <DialogHeader className="border-b p-5">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <span>{pair.candidateName}</span>
              {pair.companyId && (
                <Badge variant="secondary" className="text-[10px] font-mono">{pair.companyId}</Badge>
              )}
              <ArrowRight className="h-4 w-4 text-emerald-500" />
              <span>{pair.jobProfileName}</span>
              <Badge variant="outline" className={`text-[10px] ${MATCH_TONE[pair.matchType]}`}>
                {MATCH_LABEL[pair.matchType]}
                {pair.matchType === 'embedding' && pair.similarity != null
                  ? ` · ${Math.round(pair.similarity * 100)}%`
                  : pair.matchType === 'ai' && pair.aiConfidence != null
                    ? ` · ${Math.round(pair.aiConfidence * 100)}%`
                    : ''}
              </Badge>
            </DialogTitle>
            <DialogDescription className="text-xs">{pair.currentPosition}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-auto p-5">
            {/* Match reason */}
            <section>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">Alasan Kecocokan</p>
              <MatchReason pair={pair} />
            </section>

            {/* Candidate info (skipped for exact — profile info is the basis) */}
            {showCandidate && (
              <section>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">Informasi Kandidat</p>
                {loadingCand ? (
                  <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat detail kandidat…
                  </div>
                ) : candidate ? (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <CandidateEnrichment detail={candidate} />
                  </div>
                ) : (
                  <p className="py-2 text-xs text-muted-foreground">Detail kandidat tidak tersedia.</p>
                )}
              </section>
            )}

            {/* Job profile info */}
            <section>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">Informasi Profil Pekerjaan</p>
              {loadingProf ? (
                <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat job profile…
                </div>
              ) : profile ? (
                // Bounded flex-column so JobProfileDetailContent's flex-1 tab
                // body gets a height and scrolls internally.
                <div className="flex h-[60vh] flex-col overflow-hidden rounded-lg border">
                  <JobProfileDetailContent profile={profile} />
                </div>
              ) : (
                <p className="py-2 text-xs text-muted-foreground">Job profile tidak ditemukan.</p>
              )}
            </section>
          </div>

          {/* Correction controls. Available on EVERY match, not just manual
              ones: an automatic tier can pair the wrong JD (a shared filename
              code, a >98% title twin), and re-pinning is the only way to
              overrule it — the pin then survives later re-runs. */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4">
            <p className="text-xs text-muted-foreground">
              {pair.matchType === 'manual'
                ? 'Pemetaan manual — tidak akan ditimpa pencocokan otomatis.'
                : 'Pemetaan otomatis — dapat berubah pada sinkronisasi berikutnya.'}
            </p>
            <div className="flex items-center gap-2">
              {pair.matchType === 'manual' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400"
                  onClick={() => onRemoveManual(pair.candidateId)}
                >
                  <Unlink className="h-3.5 w-3.5" />
                  Lepas pemetaan manual
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                onClick={() => {
                  onRepin(pair);
                  onClose();
                }}
              >
                <Link2 className="h-3.5 w-3.5" />
                {pair.matchType === 'manual' ? 'Ganti job profile' : 'Timpa manual'}
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

// ── Manual matching dialogs ────────────────────────────────────────
// The escape hatch for pairs the three automatic tiers cannot reach. Two entry
// points because the operator can start from either side of the gap: a
// candidate with no JD, or a JD with no incumbent. Both write the same row.

/** Pick a JOB PROFILE for a given candidate. */
function ManualMatchProfileDialog({
  candidate,
  onClose,
  onDone,
}: {
  candidate: { candidateId: string; candidateName: string; currentPosition: string | null } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const ids = useIdentifierDisplay();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<JobProfileOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);

  // Seed with the candidate's own title so the likeliest JD is usually the
  // first thing on screen rather than something the operator must type for.
  useEffect(() => {
    if (!candidate) return;
    setQuery(candidate.currentPosition ?? '');
  }, [candidate]);

  useEffect(() => {
    if (!candidate) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      searchJobProfilesForMatchAction(query)
        .then((rows) => alive && setOptions(rows))
        .catch(() => alive && setOptions([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, candidate]);

  async function pick(jobProfileId: number) {
    if (!candidate) return;
    setSaving(jobProfileId);
    try {
      const res = await setManualMatchAction({ candidateId: candidate.candidateId, jobProfileId });
      if (res.ok) {
        toast.success(res.message);
        onDone();
        onClose();
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan pemetaan manual.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={candidate !== null} onOpenChange={(o) => !o && onClose()}>
      {candidate && (
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="border-b p-5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-sky-500" />
              Cocokkan manual
            </DialogTitle>
            <DialogDescription className="text-xs">
              Pilih job profile untuk <strong>{candidate.candidateName}</strong>
              {candidate.currentPosition ? ` — ${candidate.currentPosition}` : ''}. Pemetaan manual
              disimpan langsung dan TIDAK akan ditimpa oleh pencocokan otomatis berikutnya.
            </DialogDescription>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari nama posisi, divisi, atau nama berkas…"
                className="h-9 pl-8 text-sm"
              />
            </div>
          </DialogHeader>
          <div className="flex-1 space-y-2 overflow-auto p-5">
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat job profile…
              </div>
            ) : options.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Tidak ada job profile yang cocok dengan pencarian.
              </p>
            ) : (
              options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={saving !== null}
                  onClick={() => pick(o.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:border-sky-400/60 hover:bg-sky-500/5 disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{o.positionName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[o.divisionDepartment, o.fileName && (ids.demo ? maskJobProfileFileName(o.fileName) : o.fileName)].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  {saving === o.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-500" />
                  ) : (
                    <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Pick a CANDIDATE for a given job profile (the mirror entry point). */
function ManualMatchCandidateDialog({
  profile,
  candidates,
  onClose,
  onDone,
}: {
  profile: { jobProfileId: number; positionName: string } | null;
  candidates: JobFamilyMatchReport['unmatchedCandidates'];
  onClose: () => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const filtered = useTitleFilter(
    candidates,
    (c) => `${c.candidateName} ${c.currentPosition ?? ''}`,
    query,
  );

  useEffect(() => {
    if (profile) setQuery('');
  }, [profile]);

  async function pick(candidateId: string) {
    if (!profile) return;
    setSaving(candidateId);
    try {
      const res = await setManualMatchAction({ candidateId, jobProfileId: profile.jobProfileId });
      if (res.ok) {
        toast.success(res.message);
        onDone();
        onClose();
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan pemetaan manual.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={profile !== null} onOpenChange={(o) => !o && onClose()}>
      {profile && (
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="border-b p-5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-sky-500" />
              Cocokkan manual
            </DialogTitle>
            <DialogDescription className="text-xs">
              Pilih kandidat untuk job profile <strong>{profile.positionName}</strong>. Daftar ini
              hanya memuat kandidat yang belum punya job profile — kandidat yang sudah cocok tidak
              ditampilkan agar satu kandidat tidak terpetakan dua kali.
            </DialogDescription>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari nama kandidat atau posisi…"
                className="h-9 pl-8 text-sm"
              />
            </div>
          </DialogHeader>
          <div className="flex-1 space-y-2 overflow-auto p-5">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {candidates.length === 0
                  ? 'Semua kandidat sudah punya job profile.'
                  : 'Tidak ada kandidat yang cocok dengan pencarian.'}
              </p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.candidateId}
                  type="button"
                  disabled={saving !== null}
                  onClick={() => pick(c.candidateId)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:border-sky-400/60 hover:bg-sky-500/5 disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.candidateName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.currentPosition ?? (
                        <span className="italic">Posisi saat ini tidak diketahui</span>
                      )}
                    </p>
                  </div>
                  {saving === c.candidateId ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-500" />
                  ) : (
                    <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

// ── Unmatched candidates modal with expandable enrichment rows ──

function UnmatchedCandidatesModal({
  open,
  onClose,
  candidates,
  query,
  onQuery,
  onManualMatch,
}: {
  open: boolean;
  onClose: () => void;
  candidates: JobFamilyMatchReport['unmatchedCandidates'];
  query: string;
  onQuery: (v: string) => void;
  /** Opens the job-profile picker for this candidate. */
  onManualMatch: (c: JobFamilyMatchReport['unmatchedCandidates'][number]) => void;
}) {
  const [scenario, setScenario] = useState<'all' | CandidateScenario>('all');
  const counts = countBy(candidates, (c) => c.scenario);
  const byScenario = scenario === 'all' ? candidates : candidates.filter((c) => c.scenario === scenario);
  const filtered = useTitleFilter(byScenario, (c) => `${c.candidateName} ${c.currentPosition ?? ''}`, query);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            Kandidat tanpa job profile
            <Badge variant="secondary" className="text-[10px]">{candidates.length}</Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Kandidat yang posisi aktifnya tidak cocok dengan job profile mana pun. Klik untuk melihat detail profil &amp; posisi.
          </DialogDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Select
              value={scenario}
              onValueChange={(v) => setScenario(v as 'all' | CandidateScenario)}
            >
              <SelectTrigger size="sm" className="h-9 w-[15rem] text-xs" aria-label="Filter skenario">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  Semua skenario ({candidates.length})
                </SelectItem>
                {(Object.keys(CANDIDATE_SCENARIO_LABEL) as CandidateScenario[]).map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {CANDIDATE_SCENARIO_LABEL[s]} ({counts.get(s) ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Cari..." className="h-9 pl-8 text-sm" />
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 space-y-2 overflow-auto p-5">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {candidates.length === 0 ? 'Semua kandidat cocok dengan job profile.' : 'Tidak ada hasil.'}
            </p>
          ) : (
            filtered.map((c) => (
              <CandidateRow key={c.candidateId} candidate={c} onManualMatch={onManualMatch} />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function countBy<T, K>(items: T[], key: (t: T) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const it of items) {
    const k = key(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function CandidateRow({
  candidate,
  onManualMatch,
}: {
  candidate: JobFamilyMatchReport['unmatchedCandidates'][number];
  onManualMatch: (c: JobFamilyMatchReport['unmatchedCandidates'][number]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<CandidateEnrichmentDetail | null>(null);
  const [diagnosis, setDiagnosis] = useState<UnmatchedCandidateDiagnosis | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail && state !== 'loading') {
      setState('loading');
      try {
        const [d, diag] = await Promise.all([
          getCandidateDetailAction(candidate.candidateId),
          getUnmatchedCandidateDiagnosisAction(candidate.candidateId).catch(() => null),
        ]);
        setDetail(d);
        setDiagnosis(diag);
        setState('idle');
      } catch {
        setState('error');
      }
    }
  }

  return (
    <div className="rounded-lg border">
      {/* The manual-match control sits BESIDE the expand toggle, never inside
          it — nesting a button in a button is invalid HTML and the inner click
          would also toggle the row. */}
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 p-3 text-left"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{candidate.candidateName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {candidate.currentPosition ?? <span className="italic">Posisi saat ini tidak diketahui</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="text-[9px] text-muted-foreground">
              {CANDIDATE_SCENARIO_LABEL[candidate.scenario]}
            </Badge>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 text-xs"
          onClick={() => onManualMatch(candidate)}
        >
          <Link2 className="h-3.5 w-3.5" />
          Cocokkan manual
        </Button>
      </div>

      {expanded && (
        <div className="border-t bg-muted/20 p-3">
          {state === 'loading' && (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat detail…
            </div>
          )}
          {state === 'error' && (
            <p className="py-3 text-xs text-rose-600 dark:text-rose-400">Gagal memuat detail kandidat.</p>
          )}
          {state === 'idle' && (
            <div className="space-y-3">
              {diagnosis && <UnmatchedCandidateDiagnosisCard diagnosis={diagnosis} />}
              {detail ? (
                <CandidateEnrichment detail={detail} />
              ) : (
                <p className="py-3 text-xs text-muted-foreground">Detail tidak tersedia.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium">{value || '—'}</p>
    </div>
  );
}

function CandidateEnrichment({ detail }: { detail: CandidateEnrichmentDetail }) {
  const c = detail.candidate;
  const p = detail.position;
  return (
    <div className="space-y-4">
      {/* Candidate profile */}
      <section>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">Profil Kandidat</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="NIK" value={c.employeeId} />
          <Field label="Grade" value={c.grade} />
          <Field label="Pengalaman" value={c.yearsExperience != null ? `${c.yearsExperience} th` : null} />
          <Field label="Departemen" value={c.department} />
          <Field label="Divisi" value={c.division} />
          <Field label="Pendidikan" value={[c.education, c.major].filter(Boolean).join(' — ') || null} />
          <Field label="Performa" value={c.performanceGrade} />
          <Field label="HAV" value={c.havQuadrant} />
          <Field label="Rekomendasi" value={c.behaviorRecommendation} />
          <Field label="Disiplin" value={c.disciplineStatus} />
          <Field label="MCU" value={c.mcuStatus} />
          <Field label="Email" value={c.email} />
        </div>
      </section>

      {/* Position enrichment */}
      <section>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">
          Informasi Posisi (tanpa job profile)
        </p>
        {p ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Position ID" value={p.positionId} />
              <Field label="Company" value={p.companyId} />
              <Field label="Judul Internal" value={p.internalTitle} />
              <Field label="Judul Eksternal" value={p.externalTitle} />
              <Field label="Grade Posisi" value={p.gradeId} />
              <Field label="Level" value={p.posLevelNo != null ? String(p.posLevelNo) : null} />
              <Field label="Atasan (Posisi)" value={p.supervisorTitle} />
              <Field label="Jumlah Bawahan" value={String(p.subordinateCount)} />
              <Field
                label="Menjabat Sejak"
                value={p.validFrom ? formatDate(p.validFrom) : null}
              />
            </div>
            {p.summary && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ringkasan Posisi</p>
                <p className="mt-0.5 text-xs leading-relaxed text-foreground/80">{p.summary}</p>
              </div>
            )}
            {p.coIncumbents.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Rekan Se-Posisi ({p.coIncumbents.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {p.coIncumbents.map((e, idx) => (
                    <Badge
                      key={`${e.employeeId}:${idx}`}
                      variant="outline"
                      className={`gap-1 text-[10px] ${
                        e.isCandidate
                          ? 'border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'text-muted-foreground'
                      }`}
                      title={e.isCandidate ? 'Kandidat' : 'Karyawan (belum kandidat)'}
                    >
                      <span className="font-mono opacity-60">{e.employeeId}</span>
                      {e.name ?? '—'}
                      {!e.isCandidate && <span className="opacity-60">· non-kandidat</span>}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Tidak ada posisi aktif (valid_to 9999) yang cocok di sync_employee_positions untuk kandidat ini.
          </p>
        )}
      </section>

      {/* Technical competencies */}
      {detail.competencies.length > 0 && (
        <section>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">
            Kompetensi Teknis ({detail.competencies.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {detail.competencies.map((k, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">
                {k.technicalName}
                {k.currentProficiencyName ? ` · ${k.currentProficiencyName}` : ''}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {/* Position history */}
      {detail.history.length > 0 && (
        <section>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">
            Riwayat Posisi ({detail.history.length})
          </p>
          <div className="space-y-1">
            {detail.history.map((h, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-medium">{h.title ?? '—'}</span>
                <span className="shrink-0 text-muted-foreground">
                  {h.validFrom ? new Date(h.validFrom).getFullYear() : '—'}
                  {' – '}
                  {h.validTo && new Date(h.validTo).getFullYear() < 9999
                    ? new Date(h.validTo).getFullYear()
                    : 'kini'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Unmatched profiles modal (click a profile → open its detail dialog) ──

function UnmatchedProfilesModal({
  open,
  onClose,
  profiles,
  query,
  onQuery,
  onOpenProfile,
  loadingProfileId,
  onManualMatch,
}: {
  open: boolean;
  onClose: () => void;
  profiles: JobFamilyMatchReport['unmatchedProfiles'];
  query: string;
  onQuery: (v: string) => void;
  onOpenProfile: (id: number) => void;
  loadingProfileId: number | null;
  /** Opens the candidate picker for this job profile. */
  onManualMatch: (p: JobFamilyMatchReport['unmatchedProfiles'][number]) => void;
}) {
  const [scenario, setScenario] = useState<'all' | ProfileScenario>('all');
  const counts = countBy(profiles, (p) => p.scenario);
  const byScenario = scenario === 'all' ? profiles : profiles.filter((p) => p.scenario === scenario);
  const filtered = useTitleFilter(byScenario, (p) => `${p.positionName} ${p.divisionDepartment ?? ''}`, query);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            Job profile tanpa incumbent kandidat
            <Badge variant="secondary" className="text-[10px]">{profiles.length}</Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Job profile yang tidak diduduki kandidat mana pun. Filter berdasarkan alasan; klik untuk detail lengkap.
          </DialogDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Select
              value={scenario}
              onValueChange={(v) => setScenario(v as 'all' | ProfileScenario)}
            >
              <SelectTrigger size="sm" className="h-9 w-[16rem] text-xs" aria-label="Filter skenario">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  Semua skenario ({profiles.length})
                </SelectItem>
                {(Object.keys(PROFILE_SCENARIO_LABEL) as ProfileScenario[]).map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {PROFILE_SCENARIO_LABEL[s]} ({counts.get(s) ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Cari..." className="h-9 pl-8 text-sm" />
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 space-y-2 overflow-auto p-5">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {profiles.length === 0 ? 'Semua job profile punya kandidat incumbent.' : 'Tidak ada hasil.'}
            </p>
          ) : (
            filtered.map((p) => (
              // Same rule as CandidateRow: the manual action is a sibling of
              // the open-detail button, not nested inside it.
              <div
                key={p.jobProfileId}
                className="flex items-center gap-2 rounded-lg border pr-3 transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <button
                  type="button"
                  onClick={() => onOpenProfile(p.jobProfileId)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 p-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.positionName}</p>
                    {p.divisionDepartment && (
                      <p className="truncate text-xs text-muted-foreground">{p.divisionDepartment}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className={`text-[9px] ${PROFILE_SCENARIO_TONE[p.scenario]}`}>
                      {PROFILE_SCENARIO_LABEL[p.scenario]}
                    </Badge>
                    {loadingProfileId === p.jobProfileId ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5 text-xs"
                  onClick={() => onManualMatch(p)}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Cocokkan manual
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Active positions without a job profile (incumbent or not) ──────────────

function UnmatchedPositionsModal({
  open,
  onClose,
  positions,
  totalPositions,
  query,
  onQuery,
}: {
  open: boolean;
  onClose: () => void;
  /** Distinct active-position titles with no matching job profile. */
  positions: JobFamilyMatchReport['unmatchedPositions'];
  totalPositions: number;
  query: string;
  onQuery: (v: string) => void;
}) {
  const filtered = useTitleFilter(positions, (t) => t, query);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            Posisi aktif tanpa job profile
            <Badge variant="secondary" className="text-[10px]">{positions.length}</Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Posisi aktif (valid_to 9999) — baik yang punya maupun tanpa incumbent — yang tidak
            memiliki job profile (tidak cocok via kode nama file, nama posisi, maupun embedding &gt;98%).
            {totalPositions > 0 && (
              <> {positions.length} dari {totalPositions} posisi aktif ({pct(positions.length, totalPositions)}%).</>
            )}
          </DialogDescription>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Cari posisi..." className="h-9 pl-8 text-sm" />
          </div>
        </DialogHeader>
        <div className="flex-1 space-y-2 overflow-auto p-5">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {positions.length === 0 ? 'Semua posisi aktif punya job profile.' : 'Tidak ada hasil.'}
            </p>
          ) : (
            filtered.map((title, i) => (
              <div
                key={`${title}-${i}`}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Briefcase className="h-3.5 w-3.5" />
                </div>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
                <Badge variant="outline" className="shrink-0 border-muted-foreground/30 text-[9px] text-muted-foreground">
                  tanpa profil
                </Badge>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Why-unmatched diagnosis card (shown atop an unmatched profile's detail) ──

function UnmatchedDiagnosisCard({ diagnosis: d }: { diagnosis: UnmatchedProfileDiagnosis }) {
  const ids = useIdentifierDisplay();
  return (
    <div className="rounded-lg border border-amber-300/50 bg-amber-500/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4" /> Kenapa profil ini &ldquo;tanpa incumbent&rdquo;?
      </p>

      {/* Where the code / title was found */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <TraceRow
          label="Kode nama file"
          value={d.fileCode ? ids.code(d.fileCode) : '—'}
          ok={d.codeInSyncPositions || d.activeIncumbents.length > 0}
          okText={[
            d.codeInSyncPositions ? 'sync_positions' : null,
            d.activeIncumbents.length > 0 ? 'sync_employee_positions (aktif)' : null,
          ]
            .filter(Boolean)
            .join(' + ') || 'tidak ditemukan'}
        />
        <TraceRow
          label="Nama posisi"
          value={d.positionName ?? '—'}
          ok={d.titleInSyncPositions}
          okText={d.titleInSyncPositions ? 'ada di sync_positions' : 'tak cocok'}
        />
        <TraceRow
          label="Incumbent aktif"
          value={`${d.activeIncumbents.length} orang`}
          ok={d.activeIncumbents.length > 0}
          okText={d.activeIncumbents.length > 0 ? 'ditemukan' : 'tidak ada'}
        />
        <TraceRow
          label="Diduduki kandidat (Company terpilih)"
          value={d.titleHeldByCandidate || d.activeIncumbents.some((i) => i.inCandidates && i.tenantSelected) ? 'ya' : 'tidak'}
          ok={d.titleHeldByCandidate || d.activeIncumbents.some((i) => i.inCandidates && i.tenantSelected)}
          okText=""
        />
      </div>

      {/* Active incumbents (candidate or non-candidate) — matched by code/title */}
      {d.activeIncumbents.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Orang yang menduduki posisi ini ({d.activeIncumbents.length})
          </p>
          <div className="space-y-1.5">
            {d.activeIncumbents.map((i, idx) => {
              const label = i.inCandidates
                ? i.tenantSelected
                  ? { text: 'kandidat', cls: 'border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' }
                  : { text: `kandidat @${i.candidateTenantName ?? 'Company lain'}`, cls: 'border-sky-300/60 bg-sky-500/10 text-sky-700 dark:text-sky-300' }
                : { text: 'non-candidate', cls: 'border-muted-foreground/30 text-muted-foreground' };
              // "Seadanya" info for non-candidates (from sync_employees).
              const extra = [i.internalTitle, i.division, i.department, i.gradeId && `grade ${i.gradeId}`]
                .filter(Boolean)
                .join(' · ');
              return (
                <div key={`${i.employeeId}:${idx}`} className="rounded-md border bg-background/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground">{ids.npk(i.employeeId)}</span>
                      <span className="truncate text-xs font-medium">{i.name ?? '(nama tak tersedia)'}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {i.foundVia && (
                        <span className="text-[9px] text-muted-foreground">via {i.foundVia}</span>
                      )}
                      <Badge variant="outline" className={`text-[9px] ${label.cls}`}>{label.text}</Badge>
                    </div>
                  </div>
                  {!i.inCandidates && (
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {i.inSyncEmployees
                        ? extra || 'ada di sync_employees (info minim)'
                        : 'hanya ada di sync_employee_positions — data karyawan tak lengkap'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reasons */}
      <ul className="mt-3 space-y-1.5">
        {d.reasons.map((r, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground/90">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UnmatchedCandidateDiagnosisCard({ diagnosis: d }: { diagnosis: UnmatchedCandidateDiagnosis }) {
  const ids = useIdentifierDisplay();
  return (
    <div className="rounded-lg border border-amber-300/50 bg-amber-500/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4" /> Kenapa kandidat ini tanpa job profile?
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <TraceRow
          label="Position ID (posisi aktif)"
          value={d.positionId ? ids.code(d.positionId) : '—'}
          ok={d.hasActivePosition}
          okText={
            d.hasActivePosition
              ? d.positionInSyncPositions
                ? 'ada di sync_positions'
                : 'tak ada di sync_positions'
              : 'tak ada posisi aktif'
          }
        />
        <TraceRow
          label={`Judul posisi (${d.titleSource})`}
          value={d.positionTitle ?? '—'}
          ok={!!d.positionTitle}
          okText=""
        />
        <TraceRow
          label="ID cocok kode nama file"
          value={d.positionIdMatchesFilename ? 'ya' : 'tidak'}
          ok={d.positionIdMatchesFilename}
          okText={
            !d.positionIdMatchesFilename && d.filenameCodesSamePrefix.length
              ? `ada JD berawalan sama: ${d.filenameCodesSamePrefix.map(ids.code).join(', ')}`
              : ''
          }
        />
        <TraceRow
          label="Judul cocok position_name profil"
          value={d.titleMatchesProfile ? 'ya' : 'tidak'}
          ok={d.titleMatchesProfile}
          okText={d.titleMatchesProfile ? d.matchingProfileNames.slice(0, 2).join(', ') : ''}
        />
      </div>

      <ul className="mt-3 space-y-1.5">
        {d.reasons.map((r, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground/90">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TraceRow({
  label,
  value,
  ok,
  okText,
}: {
  label: string;
  value: string;
  ok: boolean;
  okText: string;
}) {
  return (
    <div className="rounded-md border bg-background/60 p-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex items-center gap-1.5">
        {ok ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
        )}
        <span className="truncate text-xs font-medium">{value}</span>
        {okText && <span className="shrink-0 text-[10px] text-muted-foreground">· {okText}</span>}
      </div>
    </div>
  );
}
