'use client';

// FR-RR-11 — a run that is still being scored, in four stages a forum can
// follow: validation (done before the run existed), scoring the new
// candidates, ranking, writing the narrative. The ranking is on screen as soon
// as TOPSIS is done; the narrative may follow. Polls a single small row and
// refreshes the page when the run finishes or fails.

import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { getRunProgressAction, type RunProgress } from '@/lib/run-history-actions';
import { cn } from '@/lib/utils';

const SCORING = new Set(['load', 'technical', 'career', 'behavior', 'performance', 'hav', 'education']);
const RANKING = new Set(['topsis', 'persist']);

function stageOf(phase: string | null): number {
  if (!phase) return 1;
  if (SCORING.has(phase)) return 1;
  if (RANKING.has(phase)) return 2;
  if (phase === 'narrative') return 3;
  if (phase === 'completed') return 4;
  return 1;
}

export function RunProgressStages({ runId }: { runId: string }) {
  const [p, setP] = useState<RunProgress | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const next = await getRunProgressAction(runId).catch(() => null);
      if (!active) return;
      setP(next);
      if (next && next.state !== 'running') {
        // A full reload: the run's rows are loaded client-side per run, and a
        // server refresh alone would keep the half-finished list on screen.
        window.location.reload();
        return;
      }
      timer = setTimeout(tick, 3000);
    };
    tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [runId]);

  const current = stageOf(p?.phase ?? null);
  const stages = [
    'Validasi permintaan',
    p?.newCandidates != null ? `Menilai ${p.newCandidates} kandidat baru` : 'Menilai kandidat',
    'Menghitung peringkat',
    'Menulis narasi (peringkat sudah tampil)',
  ];
  return (
    <ol className="mt-3 space-y-1 text-left text-xs" aria-label="Tahap penilaian">
      {stages.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className={cn('flex items-center gap-2', !done && !active && 'text-muted-foreground')}>
            {done ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label="selesai" />
            ) : active ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" aria-label="berjalan" />
            ) : (
              <Circle className="h-3.5 w-3.5" aria-label="menunggu" />
            )}
            <span>
              {label}
              {active && i === 1 && p && p.total > 0 && p.phase === 'education' ? ` (${p.done}/${p.total})` : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
