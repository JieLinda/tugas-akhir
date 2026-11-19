'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import {
  Database,
  FileText,
  BookOpen,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  HardDrive,
  AlertTriangle,
} from 'lucide-react';
import {
  getVectorStoreStatusAction,
  type VectorStoreStatus,
} from '@/lib/vector-store-actions';

function StatusDot({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  ) : (
    <XCircle className="h-4 w-4 text-rose-500" />
  );
}

export function VectorStorePanel() {
  const [status, setStatus] = useState<VectorStoreStatus | null>(null);
  const [loading, startLoad] = useTransition();

  function refresh() {
    startLoad(async () => {
      try {
        const next = await getVectorStoreStatusAction();
        setStatus(next);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal memuat status vector store.');
      }
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  const active = status?.pgvector ?? null;
  const activeReady = active?.ready ?? false;
  const jobProfilesCount = active?.jobProfilesCount ?? null;
  const kamusCount = active?.kamusCount ?? null;

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            Penyimpanan Pengetahuan AI
            <InfoHint title="Penyimpanan Pengetahuan AI">
              <p>
                Penyimpanan embedding vector <strong>dokumen</strong> job profile &amp; kamus
                kompetensi disimpan pada container PostgreSQL terpisah menggunakan ekstensi{' '}
                <strong>pgvector</strong>.
              </p>
            </InfoHint>
          </h3>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Health detail for pgvector */}
      {status && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <HealthRow
            icon={HardDrive}
            label="Database pgvector"
            ok={status.pgvector.extensionReady}
            hint="Tabel *_embed pada container vector-db"
          />
          <HealthRow
            icon={RefreshCw}
            label="Layanan Embedding API"
            ok={status.pgvector.serviceConfigured}
            hint={status.pgvector.embeddingModel ?? 'OpenAI Compatible API'}
          />
        </div>
      )}

      {/* Not-ready warning */}
      {status && !activeReady && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {status.pgvector.error ??
              'Database pgvector belum siap. Pastikan container vector-db berjalan dan API embedding dikonfigurasi pada .env.'}
          </span>
        </p>
      )}

      {/* Collection counts. Embedding is run from the "Transformasi Job Profile" /
          "Transformasi Kamus Kompetensi" panels below — the per-collection Sync
          buttons that used to sit here wrote the same tables in one request but
          skipped the per-level kamus vectors and the anchor refresh. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Job Profiles</p>
              <p className="text-[11px] text-muted-foreground">
                <Badge variant="secondary" className="text-[10px]">{jobProfilesCount ?? '—'}</Badge> tersimpan
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Kamus Kompetensi</p>
              <p className="text-[11px] text-muted-foreground">
                <Badge variant="secondary" className="text-[10px]">{kamusCount ?? '—'}</Badge> tersimpan
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function HealthRow({
  icon: Icon,
  label,
  ok,
  hint,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  ok: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-xs font-semibold">{label}</span>
        </div>
        <StatusDot ok={ok} />
      </div>
      {hint && <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
