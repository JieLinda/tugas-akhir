'use client';

import Link from 'next/link';
import { ArrowRight, Check, FileText, Loader2, Network, Play, Sparkles, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { EmbedSyncButton } from '@/components/job-family/embed-sync-button';
import { formatDate } from '@/lib/datetime';
import { cn } from '@/lib/utils';

/**
 * The three steps that produce a job family map, in the order they run.
 *
 * This replaced a row of four stat chips (Job Profile / Ter-embed / Menunggu /
 * Model) sitting above a panel whose header carried its own build button. The
 * numbers were all there and the ordering was nowhere: embedding hid behind a
 * 28px icon inside a chip, the map's build button sat in a different block, and
 * three separate notices each named that embedding action differently
 * ("Mulai Transformasi Job Profile", "Mulai Sinkronisasi Embedding",
 * "Sinkronkan Transformasi job profile"), one of them pointing at a button with
 * no visible label at all. A reader could see every number and still not know
 * what to press.
 *
 * The rule here: exactly ONE step is `current`, and only that step's control is
 * a filled button. A step that is already done keeps its control as an outline
 * (re-running is allowed, it is just not what to do next), and a step that
 * cannot run yet has no control at all — its own text says what it is waiting
 * for. So "which one first" is answered by the only filled button on screen.
 */

type StepState = 'done' | 'current' | 'waiting' | 'blocked';

export function JobFamilyPipeline({
  completedProfiles,
  embeddedCount,
  pendingCount,
  embeddingModel,
  pgvectorReady,
  canManage,
  runStatus,
  numTopics,
  runCompletedAt,
  onBuild,
  buildBusy,
  buildDisabled,
}: {
  completedProfiles: number;
  embeddedCount: number;
  pendingCount: number;
  embeddingModel: string | null;
  pgvectorReady: boolean;
  /** job_profiles.manage — without it the steps are read-only. */
  canManage: boolean;
  /** null = never run. */
  runStatus: 'pending' | 'processing' | 'completed' | 'failed' | null;
  numTopics: number;
  runCompletedAt: string | null;
  onBuild: () => void;
  buildBusy: boolean;
  buildDisabled: boolean;
}) {
  const running = runStatus === 'pending' || runStatus === 'processing';
  const hasMap = runStatus === 'completed';

  // The state machine. Read top to bottom: the first unsatisfied condition owns
  // `current`, everything before it is done and everything after it waits.
  const noProfiles = completedProfiles === 0;
  const noVectors = embeddedCount === 0;
  const partial = !noVectors && pendingCount > 0;

  const step1: StepState = noProfiles ? 'current' : 'done';
  const step2: StepState = noProfiles
    ? 'waiting'
    : !pgvectorReady
      ? 'blocked'
      : noVectors || partial
        ? 'current'
        : 'done';
  const step3: StepState = running
    ? 'current'
    : noProfiles || noVectors || !pgvectorReady
      ? 'waiting'
      : hasMap
        ? 'done'
        : 'current';

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          Alur pembuatan peta
          <InfoHint title="Alur pembuatan peta" size="xs">
            <p>Tiga langkah berurutan — jalankan yang tombolnya menyala.</p>
          </InfoHint>
        </p>
      </div>

      <div className="grid gap-px bg-border md:grid-cols-3">
        <Step
          n={1}
          state={step1}
          title="Job profile terekstrak"
          value={completedProfiles}
          unit="dokumen"
          detail={
            noProfiles
              ? 'Belum ada dokumen job profile yang berhasil dibaca AI.'
              : 'Sumber peta. Ditambah lewat seksi Dokumen, bukan di sini.'
          }
          icon={FileText}
          action={
            noProfiles ? (
              <Button asChild size="sm" className="gap-1.5">
                <Link href="/job-profiles">
                  Buka Dokumen
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null
          }
        />

        <Step
          n={2}
          state={step2}
          title="Transformasi jadi angka"
          value={embeddedCount}
          unit={completedProfiles > 0 ? `dari ${completedProfiles}` : 'vektor'}
          detail={
            !pgvectorReady
              ? 'Menunggu ekstensi pgvector aktif — lihat peringatan di atas.'
              : noProfiles
                ? 'Menunggu langkah 1.'
                : noVectors
                  ? 'Belum pernah dijalankan. Peta dibangun dari angka ini, bukan dari teks dokumen.'
                  : partial
                    ? `${pendingCount} dokumen belum ikut — peta akan melewatkannya.`
                    : `Semua dokumen sudah jadi angka${embeddingModel ? ` · model ${embeddingModel}` : ''}.`
          }
          icon={Sparkles}
          action={
            canManage && pgvectorReady && !noProfiles ? (
              <EmbedSyncButton
                label={noVectors || partial ? 'Jalankan Transformasi' : 'Jalankan Ulang'}
                variant={step2 === 'current' ? 'default' : 'outline'}
              />
            ) : null
          }
        />

        <Step
          n={3}
          state={step3}
          title="Peta job family"
          value={hasMap ? numTopics : '—'}
          unit={hasMap ? 'famili' : 'belum dibangun'}
          detail={
            running
              ? 'Sedang dibangun — progresnya di bawah.'
              : step3 === 'waiting'
                ? 'Menunggu langkah 2.'
                : hasMap
                  ? `Dibangun ${runCompletedAt ? formatDate(runCompletedAt) : '—'}. Bangun ulang setelah dokumen atau pengaturan berubah.`
                  : 'Kelompokkan angka tadi menjadi rumpun jabatan.'
          }
          icon={Network}
          action={
            canManage && step3 !== 'waiting' ? (
              <Button
                size="sm"
                variant={step3 === 'current' ? 'default' : 'outline'}
                onClick={onBuild}
                disabled={buildDisabled}
                className="gap-1.5"
              >
                {buildBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {running ? 'Sedang berjalan…' : hasMap ? 'Bangun Ulang' : 'Bangun Peta'}
              </Button>
            ) : null
          }
          footer={
            hasMap ? (
              <Link
                href="/posisi/job-family/pengaturan"
                className="ml-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <SlidersHorizontal className="h-3 w-3" />
                Hasil kurang pas? Ubah pengelompokannya
              </Link>
            ) : null
          }
        />
      </div>
    </div>
  );
}

function Step({
  n,
  state,
  title,
  value,
  unit,
  detail,
  icon: Icon,
  action,
  footer,
}: {
  n: number;
  state: StepState;
  title: string;
  value: number | string;
  unit: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  action: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const done = state === 'done';
  const current = state === 'current';

  return (
    <div
      className={cn(
        'flex flex-col gap-2 bg-card p-4',
        current && 'bg-primary/4',
        state === 'waiting' && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
            done
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : current
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {done ? <Check className="h-3 w-3" /> : n}
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 truncate text-xs font-semibold">{title}</p>
        {current && (
          <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
            Berikutnya
          </span>
        )}
        {state === 'blocked' && (
          <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            Terhalang
          </span>
        )}
      </div>

      <p className="flex items-baseline gap-1.5 text-xl font-bold leading-none tabular-nums">
        {value}
        <span className="truncate text-[11px] font-normal text-muted-foreground">{unit}</span>
      </p>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{detail}</p>

      {(action || footer) && (
        <div className="mt-auto space-y-1.5 pt-1">
          {action}
          {footer}
        </div>
      )}
    </div>
  );
}
