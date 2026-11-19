'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PositionRunTable, type RunRow } from './position-run-table';
import { RerunDialog } from './rerun-dialog';
import { getRerunPreviewAction, startRerunAction, type RerunPreview } from '@/lib/scoring-engine';
import type { RunTree } from '@/lib/run-tree';

interface PositionRunTableClientProps {
  positionId: string;
  positionTitle: string;
  runs: RunRow[];
  availablePrograms: string[];
  selectedRunId: string | null;
  qualifiedCount: number;
  readinessCoverage: number;
  excludeEmployeeIds?: string[];
  tenants: { id: string; name: string }[];
  defaultProgram?: string;
  defaultDateFrom?: string;
  defaultDateTo?: string;
  gradeLevels?: { gradeId: string; levelName: string | null }[];
  programLabels?: Record<string, string>;
  /** The lineage forest, loaded by the page section and shared; null while loading. */
  tree: RunTree | null;
}

export function PositionRunTableClient(props: PositionRunTableClientProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);

  // The lineage forest comes from the page section, deliberately UNFILTERED,
  // so the structure stays whole while the list beside it obeys the
  // date/program filters — a tree with its parents filtered out would read as
  // broken.
  const tree = props.tree;

  // Runs the picker is hiding right now. The tree dims them instead of dropping
  // them, and needs to know which.
  const filteredOutIds = useMemo(() => {
    if (!tree) return undefined;
    const visible = new Set(props.runs.map((r) => r.id));
    const hidden = new Set<string>();
    const walk = (nodes: typeof tree.roots) => {
      for (const n of nodes) {
        if (!visible.has(n.runId)) hidden.add(n.runId);
        walk(n.children);
      }
    };
    walk(tree.roots);
    return hidden;
  }, [tree, props.runs]);

  const selectRun = useCallback(
    (runId: string) => router.push(`/positions/${props.positionId}?runId=${runId}`),
    [router, props.positionId],
  );

  // Whether the selected run can take comparison candidates, and what a child
  // of it would inherit. Decided by the SAME validator the server applies on
  // submit, so the action is offered exactly when it would be accepted — and
  // when it is not, the reason takes its place instead of a dead button.
  const [preview, setPreview] = useState<RerunPreview | null>(null);
  useEffect(() => {
    let active = true;
    setPreview(null);
    if (!props.selectedRunId) return;
    getRerunPreviewAction(props.selectedRunId)
      .then((p) => {
        if (active) setPreview(p);
      })
      .catch(() => {
        if (active) setPreview({ eligible: false, reason: 'Status run tidak dapat diperiksa.' });
      });
    return () => {
      active = false;
    };
  }, [props.selectedRunId]);

  return (
    <>
      <PositionRunTable
        positionId={props.positionId}
        positionTitle={props.positionTitle}
        runs={props.runs}
        availablePrograms={props.availablePrograms}
        selectedRunId={props.selectedRunId}
        qualifiedCount={props.qualifiedCount}
        readinessCoverage={props.readinessCoverage}
        onAddCandidates={preview?.eligible ? () => setAddOpen(true) : undefined}
        rerunBlockedReason={preview && !preview.eligible ? preview.reason : null}
        defaultProgram={props.defaultProgram ?? ''}
        defaultDateFrom={props.defaultDateFrom ?? ''}
        defaultDateTo={props.defaultDateTo ?? ''}
        gradeLevels={props.gradeLevels}
        programLabels={props.programLabels}
        tree={tree}
        filteredOutIds={filteredOutIds}
        onSelectRun={selectRun}
      />
      {props.selectedRunId && preview?.eligible && (
        <RerunDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          baseRunId={props.selectedRunId}
          preview={preview}
          tenants={props.tenants}
          onSubmit={async ({ addedCandidateIds, confirmedOutOfRangeIds, reason }) => {
            const res = await startRerunAction({
              baseRunId: props.selectedRunId!,
              mode: 'incremental_add',
              addedCandidateIds,
              confirmedOutOfRangeIds,
              reason,
            });
            // FR-RR-11: straight to the child, whose header links the comparison
            // with its parent and whose summary shows the stages while it runs.
            // push alone: a refresh() right behind it re-renders the current
            // url and can win the race, leaving the user on the parent.
            router.push(`/positions/${props.positionId}?runId=${res.runId}`);
            return res;
          }}
        />
      )}
    </>
  );
}
