'use client';

// Competency name → kamus code mapping panel (on /settings/sync).
//
// The kamus is the canonical vocabulary, but job-profile PDFs are extracted by
// an LLM and name competencies loosely. A required competency that resolves to
// no kamus code has no level vector, so its whole column scores 0 during
// AHP+TOPSIS — and because Hungarian maximises, the candidate competency that
// belonged in that column is spent on some other column that scores above zero.
// This panel is where an operator sees what resolved to what, and fills in the
// rest deliberately instead of discovering it inside a ranking.
//
// Scoring primes this automatically at session start (capped, best-effort). The
// button here is uncapped: an operator asked, so it finishes the job.

import { useEffect, useState, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { Tags, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIdentifierDisplay } from '@/components/app-mode-provider';
import {
  getCompetencyMatchReportAction,
  resolveCompetencyNamesAction,
  type CompetencyMatchReport,
  type CompetencyMatchRow,
} from '@/lib/kamus-name-match-actions';

function tierTone(row: CompetencyMatchRow): string {
  if (row.code == null) return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (row.tier === 'exact') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (row.tier === 'fuzzy') return 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400';
  return 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400';
}

function tierLabel(row: CompetencyMatchRow): string {
  if (row.code == null) return 'Tidak dipetakan';
  if (row.tier === 'exact') return 'Sama persis';
  if (row.tier === 'fuzzy') return 'Deterministik';
  return 'AI';
}

export function KamusNameMatchPanel() {
  const ids = useIdentifierDisplay();
  const [report, setReport] = useState<CompetencyMatchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    startTransition(async () => {
      try {
        setReport(await getCompetencyMatchReportAction());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Gagal memuat pemetaan.');
      }
    });
  }, []);

  const runResolve = async () => {
    setResolving(true);
    setError(null);
    try {
      setReport(await resolveCompetencyNamesAction());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menjalankan pemetaan.');
    } finally {
      setResolving(false);
    }
  };

  // Exact matches are the uninteresting majority — the rows worth an operator's
  // attention are the ones a tier had to decide, and the ones still undecided.
  const notable = (report?.rows ?? []).filter((r) => r.tier !== 'exact' || r.code == null);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <Tags className="h-4 w-4 text-primary" />
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          Pemetaan Nama Kompetensi → Kamus
          <InfoHint title="Pemetaan Nama Kompetensi → Kamus">
            <p>
              Menyamakan nama kompetensi dari job profile dan data HR ke kode kamus, agar pasangan
              exact match tidak terlewat saat penilaian teknis.
            </p>
          </InfoHint>
        </h3>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto shrink-0"
          onClick={runResolve}
          disabled={resolving || pending}
        >
          {resolving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Petakan
        </Button>
      </header>

      {error && (
        <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {pending && !report && (
        <p className="text-[11px] text-muted-foreground">Memuat…</p>
      )}

      {report && (
        <>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <Badge variant="outline" className={tierTone({ code: 'x', tier: 'exact' } as CompetencyMatchRow)}>
              Sama persis {report.exactCount}
            </Badge>
            <Badge variant="outline" className={tierTone({ code: 'x', tier: 'fuzzy' } as CompetencyMatchRow)}>
              Deterministik {report.fuzzyCount}
            </Badge>
            <Badge variant="outline" className={tierTone({ code: 'x', tier: 'ai' } as CompetencyMatchRow)}>
              AI {report.aiCount}
            </Badge>
            <Badge variant="outline" className={tierTone({ code: null } as CompetencyMatchRow)}>
              Belum dipetakan {report.pendingCount + report.noneCount}
            </Badge>
          </div>

          {report.migrationNeeded && (
            <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {report.migrationNeeded}
            </p>
          )}

          {/* An unreachable model must never read as "AI found nothing" — that
              would look like a catalogue with no answers instead of an outage. */}
          {!report.aiConfigured && (
            <p className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
              Tier AI tidak aktif — <code className="font-mono">LLM_BASE_URL</code> dan{' '}
              <code className="font-mono">LLM_MODEL</code> belum diisi. Tier sama-persis dan
              deterministik tetap berjalan.
            </p>
          )}
          {report.aiConfigured && !report.aiAvailable && (
            <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Model tidak dapat dihubungi. Ini bukan berarti tidak ada padanan — nama yang belum
              diputuskan tetap menunggu, bukan ditolak.
            </p>
          )}

          {notable.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              Semua nama kompetensi cocok persis dengan kamus.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <div className="divide-y">
                {notable.map((r) => (
                  <div key={r.nameKey} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="wrap-break-word text-xs font-medium text-foreground/90">{r.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {r.code ? `→ ${ids.code(r.code)} · ${r.codeName ?? ''}` : '→ tidak ada padanan di kamus'}
                      </p>
                      {r.reason && (
                        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground/80">
                          {r.reason}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {r.confidence != null && r.tier === 'ai' && (
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {r.confidence.toFixed(2)}
                        </span>
                      )}
                      <Badge variant="outline" className={cn('text-[10px]', tierTone(r))}>
                        {tierLabel(r)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
