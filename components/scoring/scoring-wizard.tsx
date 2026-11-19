'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Loader2,
  Play,
  RotateCcw,
  Sliders,
  Sparkles,
  Target,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  previewProgramFilterAction,
  previewGradeFilterCountAction,
  prepareMatrixAction,
  type FilterPreviewRow,
} from '@/lib/scoring-wizard-actions';
import {
  startTournamentSessionAction,
  finalizeTournamentAction,
} from '@/lib/scoring-engine';
import type { GradeLevelOption } from '@/lib/pulse-data';
import { useActivityThread } from '@/components/activity-thread';
import { formatDate } from '@/lib/datetime';

type TemplateLite = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  filterRulesCount: number;
  defaultCriteriaCount: number;
  isSystem: boolean;
  targetFinalists: number;
};

type PositionLite = {
  id: string;
  title: string;
  department: string;
  level: string;
  minGradeId: string | null;
  maxGradeId: string | null;
  holderName: string | null;
  holderEmployeeId: string | null;
  /** The one program this position is managed under (drizzle/0056). */
  programTemplateId: string | null;
  programCode: string;
  programName: string;
};

type TenantLite = {
  id: string;
  name: string;
};

/**
 * Whether a preview row is the incumbent of `position`. The server answers by
 * candidate id when it was given the position (always, from this wizard); the
 * NPK comparison is the fallback for a row that carries no answer. In demo mode
 * neither side has an NPK, so only the server's answer can match.
 */
function isIncumbentRow(row: FilterPreviewRow, position: PositionLite | null | undefined): boolean {
  if (row.incumbent !== undefined) return row.incumbent;
  const holder = position?.holderEmployeeId?.trim().toUpperCase();
  return Boolean(holder && row.employeeId?.trim().toUpperCase() === holder);
}

interface ScoringWizardProps {
  templates: TemplateLite[];
  positions: PositionLite[];
  initialPositionId: string;
  /** True when the position came from the URL (i.e. the user picked it), false when it is just the first row. */
  positionPreselected?: boolean;
  gradeLevels?: GradeLevelOption[];
  sessionId?: string;
  /** All business units, for cross-tenant candidate pooling. */
  tenants?: TenantLite[];
  /** Owning business unit of this scoring session (always included). */
  currentTenantId?: string;
}

type Phase = 'configure' | 'processing' | 'complete';

type AhpProgress = { phase: string; done: number; total: number };

/** What `GET /api/tournament/:sessionId/status` answers. */
type SessionStatus = {
  id: string;
  /** 'running' | 'finalizing' | 'completed' | 'failed' */
  status: string;
  scoringMethod: string;
  currentPoolSize: number;
  totalCandidates: number;
  targetFinalists: number;
  runId: string | null;
  ahpProgress: AhpProgress | null;
};

const AHP_PHASE_META: Record<string, { label: string; pct: number }> = {
  load: { label: 'Memuat data kandidat & job profile', pct: 10 },
  technical: { label: 'Aspek 1/6 — Technical Competency (BERT + Mean Pooling)', pct: 25 },
  career: { label: 'Aspek 2/6 — Career Relevance (job profile vs riwayat jabatan)', pct: 40 },
  behavior: { label: 'Aspek 3/6 — Behavior Competency (aturan peringkat)', pct: 50 },
  performance: { label: 'Aspek 4/6 — Performance Appraisal (Absolute Dynamic TOPSIS)', pct: 55 },
  hav: { label: 'Aspek 5/6 — HAV Mapping (aturan kuadran)', pct: 58 },
  education: { label: 'Aspek 6/6 — Education (analisis korelasi AI)', pct: 60 },
  topsis: { label: 'Menghitung bobot AHP & perangkingan TOPSIS', pct: 92 },
  narrative: { label: 'Menulis insight suksesi per finalis', pct: 94 },
  persist: { label: 'Menyimpan hasil peringkat', pct: 96 },
  completed: { label: 'Selesai', pct: 100 },
};

/** Phase order of an AHP+TOPSIS run, in the sequence the engine reports them. */
const AHP_PHASE_ORDER = [
  'load',
  'technical',
  'career',
  'behavior',
  'performance',
  'hav',
  'education',
  'topsis',
  'narrative',
  'persist',
] as const;

function ahpProgressPct(p: AhpProgress | null): number {
  if (!p) return 10;
  const meta = AHP_PHASE_META[p.phase];
  if (!meta) return 10;
  if (p.phase === 'education' && p.total > 0) {
    return Math.min(91, Math.round(meta.pct + (p.done / p.total) * 30));
  }
  return meta.pct;
}

type ActivityEntry = {
  id: number;
  text: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'step';
};

export function ScoringWizard({ templates, positions, initialPositionId, positionPreselected = false, gradeLevels = [], sessionId: initialSessionId, tenants = [], currentTenantId }: ScoringWizardProps) {
  const router = useRouter();
  const { syncPosition: syncThreadPosition, recordRun: recordThreadRun } = useActivityThread();
  const [phase, setPhase] = useState<Phase>('configure');

  // Config state.
  //
  // A position belongs to exactly one program, so the two pickers are not
  // independent: the program narrows the position list, and the position it
  // lands on decides the program. The initial program therefore comes from the
  // initial position, not from the first template in the list.
  const templateIdForPosition = useCallback(
    (pos: PositionLite | undefined): string => {
      if (!pos) return '';
      if (pos.programTemplateId && templates.some((t) => t.id === pos.programTemplateId)) {
        return pos.programTemplateId;
      }
      return templates.find((t) => t.code === pos.programCode)?.id ?? '';
    },
    [templates],
  );
  const [templateId, setTemplateId] = useState<string>(
    () => templateIdForPosition(positions.find((p) => p.id === initialPositionId)) || (templates[0]?.id ?? ''),
  );
  const [positionId, setPositionId] = useState<string>(initialPositionId);
  const [label, setLabel] = useState<string>('');
  const [excludedCandidateIds, setExcludedCandidateIds] = useState<string[]>([]);
  // Business units contributing candidates. Current tenant is always included.
  const [extraTenantIds, setExtraTenantIds] = useState<string[]>([]);
  const includedTenantIds = useMemo(
    () => (currentTenantId ? [currentTenantId, ...extraTenantIds] : extraTenantIds),
    [currentTenantId, extraTenantIds],
  );
  const otherTenants = useMemo(
    () => tenants.filter((t) => t.id !== currentTenantId),
    [tenants, currentTenantId],
  );
  const [overrideMinLevelName, setOverrideMinLevelName] = useState('');
  const [overrideMaxLevelName, setOverrideMaxLevelName] = useState('');
  const [gradeFilterPreview, setGradeFilterPreview] = useState<{ total: number; filtered: number } | null>(null);
  const [showExclusionPanel, setShowExclusionPanel] = useState(false);
  const [candidatePreview, setCandidatePreview] = useState<FilterPreviewRow[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [excludeSearch, setExcludeSearch] = useState('');

  // Processing state
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [progress, setProgress] = useState(0);
  /**
   * Set when the session was created but the scoring service did not accept it.
   * A third terminal state, distinct from both success and failure: nothing is
   * lost and nothing is wrong with the configuration — the work is recorded and
   * waiting. Without it the wizard polled a session nobody was working on for a
   * full hour and then rendered "Penilaian dihentikan" in red.
   */
  const [queuedNotice, setQueuedNotice] = useState<{
    message: string;
    reason: 'unconfigured' | 'unreachable' | 'rejected' | null;
    /** Technical cause (status code, database targets) to quote when reporting. */
    detail: string | null;
  } | null>(null);
  const [filterResult, setFilterResult] = useState<{
    total: number;
    qualified: number;
    disqualified: number;
    rows: FilterPreviewRow[];
  } | null>(null);
  const [resultRunId, setResultRunId] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [ahpProgress, setAhpProgress] = useState<AhpProgress | null>(null);
  const lastAhpPhaseRef = useRef<string | null>(null);
  const [actualActiveCount, setActualActiveCount] = useState<number | null>(null);
  const [gradeFilteredCount, setGradeFilteredCount] = useState(0);
  const isProcessingRef = useRef(false);

  const template = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId]);
  const position = useMemo(() => positions.find((p) => p.id === positionId), [positions, positionId]);
  /** Positions registered under the selected program — the only ones scorable
   *  with it. A seat is added once per program it takes part in. */
  const positionsForProgram = useMemo(
    () => positions.filter((p) => templateIdForPosition(p) === templateId),
    [positions, templateId, templateIdForPosition],
  );

  // Feed the floating thread pill. The anchor is the *target position*, not the
  // wizard route, so picking a different position here parks the previous
  // thread instead of silently rewriting it — and a scoring run that is still
  // being processed by scoring-service survives a reload of this page.
  useEffect(() => {
    if (!position) return;
    // Entering from the sidebar CTA lands on positions[0] as a placeholder, which
    // the user has not chosen — don't open a thread (or archive theirs) for it
    // until they pick a position or actually start the run.
    if (phase === 'configure' && !positionPreselected && positionId === initialPositionId) return;
    syncThreadPosition({
      positionId,
      positionLabel: position.title,
      meta: position.department,
      // Once the run is finalised it is recorded as a run instead — leaving a
      // "wizard in flight" marker behind would point at a finished screen.
      wizard:
        phase === 'complete'
          ? null
          : { stage: phase, href: `/scoring/new?positionId=${positionId}` },
    });
  }, [syncThreadPosition, position, positionId, phase, positionPreselected, initialPositionId]);

  // Level name options (same pattern as position-form-dialog)
  const levelOptions = useMemo(() => {
    const map = new Map<string, { min: number; max: number }>();
    for (const g of gradeLevels) {
      const num = parseInt(g.gradeId, 10);
      if (Number.isNaN(num)) continue;
      const entry = map.get(g.levelName ?? g.gradeId) ?? { min: num, max: num };
      entry.min = Math.min(entry.min, num);
      entry.max = Math.max(entry.max, num);
      map.set(g.levelName ?? g.gradeId, entry);
    }
    return Array.from(map.entries())
      .map(([label, { min, max }]) => ({ label, min, max }))
      .sort((a, b) => a.min - b.min)
      .map(({ label, min, max }) => ({
        value: label,
        label: min === max ? `${label} (Grade ${min})` : `${label} (Grade ${min}-${max})`,
      }));
  }, [gradeLevels]);

  const getGradeRange = (levelName: string): { min: number; max: number } | null => {
    const nums = gradeLevels
      .filter((g) => (g.levelName ?? g.gradeId) === levelName)
      .map((g) => parseInt(g.gradeId, 10))
      .filter((n) => !Number.isNaN(n));
    if (nums.length === 0) return null;
    return { min: Math.min(...nums), max: Math.max(...nums) };
  };

  const resolvedGradeIds = useMemo(() => {
    const minRange = overrideMinLevelName ? getGradeRange(overrideMinLevelName) : null;
    const maxRange = overrideMaxLevelName ? getGradeRange(overrideMaxLevelName) : null;
    return {
      minGradeId: minRange ? String(minRange.min) : '',
      maxGradeId: maxRange ? String(maxRange.max) : '',
    };
  }, [overrideMinLevelName, overrideMaxLevelName, gradeLevels]);

  // Reset exclusions and grade override when position or template changes
  useEffect(() => {
    setExcludedCandidateIds([]);
    setCandidatePreview(null);
    const p = positions.find((pos) => pos.id === positionId);
    const minNum = p?.minGradeId ? parseInt(p.minGradeId, 10) : NaN;
    const maxNum = p?.maxGradeId ? parseInt(p.maxGradeId, 10) : NaN;
    const minMatch = Number.isFinite(minNum) ? levelOptions.find((lo) => getGradeRange(lo.value)?.min === minNum) : null;
    const maxMatch = Number.isFinite(maxNum) ? levelOptions.find((lo) => getGradeRange(lo.value)?.max === maxNum) : null;
    setOverrideMinLevelName(minMatch?.value ?? '');
    setOverrideMaxLevelName(maxMatch?.value ?? '');
  }, [positionId, templateId, positions, levelOptions]);

  // Preview grade-filter count when override changes
  useEffect(() => {
    if (!resolvedGradeIds.minGradeId && !resolvedGradeIds.maxGradeId) {
      setGradeFilterPreview(null);
      return;
    }
    let cancelled = false;
    previewGradeFilterCountAction({
      minGradeId: resolvedGradeIds.minGradeId || null,
      maxGradeId: resolvedGradeIds.maxGradeId || null,
      includedTenantIds,
    }).then((r) => {
      if (!cancelled) setGradeFilterPreview(r);
    });
    return () => { cancelled = true; };
  }, [resolvedGradeIds.minGradeId, resolvedGradeIds.maxGradeId, includedTenantIds]);

  // Changing which business units are included invalidates the cached pool
  // preview and any exclusions picked from the old pool.
  useEffect(() => {
    setCandidatePreview(null);
    setExcludedCandidateIds([]);
  }, [includedTenantIds]);

  // Load candidate preview list when exclusion panel opens
  useEffect(() => {
    if (!showExclusionPanel || !templateId || candidatePreview || loadingPreview) return;
    setExcludeSearch('');
    setLoadingPreview(true);
    previewProgramFilterAction({ programTemplateId: templateId, includedTenantIds, positionId: position?.id })
      .then((rows) => {
        setCandidatePreview(rows);
        const incumbentRows = rows.filter((r) => isIncumbentRow(r, position));
        if (incumbentRows.length > 0) {
          setExcludedCandidateIds((prev) => {
            const next = [...prev];
            for (const r of incumbentRows) if (!next.includes(r.candidateId)) next.push(r.candidateId);
            return next;
          });
        }
      })
      .catch(() => setCandidatePreview([]))
      .finally(() => setLoadingPreview(false));
  }, [showExclusionPanel, templateId, candidatePreview, loadingPreview, position, includedTenantIds]);

  // Auto-resume: if sessionId is provided via URL, fetch its status and
  // attach to the live UI (show its phase progress, poll until completion).
  useEffect(() => {
    if (!initialSessionId || phase !== 'configure') return;
    const sid = initialSessionId;
    (async () => {
      try {
        const res = await fetch(`/api/tournament/${sid}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const data: SessionStatus = await res.json();

        if (data.status === 'completed' || data.status === 'failed') {
          addActivity(
            `Sesi penilaian ${sid.slice(0, 8)}... sudah ${data.status === 'completed' ? 'selesai' : 'gagal'}.`,
            data.status === 'completed' ? 'success' : 'error'
          );
          return;
        }

        // Still running or pending — attach UI and start polling.
        setSessionId(sid);
        setPhase('processing');
        setAhpProgress(data.ahpProgress ?? null);
        setProgress(Math.min(99, ahpProgressPct(data.ahpProgress ?? null)));
        addActivity(`Melanjutkan sesi penilaian ${sid.slice(0, 8)}...`, 'info');

        const finalStatus = await pollServiceUntilComplete(sid);
        if (finalStatus === 'completed') {
          setResultRunId(data.runId ?? null);
          setResultCount(data.currentPoolSize ?? 0);
          setProgress(100);
          setPhase('complete');
          toast.success('Penilaian talent berhasil diselesaikan.');
        } else if (finalStatus === 'failed') {
          setPhase('complete');
          toast.error('Layanan scoring melaporkan kegagalan.');
        } else if (finalStatus === 'cancelled') {
          setPhase('complete');
        }
      } catch (err) {
        addActivity(
          `Gagal melanjutkan sesi: ${err instanceof Error ? err.message : 'unknown'}`,
          'error'
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  function toggleExclusion(candidateId: string) {
    setExcludedCandidateIds((prev) =>
      prev.includes(candidateId)
        ? prev.filter((id) => id !== candidateId)
        : [...prev, candidateId],
    );
  }

  const filteredForExclude = useMemo(() => {
    if (!candidatePreview) return [];
    const term = excludeSearch.trim().toLowerCase();
    if (!term) return candidatePreview;
    return candidatePreview.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.currentPosition ?? '').toLowerCase().includes(term) ||
        (c.department ?? '').toLowerCase().includes(term),
    );
  }, [candidatePreview, excludeSearch]);

  // Resolve the excluded IDs back to full candidate rows so we can show WHO is
  // excluded (as removable chips), not just a count. Preserves the order in
  // which candidates were excluded.
  const excludedCandidates = useMemo(() => {
    if (!candidatePreview) return [];
    const byId = new Map(candidatePreview.map((c) => [c.candidateId, c]));
    return excludedCandidateIds
      .map((id) => byId.get(id))
      .filter((c): c is FilterPreviewRow => Boolean(c));
  }, [candidatePreview, excludedCandidateIds]);

  // The incumbent (pejabat saat ini) is always excluded and cannot be
  // un-excluded — they can't compete to succeed themselves.
  const incumbentCandidateId = useMemo(() => {
    if (!candidatePreview) return null;
    return candidatePreview.find((c) => isIncumbentRow(c, position))?.candidateId ?? null;
  }, [candidatePreview, position]);

  const activityCounter = useRef(0);
  function addActivity(text: string, type: ActivityEntry['type'] = 'info') {
    activityCounter.current += 1;
    setActivities((prev) => [...prev, { id: activityCounter.current, text, type }]);
  }

  /**
   * Poll the status endpoint until the session reaches a terminal state
   * (completed or failed), updating the phase progress as the standalone
   * scoring service writes it to the database.
   *
   * Returns the final status string ('completed' | 'failed' | 'cancelled').
   */
  async function pollServiceUntilComplete(
    sessionId: string
  ): Promise<'completed' | 'failed' | 'cancelled' | 'unknown'> {
    const POLL_INTERVAL_MS = 2000;
    const MAX_POLLS = 60 * 60 * 1000 / POLL_INTERVAL_MS; // up to 1 hour

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH}/api/tournament/${sessionId}/status`,
          { cache: 'no-store' }
        );
        if (!res.ok) {
          if (res.status >= 500) {
            addActivity(`Layanan scoring mengalami kesalahan (HTTP ${res.status}).`, 'error');
            return 'cancelled';
          }
          continue;
        }
        const data: SessionStatus = await res.json();

        const ap = data.ahpProgress ?? null;
        setAhpProgress(ap);
        setProgress(data.status === 'completed' ? 100 : Math.min(99, ahpProgressPct(ap)));
        if (ap && ap.phase !== lastAhpPhaseRef.current) {
          lastAhpPhaseRef.current = ap.phase;
          const meta = AHP_PHASE_META[ap.phase];
          if (meta && ap.phase !== 'completed') addActivity(meta.label, 'step');
        }
        if (data.status === 'completed') return 'completed';
        if (data.status === 'failed') return 'failed';
      } catch {
        // Network glitch — keep polling
      }
    }

    return 'unknown';
  }

  /**
   * Fallback when polling gave up before the session reached a terminal state:
   * ask the scoring service to finish it and wait for the run.
   */
  async function startFinalizing(sid: string) {
    setProgress(95);
    addActivity('Menyelesaikan penilaian di layanan scoring...', 'step');

    try {
      const { runId, candidateCount } = await finalizeTournamentAction(sid);
      setProgress(100);
      setResultRunId(runId);
      setResultCount(candidateCount);
      // Record it as the thread's first run rather than closing the thread —
      // re-runs on the same position usually follow, and this is the row the
      // user will want to get back to.
      recordThreadRun(positionId, {
        runId,
        origin: 'baseline',
        label: 'Run awal',
        method: 'AHP_TOPSIS',
        candidateCount,
        baseRunId: null,
        at: Date.now(),
      });
      addActivity(`Peringkat ${candidateCount.toLocaleString('id-ID')} kandidat berhasil disusun`, 'success');
      setPhase('complete');
      // The session row is NOT deleted on success — see the note at the other
      // completion path below.
      toast.success('Penilaian talent berhasil diselesaikan.');
    } catch (error) {
      addActivity(error instanceof Error ? error.message : 'Terjadi kesalahan.', 'error');
      setProgress(100);
      setPhase('complete');
      toast.error(error instanceof Error ? error.message : 'Gagal menyelesaikan penilaian.');
    }
  }

  async function handleStartScoring() {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    setPhase('processing');
    setActivities([]);
    setProgress(0);
    setQueuedNotice(null);
    setFilterResult(null);
    setResultRunId(null);
    setSessionId(null);
    setAhpProgress(null);
    lastAhpPhaseRef.current = null;
    setActualActiveCount(null);
    setGradeFilteredCount(0);

    try {
      addActivity('Memulai penilaian metode AHP + TOPSIS (deterministik)...', 'step');
      await delay(500);
      setProgress(10);

      addActivity('Memuat data kandidat untuk evaluasi...', 'step');
      const rows = await previewProgramFilterAction({ programTemplateId: templateId, includedTenantIds });
      setProgress(30);

      setFilterResult({
        total: rows.length,
        qualified: rows.length,
        disqualified: 0,
        rows,
      });

      addActivity(
        `Seluruh ${rows.length} kandidat akan dinilai pada 6 aspek lalu diranking dengan AHP + TOPSIS.`,
        'info',
      );
      await delay(500);

      setProgress(45);
      addActivity('Mengumpulkan data penilaian seluruh kandidat...', 'step');
      const allCandidateIds = rows.map((r) => r.candidateId);
      const matrix = await prepareMatrixAction({
        positionId,
        programTemplateId: templateId,
        candidateIds: allCandidateIds,
        includedTenantIds,
      });
      setProgress(55);
      addActivity(`${matrix.criteriaCount} aspek penilaian disiapkan`, 'info');
      await delay(400);

      setProgress(65);
      addActivity('Memulai komputasi AHP + TOPSIS di layanan scoring...', 'step');
      await delay(400);

      const finalLabel =
        label.trim() ||
        `${template?.name ?? 'Penilaian'} — ${position?.title ?? ''} — ${formatDate(new Date())}`;

      const session = await startTournamentSessionAction({
        positionId,
        programTemplateId: templateId || null,
        label: finalLabel,
        excludedCandidateIds,
        includedTenantIds,
        ...(resolvedGradeIds.minGradeId || resolvedGradeIds.maxGradeId ? { minGradeId: resolvedGradeIds.minGradeId || undefined, maxGradeId: resolvedGradeIds.maxGradeId || undefined } : {}),
      });

      setSessionId(session.sessionId);
      setActualActiveCount(session.totalCandidates);
      setGradeFilteredCount(Math.max(0, (filterResult?.total ?? 0) - excludedCandidateIds.length - session.totalCandidates));

      addActivity(
        `Sesi dibuat — ${session.totalCandidates.toLocaleString('id-ID')} kandidat (setelah filter grade & eksklusi) akan diranking sekaligus.`,
        'info',
      );

      // Update URL with sessionId for auto-resume / status page link
      const url = new URL(window.location.href);
      url.searchParams.set('sessionId', session.sessionId);
      window.history.replaceState({}, '', url.toString());

      // The service did not take the session. Stop here instead of polling for
      // an hour: the session and its run row are committed, the sessionId is in
      // the URL for auto-resume, and the service's orphan sweeper starts it on
      // its next boot. Reload this page then and progress picks up where it is.
      if (session.dispatch.status === 'queued') {
        const notice = session.dispatch.message ?? 'Sesi masuk antrean layanan scoring.';
        addActivity(notice, 'warn');
        setQueuedNotice({
          message: notice,
          reason: session.dispatch.reason,
          detail: session.dispatch.detail,
        });
        setProgress(100);
        setPhase('complete');
        toast.warning('Sesi masuk antrean — layanan scoring belum tersedia.');
        return;
      }

      addActivity('Layanan scoring diaktifkan — progres per aspek akan diperbarui otomatis.', 'info');

      // Poll the service-backed status endpoint. The standalone scoring
      // service writes its phase progress to the DB, so polling reflects real
      // progress even when the user navigates away or closes the tab.
      const finalStatus = await pollServiceUntilComplete(session.sessionId);

      // The scoring service also writes the final ranking and marks the
      // session 'completed'. If polling gave up first, fall back to asking the
      // service to finalize.
      if (finalStatus === 'failed') {
        addActivity('Scoring gagal dijalankan di layanan. Silakan coba lagi.', 'error');
        setPhase('complete');
        toast.error('Layanan scoring tidak dapat menjalankan penilaian.');
        return;
      }

      if (finalStatus === 'cancelled') {
        setPhase('complete');
        return;
      }

      if (finalStatus === 'completed') {
        // Service already finalized. Read runId from session.
        addActivity('Peringkat akhir tersimpan oleh layanan scoring.', 'success');
        const res = await fetch(
          `/api/tournament/${session.sessionId}/status`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data: SessionStatus = await res.json();
          setResultRunId(data.runId ?? session.runId);
          setResultCount(data.currentPoolSize ?? 0);
        } else {
          setResultRunId(session.runId);
        }
        setProgress(100);
        setPhase('complete');
        // The session row is deliberately KEPT. `tournament_sessions.final_ranked`
        // is the only place `runInfo` lives — the run-level diagnostics the
        // "Konfigurasi" tab renders: AHP criteria dropped and the effective
        // weights, the technical similarity anchors and their provenance, the
        // career scale and depth targets, the augment/exclusion summaries, and
        // the scored/finalist counts. Deleting the session on success threw all
        // of that away the instant a run succeeded, so `getRunConfigurationAction`
        // found no session, `runInfo` came back null, and the whole "Sumber Acuan
        // & Penyesuaian" section silently stopped rendering.
        //
        // Nothing needed the deletion: every "is this position mid-run?" check
        // filters on status ('running' | 'finalizing'), the orphan sweeper only
        // re-dispatches 'running', and auto-resume already handles a 'completed'
        // session by reporting it as finished. A completed session is inert.
        toast.success('Penilaian talent berhasil diselesaikan.');
      } else {
        // Polling gave up before the session finished; ask the service to finish it.
        await startFinalizing(session.sessionId);
      }

    } catch (error) {
      addActivity(error instanceof Error ? error.message : 'Terjadi kesalahan.', 'error');
      setProgress(100);
      setPhase('complete');
      toast.error(error instanceof Error ? error.message : 'Gagal menjalankan penilaian.');
    } finally {
      isProcessingRef.current = false;
    }
  }

  function TooltipWrap({ children, text }: { children: React.ReactNode; text: string }) {
    return (
      <div className="group relative">
        {children}
        <div className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 pointer-events-none">
          <div className="rounded-md border bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md whitespace-nowrap">
            {text}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ─── Configure Phase ─── */}
      {phase === 'configure' && (
        <Card className="overflow-hidden border shadow-sm">
          <div className="border-b bg-muted/30 px-6 py-3">
            <h3 className="flex items-center gap-1.5 text-base font-semibold">
              Konfigurasi Penilaian Sesi Baru
              <InfoHint title="Konfigurasi Penilaian Sesi Baru">
                Tentukan program penilaian dan posisi target jabatan untuk memulai penyaringan kelayakan &amp;
                perangkingan AHP + TOPSIS.
              </InfoHint>
            </h3>
          </div>

          <div className="grid gap-6 p-6 lg:grid-cols-12">
            {/* Left: Form Inputs */}
            <div className="space-y-4 lg:col-span-6">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Program Penilaian <span className="text-destructive">*</span>
                </Label>
                <Combobox
                  value={templateId}
                  onValueChange={(next) => {
                    setTemplateId(next);
                    // The position list belongs to the program: keep the current
                    // position only if it is registered under the new one.
                    const stillValid = positions.some(
                      (p) => p.id === positionId && templateIdForPosition(p) === next,
                    );
                    if (!stillValid) {
                      setPositionId(positions.find((p) => templateIdForPosition(p) === next)?.id ?? '');
                    }
                  }}
                  options={templates.map((t) => ({
                    value: t.id,
                    label: t.name,
                  }))}
                  placeholder="Pilih program penilaian..."
                  searchPlaceholder="Cari program..."
                  emptyText="Program tidak ditemukan."
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Posisi Target Jabatan <span className="text-destructive">*</span>
                </Label>
                <Combobox
                  value={positionId}
                  onValueChange={(next) => {
                    setPositionId(next);
                    const owner = templateIdForPosition(positions.find((p) => p.id === next));
                    if (owner) setTemplateId(owner);
                  }}
                  options={positionsForProgram.map((p) => {
                    const meta: string[] = [p.department];
                    if (p.level && p.level !== '-') meta.push(p.level);
                    if (p.holderName) meta.push(`Pejabat: ${p.holderName}`);
                    return {
                      value: p.id,
                      label: p.title,
                      description: meta.join(' · '),
                    };
                  })}
                  placeholder="Pilih posisi target..."
                  searchPlaceholder="Cari posisi..."
                  emptyText="Belum ada posisi pada program ini."
                />
                <p className="text-[10px] leading-normal text-muted-foreground">
                  Hanya posisi yang terdaftar pada program{template ? ` ${template.name}` : ' ini'} yang ditampilkan.
                  Untuk menilai posisi lain pada program ini, tambahkan posisi tersebut lebih dulu di{' '}
                  <a href="/positions" className="underline hover:text-primary">Position Management</a>.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Nama Sesi <span className="text-muted-foreground font-normal lowercase">(opsional)</span>
                </Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Contoh: Seleksi Kepala Divisi Q1 2026"
                  className="bg-background text-sm"
                />
              </div>

              {/* ── Cross-tenant unit picker ── */}
              {otherTenants.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center gap-1.5">
                    <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5" />
                      Unit Bisnis Kandidat
                    </Label>
                    <InfoHint size="xs" title="Unit Bisnis Kandidat">
                      Secara default hanya unit saat ini. Pilih unit lain untuk menyertakan kandidat lintas unit ke dalam
                      pool penilaian (filter grade &amp; kelayakan tetap berlaku sama).
                    </InfoHint>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {currentTenantId && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                        <CheckCircle2 className="h-3 w-3" />
                        {tenants.find((t) => t.id === currentTenantId)?.name ?? 'Unit saat ini'}
                        <span className="text-[9px] font-normal opacity-70">(saat ini)</span>
                      </span>
                    )}
                    {otherTenants.map((t) => {
                      const active = extraTenantIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() =>
                            setExtraTenantIds((prev) =>
                              prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id],
                            )
                          }
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                            active
                              ? 'border-primary/40 bg-primary/10 text-primary'
                              : 'border-border bg-background text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
                          )}
                        >
                          {active ? <CheckCircle2 className="h-3 w-3" /> : <Building2 className="h-3 w-3 opacity-60" />}
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                  {extraTenantIds.length > 0 && (
                    <p className="text-[10px] font-medium text-primary pt-0.5">
                      Pool mencakup {includedTenantIds.length} unit bisnis.
                    </p>
                  )}
                </div>
              )}

              {/* ── Exclusion picker ── */}
              <div className="space-y-1.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowExclusionPanel((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg border border-amber-200/60 dark:border-amber-900/40 bg-amber-500/5 px-3 py-2 text-left transition-colors hover:bg-amber-500/10"
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    <UserCheck className="h-3.5 w-3.5" />
                    Exclude Kandidat
                    {excludedCandidateIds.length > 0 && (
                      <span className="rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5">
                        {excludedCandidateIds.length}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{showExclusionPanel ? 'Tutup' : 'Atur'}</span>
                </button>

                {showExclusionPanel && (
                  <div className="rounded-lg border border-amber-200/40 dark:border-amber-900/30 bg-amber-50/30 dark:bg-amber-950/10">
                    {loadingPreview ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Memuat daftar kandidat...
                      </div>
                    ) : !candidatePreview || candidatePreview.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6">
                        Tidak ada kandidat tersedia.
                      </p>
                    ) : (
                      <>
                        <div className="relative p-2">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                          <Input
                            value={excludeSearch}
                            onChange={(e) => setExcludeSearch(e.target.value)}
                            placeholder="Cari nama / jabatan / departemen..."
                            className="h-8 pl-8 pr-8 text-xs bg-background/80"
                          />
                          {excludeSearch && (
                            <button
                              type="button"
                              onClick={() => setExcludeSearch('')}
                              className="absolute right-4 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="max-h-64 overflow-y-auto p-2">
                          {filteredForExclude.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">
                              Tidak ada hasil untuk "{excludeSearch}".
                            </p>
                          ) : (
                            <div className="space-y-0.5">
                              {filteredForExclude.map((c) => {
                                const checked = excludedCandidateIds.includes(c.candidateId);
                                const isIncumbent = isIncumbentRow(c, position);
                                return (
                                  <label
                                    key={c.candidateId}
                                    className={cn(
                                      'flex items-start gap-2.5 rounded-md px-2 py-1.5',
                                      isIncumbent ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer hover:bg-background/60',
                                    )}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      disabled={isIncumbent}
                                      onCheckedChange={() => !isIncumbent && toggleExclusion(c.candidateId)}
                                      className="mt-0.5"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-medium truncate">
                                        {c.name}
                                        {includedTenantIds.length > 1 && c.businessUnit && (
                                          <span className="ml-1.5 rounded bg-muted px-1 py-px text-[9px] font-semibold text-muted-foreground align-middle">
                                            {c.businessUnit}
                                          </span>
                                        )}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground truncate">
                                        {c.currentPosition ?? '-'} {c.department ? `· ${c.department}` : ''}
                                      </p>
                                    </div>
                                    {isIncumbent && (
                                      <Badge variant="outline" className="shrink-0 text-[10px] border-amber-400/50 text-amber-700 dark:text-amber-400">
                                        Pejabat Saat Ini
                                      </Badge>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2 border-t border-amber-200/30 dark:border-amber-900/20 px-2.5 py-2">
                          <p className="text-[10px] text-muted-foreground">
                            {candidatePreview.length} kandidat
                            {excludeSearch && ` · ${filteredForExclude.length} filter`}
                            {excludedCandidateIds.length > 0 && (
                              <span className="text-amber-700 dark:text-amber-300 font-semibold ml-1">
                                · {excludedCandidateIds.length} dikecualikan
                              </span>
                            )}
                          </p>
                          <div className="flex gap-1">
                            {excludeSearch && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const ids = filteredForExclude.map((c) => c.candidateId);
                                    setExcludedCandidateIds((prev) => {
                                      const cur = new Set(prev);
                                      for (const id of ids) cur.add(id);
                                      return Array.from(cur);
                                    });
                                  }}
                                  className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 hover:underline px-1.5"
                                >
                                  Pilih semua
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const ids = new Set(filteredForExclude.map((c) => c.candidateId));
                                    setExcludedCandidateIds((prev) => prev.filter((id) => !ids.has(id)));
                                  }}
                                  className="text-[10px] font-semibold text-muted-foreground hover:underline px-1.5"
                                >
                                  Hapus semua
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {excludedCandidateIds.length > 0 && (
                  <div className="space-y-1.5 rounded-lg border border-amber-200/50 dark:border-amber-900/30 bg-amber-50/40 dark:bg-amber-950/10 p-2">
                    <div className="flex items-center justify-between px-0.5">
                      <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                        {excludedCandidateIds.length} kandidat dikecualikan dari penilaian
                      </p>
                      {excludedCandidateIds.some((id) => id !== incumbentCandidateId) && (
                        <button
                          type="button"
                          onClick={() =>
                            setExcludedCandidateIds((prev) =>
                              prev.filter((id) => id === incumbentCandidateId),
                            )
                          }
                          className="text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:underline"
                        >
                          Batalkan semua
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {excludedCandidates.map((c) => {
                        const isIncumbent = isIncumbentRow(c, position);
                        return (
                          <span
                            key={c.candidateId}
                            className={cn(
                              'group inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 text-[10px]',
                              isIncumbent
                                ? 'border-amber-400/70 dark:border-amber-700/60 bg-amber-500/10 px-2 text-amber-800 dark:text-amber-200'
                                : 'border-amber-300/60 dark:border-amber-800/50 bg-background/70 pl-2 pr-1 text-amber-800 dark:text-amber-200',
                            )}
                            title={
                              isIncumbent
                                ? `${c.name} — Pejabat Saat Ini (tidak dapat dinilai sebagai kandidat penggantinya sendiri)`
                                : `${c.name}${c.currentPosition ? ` · ${c.currentPosition}` : ''}${c.department ? ` · ${c.department}` : ''}`
                            }
                          >
                            <span className="truncate">{c.name}</span>
                            {isIncumbent ? (
                              <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-px text-[9px] font-semibold text-amber-700 dark:text-amber-300">
                                Pejabat Saat Ini
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleExclusion(c.candidateId)}
                                className="shrink-0 rounded-full p-0.5 text-amber-600/70 hover:bg-amber-500/15 hover:text-amber-800 dark:hover:text-amber-100"
                                aria-label={`Batalkan pengecualian ${c.name}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Live Summary Panel */}
            <div className="lg:col-span-6 flex flex-col justify-start rounded-xl border bg-muted/20 p-4">
              <div className="space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ringkasan Konfigurasi Sesi
                </h4>
                
                {template || position ? (
                  <div className="space-y-3">
                    {template && (
                      <div className="flex items-start gap-2.5">
                        <ClipboardList className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <p className="text-xs font-semibold">{template.name}</p>
                          {template.description && (
                            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                              {template.description}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-background">
                              Target Finalis: {template.targetFinalists}
                            </Badge>
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-background">
                              Metode: AHP + TOPSIS
                            </Badge>
                          </div>
                        </div>
                      </div>
                    )}

                    {template && position && <div className="h-px bg-border my-2" />}

                    {position && (
                      <div className="flex items-start gap-2.5">
                        <Target className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <p className="text-xs font-semibold">{position.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {position.department} {position.level ? `· ${position.level}` : ''}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center h-24 text-muted-foreground">
                    <p className="text-xs leading-normal px-4">
                      Silakan pilih program penilaian & posisi target di sebelah kiri untuk melihat ringkasan.
                    </p>
                  </div>
                )}
              </div>

              {/* Grade range override */}
              <div className="space-y-1.5 pt-5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Rentang Level
                </Label>
                <div className="flex items-center gap-2">
                  <Combobox
                    options={levelOptions}
                    value={overrideMinLevelName}
                    onValueChange={(v) => {
                      setOverrideMinLevelName(v);
                      if (!overrideMaxLevelName) {
                        setOverrideMaxLevelName(v);
                      } else {
                        const maxRange = getGradeRange(overrideMaxLevelName);
                        const vRange = getGradeRange(v);
                        if (maxRange && vRange && maxRange.min < vRange.min) {
                          setOverrideMaxLevelName('');
                        }
                      }
                    }}
                    placeholder="Level minimum"
                    searchPlaceholder="Cari level..."
                    emptyText="Tidak ada level tersedia."
                    triggerClassName="h-9 text-sm flex-1"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">s/d</span>
                  <Combobox
                    options={levelOptions.filter((lo) => {
                      if (!overrideMinLevelName) return true;
                      const r = getGradeRange(lo.value);
                      const minR = getGradeRange(overrideMinLevelName);
                      return r && minR && r.min >= minR.min;
                    })}
                    value={overrideMaxLevelName}
                    onValueChange={setOverrideMaxLevelName}
                    placeholder="Level maksimum"
                    searchPlaceholder="Cari level..."
                    emptyText="Tidak ada level tersedia."
                    triggerClassName="h-9 text-sm flex-1"
                  />
                </div>
                {gradeFilterPreview && (
                  <p className="text-xs text-muted-foreground">
                    {gradeFilterPreview.filtered} dari {gradeFilterPreview.total} kandidat dalam rentang grade ini
                    {gradeFilterPreview.total - gradeFilterPreview.filtered > 0
                      ? ` (${gradeFilterPreview.total - gradeFilterPreview.filtered} difilter)`
                      : ''}
                  </p>
                )}
              </div>

              <div className="pt-4 mt-4 border-t flex justify-end">
                <Button
                  size="default"
                  className="gap-2 w-full sm:w-auto text-xs"
                  onClick={handleStartScoring}
                  disabled={!templateId || !positionId || isProcessingRef.current}
                >
                  <Play className="h-3.5 w-3.5" />
                  Mulai Penilaian
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ─── Processing / Complete Phase ─── */}
      {(phase === 'processing' || phase === 'complete') && (
        <div className="space-y-5">
          {/* Progress */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {phase === 'processing'
                  ? 'Sedang memproses...'
                  : resultRunId
                  ? 'Penilaian selesai'
                  : queuedNotice
                  ? 'Sesi masuk antrean'
                  : 'Penilaian dihentikan'}
              </h3>
              {phase === 'processing' && (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
              {phase === 'complete' && resultRunId && (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              )}
              {/* Queued is neither done nor failed — an amber clock, not a red X. */}
              {phase === 'complete' && !resultRunId && queuedNotice && (
                <Clock className="h-5 w-5 text-amber-500" />
              )}
              {phase === 'complete' && !resultRunId && !queuedNotice && (
                <XCircle className="h-5 w-5 text-rose-500" />
              )}
            </div>
            <div className="space-y-1.5">
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-700 ease-out',
                    progress < 100
                      ? 'bg-primary animate-pulse'
                      : resultRunId
                      ? 'bg-emerald-500'
                      : queuedNotice
                      ? 'bg-amber-500'
                      : 'bg-rose-500',
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-right text-muted-foreground">{progress}%</p>
            </div>
          </Card>

          {/* Queued: the session is committed, nothing is scoring it yet. Say
              both halves — "tersimpan" and "belum berjalan" — because either one
              alone is the misleading half. */}
          {queuedNotice && (
            <Card className="border-amber-200 bg-amber-50/60 p-5 dark:border-amber-900 dark:bg-amber-950/20">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">
                    Sesi tersimpan dan menunggu layanan scoring
                  </p>
                  <p className="text-amber-800 dark:text-amber-300/90">{queuedNotice.message}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400/80">
                    Tidak perlu mengulang penilaian — membuat sesi baru hanya menambah antrean untuk
                    posisi yang sama.{' '}
                    {queuedNotice.reason === 'rejected'
                      ? 'Layanannya merespons, jadi ini bukan sekadar menunggu: sertakan keterangan teknis di bawah saat melapor.'
                      : 'Buka kembali halaman ini setelah layanan hidup untuk melihat progresnya.'}
                  </p>
                  {queuedNotice.reason === 'rejected' && queuedNotice.detail && (
                    <p className="break-all rounded bg-amber-100/70 px-2 py-1 font-mono text-[11px] text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                      {queuedNotice.detail}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Stats */}
          {filterResult && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="relative overflow-hidden p-5 transition-all duration-300 hover:shadow-md border bg-slate-50/50 dark:bg-slate-900/10">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Kandidat Aktif</p>
                    <p className="text-3xl font-extrabold tracking-tight">
                      {actualActiveCount ?? (filterResult.total - excludedCandidateIds.length)}
                      <span className="text-xs font-normal text-muted-foreground ml-1.5">
                        / {filterResult.total}
                      </span>
                    </p>
                  </div>
                  <div className="p-2 bg-primary/10 rounded-lg text-primary">
                    <Users className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-2 space-y-0.5">
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    {excludedCandidateIds.length > 0 ? `${excludedCandidateIds.length} dikecualikan (incumbent)` : 'Semua kandidat siap dievaluasi'}
                  </p>
                  {gradeFilteredCount > 0 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                      {gradeFilteredCount} terfilter oleh rentang grade
                    </p>
                  )}
                </div>
              </Card>
              
              <Card className="relative overflow-hidden p-5 transition-all duration-300 hover:shadow-md border border-violet-100 dark:border-violet-950 bg-violet-500/5">
                <div className="flex items-center justify-between">
                  <div className="space-y-1 min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-violet-800 dark:text-violet-300">
                      Progres AHP + TOPSIS
                    </p>
                    <p className="text-sm font-bold leading-snug text-violet-700 dark:text-violet-300">
                      {AHP_PHASE_META[ahpProgress?.phase ?? '']?.label ??
                        (phase === 'complete' ? 'Selesai' : 'Menunggu layanan scoring...')}
                    </p>
                  </div>
                  <div className="p-2 bg-violet-500/10 rounded-lg text-violet-500 shrink-0">
                    <Sliders className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-violet-700 dark:text-violet-400">
                  {ahpProgress?.phase === 'education'
                    ? `${ahpProgress.done} / ${ahpProgress.total} kandidat dianalisis AI`
                    : 'Seluruh aspek dihitung deterministik — hasil dapat direproduksi.'}
                </div>
              </Card>
            </div>
          )}

          {/* AHP aspect checklist */}
          {phase === 'processing' && (
            <Card className="p-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Tahapan Metode AHP + TOPSIS
              </h4>
              <ol className="space-y-1.5">
                {AHP_PHASE_ORDER.map((key) => {
                  const order = AHP_PHASE_ORDER as readonly string[];
                  const currentIdx = order.indexOf(ahpProgress?.phase ?? 'load');
                  const idx = order.indexOf(key);
                  const isDone = ahpProgress?.phase === 'completed' || idx < currentIdx;
                  const isCurrent = ahpProgress?.phase === key;
                  return (
                    <li key={key} className="flex items-center gap-2 text-xs">
                      {isDone ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      ) : isCurrent ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500 shrink-0" />
                      ) : (
                        <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 shrink-0" />
                      )}
                      <span className={cn(isDone && 'text-muted-foreground line-through decoration-muted-foreground/40', isCurrent && 'font-semibold text-violet-700 dark:text-violet-300')}>
                        {AHP_PHASE_META[key]?.label}
                        {isCurrent && (key === 'education' || key === 'narrative') && ahpProgress
                          ? ` (${ahpProgress.done}/${ahpProgress.total})`
                          : ''}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}

          {/* Prominent action buttons */}
          {phase === 'complete' && (
            <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-auto">
              <div className="bg-gradient-to-t from-background via-background/95 to-transparent px-5 pb-5 pt-8">
                <Card className="overflow-hidden border-2 border-primary/20 bg-primary/[0.03] shadow-lg">
                  <div className="flex flex-col items-center gap-4 p-5 sm:flex-row sm:justify-center">
                    {resultRunId && (
                      <Button
                        size="lg"
                        className="gap-2.5 w-full sm:w-auto min-w-48 text-sm font-bold shadow-md"
                        onClick={() => router.push(`/positions/${positionId}?runId=${resultRunId}`)}
                      >
                        <Sparkles className="h-4 w-4" />
                        Lihat Hasil Peringkat
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="lg"
                      className="gap-2.5 w-full sm:w-auto min-w-44 text-sm font-semibold"
                      onClick={() => {
                        setPhase('configure');
                        setActivities([]);
                        setProgress(0);
                        setQueuedNotice(null);
                        setFilterResult(null);
                        setResultRunId(null);
                        setSessionId(null);
                        setAhpProgress(null);
                        lastAhpPhaseRef.current = null;
                        setActualActiveCount(null);
                        setGradeFilteredCount(0);
                      }}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Ulangi Penilaian
                    </Button>
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
