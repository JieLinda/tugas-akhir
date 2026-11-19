'use client';

// Shared, compact "(re)build embeddings" panel with a live batched progress bar.
// Both the Kamus-Kompetensi and Job-Profile embedding panels on /settings/sync
// are thin wrappers over this — they only differ in copy + which server actions
// plan/process/cancel a run and report status. Mirrors the batched rebuild flow
// used by the Job Family Configuration page (plan → per-batch process → cancel).

import { useEffect, useState, type ElementType, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import {
  Sparkles,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Database,
  CheckCircle2,
} from 'lucide-react';

// Structural subsets of the per-domain action return types (KamusEmbed* /
// Rebuild*), so the concrete actions can be passed straight through.
export type EmbedPanelStatus = {
  ready: boolean;
  embedded: number;
  total: number;
  embeddingModel: string | null;
  error?: string;
};

export type EmbedPanelPlan = {
  ok: boolean;
  sessionId: string | null;
  total: number;
  skipped: number;
  /** Job profiles report orphan vectors deleted; the kamus sync doesn't prune, so optional. */
  removed?: number;
  batchCount: number;
  message: string;
};

export type EmbedPanelBatch = {
  ok: boolean;
  done: boolean;
  batchIndex: number;
  batchCount: number;
  embedded: number;
  skipped: number;
  failed: number;
  removed?: number;
  total: number;
  error: string | null;
  message: string;
};

type Progress = {
  phase: 'planning' | 'embedding' | 'done' | 'error';
  batchIndex: number;
  batchCount: number;
  embedded: number;
  skipped: number;
  failed: number;
  removed: number;
  total: number;
  message: string;
  error: string | null;
};

export function EmbeddingRebuildPanel({
  title,
  description,
  icon: Icon = Sparkles,
  loadStatus,
  startPlan,
  processBatch,
  cancel,
}: {
  title: string;
  description: ReactNode;
  icon?: ElementType;
  loadStatus: () => Promise<EmbedPanelStatus>;
  startPlan: () => Promise<EmbedPanelPlan>;
  processBatch: (sessionId: string, batchIndex: number) => Promise<EmbedPanelBatch>;
  cancel: (sessionId: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<EmbedPanelStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  function refresh() {
    setLoading(true);
    loadStatus()
      .then(setStatus)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Gagal memuat status embedding.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setRunning(true);
    setProgress({
      phase: 'planning',
      batchIndex: 0,
      batchCount: 0,
      embedded: 0,
      skipped: 0,
      failed: 0,
      removed: 0,
      total: 0,
      message: 'Menyiapkan dokumen…',
      error: null,
    });
    let activeSessionId: string | null = null;
    try {
      const plan = await startPlan();
      if (!plan.ok || !plan.sessionId) {
        setProgress({
          phase: 'error',
          batchIndex: 0,
          batchCount: 0,
          embedded: 0,
          skipped: plan.skipped,
          failed: 0,
          removed: plan.removed ?? 0,
          total: plan.total,
          message: plan.message,
          error: plan.message,
        });
        toast.error(plan.message);
        return;
      }
      activeSessionId = plan.sessionId;

      // No document to embed (all empty) → done immediately. The prune already
      // ran during planning, so this can still be a run that changed something.
      if (plan.batchCount === 0) {
        setProgress({
          phase: 'done',
          batchIndex: 0,
          batchCount: 0,
          embedded: 0,
          skipped: plan.skipped,
          failed: 0,
          removed: plan.removed ?? 0,
          total: plan.total,
          message: plan.message,
          error: null,
        });
        toast.success(plan.message);
        refresh();
        return;
      }

      setProgress({
        phase: 'embedding',
        batchIndex: 0,
        batchCount: plan.batchCount,
        embedded: 0,
        skipped: plan.skipped,
        failed: 0,
        removed: plan.removed ?? 0,
        total: plan.total,
        message: plan.message,
        error: null,
      });

      let last: EmbedPanelBatch | null = null;
      let aborted = false;
      for (let i = 0; i < plan.batchCount; i++) {
        last = await processBatch(plan.sessionId, i);
        setProgress({
          phase: last.done ? 'done' : 'embedding',
          batchIndex: i + 1,
          batchCount: last.batchCount,
          embedded: last.embedded,
          skipped: last.skipped,
          failed: last.failed,
          removed: last.removed ?? 0,
          total: last.total,
          message: last.message,
          error: last.error,
        });
        // Batch errors are systemic (service down, pgvector missing) — stop.
        if (last.error) {
          aborted = !last.done;
          break;
        }
        if (last.done) break;
      }

      if (aborted && last && plan.sessionId) {
        await cancel(plan.sessionId).catch(() => {});
      }

      if (last) {
        const ok = last.failed === 0 && !last.error;
        setProgress((p) => (p ? { ...p, phase: ok ? 'done' : 'error' } : p));
        if (ok) toast.success(last.message);
        else toast.error(last.message);
      }
      refresh();
    } catch (err) {
      if (activeSessionId) {
        await cancel(activeSessionId).catch(() => {});
      }
      let msg = err instanceof Error ? err.message : 'Gagal meng-embed.';
      if (msg.includes('fetch failed')) {
        msg = 'Gagal terhubung ke server/layanan embedding (fetch failed). Periksa apakah layanan embedding online.';
      }
      setProgress((p) => (p ? { ...p, phase: 'error', message: msg, error: msg } : p));
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  const ready = status?.ready ?? false;
  const active = progress?.phase === 'planning' || progress?.phase === 'embedding';
  const pct =
    progress && progress.batchCount > 0
      ? Math.round((progress.batchIndex / progress.batchCount) * 100)
      : progress?.phase === 'planning'
        ? 8
        : progress?.phase === 'done'
          ? 100
          : 0;

  return (
    <Card className="flex h-full flex-col p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          {/* `description` says what the panel's run does; it sits behind the
              "?" so the counts and the result below lead. */}
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            {title}
            <InfoHint title={title}>
              <p>{description}</p>
            </InfoHint>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading || running}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" onClick={run} disabled={running || !ready}>
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {running
              ? progress?.batchCount
                ? `Batch ${progress.batchIndex}/${progress.batchCount}…`
                : 'Meng-embed…'
              : 'Mulai Transformasi'}
          </Button>
        </div>
      </div>

      {/* Store readiness + counts */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 rounded-md border px-2 py-1">
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          {status ? (
            <>
              <Badge variant="secondary" className="tabular-nums text-[10px]">
                {status.embedded}
              </Badge>
              <span className="text-muted-foreground">/ {status.total} ter-embed</span>
            </>
          ) : (
            <span className="text-muted-foreground">…</span>
          )}
        </span>
        {status?.embeddingModel && (
          <span className="flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-muted-foreground">
            <code className="truncate font-mono text-[10px]">{status.embeddingModel}</code>
          </span>
        )}
        {status && (
          <span
            className={`flex items-center gap-1 rounded-md border px-2 py-1 ${
              ready
                ? 'border-emerald-300/60 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                : 'border-amber-300/60 bg-amber-500/5 text-amber-700 dark:text-amber-300'
            }`}
          >
            {ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {ready ? 'siap' : 'belum siap'}
          </span>
        )}
      </div>

      {/* Not-ready warning */}
      {status && !ready && status.error && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{status.error}</span>
        </p>
      )}

      {/* Live progress */}
      {active && progress && (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {progress.phase === 'planning' ? 'Menyiapkan dokumen…' : 'Meng-embed dokumen…'}
            </p>
            {progress.batchCount > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                Batch {progress.batchIndex}/{progress.batchCount}
              </span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Total: {progress.total}</span>
            <span className="text-emerald-600 dark:text-emerald-400">Di-embed: {progress.embedded}</span>
            <span>Dilewati: {progress.skipped}</span>
            {progress.removed > 0 && <span>Dihapus: {progress.removed}</span>}
            {progress.failed > 0 && (
              <span className="text-rose-600 dark:text-rose-400">Gagal: {progress.failed}</span>
            )}
          </div>
        </div>
      )}

      {/* Final result */}
      {progress && (progress.phase === 'done' || progress.phase === 'error') && (
        <div
          className={`mt-3 rounded-xl border p-4 text-sm ${
            progress.phase === 'done'
              ? 'border-emerald-300/70 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200'
              : 'border-rose-300/70 bg-rose-500/5 text-rose-800 dark:text-rose-200'
          }`}
        >
          <p className="font-semibold">{progress.message}</p>
          <div className="mt-1 flex flex-wrap gap-3 text-xs opacity-90">
            <span>Total: {progress.total}</span>
            <span>Di-embed: {progress.embedded}</span>
            <span>Dilewati: {progress.skipped}</span>
            {progress.removed > 0 && <span>Dihapus: {progress.removed}</span>}
            <span>Gagal: {progress.failed}</span>
          </div>
          {progress.error && (
            <p className="mt-2 rounded-md bg-rose-500/10 px-2 py-1 font-mono text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
              {progress.error}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
