'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { stripLatexMath } from '@/lib/markdown-math';
import { useAskAi } from '@/components/analysis/ask-ai-context';
import { decodeAskMessage } from '@/lib/ask-ai-envelope';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Eraser, Loader2, MessageCircle, Send, Sparkles } from 'lucide-react';
import type { PositionSummary } from '@/lib/talent-data';
import { displayRank, runHavText, type AnalysisCandidate } from '@/lib/analysis-utils';
import { loadChatHistoryAction, clearChatHistoryAction } from '@/lib/chat-actions';
import { ChatExportMenu } from '@/components/analysis/chat-export-menu';

interface ChatMessage {
  role: string;
  content: string;
  /**
   * When the message was persisted. Absent only for the brief window between
   * sending and the next history load — the export prints a dash rather than
   * inventing a time, because a transcript with a wrong clock is worse than one
   * with a gap.
   */
  createdAt?: string | null;
}

type ChatRunInfo = {
  method: string;
  program: string | null;
  label: string | null;
  status: string;
  candidateCount: number;
  createdAt: string;
  completedAt: string | null;
  filterSummary?: {
    totalEvaluated?: number;
    qualifiedCount?: number;
    disqualifiedCount?: number;
    minGradeId?: string | null;
    maxGradeId?: string | null;
  } | null;
} | null;

interface ChatbotPanelProps {
  rankedCandidates: AnalysisCandidate[];
  selectedCandidate?: AnalysisCandidate | null;
  selectedPosition: PositionSummary;
  runId?: string | null;
  run?: ChatRunInfo;
  businessUnits?: string[];
}

export function ChatbotPanel({ rankedCandidates, selectedPosition, runId, run, businessUnits = [] }: ChatbotPanelProps) {
  const [message, setMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { claimPending, pendingToken, returnTo } = useAskAi();
  /**
   * Which run the messages currently on screen belong to.
   *
   * A history snapshot must REPLACE the list when it is a different conversation,
   * and MERGE when it is the same one — otherwise switching runs concatenates two
   * conversations, or a snapshot wipes a question the reader just asked. Tracking
   * the displayed run is what tells those two apart, and a send claims it so a
   * message sent before the first load still counts as "this conversation".
   */
  const shownRunId = useRef<string | null>(null);

  // Load chat history on mount / runId change
  useEffect(() => {
    if (!runId) { setInitialLoading(false); return; }
    setInitialLoading(true);
    loadChatHistoryAction(runId)
      .then((messages) => {
        const sameConversation = shownRunId.current === runId;
        shownRunId.current = runId;
        setChatHistory((prev) => {
          // Different run: this is another conversation entirely.
          if (!sameConversation) return messages;
          // Same run: the snapshot is authoritative for the PAST, but anything on
          // screen that it does not contain is NEWER than it — a question sent
          // while this fetch was in flight. Never replace, or that question
          // disappears and the reader sees an answer with nothing above it.
          //
          // Merging (rather than skipping) is what keeps the earlier conversation
          // when a send raced ahead, and the dedupe covers the other ordering:
          // this query may have run after the POST persisted the same question.
          const key = (m: ChatMessage) => `${m.role}\u0000${m.content}`;
          const seen = new Set(messages.map(key));
          return [...messages, ...prev.filter((m) => !seen.has(key(m)))];
        });
      })
      .catch(() => {})
      .finally(() => setInitialLoading(false));
  }, [runId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!bottomRef.current) return;
    const viewport = bottomRef.current.closest(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement | null;
    if (!viewport) return;
    requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    });
  }, []);

  useEffect(() => {
    if (initialLoading) return;
    scrollToBottom('auto');
  }, [initialLoading, runId, chatHistory.length, loading, scrollToBottom]);

  useEffect(() => {
    if (!streamingText) return;
    scrollToBottom('auto');
  }, [streamingText, scrollToBottom]);

  // A derivation panel parked a question and switched to this tab. Claim it once
  // and send it. Claiming empties the slot, so a re-render cannot resend — the
  // token in the dependency list is what makes a SECOND question arrive, rather
  // than the presence of a payload that would stay truthy.
  useEffect(() => {
    if (!pendingToken || loading || !runId) return;
    const req = claimPending();
    if (!req) return;
    // Deliberately NOT gated on `initialLoading`. Waiting for the history fetch
    // is what made the sent bubble late, and the gate never worked reliably
    // anyway: effects run in declaration order, so this one reads the
    // `initialLoading` of the render it was created in, not the value the
    // history effect above just set. The merge in that effect is what makes
    // sending early safe.
    void handleSend(req.payload);
    // handleSend is recreated every render; depending on it would re-run this on
    // every keystroke. The token is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingToken, loading, runId, claimPending]);

  async function handleSend(explicit?: string) {
    // `explicit` is a question parked by a derivation panel. It bypasses the input
    // box entirely: the payload is hundreds of lines, and putting it in the box
    // would make the user press Send on a wall of text they did not type.
    const typed = message.trim();
    const userMsg = explicit ?? typed;
    if (!userMsg || loading || !runId) return;
    if (!explicit) setMessage('');
    // Claim the conversation so a load that resolves later merges instead of
    // replacing — this send may be the first thing to happen on a fresh mount.
    shownRunId.current = runId;
    // Functional form: `[...chatHistory, …]` rebuilt from a value captured at
    // render time, which drops anything that arrived in between.
    setChatHistory((prev) => [
      ...prev,
      { role: 'user' as const, content: userMsg, createdAt: new Date().toISOString() },
    ]);
    setLoading(true);
    setStreamingText('');

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const context = {
        positionTitle: selectedPosition.title,
        positionDepartment: selectedPosition.department,
        positionDivision: selectedPosition.division,
        // Full scoring-run metadata so the assistant can answer about the run itself.
        scoringRun: run
          ? {
              method: run.method,
              program: run.program,
              label: run.label,
              status: run.status,
              candidateCount: run.candidateCount,
              createdAt: run.createdAt,
              completedAt: run.completedAt,
              businessUnits,
              gradeRange:
                run.filterSummary?.minGradeId || run.filterSummary?.maxGradeId
                  ? { min: run.filterSummary?.minGradeId ?? null, max: run.filterSummary?.maxGradeId ?? null }
                  : null,
              totalEvaluated: run.filterSummary?.totalEvaluated ?? null,
              qualifiedCount: run.filterSummary?.qualifiedCount ?? null,
              disqualifiedCount: run.filterSummary?.disqualifiedCount ?? null,
            }
          : null,
        candidates: rankedCandidates.map((c, idx) => ({
          // The rank the Kandidat tab prints, so the assistant cites the same one.
          rank: displayRank(c, idx),
          name: c.name,
          employeeId: c.profile?.employeeId ?? c.id,
          currentPosition: c.profile?.currentPosition ?? c.currentPosition,
          department: c.profile?.department ?? selectedPosition.department,
          division: c.profile?.division ?? selectedPosition.division,
          grade: c.profile?.grade ?? null,
          gradeLevel: c.profile?.gradeLevel ?? null,
          yearsOfService: c.yearsOfService,
          education: c.profile?.education ?? '-',
          major: c.profile?.major ?? '-',
          disciplinaryStatus: c.profile?.disciplinaryStatus ?? c.discipline,
          mcuStatus: c.profile?.mcuStatus ?? c.mcu,
          behaviorRecommendation: c.profile?.behaviorRecommendation ?? '-',
          behaviorNotes: c.profile?.behaviorNotes ?? null,
          // The quadrant the run scored, worded as the chip words it.
          havQuadrant: runHavText(c),
          // No jobMatch: it is the final score minus 5 (PositionCandidate.jobMatch),
          // and told to the model as "Job Match" it read as a fit measurement.
          riskLevel: c.riskLevel ?? null,
          programs: (c.profile?.programs ?? []).map((p) => ({ code: p.code, status: p.status, note: p.note })),
          assessmentHistory: (c.profile?.assessmentHistory ?? []).map((a) => ({ period: a.period, technical: a.technical, behavior: a.behavior, performance: a.performance })),
          technicalCompetencies: (c.profile?.technicalCompetencies ?? []).map((tc) => ({
            name: tc.technicalName,
            currentProficiency: tc.currentProficiencyName,
            currentScore: tc.currentScore,
            targetScore: tc.score,
            gap: tc.gap,
          })),
          positionHistory: (c.profile?.positionHistory ?? []).map((ph) => ({
            title: ph.internalTitle ?? ph.externalTitle,
            gradeId: ph.gradeId,
            primary: ph.primaryPosition,
            from: ph.validFrom,
            to: ph.validTo,
          })),
          score: c.weightedScore,
          readiness: c.readiness,
          constraint: c.constraint,
          strengths: c.strengths ?? [],
          weaknesses: c.weaknesses ?? [],
          recommendation: c.recommendation ?? [],
          scoreBreakdown: {
            technical: c.scoreBreakdown.technical,
            behavior: c.scoreBreakdown.behavior,
            hav: c.scoreBreakdown.hav,
            performance: c.scoreBreakdown.performance,
            education: c.scoreBreakdown.education,
            ...(c.scoreBreakdown.career != null ? { career: c.scoreBreakdown.career } : {}),
          },
        })),
      };

      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const chatBasePath = basePath ? `${basePath}/api/chat` : '/api/chat';

      const response = await fetch(chatBasePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMsg, runId, context }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error('Chat gagal');
      if (!response.body) throw new Error('Tidak ada response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;
        setStreamingText(accumulated);
      }

      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: accumulated, createdAt: new Date().toISOString() },
      ]);
      setStreamingText('');
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Maaf, terjadi kesalahan. Silakan coba lagi.',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  async function confirmClear() {
    if (!runId) return;
    abortRef.current?.abort();
    setChatHistory([]);
    setStreamingText('');
    setLoading(false);
    setClearConfirmOpen(false);
    try { await clearChatHistoryAction(runId); } catch {}
  }

  // Everything the document needs to say WHICH ranking the conversation is about.
  // Built here rather than inside the export module so the file can never claim
  // a run the panel is not showing.
  const exportMeta = {
    positionTitle: selectedPosition.title,
    department: selectedPosition.department,
    division: selectedPosition.division,
    runId: runId ?? null,
    runLabel: run?.label ?? null,
    runMethod: run?.method ?? null,
    runProgram: run?.program ?? null,
    runStatus: run?.status ?? null,
    runCreatedAt: run?.createdAt ?? null,
    runCompletedAt: run?.completedAt ?? null,
    candidateCount: run?.candidateCount ?? rankedCandidates.length,
  };

  const allMessages = [
    ...chatHistory,
    ...(streamingText ? [{ role: 'assistant' as const, content: streamingText }] : []),
    ...(loading && !streamingText ? [{ role: 'assistant' as const, content: '' }] : []),
  ];

  return (
    <>
      <style>{`
        .chatbot-markdown h1 { font-size: 1.0625rem; font-weight: 700; margin-top: 0.75rem; margin-bottom: 0.375rem; }
        .chatbot-markdown h2 { font-size: 0.9375rem; font-weight: 700; margin-top: 0.5rem; margin-bottom: 0.25rem; }
        .chatbot-markdown h3 { font-size: 0.875rem; font-weight: 600; margin-top: 0.375rem; margin-bottom: 0.25rem; }
        .chatbot-markdown p { margin-bottom: 0.375rem; line-height: 1.625; }
        .chatbot-markdown p:last-child { margin-bottom: 0; }
        .chatbot-markdown ul, .chatbot-markdown ol { padding-left: 1.125rem; margin-bottom: 0.375rem; }
        .chatbot-markdown ul { list-style-type: disc; }
        .chatbot-markdown ol { list-style-type: decimal; }
        .chatbot-markdown li { margin-bottom: 0.125rem; }
        .chatbot-markdown code { background: rgba(0,0,0,0.08); padding: 0.125rem 0.3125rem; border-radius: 0.25rem; font-size: 0.75rem; font-family: monospace; }
        .dark .chatbot-markdown code { background: rgba(255,255,255,0.1); }
        .chatbot-markdown pre { background: rgba(0,0,0,0.06); padding: 0.625rem; border-radius: 0.5rem; margin-bottom: 0.375rem; overflow-x: auto; }
        .dark .chatbot-markdown pre { background: rgba(255,255,255,0.06); }
        .chatbot-markdown pre code { background: transparent; padding: 0; }
        .chatbot-markdown strong { font-weight: 600; }
        .chatbot-markdown blockquote { border-left: 2px solid rgba(148,163,184,0.4); padding-left: 0.625rem; font-style: italic; opacity: 0.85; margin-bottom: 0.375rem; }
        .chatbot-markdown table { border-collapse: collapse; width: 100%; margin-bottom: 0.375rem; font-size: 0.8125rem; }
        .chatbot-markdown th, .chatbot-markdown td { border: 1px solid rgba(148,163,184,0.25); padding: 0.25rem 0.5rem; text-align: left; }
        .chatbot-markdown th { background: rgba(148,163,184,0.1); font-weight: 600; }
      `}</style>
      <Card className="border-slate-200 dark:border-slate-800 shadow-lg flex flex-col h-[calc(100vh-50px)]">
        <CardHeader className="border-b bg-slate-50/50 dark:bg-slate-900/10 p-5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                AI Analytics Assistant
              </CardTitle>
              <CardDescription className="text-xs">
                Tanyakan tentang hasil scoring <strong>{selectedPosition.title}</strong>
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {chatHistory.length > 0 && (
                <>
                  <ChatExportMenu
                    messages={chatHistory}
                    meta={exportMeta}
                    streaming={loading}
                  />
                  <Button size="sm" variant="ghost" onClick={() => setClearConfirmOpen(true)} className="h-7 gap-1 text-xs text-destructive">
                    <Eraser className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                </>
              )}
              <Badge variant="outline" className="text-[10px] font-mono tracking-wider font-extrabold px-2 py-0.5 uppercase">
                {rankedCandidates.length} kandidat
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">
          <ScrollArea className="flex-1 p-5 min-h-0">
            <div className="space-y-4">
              {initialLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : allMessages.length === 0 ? (
                <div className="text-center py-8 space-y-4">
                  <Sparkles className="h-10 w-10 text-primary/40 mx-auto" />
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                      Tanyakan tentang data scoring
                    </p>
                    {runId ? (
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {[
                          'Apa insight kandidat teratas?',
                          'Bandingkan kandidat #1 dan #2',
                          'Siapa yang paling siap?',
                          'Apa rekomendasi untuk posisi ini?',
                        ].map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => { setMessage(q); }}
                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-muted-foreground hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Pilih scoring run terlebih dahulu.</p>
                    )}
                  </div>
                </div>
              ) : (
                allMessages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'user' ? (
                      (() => {
                        // A question sent from a derivation panel carries hundreds
                        // of lines of numbers. Showing that as the user's message
                        // buries the conversation, so it renders as a chip naming
                        // what was asked about — and the chip navigates back to
                        // the exact section it came from.
                        const ref = decodeAskMessage(msg.content)?.ref;
                        if (!ref) {
                          return (
                            <div className="max-w-[85%] px-3.5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm leading-relaxed">
                              {msg.content}
                            </div>
                          );
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => returnTo(ref)}
                            title="Kembali ke bagian tempat pertanyaan ini diajukan"
                            className="group max-w-[85%] rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-2.5 text-left transition-colors hover:bg-primary/20"
                          >
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                              {ref.label}
                              <ArrowUpRight className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                              {ref.candidate}
                              {ref.detail ? ` · ${ref.detail}` : ''}
                            </span>
                            <span className="mt-1 block text-[10px] text-primary/70">
                              Rincian datanya dikirim ke AI · klik untuk kembali ke bagiannya
                            </span>
                          </button>
                        );
                      })()
                    ) : msg.content ? (
                      <div className="chatbot-markdown max-w-[85%] px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm leading-relaxed">
                        {/* The renderer has no math plugin, so LaTeX would
                            reach the reader as literal $$	ext{...}$$. The model
                            is told not to emit it; this repairs the ones that
                            slip through, and the stored history that already
                            contains them. */}
                        <ReactMarkdown>{stripLatexMath(msg.content)}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Menganalisis...</span>
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="border-t border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-900/10 shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={runId ? 'Tanya tentang hasil scoring...' : 'Pilih scoring run untuk mengaktifkan chat'}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={!runId || loading}
                className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
              <Button size="sm" onClick={() => handleSend()} disabled={loading || !message.trim() || !runId} className="shadow-xs font-semibold">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset percakapan?</AlertDialogTitle>
            <AlertDialogDescription>
              Seluruh riwayat chat pada run ini akan dihapus permanen dan tidak dapat dipulihkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClear}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
