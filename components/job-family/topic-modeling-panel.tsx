'use client';

// Client panel for the BERTopic topic-modeling run: trigger a run, poll its live
// phase progress, then render the resulting job families with rich detail —
// c-TF-IDF keywords, member job profiles, their incumbents (candidates matched
// via job_family_matches), a division/tenant breakdown, an interactive 2-D
// scatter, and the hierarchical Family Tree. The heavy compute runs in the
// Python topic-service; this polls Postgres via lib/job-family-topics-actions.ts.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ComponentType,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { InfoHint } from '@/components/ui/info-hint';
import { Input } from '@/components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Network,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Tags,
  ScatterChart,
  Users,
  Building2,
  Layers,
  Target,
  FileText,
  Maximize2,
  Search,
  FolderTree,
  Sparkles,
  FolderPlus,
  Plus,
  ArrowLeftRight,
  ChevronsUpDown,
  Crosshair,
  GitCompare,
  Percent,
  Ruler,
  X,
} from 'lucide-react';
import {
  startTopicRunAction,
  getTopicRunStatusAction,
  getTopicResultsAction,
  getOutlierClusterDistancesAction,
  assignOutlierToClusterAction,
  type TopicRunSummary,
  type TopicResults,
  type TopicResult,
  type TopicAssignment,
  type TopicMember,
  type TopicKeyword,
  type PositionDistanceResult,
  type ComparedProfile,
  type Incumbent,
  type HierarchyLinkRow,
  type ClusterDistance,
  getPositionDistanceAction,
} from '@/lib/job-family-topics-actions';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { JobFamilyPipeline } from '@/components/job-family/pipeline-steps';
import { ZoomablePlot, type PlotMode } from '@/components/zoomable-plot';
import { formatDateTime } from '@/lib/datetime';

// Shared with the exported report so the colour of a family on the map is the
// colour it carries in the printout.
import { NOISE_COLOR, colorForTopic } from '@/lib/job-family/palette';
import { TopicExportDialog } from '@/components/job-family/topic-export-dialog';


type TopicMeta = Map<
  number,
  {
    size: number;
    incumbentCount: number;
    label: string;
    color: string;
    members: TopicMember[];
    generalTitle: string | null;
    generalDescription: string | null;
    keywords: TopicKeyword[];
  }
>;

const RUNNING = (s: string) => s === 'pending' || s === 'processing';

// A run is "mostly noise" when HDBSCAN found no real topics, or the -1 outlier
// bucket swallowed most documents — the classic small-corpus / too-high
// min_cluster_size symptom.
const NOISE_THRESHOLD = 0.6;
function isMostlyNoise(run: TopicRunSummary, results: TopicResults | null): boolean {
  if (run.numTopics === 0) return true;
  if (!results || run.numDocuments <= 0) return false;
  const noise = results.topics.find((t) => t.topicId === -1);
  return noise ? noise.size / run.numDocuments >= NOISE_THRESHOLD : false;
}

export function TopicModelingPanel({
  initialRun,
  initialResults,
  embeddedCount,
  completedProfiles = 0,
  pendingCount = 0,
  embeddingModel = null,
  canManage = false,
  showEmbedGuidance = false,
  pgvectorReady = true,
  focusTopicId = null,
  focusFamily = null,
  embeddingDimensions = 768,
  tenantLabel = null,
}: {
  initialRun: TopicRunSummary | null;
  initialResults: TopicResults | null;
  embeddedCount: number;
  /** Corpus counts for the pipeline steps — see JobFamilyPipeline. */
  completedProfiles?: number;
  pendingCount?: number;
  embeddingModel?: string | null;
  /** job_profiles.manage — decides whether the steps offer their controls. */
  canManage?: boolean;
  /** Deep-link target from /posisi/job-family?topicId=…&family=… — opens that card. */
  focusTopicId?: number | null;
  focusFamily?: string | null;
  /** Explain the disabled build button and offer the embedding sync inline —
   *  used where the settings page is not open. */
  showEmbedGuidance?: boolean;
  pgvectorReady?: boolean;
  /** Configured embedding dimension — drives the "Kesamaan Embedding (ND)" label. */
  embeddingDimensions?: number;
  /** Active business unit — printed on the exported report header. */
  tenantLabel?: string | null;
}) {
  const [run, setRun] = useState<TopicRunSummary | null>(initialRun);
  const [results, setResults] = useState<TopicResults | null>(initialResults);
  const [starting, startTransition] = useTransition();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll while a run is pending/processing; fetch results once completed. Keyed
  // on runId + running-state only, so progress ticks don't re-create the timer.
  const runId = run?.runId;
  const isRunning = run != null && RUNNING(run.status);
  useEffect(() => {
    if (!runId || !isRunning) return;

    async function tick() {
      const next = await getTopicRunStatusAction(runId!).catch(() => null);
      if (!next) return;
      setRun(next);
      if (next.status === 'completed') {
        stopPolling();
        const res = await getTopicResultsAction(runId!).catch(() => null);
        if (res) setResults(res);
        if (isMostlyNoise(next, res)) {
          toast.warning(
            'Sebagian besar dokumen menjadi outlier. Turunkan HDBSCAN min_cluster_size di Pengaturan Job Family lalu bangun ulang.',
          );
        } else {
          toast.success(`Selesai — ${next.numTopics} job family ditemukan.`);
        }
      } else if (next.status === 'failed') {
        stopPolling();
        toast.error(next.error ?? 'Topic modeling gagal.');
      }
    }

    pollRef.current = setInterval(tick, 2000);
    void tick();
    return stopPolling;
  }, [runId, isRunning, stopPolling]);

  const onStart = () => {
    startTransition(async () => {
      const res = await startTopicRunAction();
      if (!res.ok || !res.runId) {
        toast.error(res.message);
        return;
      }
      setResults(null);
      setRun({
        runId: res.runId,
        status: 'pending',
        // Optimistic placeholder only — the first poll replaces it with the
        // server's row, which carries the run's real scope.
        tenantId: null,
        tenantName: null,
        progress: { phase: 'pending', message: res.message },
        numDocuments: embeddedCount,
        numTopics: 0,
        embeddingModel: null,
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      });
      toast.success('Run topic modeling dimulai.');
    });
  };

  const running = run != null && RUNNING(run.status);
  const canStart = embeddedCount >= 2 && !running && !starting;
  // Re-read results after a manual mapping writes to the run's assignments.
  const refreshResults = useCallback(async () => {
    const rid = run?.runId;
    if (!rid) return;
    const res = await getTopicResultsAction(rid).catch(() => null);
    if (res) setResults(res);
  }, [run?.runId]);
  // "Belum memulai embedding sama sekali" — the only case that gets the inline
  // sync call-to-action; a partial embedding (1 doc) still falls back to the
  // generic hint below.
  const notEmbeddedYet = showEmbedGuidance && embeddedCount === 0;

  return (
    <div className="space-y-4">
      {/* The ordered flow, and the only place the two pipeline actions live.
          The panel header used to carry a build button of its own while the
          embedding action hid inside a stat chip above it — two controls from
          the same sequence, in two blocks, with no statement of which came
          first. Both are now steps 2 and 3 of one strip. */}
      <JobFamilyPipeline
        completedProfiles={completedProfiles}
        embeddedCount={embeddedCount}
        pendingCount={pendingCount}
        embeddingModel={embeddingModel}
        pgvectorReady={pgvectorReady}
        canManage={canManage}
        runStatus={(run?.status as 'pending' | 'processing' | 'completed' | 'failed') ?? null}
        numTopics={run?.numTopics ?? 0}
        runCompletedAt={run?.completedAt ?? null}
        onBuild={onStart}
        buildBusy={starting || running}
        buildDisabled={!canStart}
      />

      <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Network className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Peta Job Family</h3>
      </div>

      {notEmbeddedYet ? (
        <NotEmbeddedNotice pgvectorReady={pgvectorReady} />
      ) : (
        embeddedCount < 2 && !run && <EmptyHint />
      )}

      {run && RUNNING(run.status) && <RunningProgress run={run} />}

      {run && run.status === 'failed' && <FailedNotice run={run} />}

      {run && run.status === 'completed' && results && (
        <TopicResultsView
          run={run}
          results={results}
          focusTopicId={focusTopicId}
          focusFamily={focusFamily}
          embeddingDimensions={embeddingDimensions}
          tenantLabel={tenantLabel}
          onResultsChanged={refreshResults}
        />
      )}
      </Card>
    </div>
  );
}

/**
 * Shown only when embedding has never been started (embeddedCount === 0) —
 * explains why pipeline step 3 is still locked. It no longer carries an
 * embedding button of its own: that action is step 2 of the strip above, and a
 * second copy here was where its third name came from.
 */
function NotEmbeddedNotice({ pgvectorReady }: { pgvectorReady: boolean }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-amber-300/70 bg-amber-500/5 p-8 text-center dark:border-amber-900/50">
      <Sparkles className="mb-3 h-10 w-10 text-amber-500/50" />
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
        Transformasi job profile belum pernah dijalankan
      </p>
      <p className="mt-1 max-w-lg text-xs leading-relaxed text-amber-700/90 dark:text-amber-300/90">
        Peta dibangun dari <strong>angka</strong>, bukan dari teks dokumen, jadi langkah 3 di atas
        masih terkunci. Jalankan langkah 2 lebih dulu: setiap job profile yang sudah terekstrak
        dirapikan mengikuti template lalu disimpan sebagai angka. Setelah minimal 2 dokumen selesai,
        peta job family bisa dibangun.
      </p>
      {!pgvectorReady && (
        <p className="mt-4 rounded-lg border border-amber-300/70 bg-background/70 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/50 dark:text-amber-200">
          Ekstensi <code className="font-mono">pgvector</code> belum aktif — aktifkan dahulu
          sebelum langkah 2 dapat dijalankan.
        </p>
      )}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
      <Network className="mb-3 h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">
        Belum ada dokumen ter-embed yang cukup
      </p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground/70 leading-relaxed">
        Peta butuh minimal 2 dokumen yang sudah diubah menjadi angka. Jalankan{' '}
        <strong>langkah 2</strong> di atas lebih dulu, lalu <strong>langkah 3</strong> untuk
        mengelompokkannya menjadi job family.
      </p>
    </div>
  );
}

function RunningProgress({ run }: { run: TopicRunSummary }) {
  const done = run.progress?.done ?? 0;
  const total = run.progress?.total ?? 5;
  const pct = total > 0 ? Math.round((done / total) * 100) : 5;
  return (
    <div className="rounded-xl border bg-muted/10 p-5">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        {run.progress?.message ?? 'Memproses…'}
      </div>
      <Progress value={pct} className="h-2" />
      <p className="mt-2 text-xs text-muted-foreground">
        Fase: <span className="font-mono">{run.progress?.phase ?? '—'}</span> · {run.numDocuments}{' '}
        dokumen
      </p>
    </div>
  );
}

function FailedNotice({ run }: { run: TopicRunSummary }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-300/70 bg-red-500/5 p-4 dark:border-red-900/50">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-red-800 dark:text-red-200">Topic modeling gagal</p>
        <p className="text-xs text-red-700/90 dark:text-red-300/90 leading-relaxed">
          {run.error ?? 'Terjadi kesalahan tidak diketahui.'}
        </p>
      </div>
    </div>
  );
}

function NoiseWarning({ run, noiseSize }: { run: TopicRunSummary; noiseSize: number }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-500/5 p-4 dark:border-amber-900/50">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          {run.numTopics === 0 ? 'Tidak ada job family terbentuk' : 'Sebagian besar dokumen menjadi outlier'}
        </p>
        <p className="text-xs text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
          {noiseSize}/{run.numDocuments} dokumen masuk ke bucket noise (topik -1). Dataset terlalu
          kecil atau <code className="font-mono">min_cluster_size</code> terlalu tinggi. Buka{' '}
          <strong>Pengaturan Job Family → Parameter Pipeline</strong>, turunkan{' '}
          <code className="font-mono">HDBSCAN min_cluster_size</code> (mis. ke 2–3), lalu{' '}
          <strong>Bangun Ulang</strong>.
        </p>
      </div>
    </div>
  );
}

// ── Results ────────────────────────────────────────────────────────

function TopicResultsView({
  run,
  results,
  focusTopicId = null,
  focusFamily = null,
  embeddingDimensions = 768,
  tenantLabel = null,
  onResultsChanged,
}: {
  run: TopicRunSummary;
  results: TopicResults;
  focusTopicId?: number | null;
  focusFamily?: string | null;
  /** Business unit the map is read as — printed on the exported report. */
  tenantLabel?: string | null;
  /** Configured embedding dimension — shown in the position-distance labels. */
  embeddingDimensions?: number;
  /** Called after a manual mapping writes to the run so the lists refresh. */
  onResultsChanged?: () => Promise<void> | void;
}) {
  // Which card a deep link asked us to open. The name-matching rule here is
  // deliberately identical to the agent's reader
  // (lib/agent/registry/handlers/knowledge.ts) so the card that opens is the
  // same family the answer described.
  const focusedId = useMemo(() => {
    if (typeof focusTopicId === 'number' && focusTopicId >= 0) return focusTopicId;
    const wanted = focusFamily?.trim().toLowerCase();
    if (!wanted) return null;
    const hit = results.topics.find(
      (t) =>
        t.topicId !== -1 &&
        (((t as { generalTitle?: string | null }).generalTitle ?? '').toLowerCase().includes(wanted) ||
          (t.label ?? '').toLowerCase().includes(wanted)),
    );
    return hit ? hit.topicId : null;
  }, [focusTopicId, focusFamily, results.topics]);

  const [selectedTopic, setSelectedTopic] = useState<number | null>(focusedId);
  const [outlierFocus, setOutlierFocus] = useState<TopicMember | null>(null);
  // Manual mapping: which cluster the highlighted outlier's line points at
  // (null → the recorded nearest cluster from the topic-service).
  const [outlierTarget, setOutlierTarget] = useState<{ topicId: number; similarity: number | null } | null>(null);
  const [distancePos1, setDistancePos1] = useState<number | null>(null);
  const [distancePos2, setDistancePos2] = useState<number | null>(null);
  const [distanceResult, setDistanceResult] = useState<PositionDistanceResult | null>(null);

  const realTopics = useMemo(
    () => results.topics.filter((t) => t.topicId !== -1),
    [results.topics],
  );
  const noise = useMemo(
    () => results.topics.find((t) => t.topicId === -1) ?? null,
    [results.topics],
  );

  const order = useMemo(() => {
    const m = new Map<number, number>();
    realTopics.forEach((t, i) => m.set(t.topicId, i));
    return m;
  }, [realTopics]);
  const colorFor = useCallback((tid: number) => colorForTopic(tid, order), [order]);

  const totalIncumbents = useMemo(
    () => results.topics.reduce((s, t) => s + t.incumbentCount, 0),
    [results.topics],
  );

  const topicMeta: TopicMeta = useMemo(() => {
    const m: TopicMeta = new Map();
    for (const t of results.topics) {
      m.set(t.topicId, {
        size: t.size,
        incumbentCount: t.incumbentCount,
        label: t.label ?? `Topic ${t.topicId}`,
        color: colorFor(t.topicId),
        members: t.members,
        generalTitle: t.generalTitle ?? null,
        generalDescription: t.generalDescription ?? null,
        keywords: t.keywords ?? [],
      });
    }
    return m;
  }, [results.topics, colorFor]);

  const toggleTopic = useCallback(
    (tid: number) => setSelectedTopic((cur) => (cur === tid ? null : tid)),
    [],
  );

  const clearDistance = useCallback(() => {
    setDistancePos1(null);
    setDistancePos2(null);
    setDistanceResult(null);
  }, []);

  // Outlier highlight — from the list row (target = the recorded nearest
  // cluster) or from the merged popup (target = a picked cluster).
  const focusOutlierNearest = useCallback((m: TopicMember) => {
    setOutlierTarget(null);
    setOutlierFocus((cur) => (cur?.jobProfileId === m.jobProfileId ? null : m));
  }, []);
  const highlightOutlierTo = useCallback((m: TopicMember, topicId: number, similarity: number | null) => {
    setOutlierFocus(m);
    setOutlierTarget({ topicId, similarity });
  }, []);
  const clearOutlierFocus = useCallback(() => {
    setOutlierFocus(null);
    setOutlierTarget(null);
  }, []);
  const handleAssigned = useCallback(
    async (member: TopicMember) => {
      if (outlierFocus?.jobProfileId === member.jobProfileId) {
        setOutlierFocus(null);
        setOutlierTarget(null);
      }
      await onResultsChanged?.();
    },
    [outlierFocus?.jobProfileId, onResultsChanged],
  );

  return (
    <div className="space-y-5">
      {isMostlyNoise(run, results) && <NoiseWarning run={run} noiseSize={noise?.size ?? 0} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SummaryBar run={run} totalIncumbents={totalIncumbents} noiseSize={noise?.size ?? 0} />
        <TopicExportDialog run={run} results={results} tenantLabel={tenantLabel} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <Scatter
            assignments={results.assignments}
            topics={results.topics}
            colorFor={colorFor}
            selectedTopic={selectedTopic}
            onSelectTopic={toggleTopic}
            meta={topicMeta}
            distancePos1={distancePos1}
            distancePos2={distancePos2}
            distanceResult={distanceResult}
            onClearDistance={clearDistance}
            outlierFocus={outlierFocus}
            outlierTargetTopicId={outlierTarget?.topicId ?? null}
            outlierTargetSimilarity={outlierTarget?.similarity ?? null}
            onClearOutlierFocus={clearOutlierFocus}
          />
        </div>
        <Legend
          topics={realTopics}
          noise={noise}
          colorFor={colorFor}
          selectedTopic={selectedTopic}
          onSelectTopic={toggleTopic}
        />
      </div>

      {/* Compare two profiles — its own full-width row, NOT inside the map
          column. Sitting in that column it had to share a grid cell with the
          scatter: every result grew the cell, stretched the legend beside it,
          and pushed the family cards below out of place. Full width also gives
          the two profiles a symmetric side-by-side reading. */}
      <PositionDistanceSearch
        assignments={results.assignments}
        topics={results.topics}
        onPositionsSelect={(p1, p2) => {
          setDistancePos1(p1);
          setDistancePos2(p2);
        }}
        onResultUpdate={(res) => setDistanceResult(res)}
        onClear={clearDistance}
        distancePos1={distancePos1}
        distancePos2={distancePos2}
        colorFor={colorFor}
        embeddingDimensions={embeddingDimensions}
      />

      <div className="max-h-[65vh] overflow-y-auto pr-1">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {realTopics.map((t) => (
            <TopicCard
              // The focused id is part of the key so navigating between two
              // family URLs inside one client session remounts the card —
              // `defaultOpen` on a Radix Dialog only applies at mount.
              key={`${t.topicId}:${focusedId ?? ''}`}
              topic={t}
              color={colorFor(t.topicId)}
              selected={selectedTopic === t.topicId}
              onFocus={() => toggleTopic(t.topicId)}
              openInitially={focusedId === t.topicId}
            />
          ))}
        </div>
      </div>

      {noise && noise.members.length > 0 && (
        <NoiseCard
          topic={noise}
          focusedOutlierId={outlierFocus?.jobProfileId ?? null}
          onFocusOutlier={focusOutlierNearest}
          mapping={{
            runId: run.runId,
            topics: realTopics,
            colorFor,
            // The row/dialog ring needs the cluster the map line points at —
            // fall back to the recorded nearest when no explicit target is set.
            targetTopicId: outlierTarget?.topicId ?? outlierFocus?.reason.altTopicId ?? null,
            onHighlight: highlightOutlierTo,
            onAssigned: handleAssigned,
          }}
        />
      )}

      {results.hierarchy && results.hierarchy.linkage.length > 0 && (
        <HierarchyTree linkage={results.hierarchy.linkage} topicMeta={topicMeta} />
      )}
    </div>
  );
}

function Chip({
  children,
  icon: Icon,
  className,
}: {
  children: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium ${
        className ?? 'bg-muted text-muted-foreground'
      }`}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

function SummaryBar({
  run,
  totalIncumbents,
  noiseSize,
}: {
  run: TopicRunSummary;
  totalIncumbents: number;
  noiseSize: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Chip className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" icon={CheckCircle2}>
        {run.numTopics} job family
      </Chip>
      <Chip icon={FileText}>{run.numDocuments} job profile</Chip>
      <Chip className="bg-blue-500/10 text-blue-700 dark:text-blue-300" icon={Users}>
        {totalIncumbents} incumbent
      </Chip>
      {noiseSize > 0 && <Chip>{noiseSize} outlier</Chip>}
      {run.embeddingModel && <Chip>{run.embeddingModel}</Chip>}
      {run.completedAt && <Chip>{formatDateTime(run.completedAt)}</Chip>}
    </div>
  );
}

// ── 2-D scatter ────────────────────────────────────────────────────

function Scatter({
  assignments,
  topics,
  colorFor,
  selectedTopic,
  onSelectTopic,
  meta,
  distancePos1,
  distancePos2,
  distanceResult,
  onClearDistance,
  outlierFocus,
  outlierTargetTopicId,
  outlierTargetSimilarity,
  onClearOutlierFocus,
}: {
  assignments: TopicAssignment[];
  topics: TopicResult[];
  colorFor: (tid: number) => string;
  selectedTopic: number | null;
  onSelectTopic: (tid: number) => void;
  meta: TopicMeta;
  distancePos1: number | null;
  distancePos2: number | null;
  distanceResult: PositionDistanceResult | null;
  onClearDistance: () => void;
  /** Outlier member being highlighted — ring + line to the target cluster. */
  outlierFocus: TopicMember | null;
  /** Cluster the line points at; null → the topic-service's recorded nearest. */
  outlierTargetTopicId: number | null;
  /** Embedding cosine to that target (from the manual-mapping popup). */
  outlierTargetSimilarity: number | null;
  onClearOutlierFocus: () => void;
}) {
  // Hooks first — the early return below would otherwise make them conditional.
  const [mode, setMode] = useState<PlotMode>('pan');
  const [hovered, setHovered] = useState<TopicAssignment | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const hadFocus = useRef(false);
  // Bring the map into view when an outlier is highlighted from the list below.
  useEffect(() => {
    if (outlierFocus && !hadFocus.current) {
      plotRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    hadFocus.current = Boolean(outlierFocus);
  }, [outlierFocus]);

  const pts = assignments.filter((a) => a.x != null && a.y != null);
  if (pts.length === 0) return null;

  const W = 640;
  const H = 380;
  const PAD = 22;
  const xs = pts.map((p) => p.x!);
  const ys = pts.map((p) => p.y!);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const sx = (x: number) => PAD + ((x - minX) / spanX) * (W - 2 * PAD);
  const sy = (y: number) => PAD + (1 - (y - minY) / spanY) * (H - 2 * PAD); // invert y

  // Draw selected-topic points last so they sit on top.
  const ordered = [...pts].sort(
    (a, b) =>
      (a.topicId === selectedTopic ? 1 : 0) - (b.topicId === selectedTopic ? 1 : 0),
  );
  const centroids = topics.filter((t) => t.topicId !== -1 && t.x != null && t.y != null);

  // Find distance points for visualization
  const p1 = distancePos1 ? pts.find((p) => p.jobProfileId === distancePos1) : null;
  const p2 = distancePos2 ? pts.find((p) => p.jobProfileId === distancePos2) : null;

  // Outlier highlight: the member point itself + the cluster the line points
  // at — either picked in the manual-mapping popup, or the nearest real cluster
  // the topic-service recorded (embedding-space cosine, stored per doc).
  const focusPt = outlierFocus && outlierFocus.x != null && outlierFocus.y != null ? outlierFocus : null;
  const targetTopicId = outlierTargetTopicId ?? focusPt?.reason.altTopicId ?? null;
  const target =
    focusPt && targetTopicId != null
      ? topics.find((t) => t.topicId === targetTopicId && t.x != null && t.y != null) ?? null
      : null;
  const targetSim =
    outlierTargetSimilarity ??
    (focusPt && targetTopicId === focusPt.reason.altTopicId ? focusPt.reason.altSimilarity ?? null : null);
  const targetSimPct = focusPt && targetSim != null ? Math.round(targetSim * 100) : null;
  const umapDist = focusPt && target ? Math.hypot(focusPt.x! - target.x!, focusPt.y! - target.y!) : null;

  return (
    <div ref={plotRef} className="relative rounded-xl border bg-muted/10 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        {/* The point-size key stays on screen (it is the legend); how to
            drive the plot in the current mode sits behind the "?". */}
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <ScatterChart className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">Proyeksi 2D (UMAP) — ukuran titik ∝ jumlah incumbent</span>
          <InfoHint title="Proyeksi 2D (UMAP)" size="xs">
            <p>
              {mode === 'pan'
                ? 'Drag untuk geser · scroll untuk zoom.'
                : 'Arahkan ke titik untuk detail · scroll untuk zoom.'}
            </p>
          </InfoHint>
        </div>
        {selectedTopic != null && (
          <button
            className="shrink-0 text-[11px] text-primary hover:underline"
            onClick={() => onSelectTopic(selectedTopic)}
          >
            Tampilkan semua
          </button>
        )}
      </div>
      <div className="relative">
      <ZoomablePlot
        className="rounded-lg"
        mode={mode}
        onModeChange={(m) => {
          setMode(m);
          setHovered(null);
        }}
      >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Sebaran job profile per job family">
        {/* Distance connection line */}
        {p1 && p2 && (
          <>
            <line
              x1={sx(p1.x!)}
              y1={sy(p1.y!)}
              x2={sx(p2.x!)}
              y2={sy(p2.y!)}
              stroke="#8b5cf6"
              strokeWidth="2"
              strokeDasharray="4,4"
              opacity="0.6"
            />
            {/* Distance label at midpoint */}
            {distanceResult && (
              <>
                <circle
                  cx={(sx(p1.x!) + sx(p2.x!)) / 2}
                  cy={(sy(p1.y!) + sy(p2.y!)) / 2}
                  r="14"
                  fill="white"
                  opacity="0.95"
                  stroke="#8b5cf6"
                  strokeWidth="1"
                />
                <text
                  x={(sx(p1.x!) + sx(p2.x!)) / 2}
                  y={(sy(p1.y!) + sy(p2.y!)) / 2 + 2}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="700"
                  fill="#8b5cf6"
                  className="pointer-events-none select-none"
                >
                  {distanceResult.umap2dDistance?.toFixed(2)}
                </text>
              </>
            )}
          </>
        )}

        {/* Outlier highlight: dashed line from the outlier point to the target
            cluster centroid, with the UMAP 2-D distance at the midpoint. */}
        {focusPt && target && (
          <>
            <line
              x1={sx(focusPt.x!)}
              y1={sy(focusPt.y!)}
              x2={sx(target.x!)}
              y2={sy(target.y!)}
              stroke="#f59e0b"
              strokeWidth="2"
              strokeDasharray="4,4"
              opacity="0.7"
            />
            {umapDist != null && (
              <>
                <circle
                  cx={(sx(focusPt.x!) + sx(target.x!)) / 2}
                  cy={(sy(focusPt.y!) + sy(target.y!)) / 2}
                  r="14"
                  fill="white"
                  opacity="0.95"
                  stroke="#f59e0b"
                  strokeWidth="1"
                />
                <text
                  x={(sx(focusPt.x!) + sx(target.x!)) / 2}
                  y={(sy(focusPt.y!) + sy(target.y!)) / 2 + 2}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="700"
                  fill="#f59e0b"
                  className="pointer-events-none select-none"
                >
                  {umapDist.toFixed(2)}
                </text>
              </>
            )}
          </>
        )}

        {ordered.map((p, i) => {
          const isFocused = focusPt?.jobProfileId === p.jobProfileId;
          const dim =
            (selectedTopic != null && p.topicId !== selectedTopic) ||
            (focusPt != null &&
              !isFocused &&
              p.topicId !== (target?.topicId ?? Number.NaN));
          const isSel = p.topicId === selectedTopic;
          const isHovered = mode === 'point' && hovered?.jobProfileId === p.jobProfileId;
          const isDistance = p.jobProfileId === distancePos1 || p.jobProfileId === distancePos2;
          const r =
            3.5 + Math.min(6, p.incumbentCount * 1.3) + (isSel ? 1.5 : 0) + (isHovered ? 2 : 0) + (isDistance ? 2 : 0) + (isFocused ? 2 : 0);
          return (
            <circle
              key={i}
              cx={sx(p.x!)}
              cy={sy(p.y!)}
              r={r}
              fill={colorFor(p.topicId)}
              fillOpacity={dim ? 0.1 : p.topicId === -1 ? (isFocused ? 0.9 : 0.4) : 0.82}
              stroke={isDistance ? '#8b5cf6' : isFocused ? '#f59e0b' : isHovered ? '#0f172a' : isSel ? '#0f172a' : 'none'}
              strokeOpacity={isDistance ? 0.95 : isFocused ? 1 : isHovered ? 0.85 : 0.25}
              strokeWidth={isDistance || isFocused ? 2.5 : isHovered ? 1.5 : 0.75}
              className="cursor-pointer transition-all"
              onClick={() => onSelectTopic(p.topicId)}
              onMouseEnter={() => mode === 'point' && setHovered(p)}
              onMouseLeave={() => setHovered(null)}
            >
              <title>
                {`${p.positionName ?? '#' + p.jobProfileId}${
                  p.divisionDepartment ? '\n' + p.divisionDepartment : ''
                }\nJob family: ${meta.get(p.topicId)?.label ?? p.topicId}\n${p.incumbentCount} incumbent`}
              </title>
            </circle>
          );
        })}
        {/* Pulsing halo ring around the highlighted outlier point. */}
        {focusPt && (
          <circle
            cx={sx(focusPt.x!)}
            cy={sy(focusPt.y!)}
            r={11}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2"
            strokeDasharray="3,3"
            opacity="0.9"
            className="animate-pulse"
          />
        )}
        {centroids.map((t) => {
          const dim = selectedTopic != null && t.topicId !== selectedTopic;
          return (
            <text
              key={t.topicId}
              x={sx(t.x!)}
              y={sy(t.y!)}
              textAnchor="middle"
              className="pointer-events-none select-none"
              fontSize="9"
              fontWeight="700"
              fill={colorFor(t.topicId)}
              fillOpacity={dim ? 0.25 : 0.95}
              stroke="white"
              strokeWidth="0.4"
              paintOrder="stroke"
            >
              {shortLabel(t.label, t.topicId)}
            </text>
          );
        })}
      </svg>
      </ZoomablePlot>

      {/* Pointer-mode readout. Deliberately outside <ZoomablePlot> so it renders
          at 1:1 regardless of zoom, and anchored to a corner so it never covers
          the point being inspected. */}
      {mode === 'point' && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-20 max-w-72 rounded-lg border bg-popover/95 p-2.5 shadow-lg backdrop-blur">
          {hovered ? (
            <>
              <p className="flex items-start gap-1.5 text-xs font-semibold leading-tight">
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colorFor(hovered.topicId) }}
                />
                <span className="min-w-0">
                  {hovered.positionName ?? `Job Profile #${hovered.jobProfileId}`}
                </span>
              </p>
              {hovered.divisionDepartment && (
                <p className="mt-0.5 pl-4 text-[10px] text-muted-foreground">
                  {hovered.divisionDepartment}
                </p>
              )}
              <dl className="mt-1.5 space-y-0.5 pl-4 text-[10px]">
                <div className="flex gap-1.5">
                  <dt className="w-20 shrink-0 text-muted-foreground">Job family</dt>
                  <dd className="min-w-0 flex-1 font-medium">
                    {meta.get(hovered.topicId)?.label ?? `Topic ${hovered.topicId}`}
                  </dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="w-20 shrink-0 text-muted-foreground">Incumbent</dt>
                  <dd className="min-w-0 flex-1 font-medium tabular-nums">
                    {hovered.incumbentCount}
                  </dd>
                </div>
                {hovered.probability != null && (
                  <div className="flex gap-1.5">
                    <dt className="w-20 shrink-0 text-muted-foreground">Keanggotaan</dt>
                    <dd className="min-w-0 flex-1 font-medium tabular-nums">
                      {(hovered.probability * 100).toFixed(0)}%
                    </dd>
                  </div>
                )}
              </dl>
            </>
          ) : (
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Arahkan kursor ke salah satu titik untuk melihat detail job profile-nya.
            </p>
          )}
        </div>
      )}

      {/* Outlier-highlight readout: which cluster is targeted, how close, and
          the UMAP 2-D distance — the numbers behind the amber line on the plot. */}
      {focusPt && target && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-400/40 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <span className="inline-flex items-center gap-1 font-medium">
            <Target className="h-3.5 w-3.5" />
            {focusPt.positionName ?? `Job Profile #${focusPt.jobProfileId}`}
          </span>
          <span className="text-amber-700/90 dark:text-amber-200/90">
            → {targetTopicId === focusPt.reason.altTopicId ? 'cluster terdekat:' : 'cluster tujuan:'}{' '}
            <span className="font-semibold">
              {topicDisplayName(target.generalTitle, target.label, target.topicId)}
            </span>
          </span>
          {targetSimPct != null && (
            <span>
              · kedekatan embedding <span className="font-semibold tabular-nums">{targetSimPct}%</span>
            </span>
          )}
          {umapDist != null && (
            <span>
              · jarak UMAP (2D) <span className="font-semibold tabular-nums">{umapDist.toFixed(2)}</span>
            </span>
          )}
          <button
            className="ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-medium underline-offset-2 hover:underline"
            onClick={onClearOutlierFocus}
          >
            Batalkan sorotan
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

/** Verdict bands for the comparison, read from the corpus-relative percentile
 *  rather than the raw cosine. A cosine between two job-profile embeddings sits
 *  in a narrow band (most pairs here land 0.6–0.9), so fixed cut-offs called
 *  almost every pair "sangat mirip" and the panel stopped discriminating. The
 *  percentile answers the question a user actually has: out of everything on
 *  this map, how close is this? */
const COMPARE_BANDS = [
  {
    min: 95,
    label: 'Sangat berdekatan',
    note: 'Termasuk pasangan terdekat di seluruh peta.',
    tone: 'text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    ring: 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800/50 dark:bg-emerald-950/25',
  },
  {
    min: 80,
    label: 'Berdekatan',
    note: 'Isi job profile keduanya banyak beririsan.',
    tone: 'text-lime-700 dark:text-lime-300',
    bar: 'bg-lime-500',
    ring: 'border-lime-300 bg-lime-50/70 dark:border-lime-800/50 dark:bg-lime-950/25',
  },
  {
    min: 50,
    label: 'Kedekatan sedang',
    note: 'Ada irisan, tetapi bukan pasangan yang menonjol.',
    tone: 'text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-500',
    ring: 'border-amber-300 bg-amber-50/70 dark:border-amber-800/50 dark:bg-amber-950/25',
  },
  {
    min: -1,
    label: 'Berjauhan',
    note: 'Sebagian besar dokumen lain lebih dekat daripada pasangan ini.',
    tone: 'text-rose-700 dark:text-rose-300',
    bar: 'bg-rose-500',
    ring: 'border-rose-300 bg-rose-50/70 dark:border-rose-800/50 dark:bg-rose-950/25',
  },
] as const;

function bandFor(percentile: number | null) {
  const p = percentile ?? -1;
  return COMPARE_BANDS.find((b) => p >= b.min) ?? COMPARE_BANDS[COMPARE_BANDS.length - 1]!;
}

const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : `${(v * 100).toFixed(digits)}%`;

/** Searchable, portalled profile picker. The list it replaced was an absolutely
 *  positioned div inside the map's grid cell — it overlapped the legend, and on
 *  a corpus of a few hundred documents it was an unfiltered scroll. */
function ProfilePicker({
  value,
  options,
  colorFor,
  familyName,
  onSelect,
  placeholder,
  accent,
}: {
  value: number | null;
  options: TopicAssignment[];
  colorFor: (tid: number) => string;
  familyName: (tid: number) => string;
  onSelect: (jobProfileId: number) => void;
  placeholder: string;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  const picked = value != null ? options.find((o) => o.jobProfileId === value) ?? null : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={`flex h-11 w-full items-center gap-2 rounded-lg border px-3 text-left transition-colors ${
            picked ? accent : 'bg-background hover:bg-muted/50'
          }`}
        >
          {picked ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorFor(picked.topicId) }}
            />
          ) : (
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">
              {picked ? picked.positionName ?? `Job Profile #${picked.jobProfileId}` : placeholder}
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {picked
                ? picked.divisionDepartment ?? familyName(picked.topicId)
                : `${options.length} profil tersedia`}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 p-0"
      >
        <Command>
          <CommandInput placeholder="Cari nama jabatan atau divisi…" className="h-9" />
          <CommandList>
            <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
              Tidak ada profil yang cocok.
            </CommandEmpty>
            <CommandGroup>
              {options.map((a) => (
                <CommandItem
                  key={a.jobProfileId}
                  value={`${a.positionName ?? ''} ${a.divisionDepartment ?? ''} ${familyName(a.topicId)} #${a.jobProfileId}`}
                  onSelect={() => {
                    onSelect(a.jobProfileId);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: colorFor(a.topicId) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {a.positionName ?? `Job Profile #${a.jobProfileId}`}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {[a.divisionDepartment, familyName(a.topicId)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {a.incumbentCount > 0 && (
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {a.incumbentCount} org
                    </span>
                  )}
                  {value === a.jobProfileId && (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One headline number with its unit and a one-line reading. */
function CompareStat({
  icon: Icon,
  label,
  value,
  unit,
  hint,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-1 flex items-baseline gap-1 text-lg font-bold leading-none tabular-nums">
        {value}
        {unit && <span className="text-[11px] font-medium text-muted-foreground">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Chip row with a heading and an overflow counter. */
function TermGroup({
  title,
  terms,
  className,
  limit = 10,
  empty,
}: {
  title: string;
  terms: string[];
  className: string;
  limit?: number;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} {terms.length > 0 && <span className="tabular-nums">({terms.length})</span>}
      </p>
      {terms.length === 0 ? (
        <p className="text-[11px] italic text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {terms.slice(0, limit).map((t, i) => (
            <span
              key={`${t}-${i}`}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}
            >
              {t}
            </span>
          ))}
          {terms.length > limit && (
            <span className="px-1 py-0.5 text-[10px] text-muted-foreground">
              +{terms.length - limit} lagi
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** One side of the comparison: identity, family membership, incumbents, and the
 *  documents that sit closest to it — the context that turns a single cosine
 *  into something a reader can judge. */
function ComparedProfileCard({
  side,
  profile,
  color,
  otherName,
}: {
  side: string;
  profile: ComparedProfile;
  color: string;
  otherName: string | null;
}) {
  const family = profile.topicGeneralTitle || profile.topicLabel || `Topic ${profile.topicId}`;
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {side}
          </p>
          <p className="truncate text-sm font-semibold leading-tight">
            {profile.positionName ?? `Job Profile #${profile.jobProfileId}`}
          </p>
          {profile.divisionDepartment && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
              <Building2 className="h-3 w-3 shrink-0" />
              {profile.divisionDepartment}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2 text-[10px]">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium">
          <Layers className="h-3 w-3" />
          {profile.topicId === -1 ? 'Outlier (tanpa family)' : family}
        </span>
        {profile.probability != null && profile.topicId !== -1 && (
          <span className="rounded-full bg-muted px-2 py-0.5 tabular-nums text-muted-foreground">
            keanggotaan {pct(profile.probability, 0)}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 tabular-nums text-muted-foreground">
          <Users className="h-3 w-3" />
          {profile.incumbentCount} incumbent
        </span>
      </div>

      {profile.incumbentNames.length > 0 && (
        <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
          {profile.incumbentNames.slice(0, 4).join(', ')}
          {profile.incumbentNames.length > 4 && ` +${profile.incumbentNames.length - 4} lainnya`}
        </p>
      )}

      {profile.jobPurpose && (
        <p className="mt-2 line-clamp-3 border-t pt-2 text-[11px] leading-relaxed text-muted-foreground">
          {profile.jobPurpose}
        </p>
      )}

      {profile.nearest.length > 0 && (
        <div className="mt-2 border-t pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Profil lain terdekat
          </p>
          <ul className="space-y-0.5">
            {profile.nearest.map((n) => (
              <li
                key={n.jobProfileId}
                className="flex items-baseline justify-between gap-2 text-[10px]"
              >
                <span className="truncate text-muted-foreground">
                  {n.positionName ?? `Job Profile #${n.jobProfileId}`}
                </span>
                <span className="shrink-0 tabular-nums font-medium">{pct(n.similarity, 0)}</span>
              </li>
            ))}
          </ul>
          {otherName && (
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Pembanding{' '}
              <span className="font-medium text-foreground">{otherName}</span> berada di
              peringkat{' '}
              <span className="font-semibold tabular-nums text-foreground">
                {profile.rankOfOther != null ? `#${profile.rankOfOther}` : '—'}
              </span>{' '}
              dari {profile.neighborCount} dokumen.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Bandingkan 2 Profil Jabatan" — pick two documents and read how close they
 * really are.
 *
 * Two decisions shape this panel. The pickers are portalled Popover+Command
 * comboboxes, not the in-flow absolute lists they replaced: those sat inside the
 * scatter plot's grid cell, so opening one overlapped the legend and every
 * result grew the cell and shifted the page around it. And the reading is
 * corpus-relative — `similarityPercentile` and the neighbour rank, not a fixed
 * cosine threshold — because embedding cosines between job profiles occupy a
 * narrow band where an absolute cut-off labels nearly everything "mirip".
 */
function PositionDistanceSearch({
  assignments,
  topics,
  onPositionsSelect,
  onResultUpdate,
  onClear,
  distancePos1,
  distancePos2,
  colorFor,
  embeddingDimensions = 768,
}: {
  assignments: TopicAssignment[];
  topics: TopicResult[];
  onPositionsSelect: (pos1: number | null, pos2: number | null) => void;
  onResultUpdate: (result: PositionDistanceResult | null) => void;
  onClear: () => void;
  distancePos1: number | null;
  distancePos2: number | null;
  colorFor: (tid: number) => string;
  /** Configured embedding dimension — shown as the basis of the comparison. */
  embeddingDimensions?: number;
}) {
  const [result, setResult] = useState<PositionDistanceResult | null>(null);
  const [loading, setLoading] = useState(false);

  const sortedAssignments = useMemo(
    () => [...assignments].sort((a, b) => (a.positionName || '').localeCompare(b.positionName || '')),
    [assignments],
  );

  const familyName = useCallback(
    (tid: number) => {
      if (tid === -1) return 'Outlier';
      const t = topics.find((x) => x.topicId === tid);
      return topicDisplayName(t?.generalTitle ?? null, t?.label ?? null, tid);
    },
    [topics],
  );

  // A new pick invalidates the answer on screen — leaving the old numbers under
  // a changed selection would read as a result for the new pair.
  const select = (p1: number | null, p2: number | null) => {
    setResult(null);
    onResultUpdate(null);
    onPositionsSelect(p1, p2);
  };

  const handleSearch = async () => {
    if (!distancePos1 || !distancePos2) return;
    setLoading(true);
    try {
      const res = await getPositionDistanceAction(distancePos1, distancePos2, assignments, topics);
      setResult(res);
      onResultUpdate(res);
      if (!res) toast.error('Salah satu profil tidak termasuk dalam pemetaan yang sedang tampil.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghitung perbandingan.');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setResult(null);
    onResultUpdate(null);
    onClear();
  };

  const bothPicked = Boolean(distancePos1 && distancePos2);
  const samePicked = bothPicked && distancePos1 === distancePos2;
  // The result on screen belongs to the pair on screen, never a stale one.
  const live =
    result && result.pos1.jobProfileId === distancePos1 && result.pos2.jobProfileId === distancePos2
      ? result
      : null;

  const band = bandFor(live?.similarityPercentile ?? null);
  const percentile = live?.similarityPercentile ?? null;
  const mapShare =
    live?.umap2dDistance != null && live.umap2dSpan ? live.umap2dDistance / live.umap2dSpan : null;
  const sharedCount = live?.sharedCompetencies.length ?? 0;
  const unionCount = live
    ? sharedCount + live.competenciesOnly1.length + live.competenciesOnly2.length
    : 0;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompare className="h-4 w-4 shrink-0 text-primary" />
          {/* The panel's purpose and the pick-then-Hitung instructions that used
              to sit under the pickers until a result arrived. */}
          <h4 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-tight">
            Bandingkan 2 Profil Jabatan
            <InfoHint title="Bandingkan 2 Profil Jabatan">
              <p>
                Seberapa dekat dua jabatan menurut isi job profile-nya — dibaca terhadap seluruh
                dokumen di peta ini.
              </p>
              <p>
                Pilih dua profil jabatan. Perbandingan memakai vektor dokumen job profile, bukan
                data karyawan.
              </p>
              <p>
                Tekan Hitung untuk membandingkan. Hasilnya juga digambar sebagai garis putus-putus
                di peta.
              </p>
            </InfoHint>
          </h4>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {bothPicked && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => select(distancePos2, distancePos1)}
            >
              <ArrowLeftRight className="mr-1 h-3.5 w-3.5" />
              Tukar
            </Button>
          )}
          {(distancePos1 || distancePos2) && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={handleClear}>
              <X className="mr-1 h-3.5 w-3.5" />
              Bersihkan
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto] md:items-center">
          <ProfilePicker
            value={distancePos1}
            options={sortedAssignments}
            colorFor={colorFor}
            familyName={familyName}
            onSelect={(id) => select(id, distancePos2)}
            placeholder="Pilih profil pertama…"
            accent="border-sky-300 bg-sky-50/70 dark:border-sky-800/60 dark:bg-sky-950/25"
          />
          <span className="hidden shrink-0 px-1 text-[11px] font-semibold text-muted-foreground md:block">
            vs
          </span>
          <ProfilePicker
            value={distancePos2}
            options={sortedAssignments}
            colorFor={colorFor}
            familyName={familyName}
            onSelect={(id) => select(distancePos1, id)}
            placeholder="Pilih profil kedua…"
            accent="border-violet-300 bg-violet-50/70 dark:border-violet-800/60 dark:bg-violet-950/25"
          />
          <Button
            size="sm"
            className="h-11 shrink-0 md:w-auto"
            onClick={handleSearch}
            disabled={!bothPicked || samePicked || loading}
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Hitung
          </Button>
        </div>

        {samePicked && (
          <p className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Kedua pilihan menunjuk profil yang sama — pilih jabatan yang berbeda.
          </p>
        )}

        {live && (
          <div className="space-y-3">
            {/* Verdict — the percentile is the headline, the cosine supports it. */}
            <div className={`rounded-lg border p-3 ${band.ring}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className={`text-sm font-bold ${band.tone}`}>
                  {band.label}
                  {live.sameFamily ? ' · satu job family' : ' · beda job family'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {percentile != null ? (
                    <>
                      lebih dekat daripada{' '}
                      <span className="font-semibold tabular-nums text-foreground">
                        {percentile.toFixed(0)}%
                      </span>{' '}
                      dokumen lain di peta
                    </>
                  ) : (
                    'peringkat kedekatan tidak tersedia'
                  )}
                </p>
              </div>
              {percentile != null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/70">
                  <div
                    className={`h-full rounded-full transition-all ${band.bar}`}
                    style={{ width: `${Math.max(2, Math.min(100, percentile))}%` }}
                  />
                </div>
              )}
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {band.note}{' '}
                {live.sameFamily
                  ? 'Keduanya masuk kelompok yang sama saat pemetaan dijalankan.'
                  : 'Pemetaan menempatkan keduanya pada kelompok berbeda.'}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <CompareStat
                icon={Percent}
                label="Kedekatan dokumen"
                value={pct(live.cosineSimilarity)}
                hint={
                  live.pos1.medianSimilarity != null
                    ? `median profil 1 ke dokumen lain ${pct(live.pos1.medianSimilarity, 0)}`
                    : `cosine pada vektor ${embeddingDimensions}D`
                }
              />
              <CompareStat
                icon={Crosshair}
                label="Peringkat kedekatan"
                value={live.pos1.rankOfOther != null ? `#${live.pos1.rankOfOther}` : '—'}
                unit={live.pos1.neighborCount ? `/ ${live.pos1.neighborCount}` : undefined}
                hint={
                  live.pos2.rankOfOther != null
                    ? `arah sebaliknya #${live.pos2.rankOfOther} dari ${live.pos2.neighborCount}`
                    : 'urutan dari sisi profil 1'
                }
              />
              <CompareStat
                icon={Ruler}
                label="Jarak di peta"
                value={live.umap2dDistance != null ? live.umap2dDistance.toFixed(2) : '—'}
                hint={
                  mapShare != null
                    ? `${(mapShare * 100).toFixed(0)}% dari rentang peta (UMAP 2D)`
                    : 'koordinat UMAP tidak tersedia'
                }
              />
              <CompareStat
                icon={Target}
                label="Kompetensi beririsan"
                value={String(sharedCount)}
                unit={unionCount ? `/ ${unionCount}` : undefined}
                hint={
                  unionCount
                    ? `${((sharedCount / unionCount) * 100).toFixed(0)}% dari gabungan kompetensi keduanya`
                    : 'kompetensi teknis belum terekstrak'
                }
              />
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <ComparedProfileCard
                side="Profil 1"
                profile={live.pos1}
                color={colorFor(live.pos1.topicId)}
                otherName={live.pos2.positionName}
              />
              <ComparedProfileCard
                side="Profil 2"
                profile={live.pos2}
                color={colorFor(live.pos2.topicId)}
                otherName={live.pos1.positionName}
              />
            </div>

            <div className="rounded-lg border p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold">
                <Target className="h-3.5 w-3.5 text-primary" />
                Kompetensi teknis pada job profile
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <TermGroup
                  title="Dituntut keduanya"
                  terms={live.sharedCompetencies}
                  className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                  empty="Tidak ada kompetensi yang sama persis."
                />
                <TermGroup
                  title="Hanya profil 1"
                  terms={live.competenciesOnly1}
                  className="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-300"
                  empty="Tidak ada yang khas."
                />
                <TermGroup
                  title="Hanya profil 2"
                  terms={live.competenciesOnly2}
                  className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/50 dark:bg-violet-950/30 dark:text-violet-300"
                  empty="Tidak ada yang khas."
                />
              </div>
            </div>

            {(live.commonKeywords.length > 0 ||
              live.keywordsOnly1.length > 0 ||
              live.keywordsOnly2.length > 0) && (
              <div className="rounded-lg border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold">
                  <Tags className="h-3.5 w-3.5 text-primary" />
                  Kosakata job family
                  {live.sameFamily && (
                    <span className="font-normal text-muted-foreground">
                      — satu family, kosakatanya identik
                    </span>
                  )}
                </p>
                <div className="grid gap-3 md:grid-cols-3">
                  <TermGroup
                    title="Kata kunci bersama"
                    terms={live.commonKeywords.map((k) => k.word)}
                    className="border-primary/30 bg-primary/10 text-foreground"
                    empty="Kedua family memakai kosakata yang berbeda."
                  />
                  <TermGroup
                    title="Khas family profil 1"
                    terms={live.keywordsOnly1.map((k) => k.word)}
                    className="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-300"
                    empty="—"
                  />
                  <TermGroup
                    title="Khas family profil 2"
                    terms={live.keywordsOnly2.map((k) => k.word)}
                    className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/50 dark:bg-violet-950/30 dark:text-violet-300"
                    empty="—"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({
  topics,
  noise,
  colorFor,
  selectedTopic,
  onSelectTopic,
}: {
  topics: TopicResult[];
  noise: TopicResult | null;
  colorFor: (tid: number) => string;
  selectedTopic: number | null;
  onSelectTopic: (tid: number) => void;
}) {
  return (
    <div className="rounded-xl border bg-muted/10 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Tags className="h-3.5 w-3.5" /> Daftar Job Family
      </div>
      <div className="max-h-125 overflow-y-auto pr-2">
        <div className="space-y-1">
          {topics.map((t) => (
            <button
              key={t.topicId}
              onClick={() => onSelectTopic(t.topicId)}
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                selectedTopic === t.topicId ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted'
              }`}
            >
              <span
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorFor(t.topicId) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" title={t.generalTitle ?? t.label ?? ''}>
                  {t.generalTitle ?? t.label ?? `Topic ${t.topicId}`}
                </span>
                {t.generalTitle && t.label && (
                  <span className="block truncate text-[10px] text-muted-foreground" title={t.label}>
                    {t.label}
                  </span>
                )}
              </span>
              <span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground">{t.size}</span>
              <span className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-300">
                <Users className="h-3 w-3" />
                {t.incumbentCount}
              </span>
            </button>
          ))}
          {noise && (
            <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs opacity-70">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: NOISE_COLOR }} />
              <span className="min-w-0 flex-1 truncate">Outlier (noise)</span>
              <span className="text-[10px] text-muted-foreground">{noise.size}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Topic card (expandable, with members + incumbents) ─────────────

function TopicCard({
  topic,
  color,
  selected,
  onFocus,
  openInitially = false,
}: {
  topic: TopicResult;
  color: string;
  selected: boolean;
  onFocus: () => void;
  /** Opened by a deep link (/posisi/job-family?topicId=…). */
  openInitially?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  // The card grid lives inside its own scroll container, so a deep-linked card
  // would sit off-screen the moment its dialog is closed.
  useEffect(() => {
    if (openInitially) cardRef.current?.scrollIntoView({ block: 'center' });
  }, [openInitially]);
  return (
    <div
      ref={cardRef}
      className={`flex flex-col rounded-xl border ${selected ? 'ring-2 ring-primary/50' : ''}`}
    >
      <div className="flex-1 p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold" title={topic.generalTitle ?? topic.label ?? ''}>
                {topic.generalTitle ?? topic.label ?? `Topic ${topic.topicId}`}
              </p>
              {topic.generalTitle && topic.label && (
                <p className="truncate text-[10px] text-muted-foreground" title={topic.label}>
                  {topic.label}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onFocus}
            title="Sorot di peta"
            className={`shrink-0 rounded-md p-1 ${
              selected ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Target className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
          <Badge variant="secondary" className="gap-1">
            <FileText className="h-3 w-3" />
            {topic.size} profil
          </Badge>
          <Badge variant="secondary" className="gap-1 text-blue-700 dark:text-blue-300">
            <Users className="h-3 w-3" />
            {topic.incumbentCount} incumbent
          </Badge>
        </div>

        {topic.generalDescription && (
          <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
            {topic.generalDescription}
          </p>
        )}

        {topic.divisions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {topic.divisions.slice(0, 3).map((d) => (
              <span
                key={d.name}
                className="inline-flex items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                title={`${d.count} profil`}
              >
                <Building2 className="h-3 w-3" />
                {d.name} · {d.count}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {topic.keywords.slice(0, 8).map((k) => (
            <span
              key={k.word}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              title={`c-TF-IDF: ${k.score.toFixed(4)}`}
            >
              {k.word}
            </span>
          ))}
        </div>
      </div>

      {/* Detail opens as a scrollable modal so it never distorts the card grid. */}
      <Dialog defaultOpen={openInitially}>
        <DialogTrigger asChild>
          <button className="flex w-full items-center justify-center gap-1 border-t py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/50">
            <Maximize2 className="h-3.5 w-3.5" />
            Lihat detail &amp; incumbent
          </button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="truncate">{topic.label ?? `Topic ${topic.topicId}`}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <Badge variant="secondary" className="gap-1">
              <FileText className="h-3 w-3" />
              {topic.size} profil
            </Badge>
            <Badge variant="secondary" className="gap-1 text-blue-700 dark:text-blue-300">
              <Users className="h-3 w-3" />
              {topic.incumbentCount} incumbent
            </Badge>
            {topic.divisions.slice(0, 4).map((d) => (
              <span
                key={d.name}
                className="inline-flex items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <Building2 className="h-3 w-3" />
                {d.name} · {d.count}
              </span>
            ))}
          </div>

          <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
            <TopicDetailBody topic={topic} color={color} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The detail body inside a topic's modal — a normal flowing block (the whole
 *  modal scrolls as one). Keyword bars, sample snippet, then the searchable /
 *  filterable member+incumbent list (flow mode, so it doesn't nest a scroll). */
function TopicDetailBody({ topic, color }: { topic: TopicResult; color: string }) {
  const maxScore = topic.keywords[0]?.score ?? 1;
  return (
    <div className="space-y-4">
      {/* c-TF-IDF keyword bars */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Kata kunci (c-TF-IDF)</p>
        <div className="space-y-1">
          {topic.keywords.slice(0, 10).map((k) => (
            <div key={k.word} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-[11px]" title={k.word}>
                {k.word}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(4, (k.score / maxScore) * 100)}%`, backgroundColor: color }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                {k.score.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* representative snippet */}
      {topic.members[0]?.documentSnippet && (
        <div>
          <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Contoh uraian</p>
          <p className="line-clamp-3 rounded-lg bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
            {topic.members[0].documentSnippet}
          </p>
        </div>
      )}

      {/* members + incumbents — searchable + filterable, flows with the modal */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
          Anggota job profile &amp; incumbent
        </p>
        <MembersPanel members={topic.members} flow />
      </div>
    </div>
  );
}

type IncumbentFilter = 'all' | 'has' | 'none';

/** Everything the merged outlier popup needs for manual mapping: the cluster
 *  list with distances, map highlighting, and the assign action. */
type OutlierMappingProps = {
  runId: string;
  topics: TopicResult[];
  colorFor: (tid: number) => string;
  /** Cluster the map line currently points at (rings that row in the popup). */
  targetTopicId: number | null;
  onHighlight: (member: TopicMember, topicId: number, similarity: number | null) => void;
  onAssigned: (member: TopicMember) => Promise<void> | void;
};

/** Searchable + filterable list of a topic's member job profiles and their
 *  incumbents. `flow` renders the list inline (the parent modal scrolls as one);
 *  otherwise the list caps at a fixed height and scrolls itself (outlier card).
 *  `isOutlier` switches rows to outlier mode: nearest-cluster caption, the merged
 *  profile-info + manual-mapping popup, and the map-highlight action. */
function MembersPanel({
  members,
  flow = false,
  isOutlier = false,
  focusedMemberId = null,
  onFocusMember,
  mapping,
}: {
  members: TopicMember[];
  flow?: boolean;
  isOutlier?: boolean;
  /** Outlier member currently highlighted on the map (row gets an amber ring). */
  focusedMemberId?: number | null;
  onFocusMember?: (member: TopicMember) => void;
  /** Outlier rows only: feeds the merged popup's manual-mapping section. */
  mapping?: OutlierMappingProps;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<IncumbentFilter>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (filter === 'has' && m.incumbents.length === 0) return false;
      if (filter === 'none' && m.incumbents.length > 0) return false;
      if (!q) return true;
      const hay = [
        m.positionName ?? '',
        m.divisionDepartment ?? '',
        ...m.incumbents.map(
          (i) => `${i.candidateName ?? ''} ${i.candidatePosition ?? ''} ${i.tenantName ?? ''}`,
        ),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [members, query, filter]);

  const filterOpts: { key: IncumbentFilter; label: string }[] = [
    { key: 'all', label: 'Semua' },
    { key: 'has', label: 'Ada incumbent' },
    { key: 'none', label: 'Tanpa' },
  ];

  const list = (
    <div className="space-y-2">
      {filtered.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-muted-foreground">
          Tidak ada anggota untuk filter ini.
        </p>
      ) : (
        filtered.map((m) => (
          <MemberRow
            key={m.jobProfileId}
            member={m}
            isOutlier={isOutlier}
            focused={focusedMemberId === m.jobProfileId}
            onFocusMap={onFocusMember}
            mapping={mapping}
          />
        ))
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari posisi / divisi / incumbent…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
          {filterOpts.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                filter === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {filtered.length} dari {members.length} anggota
      </p>
      {flow ? list : <div className="max-h-72 overflow-y-auto pr-2">{list}</div>}
    </div>
  );
}

function MemberRow({
  member,
  isOutlier = false,
  focused = false,
  onFocusMap,
  mapping,
}: {
  member: TopicMember;
  /** Outlier rendering: nearest-cluster caption + merged popup + map highlight. */
  isOutlier?: boolean;
  /** This member is the one currently highlighted on the map. */
  focused?: boolean;
  onFocusMap?: (member: TopicMember) => void;
  /** Outlier rows only: feeds the merged popup's manual-mapping section. */
  mapping?: OutlierMappingProps;
}) {
  const prob = member.probability != null ? Math.round(member.probability * 100) : null;
  const altId = member.reason.altTopicId;
  const altPct = member.reason.altSimilarity != null ? Math.round(member.reason.altSimilarity * 100) : null;
  const canFocusMap = isOutlier && onFocusMap && member.x != null && member.y != null;
  return (
    <div className={`rounded-lg border bg-background/50 p-2 ${focused ? 'ring-2 ring-amber-400/60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[12px] font-medium" title={member.positionName ?? ''}>
          {member.positionName ?? `Job Profile #${member.jobProfileId}`}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {prob != null && (
            <span className="text-[10px] tabular-nums text-muted-foreground" title="Probabilitas keanggotaan">
              {prob}%
            </span>
          )}
          <MemberInfoDialog
            member={member}
            isOutlier={isOutlier}
            mapping={mapping}
            highlightedTopicId={focused ? mapping?.targetTopicId ?? null : null}
          />
          {canFocusMap && (
            <button
              type="button"
              onClick={() => onFocusMap!(member)}
              title={focused ? 'Batalkan sorotan di peta' : 'Sorot posisi di peta'}
              className={`rounded-md p-1 ${focused ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Target className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {member.divisionDepartment && (
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Building2 className="h-3 w-3" />
          {member.divisionDepartment}
        </p>
      )}
      {isOutlier && altId != null && (
        <p
          className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"
          title="Cluster terdekat berdasarkan kedekatan embedding dokumen ini"
        >
          <Target className="h-3 w-3 shrink-0 text-amber-600/80 dark:text-amber-400/80" />
          <span className="min-w-0 truncate">
            Terdekat:{' '}
            <span className="font-medium text-foreground/80">
              {topicDisplayName(member.reason.altTopicGeneralTitle, member.reason.altTopicLabel, altId)}
            </span>
            {altPct != null && (
              <>
                {' '}
                · kedekatan <span className="font-medium tabular-nums text-foreground/80">{altPct}%</span>
              </>
            )}
          </span>
        </p>
      )}
      {member.incumbents.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {member.incumbents.map((inc) => (
            <IncumbentChip key={inc.candidateId} inc={inc} />
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[10px] italic text-muted-foreground/60">Tidak ada incumbent tercocok</p>
      )}
    </div>
  );
}

/** Popup with a member's full job-profile info — summary (tujuan jabatan,
 *  tanggung jawab, kompetensi), reason, and incumbents. Outlier members get a
 *  dedicated layout whose hierarchy puts the nearest cluster first, PLUS the
 *  manual-mapping section (cluster list sorted by closeness, map highlight,
 *  and the add-to-cluster action). Non-modal in outlier mode so the map stays
 *  visible while a cluster row is highlighted. */
function MemberInfoDialog({
  member,
  isOutlier = false,
  mapping,
  highlightedTopicId = null,
}: {
  member: TopicMember;
  isOutlier?: boolean;
  /** Outlier mode only: feeds the manual-mapping section. */
  mapping?: OutlierMappingProps;
  /** Cluster currently highlighted on the map for THIS member (rings that row). */
  highlightedTopicId?: number | null;
}) {
  return (
    <Dialog modal={!isOutlier}>
      <DialogTrigger asChild>
        <button
          type="button"
          title={isOutlier ? 'Info profil pekerjaan & petakan ke cluster' : 'Info profil pekerjaan'}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{member.positionName ?? `Job Profile #${member.jobProfileId}`}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {member.divisionDepartment && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {member.divisionDepartment}
            </span>
          )}
          {isOutlier && (
            <Badge variant="secondary" className="gap-1 text-[11px]">
              <AlertTriangle className="h-3.5 w-3.5" />
              Outlier / belum terkelompok
            </Badge>
          )}
        </div>
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          {isOutlier ? (
            <>
              <OutlierProfileBody member={member} />
              {mapping && (
                <div className="mt-4 border-t pt-3">
                  <ClusterMappingSection
                    member={member}
                    mapping={mapping}
                    highlightedTopicId={highlightedTopicId}
                  />
                </div>
              )}
            </>
          ) : (
            <MemberDetailCard member={member} familyLabel="Outlier (noise)" ancestors={[]} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Outlier popup body with a deliberate visual hierarchy: the nearest cluster
 *  (headline metric, paraphrase title) → profile summary → incumbents. Larger
 *  type than the inline tree detail — this is the primary readout for the row. */
function OutlierProfileBody({ member }: { member: TopicMember }) {
  const { reason, summary } = member;
  const altId = reason.altTopicId;
  const altName =
    altId != null ? topicDisplayName(reason.altTopicGeneralTitle, reason.altTopicLabel, altId) : null;
  const altPct = reason.altSimilarity != null ? Math.round(reason.altSimilarity * 100) : null;
  const hasSummary =
    Boolean(summary.jobPurpose || member.documentSnippet) ||
    summary.responsibilities.length > 0 ||
    summary.competencies.length > 0;
  return (
    <div className="space-y-4 text-sm">
      {/* ── Nearest cluster: the one number that explains an outlier ── */}
      <section className="space-y-1.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Target className="h-3.5 w-3.5" /> Cluster terdekat
        </h3>
        <div className="rounded-lg border bg-muted/30 p-3">
          {altName ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="text-base font-semibold leading-snug">{altName}</p>
                  {reason.altTopicGeneralTitle && reason.altTopicLabel && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={reason.altTopicLabel}>
                      {reason.altTopicLabel}
                    </p>
                  )}
                </div>
                {altPct != null && (
                  <div className="shrink-0 text-right">
                    <p className="text-xl font-bold leading-none tabular-nums text-amber-600 dark:text-amber-400">
                      {altPct}%
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">kedekatan embedding</p>
                  </div>
                )}
              </div>
              {altPct != null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-amber-500 dark:bg-amber-400"
                    style={{ width: `${Math.min(100, altPct)}%` }}
                  />
                </div>
              )}
            </>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              Informasi cluster terdekat tidak tersedia pada hasil proses versi lama.
            </p>
          )}
        </div>
        <p className="text-[11px] italic leading-relaxed text-muted-foreground">
          Dokumen ini tidak masuk kelompok mana pun (outlier), sehingga tidak memiliki kata kunci
          family yang cocok maupun kedekatan ke pusat family sendiri.
        </p>
      </section>

      {/* ── Profile summary ── */}
      <section className="space-y-1.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <FileText className="h-3.5 w-3.5" /> Ringkasan profil jabatan
        </h3>
        {hasSummary ? (
          <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
            {summary.jobPurpose && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Tujuan jabatan</p>
                <p className="mt-0.5 text-sm leading-relaxed">{summary.jobPurpose}</p>
              </div>
            )}
            {!summary.jobPurpose && member.documentSnippet && (
              <p className="text-xs leading-relaxed text-muted-foreground">{member.documentSnippet}</p>
            )}
            {summary.responsibilities.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Tanggung jawab utama</p>
                <ul className="mt-1 ml-4 list-disc space-y-0.5 text-sm leading-relaxed">
                  {summary.responsibilities.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {summary.competencies.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Kompetensi teknis</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {summary.competencies.map((c, i) => (
                    <span key={i} className="rounded border bg-background px-1.5 py-0.5 text-[11px]">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Dokumen job profile tidak memiliki ringkasan terekstraksi.
          </p>
        )}
      </section>

      {/* ── Incumbents ── */}
      <section className="space-y-1.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> Incumbent ({member.incumbents.length})
        </h3>
        {member.incumbents.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {member.incumbents.map((inc) => (
              <IncumbentChip key={inc.candidateId} inc={inc} large />
            ))}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">Tidak ada incumbent tercocok</p>
        )}
      </section>
    </div>
  );
}

// ── Manual mapping: add an outlier into a cluster ──────────────────

/** Section inside the merged outlier popup: every real cluster sorted by
 *  embedding closeness (nearest first), each row with its distance numbers, a
 *  map-highlight action and an "add to this cluster" action. */
function ClusterMappingSection({
  member,
  mapping,
  highlightedTopicId,
}: {
  member: TopicMember;
  mapping: OutlierMappingProps;
  /** Cluster currently highlighted on the map (rings that row). */
  highlightedTopicId: number | null;
}) {
  const { runId, topics, colorFor, onHighlight, onAssigned } = mapping;
  const [distances, setDistances] = useState<ClusterDistance[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getOutlierClusterDistancesAction(runId, member.jobProfileId)
      .then((res) => {
        if (cancelled) return;
        setDistances(res);
        setLoading(false);
        // Auto-highlight the nearest cluster so the map shows the closest line
        // the moment the popup opens.
        const nearest = res?.[0];
        if (nearest) onHighlight(member, nearest.topicId, nearest.cosineSimilarity);
      })
      .catch(() => {
        if (!cancelled) {
          setDistances(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // onHighlight is stable in the parent; fetching is keyed on the member only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, member.jobProfileId]);

  const assign = async (topicId: number) => {
    setAssigningId(topicId);
    const res = await assignOutlierToClusterAction(runId, member.jobProfileId, topicId);
    setAssigningId(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    const topic = topics.find((t) => t.topicId === topicId);
    toast.success(
      `"${member.positionName ?? 'Dokumen'}" dipetakan ke cluster "${topicDisplayName(topic?.generalTitle ?? null, topic?.label ?? null, topicId)}".`,
    );
    onAssigned(member);
  };

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <FolderPlus className="h-3.5 w-3.5" /> Petakan ke cluster
        <InfoHint title="Petakan ke cluster" size="xs">
          <p>
            Daftar cluster diurutkan dari yang paling dekat. Ikon sasaran menggambar garis sorotan
            di peta dari posisi outlier ke cluster itu; ikon plus menetapkan keanggotaan manual
            (terbatal bila peta dibangun ulang).
          </p>
        </InfoHint>
      </h3>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Menghitung kedekatan ke setiap cluster…
        </div>
      ) : !distances || distances.length === 0 ? (
        <p className="py-8 text-center text-xs italic text-muted-foreground">
          Tidak ada cluster pada run ini.
        </p>
      ) : (
        <div className="space-y-1.5">
          {distances.map((d, idx) => {
            const pct = d.cosineSimilarity != null ? Math.round(d.cosineSimilarity * 100) : null;
            const highlighted = highlightedTopicId === d.topicId;
            return (
              <div
                key={d.topicId}
                className={`rounded-lg border p-2.5 ${
                  highlighted ? 'border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorFor(d.topicId) }}
                    />
                    <span className="min-w-0 truncate text-xs font-medium">
                      <span className="mr-1.5 text-[10px] tabular-nums text-muted-foreground">
                        {idx + 1}.
                      </span>
                      {topicDisplayName(d.generalTitle, d.label, d.topicId)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onHighlight(member, d.topicId, d.cosineSimilarity)}
                      title={highlighted ? 'Batalkan sorotan di peta' : 'Sorot garis ke cluster ini di peta'}
                      className={`rounded-md p-1 ${
                        highlighted ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Target className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => assign(d.topicId)}
                      disabled={assigningId != null}
                      title="Tetapkan ke cluster ini"
                      className="rounded-md p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50 dark:text-emerald-400"
                    >
                      {assigningId === d.topicId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  {pct != null ? (
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold tabular-nums text-foreground/90">{pct}%</span>
                      kedekatan embedding
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: colorFor(d.topicId) }}
                        />
                      </span>
                    </span>
                  ) : (
                    <span className="italic">embedding tidak tersedia</span>
                  )}
                  {d.umap2dDistance != null && (
                    <span className="tabular-nums">
                      jarak UMAP (2D){' '}
                      <span className="font-medium text-foreground/80">{d.umap2dDistance.toFixed(2)}</span>
                    </span>
                  )}
                  <span>{d.size} profil</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function IncumbentChip({ inc, large = false }: { inc: Incumbent; large?: boolean }) {
  const sim = inc.similarity != null ? ` · ${Math.round(inc.similarity * 100)}%` : '';
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border bg-background ${large ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]'}`}
      title={`${inc.candidatePosition ?? ''}${inc.tenantName ? ' · ' + inc.tenantName : ''} · match: ${inc.matchType}${sim}`}
    >
      <Users className={`shrink-0 text-blue-600 dark:text-blue-300 ${large ? 'h-3.5 w-3.5' : 'h-3 w-3'}`} />
      <span className="truncate font-medium">{inc.candidateName ?? 'Tanpa nama'}</span>
      {inc.tenantName && (
        <span className={`shrink-0 rounded bg-muted text-muted-foreground ${large ? 'px-1 text-[10px]' : 'px-1 text-[9px]'}`}>
          {inc.tenantName}
        </span>
      )}
    </span>
  );
}

function NoiseCard({
  topic,
  focusedOutlierId = null,
  onFocusOutlier,
  mapping,
}: {
  topic: TopicResult;
  /** Outlier member currently highlighted on the map. */
  focusedOutlierId?: number | null;
  onFocusOutlier?: (member: TopicMember) => void;
  /** Feeds the merged popup's manual-mapping section. */
  mapping?: OutlierMappingProps;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-dashed">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: NOISE_COLOR }} />
        Outlier / belum terkelompok
        <Badge variant="secondary" className="ml-1 text-[10px]">
          {topic.size}
        </Badge>
        <ChevronDown className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t p-3">
          <MembersPanel
            members={topic.members}
            isOutlier
            focusedMemberId={focusedOutlierId}
            onFocusMember={onFocusOutlier}
            mapping={mapping}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Hierarchical Family Tree ───────────────────────────────────────

type TreeNode = {
  id: string;
  name: string;
  distance: number | null;
  /** Generalized "topic recognition" for internal (sub-family) nodes. */
  title: string | null;
  description: string | null;
  keywords: TopicKeyword[];
  children: TreeNode[];
};

function buildTree(linkage: HierarchyLinkRow[]): TreeNode | null {
  const nodes = new Map<string, TreeNode>();
  const childIds = new Set<string>();
  const ensure = (id: string | null, name: string | null): TreeNode | null => {
    if (id == null) return null;
    let n = nodes.get(id);
    if (!n) {
      n = { id, name: name ?? id, distance: null, title: null, description: null, keywords: [], children: [] };
      nodes.set(id, n);
    } else if (name && n.name === n.id) {
      n.name = name;
    }
    return n;
  };

  for (const row of linkage) {
    const parent = ensure(row.parentId, row.parentName);
    const left = ensure(row.childLeftId, row.childLeftName);
    const right = ensure(row.childRightId, row.childRightName);
    if (parent) {
      parent.children = [left, right].filter(Boolean) as TreeNode[];
      parent.distance = row.distance ?? parent.distance; // merge height that formed this node
      parent.title = row.parentTitle ?? parent.title;
      parent.description = row.parentDescription ?? parent.description;
      parent.keywords = (row.parentKeywords as TopicKeyword[] | null) ?? parent.keywords;
    }
    if (row.childLeftId) childIds.add(row.childLeftId);
    if (row.childRightId) childIds.add(row.childRightId);
  }

  const roots = [...nodes.values()].filter((n) => !childIds.has(n.id) && n.children.length > 0);
  if (roots.length === 0) return null;
  return roots.sort((a, b) => countLeaves(b) - countLeaves(a))[0]!;
}

function countLeaves(n: TreeNode): number {
  if (n.children.length === 0) return 1;
  return n.children.reduce((s, c) => s + countLeaves(c), 0);
}

function aggIncumbents(n: TreeNode, meta: TopicMeta): number {
  if (n.children.length === 0) {
    const tid = parseInt(n.id, 10);
    return Number.isNaN(tid) ? 0 : (meta.get(tid)?.incumbentCount ?? 0);
  }
  return n.children.reduce((s, c) => s + aggIncumbents(c, meta), 0);
}

function aggProfiles(n: TreeNode, meta: TopicMeta): number {
  if (n.children.length === 0) {
    const tid = parseInt(n.id, 10);
    return Number.isNaN(tid) ? 0 : (meta.get(tid)?.size ?? 0);
  }
  return n.children.reduce((s, c) => s + aggProfiles(c, meta), 0);
}

function HierarchyTree({
  linkage,
  topicMeta,
}: {
  linkage: HierarchyLinkRow[];
  topicMeta: TopicMeta;
}) {
  const root = useMemo(() => buildTree(linkage), [linkage]);
  const [open, setOpen] = useState(true);
  if (!root) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* The reading guide sits behind a "?", which cannot live inside the
          trigger (a button): labelled trigger, hint, then a pointer-only
          trigger over the rest of the row, so the whole row still toggles. */}
      <div className="group flex items-center gap-1.5">
        <CollapsibleTrigger className="flex items-center gap-1.5 rounded-lg py-1 text-xs font-semibold text-muted-foreground group-hover:text-foreground">
          <Layers className="h-3.5 w-3.5" />
          Hierarki Job Family
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        </CollapsibleTrigger>
        <InfoHint title="Hierarki Job Family" size="xs">
          <p>
            Tiap sub-family (kartu bergaris putus) &amp; klaster daun menampilkan judul umum,
            deskripsi singkat, dan kata kunci teratas.
          </p>
          <p>
            Klik sebuah sub-family untuk membuka anak-anaknya di hirarki; pada klaster daun, klik
            menampilkan deskripsi penuh, seluruh kata kunci, dan profil anggotanya (ringkasan,
            alasan, dan jalur hirarki).
          </p>
        </InfoHint>
        <CollapsibleTrigger tabIndex={-1} aria-hidden className="flex-1 self-stretch" />
      </div>
      <CollapsibleContent>
        <div className="mt-2 rounded-xl border bg-muted/10 p-3 text-xs">
          <TreeBranch node={root} depth={0} meta={topicMeta} ancestors={[]} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

type TreeAncestor = { name: string; distance: number | null };

function TreeBranch({
  node,
  depth,
  meta,
  ancestors,
}: {
  node: TreeNode;
  depth: number;
  meta: TopicMeta;
  ancestors: TreeAncestor[];
}) {
  const isLeaf = node.children.length === 0;
  const tid = isLeaf ? parseInt(node.id, 10) : NaN;
  const leafMeta = !Number.isNaN(tid) ? meta.get(tid) : undefined;
  const inc = aggIncumbents(node, meta);
  // Internal nodes near the root start expanded so the top of the tree is
  // visible at a glance; deeper sub-families stay collapsed until clicked.
  const [open, setOpen] = useState(!isLeaf && depth < 2);
  const members = leafMeta?.members ?? [];

  // Generalized "topic recognition" for this node (leaf cluster or sub-family).
  const title = isLeaf
    ? leafMeta?.generalTitle ?? leafMeta?.label ?? node.name
    : node.title ?? node.name;
  const description = isLeaf ? leafMeta?.generalDescription ?? null : node.description ?? null;
  const keywords = isLeaf ? leafMeta?.keywords ?? [] : node.keywords ?? [];
  // Internal nodes always expandable — their "detail" is their child sub-families.
  const hasDetail = !isLeaf || Boolean(description) || keywords.length > 0 || members.length > 0;

  // Chain of internal (sub-family) titles passed down to the leaf breadcrumb.
  const childAncestors: TreeAncestor[] = isLeaf
    ? ancestors
    : [...ancestors, { name: title, distance: node.distance }];

  const header = (
    <div className="flex flex-wrap items-center gap-1.5">
      {isLeaf ? (
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: leafMeta ? leafMeta.color : '#94a3b8' }}
        />
      ) : (
        <Layers className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
      {hasDetail ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1 hover:text-primary ${isLeaf ? 'text-foreground' : 'font-semibold text-foreground'}`}
        >
          <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span>{title}</span>
        </button>
      ) : (
        <span className={isLeaf ? 'text-foreground' : 'font-semibold text-foreground'}>{title}</span>
      )}
      {!isLeaf && (
        <span className="text-[10px] text-muted-foreground/70">
          ({countLeaves(node)} job family · {aggProfiles(node, meta)} profil)
        </span>
      )}
      {leafMeta && <span className="text-[10px] text-muted-foreground/70">· {leafMeta.size} profil</span>}
      {inc > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-300">
          <Users className="h-3 w-3" />
          {inc}
        </span>
      )}
    </div>
  );

  // Always-visible generalization: aggregated keywords + (LLM) description.
  // Collapsed shows a preview (clamped description + top keywords); expanding
  // un-clamps the description, reveals the full keyword set, and — for internal
  // nodes — extends the hierarchy with their child sub-families.
  const gen =
    description || keywords.length > 0 ? (
      <div className="mt-1 space-y-1">
        {description && (
          <p
            className={`text-[10px] leading-relaxed text-muted-foreground ${open ? '' : 'line-clamp-2'}`}
          >
            {description}
          </p>
        )}
        {keywords.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {keywords.slice(0, open ? 12 : 4).map((k, i) => (
              <span
                key={i}
                className="rounded-full border bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                title={`skor: ${k.score.toFixed(3)}`}
              >
                {k.word}
              </span>
            ))}
            {!open && keywords.length > 4 && (
              <span className="text-[9px] text-muted-foreground/60">+{keywords.length - 4}</span>
            )}
          </div>
        )}
      </div>
    ) : null;

  return (
    <div className={depth > 0 ? 'ml-3 border-l pl-3' : ''}>
      {isLeaf ? (
        <div className="py-0.5">
          {header}
          {gen}
        </div>
      ) : (
        // Internal (sub-family) node → embedded summary card, always visible.
        <div className="my-1 rounded-lg border border-dashed bg-muted/15 px-2 py-1.5">
          {header}
          {gen}
        </div>
      )}

      {isLeaf && open && members.length > 0 && (
        <div className="ml-3 mt-1 space-y-1 border-l pl-3">
          {members.map((m) => (
            <MemberProfileRow
              key={m.jobProfileId}
              member={m}
              familyLabel={title}
              ancestors={childAncestors}
            />
          ))}
        </div>
      )}

      {open &&
        node.children.map((c) => (
          <TreeBranch key={c.id} node={c} depth={depth + 1} meta={meta} ancestors={childAncestors} />
        ))}
    </div>
  );
}

/** A member job profile inside a leaf family — expandable to its detail card. */
function MemberProfileRow({
  member,
  familyLabel,
  ancestors,
}: {
  member: TopicMember;
  familyLabel: string;
  ancestors: TreeAncestor[];
}) {
  const [open, setOpen] = useState(false);
  const prob = member.probability != null ? Math.round(member.probability * 100) : null;
  return (
    <div className="rounded-md border bg-background/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/40"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium" title={member.positionName ?? ''}>
          {member.positionName ?? `Job Profile #${member.jobProfileId}`}
        </span>
        {member.incumbents.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-300">
            <Users className="h-3 w-3" />
            {member.incumbents.length}
          </span>
        )}
        {prob != null && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground" title="Probabilitas keanggotaan">
            {prob}%
          </span>
        )}
      </button>
      {open && <MemberDetailCard member={member} familyLabel={familyLabel} ancestors={ancestors} />}
    </div>
  );
}

/** Expanded member detail: reason (keywords + closeness), hierarchy path, summary, incumbents. */
function MemberDetailCard({
  member,
  familyLabel,
  ancestors,
}: {
  member: TopicMember;
  familyLabel: string;
  ancestors: TreeAncestor[];
}) {
  const { reason, summary } = member;
  const centroidPct =
    reason.centroidSimilarity != null ? Math.round(reason.centroidSimilarity * 100) : null;
  const altPct = reason.altSimilarity != null ? Math.round(reason.altSimilarity * 100) : null;

  return (
    <div className="space-y-2 border-t px-2.5 py-2 text-[11px]">
      {/* Reason */}
      <div className="space-y-1.5">
        <p className="flex items-center gap-1 font-semibold text-muted-foreground">
          <Tags className="h-3 w-3" /> Alasan masuk family
        </p>
        {reason.matchedKeywords.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {reason.matchedKeywords.map((k, i) => (
              <span
                key={i}
                className="rounded-full border bg-muted/50 px-1.5 py-0.5 text-[10px]"
                title={`c-TF-IDF: ${k.score.toFixed(3)}`}
              >
                {k.word}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[10px] italic text-muted-foreground/60">
            Tidak ada kata kunci family yang cocok pada dokumen ini (atau outlier).
          </p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          {centroidPct != null && (
            <span className="inline-flex items-center gap-1">
              <Target className="h-3 w-3" /> Kedekatan ke pusat family:{' '}
              <span className="font-medium text-foreground/80">{centroidPct}%</span>
            </span>
          )}
          {reason.altTopicId != null && altPct != null && (
            <span>
              Family alternatif:{' '}
              <span className="font-medium text-foreground/80">
                {topicDisplayName(reason.altTopicGeneralTitle, reason.altTopicLabel, reason.altTopicId)}
              </span>{' '}
              ({altPct}%)
            </span>
          )}
        </div>
      </div>

      {/* Hierarchy path */}
      {ancestors.length > 0 && (
        <div className="space-y-0.5">
          <p className="flex items-center gap-1 font-semibold text-muted-foreground">
            <FolderTree className="h-3 w-3" /> Jalur hirarki
          </p>
          <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
            {ancestors.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <span className="max-w-40 truncate" title={a.name}>
                  {a.name}
                </span>
                <ChevronRight className="h-2.5 w-2.5 shrink-0" />
              </span>
            ))}
            <span className="font-medium text-foreground/80">{familyLabel}</span>
          </div>
        </div>
      )}

      {/* Inline profile summary */}
      <div className="space-y-1">
        <p className="flex items-center gap-1 font-semibold text-muted-foreground">
          <FileText className="h-3 w-3" /> Ringkasan profil
        </p>
        {summary.jobPurpose ? (
          <p className="text-[10px] text-foreground/80">
            <span className="font-medium">Tujuan: </span>
            {summary.jobPurpose}
          </p>
        ) : member.documentSnippet ? (
          <p className="text-[10px] text-muted-foreground">{member.documentSnippet}</p>
        ) : null}
        {summary.responsibilities.length > 0 && (
          <div className="text-[10px] text-foreground/80">
            <span className="font-medium">Tanggung jawab:</span>
            <ul className="ml-3 list-disc space-y-0.5">
              {summary.responsibilities.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {summary.competencies.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-medium text-foreground/80">Kompetensi:</span>
            {summary.competencies.map((c, i) => (
              <span key={i} className="rounded border bg-muted/40 px-1 py-0.5 text-[9px]">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Incumbents */}
      {member.incumbents.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {member.incumbents.map((inc) => (
            <IncumbentChip key={inc.candidateId} inc={inc} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────

function shortLabel(label: string | null, tid: number): string {
  const base = (label ?? `T${tid}`).split(',')[0]!.trim();
  return base.length > 16 ? `${base.slice(0, 16)}…` : base;
}

/** Display name for a topic: the LLM paraphrase wins, raw keywords fall back. */
function topicDisplayName(generalTitle: string | null, label: string | null, tid: number): string {
  return generalTitle ?? shortLabel(label, tid);
}
