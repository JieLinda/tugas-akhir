'use client';

import { useEffect } from 'react';
import { useActivityThread } from './thread-provider';

/**
 * Declarative thread registration, rendered by the (server) position page that
 * already has the position and the selected run loaded — that way the pill
 * shows a real title and run figures instead of re-querying for labels it
 * cannot derive from the URL.
 *
 * Props are flat primitives on purpose: an object prop would be a new reference
 * on every render and re-fire the effect on every navigation.
 */
export function ScoringThreadAnchor({
  positionId,
  positionLabel,
  meta,
  viewingRunId,
  viewingRunLabel,
  viewingRunMethod,
  viewingRunCandidateCount,
}: {
  positionId: string;
  positionLabel: string;
  /** Secondary line, e.g. "IT Application Development · IT". */
  meta?: string;
  /**
   * The run on screen. Pass only when the URL explicitly carries `?runId=` —
   * the position page auto-selects the newest run otherwise, and treating that
   * as "the run the user opened" would be a lie.
   */
  viewingRunId?: string;
  viewingRunLabel?: string;
  viewingRunMethod?: string | null;
  viewingRunCandidateCount?: number | null;
}) {
  const { syncPosition } = useActivityThread();

  useEffect(() => {
    syncPosition({
      positionId,
      positionLabel,
      meta,
      viewingRun: viewingRunId
        ? {
            runId: viewingRunId,
            label: viewingRunLabel ?? 'Run',
            method: viewingRunMethod ?? null,
            candidateCount: viewingRunCandidateCount ?? null,
          }
        : null,
      // Reaching the position page means the wizard is behind us.
      wizard: null,
    });
  }, [
    syncPosition,
    positionId,
    positionLabel,
    meta,
    viewingRunId,
    viewingRunLabel,
    viewingRunMethod,
    viewingRunCandidateCount,
  ]);

  return null;
}
