'use client';

import { useState, useTransition, useRef } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Cpu, RefreshCw, Loader2, Save } from 'lucide-react';
import { JobProfileEmbedPanel } from '@/components/job-profile-embed-panel';
import { KamusEmbedPanel } from '@/components/kamus-embed-panel';
import { KamusNameMatchPanel } from '@/components/kamus-name-match-panel';
import { VectorStorePanel } from '@/components/job-family/vector-store-panel';
import {
  saveEmbeddingConfigAction,
  startRebuildAction,
  processRebuildBatchAction,
  cancelRebuildAction,
  type RebuildResult,
  type EmbeddingModelOption,
} from '@/lib/job-family-actions';
import type { JobFamilyConfig, EmbeddingSource } from '@/lib/job-family/config';

type RebuildProgress = {
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

const SOURCE_ORDER: EmbeddingSource[] = ['multilingual', 'nomic-local', 'nomic-remote'];
const SOURCE_LABELS: Record<EmbeddingSource, string> = {
  multilingual: 'Multilingual E5 (scoring-service)',
  'nomic-local': 'Nomic — Ollama lokal',
  'nomic-remote': 'Nomic — API server (eksternal)',
};

export function EmbeddingTabContent({
  initialConfig,
  availableModels,
}: {
  initialConfig: JobFamilyConfig;
  availableModels: EmbeddingModelOption[];
}) {
  const [config, setConfig] = useState<JobFamilyConfig>(initialConfig);
  const [saving, startSaving] = useTransition();
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<RebuildResult | null>(null);
  const [progress, setProgress] = useState<RebuildProgress | null>(null);
  const sessionRef = useRef<string | null>(null);

  function setEmbedding<K extends keyof JobFamilyConfig['embedding']>(
    key: K,
    value: JobFamilyConfig['embedding'][K],
  ) {
    setConfig((c) => ({ ...c, embedding: { ...c.embedding, [key]: value } }));
  }

  function setSource(source: EmbeddingSource) {
    const match = availableModels.find((m) => m.source === source);
    setConfig((c) => ({
      ...c,
      embedding: { ...c.embedding, source, model: match ? match.name : c.embedding.model },
    }));
  }

  function saveEmbeddingConfig() {
    startSaving(async () => {
      try {
        // Only the embedding settings: this tab's copy of the rest of the config
        // is whatever it was when the page loaded.
        setConfig(await saveEmbeddingConfigAction(config.embedding));
        toast.success('Parameter BERT tersimpan.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
      }
    });
  }

  async function handleRebuild() {
    setRebuilding(true);
    setRebuildResult(null);
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
    try {
      setConfig(await saveEmbeddingConfigAction(config.embedding));

      const plan = await startRebuildAction();
      if (!plan.ok || !plan.sessionId) {
        setProgress({
          phase: 'error',
          batchIndex: 0,
          batchCount: 0,
          embedded: 0,
          skipped: plan.skipped,
          failed: 0,
          removed: plan.removed,
          total: plan.total,
          message: plan.message,
          error: plan.message,
        });
        setRebuildResult({
          ok: false,
          pgvectorReady: plan.pgvectorReady,
          totalProfiles: plan.total,
          embedded: 0,
          skipped: plan.skipped,
          failed: 0,
          removed: plan.removed,
          message: plan.message,
        });
        toast.error(plan.message);
        return;
      }

      sessionRef.current = plan.sessionId;

      if (plan.batchCount === 0) {
        setProgress({
          phase: 'done',
          batchIndex: 0,
          batchCount: 0,
          embedded: 0,
          skipped: plan.skipped,
          failed: 0,
          removed: plan.removed,
          total: plan.total,
          message: plan.message,
          error: null,
        });
        setRebuildResult({
          ok: true,
          pgvectorReady: true,
          totalProfiles: plan.total,
          embedded: 0,
          skipped: plan.skipped,
          failed: 0,
          removed: plan.removed,
          message: plan.message,
        });
        toast.success(plan.message);
        return;
      }

      setProgress({
        phase: 'embedding',
        batchIndex: 0,
        batchCount: plan.batchCount,
        embedded: 0,
        skipped: plan.skipped,
        failed: 0,
        removed: plan.removed,
        total: plan.total,
        message: plan.message,
        error: null,
      });

      let batchIndex = 0;
      let embedded = 0;
      let skipped = plan.skipped;
      let failed = 0;
      let removed = plan.removed;
      let total = plan.total;

      for (let i = 0; i < plan.batchCount; i++) {
        const batch = await processRebuildBatchAction(plan.sessionId, i);
        batchIndex = i + 1;
        embedded = batch.embedded;
        skipped = batch.skipped;
        failed = batch.failed;
        removed = batch.removed;
        total = batch.total;

        setProgress({
          phase: batch.done ? 'done' : 'embedding',
          batchIndex,
          batchCount: batch.batchCount,
          embedded,
          skipped,
          failed,
          removed,
          total,
          message: batch.message,
          error: batch.error,
        });

        if (batch.error) {
          setRebuildResult({
            ok: false,
            pgvectorReady: true,
            totalProfiles: total,
            embedded,
            skipped,
            failed,
            removed,
            message: batch.error,
          });
          toast.error(batch.error);
          return;
        }
        if (batch.done) break;
      }

      setRebuildResult({
        ok: true,
        pgvectorReady: true,
        totalProfiles: total,
        embedded,
        skipped,
        failed,
        removed,
        message: 'Embedding selesai.',
      });
      toast.success('Embedding selesai.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal membangun ulang embedding.';
      setProgress({
        phase: 'error',
        batchIndex: 0,
        batchCount: 0,
        embedded: 0,
        skipped: 0,
        failed: 0,
        removed: 0,
        total: 0,
        message: msg,
        error: msg,
      });
      setRebuildResult({
        ok: false,
        pgvectorReady: true,
        totalProfiles: 0,
        embedded: 0,
        skipped: 0,
        failed: 0,
        removed: 0,
        message: msg,
      });
      toast.error(msg);
    } finally {
      setRebuilding(false);
    }
  }

  function cancelRebuild() {
    if (progress?.phase === 'embedding' || progress?.phase === 'planning') {
      if (sessionRef.current) cancelRebuildAction(sessionRef.current).catch(() => {});
    }
    setRebuilding(false);
    setProgress(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Cpu className="h-4 w-4 text-primary" />
          <span>Parameter BERT, rebuild pengetahuan AI.</span>
        </div>
        <Button variant="outline" onClick={handleRebuild} disabled={rebuilding || saving}>
          {rebuilding ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" />
          )}
          {rebuilding
            ? progress?.batchCount
              ? `Batch ${progress.batchIndex}/${progress.batchCount}…`
              : 'Membangun...'
            : 'Bangun Ulang Job Profile'}
        </Button>
      </div>

      {progress && (progress.phase === 'planning' || progress.phase === 'embedding') && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
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
              style={{
                width: `${
                  progress.batchCount > 0
                    ? Math.round((progress.batchIndex / progress.batchCount) * 100)
                    : progress.phase === 'planning'
                      ? 8
                      : 0
                }%`,
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Total: {progress.total}</span>
            <span className="text-emerald-600 dark:text-emerald-400">
              Di-embed: {progress.embedded}
            </span>
            <span>Dilewati: {progress.skipped}</span>
            {progress.removed > 0 && <span>Dihapus: {progress.removed}</span>}
            {progress.failed > 0 && (
              <span className="text-rose-600 dark:text-rose-400">Gagal: {progress.failed}</span>
            )}
          </div>
          {progress.error && (
            <p className="mt-2 rounded-md bg-rose-500/10 px-2 py-1 font-mono text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
              {progress.error}
            </p>
          )}
        </div>
      )}

      {rebuildResult && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            rebuildResult.ok
              ? 'border-emerald-300/70 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200'
              : 'border-rose-300/70 bg-rose-500/5 text-rose-800 dark:text-rose-200'
          }`}
        >
          <p className="font-semibold">{rebuildResult.message}</p>
          <div className="mt-1 flex flex-wrap gap-3 text-xs opacity-90">
            <span>Total: {rebuildResult.totalProfiles}</span>
            <span>Di-embed: {rebuildResult.embedded}</span>
            <span>Dilewati: {rebuildResult.skipped}</span>
            {rebuildResult.removed > 0 && <span>Dihapus: {rebuildResult.removed}</span>}
            <span>Gagal: {rebuildResult.failed}</span>
          </div>
        </div>
      )}

      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Parameter BERT</h3>
          </div>
          <Button size="sm" onClick={saveEmbeddingConfig} disabled={saving || rebuilding}>
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Simpan
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Sumber Model</Label>
            <Select
              value={config.embedding.source}
              onValueChange={(v) => setSource(v as EmbeddingSource)}
            >
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Pilih sumber…" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_ORDER.map((s) => {
                  const opt = availableModels.find((m) => m.source === s);
                  const warn = !opt
                    ? 'tidak terjangkau saat ini'
                    : !opt.configured
                      ? 'belum dikonfigurasi'
                      : null;
                  return (
                    <SelectItem key={s} value={s}>
                      <span className="text-xs">{SOURCE_LABELS[s]}</span>
                      {warn && (
                        <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                          · {warn}
                        </span>
                      )}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Backend yang menghasilkan vektor DOCUMENT (job profile &amp; kamus kompetensi).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nama Model</Label>
            <Input
              value={config.embedding.model}
              onChange={(e) => setEmbedding('model', e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              {availableModels.find((m) => m.source === config.embedding.source)
                ? `Default sumber ini: ${availableModels.find((m) => m.source === config.embedding.source)!.name}`
                : 'Nama model manual untuk sumber ini.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-xs">Dimensi Vektor</Label>
            <Input
              type="number"
              min={1}
              max={8192}
              value={config.embedding.dimensions}
              onChange={(e) => setEmbedding('dimensions', Math.max(1, Number(e.target.value) || 1))}
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Panjang vektor (768 = default). Wajib sama dengan keluaran model. Diubah lalu
              tekan &ldquo;Bangun Ulang Job Profile&rdquo; — koleksi vektor dibuat ulang
              otomatis pada dimensi baru.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Batch Size</Label>
            <Input
              type="number"
              min={1}
              max={256}
              value={config.embedding.batchSize}
              onChange={(e) => setEmbedding('batchSize', Number(e.target.value))}
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground">Dokumen per panggilan embed.</p>
          </div>
        </div>
      </Card>

      <VectorStorePanel />

      <div className="grid gap-4 lg:grid-cols-2">
        <JobProfileEmbedPanel />
        <KamusEmbedPanel />
      </div>

      <KamusNameMatchPanel />
    </div>
  );
}
