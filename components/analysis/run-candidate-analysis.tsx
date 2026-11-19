'use client';

// "Analisis per Kandidat" — the per-candidate AHP+TOPSIS breakdown shown at the
// bottom of the Readiness tab on a position's run-scoring page. Renders the
// <CandidateCard> accordion over the getAhpRunDetailAction payload.
//
// AHP+TOPSIS runs only: a legacy run of another method has no aspect breakdown.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock, Loader2 } from 'lucide-react';
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  CandidateCard,
  type AspectWeights,
} from '@/components/analysis/aspect-derivations';
import { useAskAi } from '@/components/analysis/ask-ai-context';
import { parseAskAnchor } from '@/lib/ask-ai-envelope';
import {
  getAhpRunDetailAction,
  type CandidateProgressRow,
  type RunDetail,
} from '@/lib/progress-running-actions';

/**
 * The weights THIS RUN was scored with, or null to let `topWeightedCriterion`
 * fall back to DEFAULT_ASPECT_WEIGHTS.
 *
 * Two deliberate narrowings of what `ahpConfig` offers:
 *
 *  • `effectiveWeights` beats `weights`. A criterion nobody could be scored on
 *    is dropped from the TOPSIS matrix with its share redistributed, so calling
 *    it "bobot tertinggi" would name an aspect that contributed nothing here.
 *  • `origin: 'template'` is refused. That tier reconstructs the matrix from
 *    governance AS IT STANDS TODAY, so a matrix edited after the run would
 *    silently restate what a finished ranking was judged on. Falling through to
 *    the system defaults is the same answer the breakdown chips give, and it is
 *    at least not a claim about this run that nothing recorded.
 */
function historicalAspectWeights(detail: RunDetail): AspectWeights | null {
  const stored = detail.runInfo?.ahp;
  const fromRun = stored?.effectiveWeights ?? stored?.weights;
  if (fromRun && Object.values(fromRun).some((v) => Number(v) > 0)) {
    return fromRun as AspectWeights;
  }
  const cfg = detail.ahpConfig;
  if (cfg && (cfg.origin === 'run' || cfg.origin === 'snapshot')) {
    return (cfg.weights as AspectWeights | undefined) ?? null;
  }
  return null;
}

export function RunCandidateAnalysis({ runId }: { runId: string }) {
  const [candidates, setCandidates] = useState<CandidateProgressRow[] | null>(null);
  // This run's own AHP weights, so each card can summarise the aspect that
  // actually carried the most weight here — resolved with the same precedence
  // the Kandidat tab's breakdown-chip order uses (lib/criterion-weight-order.ts),
  // because the two sit on one page and must not name different heaviest
  // criteria for the same run.
  const [weights, setWeights] = useState<AspectWeights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setCandidates(null);
    setWeights(null);
    setError(null);
    getAhpRunDetailAction(runId)
      .then((detail) => {
        if (!active) return;
        setCandidates(detail.candidates);
        setWeights(historicalAspectWeights(detail));
      })
      .catch((err) => {
        console.error('getAhpRunDetail failed', err);
        // Typically a missing job_profiles.view permission — degrade to a note
        // rather than tearing down the whole Readiness tab.
        if (active) setError('Detail analisis per kandidat tidak dapat dimuat.');
      });
    return () => {
      active = false;
    };
  }, [runId, reloadKey]);

  // ── Return navigation ──
  //
  // The accordion is controlled solely so a chat chip can expand the card it
  // points at. Radix unmounts a collapsed card, so until it opens, the criterion
  // section inside it has no DOM node to scroll to and the panel that should
  // reopen never mounts — the chip landed nowhere and did nothing.
  //
  // The signal is NOT cleared here: this only makes the section mountable, and
  // the panel inside it still has to read the same signal to know which
  // derivation to open.
  const [openCards, setOpenCards] = useState<string[]>([]);
  const { reopen, trace } = useAskAi();
  const handledToken = useRef<number | null>(null);
  useEffect(() => {
    if (!reopen || handledToken.current === reopen.token) return;
    const target = parseAskAnchor(reopen.anchor);
    if (!target) {
      trace('3b. kartu Readiness: SKIP, anchor tak terbaca', { anchor: reopen.anchor });
      return;
    }
    handledToken.current = reopen.token;
    trace('3b. kartu Readiness: EXPANDING', { candidateId: target.candidateId });
    // Additive: a reader returning to one card should not lose the others they
    // had already opened.
    setOpenCards((cur) =>
      cur.includes(target.candidateId) ? cur : [...cur, target.candidateId],
    );
  }, [reopen, trace]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Coba lagi
        </Button>
      </div>
    );
  }

  if (!candidates) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat analisis per kandidat…
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Tidak ada hasil kandidat tersimpan untuk run ini.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Analisis per Kandidat</h3>
        <span className="text-[11px] text-muted-foreground">({candidates.length})</span>
      </div>
      <Accordion
        type="multiple"
        value={openCards}
        onValueChange={setOpenCards}
        className="space-y-2"
      >
        {candidates.map((c) => (
          <CandidateCard key={c.candidateId} c={c} weights={weights} />
        ))}
      </Accordion>
    </div>
  );
}
