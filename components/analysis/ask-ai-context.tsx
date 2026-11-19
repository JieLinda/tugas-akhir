'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AskPanel, AskRef } from '@/lib/ask-ai-envelope';

/**
 * Carries a question from a derivation panel to the AI Assistant tab, and the
 * reader back again.
 *
 * Everything involved lives in ONE component tree — `position-detail-tabs.tsx`
 * owns the tab state, the Kandidat tab's criterion dialog, the Readiness tab's
 * cards and the AI Assistant tab all hang off it — so this is a context rather
 * than a router concern. "Go to the chat" is a tab switch, which also means the
 * chat keeps its scroll position and streamed history instead of remounting.
 *
 * The provider holds no chat logic. It parks one pending question; the chat panel
 * claims it, sends it, and clears it. Claiming is one-shot on purpose: a
 * re-render must not resend, and that is the whole reason this is a ref-backed
 * handoff rather than a prop that stays truthy.
 */

export type AskAiRequest = {
  ref: AskRef;
  /** Data summary PLUS the instruction — what the assistant receives. */
  payload: string;
};

type Ctx = {
  enabled: boolean;
  /**
   * The tab showing right now. A chip has to record where it was asked FROM, and
   * only the host knows that — so it is published here rather than guessed by
   * each button.
   */
  currentTab: string;
  /** Send a question to the assistant and switch to its tab. */
  askAi: (req: AskAiRequest) => void;
  /** Take the reader back to where a question was asked from. */
  returnTo: (ref: AskRef) => void;
  /** Chat panel: claim the pending question exactly once. */
  claimPending: () => AskAiRequest | null;
  /** Bumped whenever a question is parked, so the chat panel re-checks. */
  pendingToken: number;
  /**
   * Set while a return navigation is in progress: the section to land on and the
   * panel to reopen inside it. Held as STATE, not consumed inline, because the
   * component that must act on it may not be mounted yet — the tab it lives in
   * mounts only after the switch.
   *
   * Read by THREE kinds of consumer, in mount order: the container that has to
   * open before the section exists (accordion card, criterion dialog), then the
   * section, then the panel inside it. Only the innermost one clears — a
   * container that cleared would strand the panel it just made mountable. The
   * full `ref` rides along because those containers are keyed by candidate, and
   * the dialog additionally needs the display name.
   */
  reopen: { anchor: string; panel?: AskPanel; ref: AskRef; token: number } | null;
  /** Called by whichever section acted on the signal. */
  clearReopen: () => void;
  /**
   * TEMPORARY diagnostic. Records one step of the ask/return handoff so a broken
   * link is visible on screen rather than inferred. Off unless the page is opened
   * with `?askdebug=1`; remove once the chain is confirmed working.
   */
  trace: (step: string, data?: unknown) => void;
};

/** How long a return signal stays claimable — see `returnTo`. */
const REOPEN_TTL_MS = 12000;
/** Anchor hunt: ~3 s at 120 ms, which outlasts a dialog's breakdown fetch. */
const REVEAL_POLL_MS = 120;
const REVEAL_MAX_TRIES = 25;

const AskAiCtx = createContext<Ctx>({
  enabled: false,
  currentTab: '',
  askAi: () => {},
  returnTo: () => {},
  claimPending: () => null,
  pendingToken: 0,
  reopen: null,
  clearReopen: () => {},
  trace: () => {},
});

export function useAskAi() {
  return useContext(AskAiCtx);
}

export function AskAiProvider({
  children,
  onNavigate,
  currentTab,
  chatTab = 'ai-assistant',
  enabled = true,
}: {
  children: React.ReactNode;
  /** Switch tabs. Owned by the host so this file knows nothing about tab names. */
  onNavigate: (tab: string) => void;
  /** Tab showing right now — recorded on every chip as its return address. */
  currentTab: string;
  chatTab?: string;
  /**
   * False while the host has no chat tab to switch to (the position page hides
   * its AI Assistant tab — lib/position-result-tabs.ts). Every "Tanya AI"
   * control reads `enabled` and renders nothing, so no button can send the
   * reader to a tab that is not there.
   */
  enabled?: boolean;
}) {
  const pending = useRef<AskAiRequest | null>(null);
  const [pendingToken, setPendingToken] = useState(0);
  const [reopen, setReopen] = useState<Ctx['reopen']>(null);
  const reopenSeq = useRef(0);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seeking = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (expiry.current) clearTimeout(expiry.current);
      if (seeking.current) clearInterval(seeking.current);
    },
    [],
  );
  const clearReopen = useCallback(() => setReopen(null), []);

  // ── TEMPORARY diagnostic ──
  //
  // The handoff crosses a tab switch, two unmount/remount boundaries and three
  // consumers, so a break in it cannot be read off the source — twice now a fix
  // that looked right by inspection changed nothing. This records each step and
  // shows it on screen, because asking for a devtools transcript costs a round
  // trip per guess. Enabled only by `?askdebug=1`. Remove once confirmed.
  const [debug, setDebug] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    if (window.location.search.includes('askdebug')) setDebug(true);
  }, []);
  const debugRef = useRef(false);
  debugRef.current = debug;
  const trace = useCallback((step: string, data?: unknown) => {
    if (!debugRef.current) return;
    const line = data === undefined ? step : `${step} — ${JSON.stringify(data)}`;
    console.log('[ask-ai]', line);
    setLog((cur) => [...cur.slice(-39), line]);
  }, []);
  // revealAnchor is created once and must not be re-created by trace changing.
  const traceRef = useRef(trace);
  traceRef.current = trace;

  /**
   * Scroll to the anchor once it EXISTS, which is usually not yet.
   *
   * The old version looked exactly once, two frames after the tab switch, and
   * that is the frame where the target is most reliably absent: the section is
   * inside a container this same signal is still opening — a collapsed accordion
   * card, or a dialog that first fetches the run's breakdown. One miss and the
   * reader was dropped at the top of a dense page with no ring to orient them.
   *
   * So poll briefly instead, and give up quietly: a chip from a run that has
   * since been reloaded with different candidates has no target at all, and that
   * is not an error worth surfacing.
   */
  const revealAnchor = useCallback((anchor: string) => {
    if (seeking.current) clearInterval(seeking.current);
    const stop = () => {
      if (seeking.current) clearInterval(seeking.current);
      seeking.current = null;
    };
    let tries = 0;
    const attempt = () => {
      const el = document.getElementById(anchor);
      if (!el) {
        if (++tries >= REVEAL_MAX_TRIES) {
          stop();
          traceRef.current('4. anchor NEVER appeared, gave up', { anchor, tries });
        }
        return;
      }
      stop();
      traceRef.current('4. anchor found, scrolling', { anchor, tries });
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // A brief ring so the reader sees WHICH section they were returned to;
      // scrolling alone leaves them hunting on a dense page.
      el.classList.add('ask-ai-flash');
      setTimeout(() => el.classList.remove('ask-ai-flash'), 2000);
    };
    seeking.current = setInterval(attempt, REVEAL_POLL_MS);
    // Try immediately too — when the reader never left the tab the section is
    // already there, and waiting out a poll interval would look like lag.
    requestAnimationFrame(() => requestAnimationFrame(attempt));
  }, []);

  const askAi = useCallback(
    (req: AskAiRequest) => {
      pending.current = req;
      traceRef.current('1. askAi: question parked', {
        from: req.ref.origin.tab,
        anchor: req.ref.origin.anchor,
        panel: req.ref.panel ?? null,
      });
      // Token before navigation: the chat panel may already be mounted (tabs keep
      // their content), so it needs the signal even when no mount happens.
      setPendingToken((n) => n + 1);
      onNavigate(chatTab);
    },
    [onNavigate, chatTab],
  );

  const claimPending = useCallback(() => {
    const req = pending.current;
    pending.current = null;
    return req;
  }, []);

  const returnTo = useCallback(
    (ref: AskRef) => {
      onNavigate(ref.origin.tab);
      reopenSeq.current += 1;
      const token = reopenSeq.current;
      traceRef.current('2. chip clicked, navigating + signalling', {
        toTab: ref.origin.tab,
        anchor: ref.origin.anchor,
        panel: ref.panel ?? null,
        token,
      });
      setReopen({ anchor: ref.origin.anchor, panel: ref.panel, ref, token });
      // Expire an unclaimed signal. Nothing consumes it when the chip carries no
      // panel (a whole-criterion summary) or when the section no longer exists (a
      // chip from an earlier run). Left set, it would reopen a panel much later,
      // the moment a matching section happened to mount.
      //
      // The window has to outlast the SLOWEST path to a mounted panel, not the
      // fastest: the Kandidat dialog fetches the run's breakdown from the server
      // before it renders anything the panel could live in.
      if (expiry.current) clearTimeout(expiry.current);
      expiry.current = setTimeout(() => {
        setReopen((cur) => (cur && cur.token === token ? null : cur));
      }, REOPEN_TTL_MS);
      revealAnchor(ref.origin.anchor);
    },
    [onNavigate, revealAnchor],
  );

  return (
    <AskAiCtx.Provider value={{ enabled, currentTab, askAi, returnTo, claimPending, pendingToken, reopen, clearReopen, trace }}>
      {children}
      {/* TEMPORARY — only with ?askdebug=1. See the trace block above. */}
      {debug && (
        <div className="fixed bottom-2 right-2 z-[9999] max-h-[45vh] w-[30rem] overflow-y-auto rounded-lg border-2 border-amber-500 bg-black/90 p-2 font-mono text-[10px] leading-snug text-amber-200 shadow-xl">
          <div className="mb-1 flex items-center justify-between font-bold text-amber-400">
            <span>ask-ai trace · tab: {currentTab}</span>
            <button type="button" onClick={() => setLog([])} className="underline">
              bersihkan
            </button>
          </div>
          {log.length === 0 ? (
            <div className="text-amber-200/60">
              (belum ada peristiwa — tekan &quot;Tanya AI&quot; lalu klik bubble-nya)
            </div>
          ) : (
            log.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap border-t border-amber-500/20 py-0.5">
                {l}
              </div>
            ))
          )}
        </div>
      )}
      {/* Plain <style>, matching chatbot-panel.tsx — no styled-jsx dependency. */}
      <style>{`
        .ask-ai-flash { animation: askAiFlash 2s ease-out; }
        @keyframes askAiFlash {
          0%, 40% { box-shadow: 0 0 0 2px hsl(var(--primary) / 0.55); }
          100%    { box-shadow: 0 0 0 2px hsl(var(--primary) / 0); }
        }
      `}</style>
    </AskAiCtx.Provider>
  );
}
