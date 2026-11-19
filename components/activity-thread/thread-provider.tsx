'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ARCHIVE_LIMIT,
  IDLE_MS,
  RUN_LIMIT,
  THREAD_STORAGE_KEY,
  threadId,
  type ActivityThread,
  type ThreadRun,
  type WizardStage,
} from '@/lib/activity-thread';

/** Identity of the position a call refers to; enough to open a thread on demand. */
export type PositionRef = {
  positionId: string;
  positionLabel: string;
  meta?: string;
};

export type SyncPositionInput = PositionRef & {
  /** Run currently on screen, when the page was opened with `?runId=`. */
  viewingRun?: Omit<ThreadRun, 'origin' | 'at'> | null;
  /** Wizard progress, or null when not in the wizard. */
  wizard?: { stage: WizardStage; href: string } | null;
};

type ThreadState = {
  active: ActivityThread | null;
  archive: ActivityThread[];
  collapsed: boolean;
};

type ThreadAction =
  | { type: 'sync'; input: SyncPositionInput }
  | { type: 'recordRun'; positionId: string; run: ThreadRun }
  | { type: 'complete'; positionId: string; outcome: { label: string; href?: string } }
  | { type: 'dismiss' }
  | { type: 'resume'; id: string }
  | { type: 'collapse'; value: boolean }
  | { type: 'expire'; before: number };

const EMPTY: ThreadState = { active: null, archive: [], collapsed: false };

// ---------------------------------------------------------------------------
// Pure state transitions
// ---------------------------------------------------------------------------

function blankThread(ref: PositionRef, at: number): ActivityThread {
  return {
    id: threadId(ref.positionId),
    positionId: ref.positionId,
    positionLabel: ref.positionLabel,
    meta: ref.meta,
    runs: [],
    viewing: null,
    currentRunId: null,
    wizard: null,
    status: 'active',
    startedAt: at,
    updatedAt: at,
  };
}

function applySync(state: ThreadState, input: SyncPositionInput): ThreadState {
  const id = threadId(input.positionId);
  const at = Date.now();
  const { active } = state;

  let thread: ActivityThread;
  let archive = state.archive;

  if (active && active.id === id) {
    thread = active;
  } else {
    // Switching positions parks the outgoing thread so it stays resumable, and
    // revives the incoming one if it was parked earlier (keeps its run lineage).
    const revived = state.archive.find((t) => t.id === id);
    archive = [
      ...(active ? [active] : []),
      ...state.archive.filter((t) => t.id !== id),
    ].slice(0, ARCHIVE_LIMIT);
    thread = revived ?? blankThread(input, at);
  }

  // Labels come from the server page, so they self-heal after a rename and fill
  // in threads that recordRun() had to create without one.
  const next: ActivityThread = {
    ...thread,
    positionLabel: input.positionLabel || thread.positionLabel,
    meta: input.meta ?? thread.meta,
    updatedAt: at,
  };

  if (input.wizard !== undefined) next.wizard = input.wizard;

  if (input.viewingRun !== undefined) {
    const viewed = input.viewingRun;
    if (!viewed) {
      next.viewing = null;
      next.currentRunId = null;
    } else if (next.runs.some((r) => r.runId === viewed.runId)) {
      // Produced in this session — it already has a delta label worth more than
      // anything we could reconstruct here, so only mark it current.
      next.viewing = null;
      next.currentRunId = viewed.runId;
    } else {
      next.viewing = { ...viewed, origin: 'opened', at };
      next.currentRunId = viewed.runId;
    }
  }

  return { ...state, active: next, archive };
}

function applyRecordRun(state: ThreadState, positionId: string, run: ThreadRun): ThreadState {
  const id = threadId(positionId);
  const at = Date.now();
  const { active } = state;

  // A run can be produced right after the thread was dismissed; open a nameless
  // thread and let the next sync() fill the label in.
  let thread: ActivityThread;
  let archive = state.archive;
  if (active && active.id === id) {
    thread = active;
  } else {
    const revived = state.archive.find((t) => t.id === id);
    archive = [
      ...(active ? [active] : []),
      ...state.archive.filter((t) => t.id !== id),
    ].slice(0, ARCHIVE_LIMIT);
    thread = revived ?? blankThread({ positionId, positionLabel: '' }, at);
  }

  const runs = [...thread.runs.filter((r) => r.runId !== run.runId), run].slice(-RUN_LIMIT);

  return {
    ...state,
    archive,
    active: {
      ...thread,
      runs,
      // The new run supersedes whatever old run was being browsed.
      viewing: null,
      currentRunId: run.runId,
      wizard: null,
      // Producing another run means the work resumed, whatever it was before.
      status: 'active',
      outcome: undefined,
      updatedAt: at,
    },
  };
}

function reduce(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case 'sync':
      return applySync(state, action.input);

    case 'recordRun':
      return applyRecordRun(state, action.positionId, action.run);

    case 'complete': {
      const { active } = state;
      if (!active || active.status === 'completed') return state;
      // Scoped to its position: a milestone must never close a thread it does
      // not belong to.
      if (active.id !== threadId(action.positionId)) return state;
      return {
        ...state,
        active: { ...active, status: 'completed', outcome: action.outcome, updatedAt: Date.now() },
      };
    }

    case 'dismiss': {
      const { active } = state;
      if (!active) return state;
      return {
        ...state,
        active: null,
        archive: [active, ...state.archive.filter((t) => t.id !== active.id)].slice(
          0,
          ARCHIVE_LIMIT,
        ),
      };
    }

    case 'resume': {
      const target = state.archive.find((t) => t.id === action.id);
      if (!target) return state;
      const { active } = state;
      return {
        ...state,
        active: { ...target, updatedAt: Date.now() },
        archive: [
          ...(active ? [active] : []),
          ...state.archive.filter((t) => t.id !== action.id),
        ].slice(0, ARCHIVE_LIMIT),
      };
    }

    case 'collapse':
      return { ...state, collapsed: action.value };

    case 'expire': {
      const fresh = (t: ActivityThread) => t.updatedAt >= action.before;
      const active = state.active && fresh(state.active) ? state.active : null;
      const archive = state.archive.filter(fresh);
      if (active === state.active && archive.length === state.archive.length) return state;
      return { ...state, active, archive };
    }
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type ThreadContextValue = ThreadState & {
  hydrated: boolean;
  /** Called by any page that knows which position the user is working on. */
  syncPosition: (input: SyncPositionInput) => void;
  /** Called the moment a run is created, with what makes it different. */
  recordRun: (positionId: string, run: ThreadRun) => void;
  /** Terminal milestone for a position's thread (a successor was saved). */
  complete: (positionId: string, outcome: { label: string; href?: string }) => void;
  dismiss: () => void;
  resume: (id: string) => void;
  setCollapsed: (value: boolean) => void;
};

const NOOP_CONTEXT: ThreadContextValue = {
  ...EMPTY,
  hydrated: false,
  syncPosition: () => {},
  recordRun: () => {},
  complete: () => {},
  dismiss: () => {},
  resume: () => {},
  setCollapsed: () => {},
};

const ThreadContext = createContext<ThreadContextValue>(NOOP_CONTEXT);

/**
 * Safe outside the provider — instrumented pages fall back to no-ops rather
 * than crashing when rendered outside the dashboard shell.
 */
export function useActivityThread() {
  return useContext(ThreadContext);
}

type Persisted = {
  v: 3;
  tenant: string;
  active: ActivityThread | null;
  archive: ActivityThread[];
  collapsed: boolean;
};

export function ActivityThreadProvider({
  tenantSlug,
  children,
}: {
  tenantSlug: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<ThreadState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  // Child effects run before parent effects, so pages call syncPosition() before
  // the stored thread is read back. Buffer those actions and replay them onto
  // the hydrated state instead of letting hydration clobber them.
  const hydratedRef = useRef(false);
  const pendingRef = useRef<ThreadAction[]>([]);

  const dispatch = useCallback((action: ThreadAction) => {
    if (!hydratedRef.current) {
      pendingRef.current.push(action);
      return;
    }
    setState((prev) => reduce(prev, action));
  }, []);

  useEffect(() => {
    let restored = EMPTY;
    try {
      const raw = window.localStorage.getItem(THREAD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted | null;
        // A tenant switch always wipes: a Mulia position title must never
        // surface in the pill while the user is looking at MSO data.
        if (parsed && parsed.v === 3 && parsed.tenant === tenantSlug) {
          const cutoff = Date.now() - IDLE_MS;
          const fresh = (t: ActivityThread) => Boolean(t) && t.updatedAt >= cutoff;
          restored = {
            active: parsed.active && fresh(parsed.active) ? parsed.active : null,
            archive: Array.isArray(parsed.archive) ? parsed.archive.filter(fresh) : [],
            collapsed: Boolean(parsed.collapsed),
          };
        }
      }
    } catch {
      // Corrupt payload or an older shape — start clean.
      restored = EMPTY;
    }

    const replayed = pendingRef.current.reduce(reduce, restored);
    pendingRef.current = [];
    hydratedRef.current = true;
    setState(replayed);
    setHydrated(true);
  }, [tenantSlug]);

  // Persist every change (cheap — the payload is a handful of small objects).
  useEffect(() => {
    if (!hydrated) return;
    const payload: Persisted = { v: 3, tenant: tenantSlug, ...state };
    try {
      window.localStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage full or blocked — the pill still works for this session.
    }
  }, [hydrated, state, tenantSlug]);

  // Staleness sweep for long-lived tabs, plus a check on refocus so a thread
  // left overnight is gone by the time the user comes back.
  useEffect(() => {
    if (!hydrated) return;
    const sweep = () => dispatch({ type: 'expire', before: Date.now() - IDLE_MS });
    const timer = window.setInterval(sweep, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') sweep();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hydrated, dispatch]);

  // These must stay referentially stable: pages call them from effects that list
  // them as dependencies, so a fresh closure per render would loop forever.
  const syncPosition = useCallback(
    (input: SyncPositionInput) => dispatch({ type: 'sync', input }),
    [dispatch],
  );
  const recordRun = useCallback(
    (positionId: string, run: ThreadRun) => dispatch({ type: 'recordRun', positionId, run }),
    [dispatch],
  );
  const complete = useCallback(
    (positionId: string, outcome: { label: string; href?: string }) =>
      dispatch({ type: 'complete', positionId, outcome }),
    [dispatch],
  );
  const dismiss = useCallback(() => dispatch({ type: 'dismiss' }), [dispatch]);
  const resume = useCallback((id: string) => dispatch({ type: 'resume', id }), [dispatch]);
  const setCollapsed = useCallback(
    (value: boolean) => dispatch({ type: 'collapse', value }),
    [dispatch],
  );

  const value = useMemo<ThreadContextValue>(
    () => ({
      ...state,
      hydrated,
      syncPosition,
      recordRun,
      complete,
      dismiss,
      resume,
      setCollapsed,
    }),
    [state, hydrated, syncPosition, recordRun, complete, dismiss, resume, setCollapsed],
  );

  return <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>;
}

export type { ActivityThread, ThreadRun };
