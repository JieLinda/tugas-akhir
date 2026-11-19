'use client';

// Makes the per-criterion breakdown chips on the Kandidat sub-tab clickable:
// clicking one pops up exactly the section that criterion gets in the Readiness
// sub-tab's "Analisis per Kandidat" (see run-candidate-analysis.tsx).
//
// AHP+TOPSIS runs only — a legacy run of another method stores no aspect
// breakdown, so the provider is mounted with runId=null there and the chips
// stay plain text.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CRITERION_TITLES,
  CriterionDetail,
  type CriterionKey,
} from '@/components/analysis/aspect-derivations';
import {
  getAhpRunDetailAction,
  type CandidateProgressRow,
} from '@/lib/progress-running-actions';
import { useAskAi } from '@/components/analysis/ask-ai-context';
import { parseAskAnchor } from '@/lib/ask-ai-envelope';

type OpenTarget = { candidateId: string; name: string; criterion: CriterionKey };

type CriterionPopupContext = {
  /** False when the selected run is not AHP+TOPSIS — chips must stay inert. */
  enabled: boolean;
  open: (target: OpenTarget) => void;
};

const Ctx = createContext<CriterionPopupContext>({ enabled: false, open: () => {} });

// Career carries a four-column history table; at the default width it could only
// be shown by scrolling sideways. The rest are a line or two of key/value and
// would just look empty in a wide dialog.
const WIDE_CRITERIA: CriterionKey[] = ['career'];

export function useAhpCriterionPopup() {
  return useContext(Ctx);
}

export function AhpCriterionPopupProvider({
  runId,
  children,
}: {
  /** Run to read the breakdown from, or null to disable (non-AHP run). */
  runId: string | null;
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<OpenTarget | null>(null);
  const [rows, setRows] = useState<CandidateProgressRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Drop any cached breakdown when the user switches run.
  useEffect(() => {
    setRows(null);
    setError(null);
    setTarget(null);
  }, [runId]);

  // Fetch lazily — only once a chip has actually been clicked.
  useEffect(() => {
    if (!runId || !target || rows || error) return;
    let active = true;
    getAhpRunDetailAction(runId)
      .then((detail) => {
        if (active) setRows(detail.candidates);
      })
      .catch((err) => {
        console.error('getAhpRunDetail failed', err);
        if (active) setError('Detail analisis kriteria tidak dapat dimuat.');
      });
    return () => {
      active = false;
    };
  }, [runId, target, rows, error]);

  // ── Return navigation ──
  //
  // Reopen this dialog when a chat chip points back into it. This provider lives
  // INSIDE the Kandidat tab's content, so leaving the tab unmounts it and closes
  // the dialog — meaning the criterion section, its anchor and the panel the chip
  // named are all gone by the time the reader comes back. Reopening on the signal
  // is what puts them back on screen.
  //
  // Declared after the reset-on-runId effect so it wins on mount: that one clears
  // `target`, and both run in the same flush.
  //
  // The signal is deliberately NOT cleared here — the panel inside the dialog
  // still has to read it, and it cannot even mount until this fetch resolves.
  const { reopen, trace } = useAskAi();
  const handledToken = useRef<number | null>(null);
  useEffect(() => {
    if (!reopen) return;
    if (!runId) {
      trace('3a. dialog: SKIP, runId null (run bukan AHP?)');
      return;
    }
    if (handledToken.current === reopen.token) return;
    const parsed = parseAskAnchor(reopen.anchor);
    // A whole-criteria chip anchors on the Readiness card and names no criterion;
    // there is no single dialog that answers it.
    if (!parsed?.criterion || !(parsed.criterion in CRITERION_TITLES)) {
      trace('3a. dialog: SKIP, anchor tanpa kriteria', { anchor: reopen.anchor, parsed });
      return;
    }
    handledToken.current = reopen.token;
    trace('3a. dialog: OPENING', { candidateId: parsed.candidateId, criterion: parsed.criterion });
    setTarget({
      candidateId: parsed.candidateId,
      name: reopen.ref.candidate,
      criterion: parsed.criterion as CriterionKey,
    });
  }, [runId, reopen, trace]);

  const open = useCallback((next: OpenTarget) => setTarget(next), []);
  const value = useMemo<CriterionPopupContext>(
    () => ({ enabled: Boolean(runId), open }),
    [runId, open],
  );

  // The Kandidat tab's candidate id comes from analysis_results.details.id while
  // these rows key on analysis_results.candidate_id — same value in practice, but
  // fall back to the name so an older run can't blank out the popup.
  const row =
    target && rows
      ? (rows.find((c) => c.candidateId === target.candidateId) ??
        rows.find((c) => c.name.trim().toLowerCase() === target.name.trim().toLowerCase()) ??
        null)
      : null;

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent
          className={cn(
            // min(): sm:max-w-* would otherwise override the base viewport cap
            // and push the dialog past the screen edge on mid-size windows.
            'max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-[min(42rem,calc(100vw-2rem))]',
            target &&
              WIDE_CRITERIA.includes(target.criterion) &&
              'sm:max-w-[min(64rem,calc(100vw-2rem))]',
          )}
        >
          <DialogHeader>
            <DialogTitle className="text-base">
              {target ? CRITERION_TITLES[target.criterion] : ''}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {target?.name} · potongan analisis kandidat dari tab Readiness
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>{error}</span>
            </div>
          ) : !rows ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuat analisis…
            </div>
          ) : !row ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Analisis untuk kandidat ini tidak tersimpan pada run ini.
            </p>
          ) : (
            target && <CriterionDetail c={row} criterion={target.criterion} />
          )}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

/**
 * One breakdown chip. Clickable (and popup-wired) only when the provider is
 * enabled; otherwise renders as the plain span it has always been.
 */
export function BreakdownChip({
  tone,
  candidateId,
  name,
  criterion,
  weightHint,
  children,
}: {
  tone: string;
  candidateId: string;
  name: string;
  criterion: CriterionKey;
  /**
   * This criterion's share of the run, e.g. "Bobot pada run ini: 35%". The chips
   * are ordered by that weight, and the order is the only thing on screen saying
   * so — without the number, a reader seeing HAV before Tech on one run and
   * after it on another has no way to learn why. Absent on a run that recorded
   * no weights, where the order means nothing and must not pretend to.
   */
  weightHint?: string;
  children: React.ReactNode;
}) {
  const { enabled, open } = useAhpCriterionPopup();
  const base = `inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${tone}`;

  if (!enabled) {
    return (
      <span className={base} title={weightHint}>
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => open({ candidateId, name, criterion })}
      title={[`Lihat analisis ${CRITERION_TITLES[criterion]}`, weightHint]
        .filter(Boolean)
        .join(' · ')}
      className={`${base} cursor-pointer underline decoration-dotted underline-offset-2 transition hover:brightness-95 hover:shadow-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary`}
    >
      {children}
    </button>
  );
}
