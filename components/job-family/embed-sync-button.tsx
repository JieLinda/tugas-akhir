'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  startRebuildAction,
  processRebuildBatchAction,
  cancelRebuildAction,
} from '@/lib/job-family-actions';

export function EmbedSyncButton({
  compact = false,
  label = 'Jalankan Transformasi',
  variant = 'default',
}: {
  /** Icon-only variant, sized to sit inside a stat chip. */
  compact?: boolean;
  /**
   * Button text for the full variant. Default deliberately matches the label
   * the pipeline step uses: this one action used to answer to four different
   * names across the Job Family surface, so a notice telling the reader to
   * press one of them pointed at a button that said something else.
   */
  label?: string;
  /** `outline` when re-running is possible but not the next step. */
  variant?: 'default' | 'outline';
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState<{ index: number; count: number } | null>(null);

  async function run() {
    if (running) return;
    setRunning(true);
    setBatch(null);
    let sessionId: string | null = null;
    try {
      const plan = await startRebuildAction();
      if (!plan.ok || !plan.sessionId) {
        toast.error(plan.message);
        return;
      }
      sessionId = plan.sessionId;

      // No embeddable document at all — the prune (if any) already ran in the plan.
      if (plan.batchCount === 0) {
        toast.success(plan.message);
        router.refresh();
        return;
      }

      setBatch({ index: 0, count: plan.batchCount });
      toast.info(
        `Meng-embed ulang ${plan.toEmbed} job profile dalam ${plan.batchCount} batch…` +
          (plan.removed > 0 ? ` ${plan.removed} embedding usang dihapus.` : ''),
      );

      let last: Awaited<ReturnType<typeof processRebuildBatchAction>> | null = null;
      let aborted = false;
      for (let i = 0; i < plan.batchCount; i++) {
        last = await processRebuildBatchAction(plan.sessionId, i);
        setBatch({ index: i + 1, count: last.batchCount });
        // Batch errors are systemic (service down, pgvector missing) — stop.
        if (last.error) {
          aborted = !last.done;
          break;
        }
        if (last.done) break;
      }

      if (aborted && sessionId) await cancelRebuildAction(sessionId).catch(() => {});

      if (last) {
        if (last.failed === 0 && !last.error) toast.success(last.message);
        else toast.error(last.error ?? last.message);
      }
      router.refresh();
    } catch (err) {
      if (sessionId) await cancelRebuildAction(sessionId).catch(() => {});
      let msg = err instanceof Error ? err.message : 'Gagal meng-embed job profile.';
      if (msg.includes('fetch failed')) {
        msg =
          'Gagal terhubung ke layanan embedding (fetch failed). Pastikan layanan embedding online.';
      }
      toast.error(msg);
    } finally {
      setRunning(false);
      setBatch(null);
    }
  }

  const progressText = batch && batch.count > 0 ? `Batch ${batch.index}/${batch.count}…` : 'Meng-embed…';

  if (!compact) {
    return (
      <Button size="sm" variant={variant} onClick={run} disabled={running}>
        {running ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
        )}
        {running ? progressText : label}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={run}
          disabled={running}
          aria-label="Sinkronkan Transformasi job profile"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {running ? progressText : 'Sinkronkan Transformasi job profile'}
      </TooltipContent>
    </Tooltip>
  );
}
