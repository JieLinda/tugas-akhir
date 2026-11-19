'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PositionRunTableClient } from './position-run-table-client';
import { PositionDetailTabs, type RunSummary } from './position-detail-tabs';
import { RunCompareNavProvider } from '@/components/analysis/run-compare/compare-nav';
import type { ComparePair } from '@/components/analysis/run-compare/run-compare-workspace';
import { getRunTreeAction, type RunTree } from '@/lib/run-tree-actions';
import { RUN_COMPARE_TAB } from '@/lib/run-history';
import { DEFAULT_RESULT_TAB, parseResultTab } from '@/lib/position-result-tabs';
import {
  loadPositionRunViewDataAction,
  loadCandidateProfilesForAnalysisAction,
  type PositionRunViewData,
} from '@/lib/position-detail-actions';
import type { CandidateProfile, PositionSummary } from '@/lib/talent-data';
import type { ReadinessConfig } from '@/lib/readiness-config-actions';
import type { PositionPick } from '@/lib/position-pick-actions';

type IncumbentInfo = { name: string; employeeId: string; profile: CandidateProfile | null };

interface PositionRunSectionProps {
  positionId: string;
  positionTitle: string;
  position: PositionSummary;
  positionDepartment: string | null;
  runs: RunSummary[];
  availablePrograms: string[];
  selectedRunId: string;
  selectedRun: RunSummary | null;
  readinessCoverage: number;
  picks: PositionPick[];
  readinessConfig: ReadinessConfig;
  programLabels: Record<string, string>;
  defaultProgram: string;
  defaultDateFrom: string;
  defaultDateTo: string;
  tenants: { id: string; name: string }[];
  gradeLevels: { gradeId: string; levelName: string | null }[];
  /** NPKs of every sitting incumbent — none of them may be added to their own successor list. */
  excludeEmployeeIds: string[];
  /** Incumbents as candidate ids, resolved on the server from the real NPKs. */
  incumbentCandidateIds?: string[];
  incumbent: IncumbentInfo | null;
  /** Server-rendered job-qualification card, shown between the table and tabs. */
  jobQualificationSlot: React.ReactNode;
  /** `?tab=` — which result tab opens. */
  initialTab?: string | null;
  /** `?a=&b=` — the pair the "Komparasi Versi" tab opens on (FR-CMP-11). */
  initialComparePair?: ComparePair;
}

function LoadingCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </CardContent>
    </Card>
  );
}

export function PositionRunSection({
  positionId,
  positionTitle,
  position,
  positionDepartment,
  runs,
  availablePrograms,
  selectedRunId,
  selectedRun,
  readinessCoverage,
  picks,
  readinessConfig,
  programLabels,
  defaultProgram,
  defaultDateFrom,
  defaultDateTo,
  tenants,
  gradeLevels,
  excludeEmployeeIds,
  incumbentCandidateIds,
  incumbent,
  jobQualificationSlot,
  initialTab = null,
  initialComparePair,
}: PositionRunSectionProps) {
  const [runData, setRunData] = useState<PositionRunViewData | null>(null);
  const [profiles, setProfiles] = useState<CandidateProfile[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const fetchRunData = useCallback(() => {
    setRunError(null);
    setRunData(null);
    loadPositionRunViewDataAction(selectedRunId, positionDepartment)
      .then(setRunData)
      .catch((err) => {
        console.error('loadPositionRunViewData failed', err);
        setRunError('Gagal memuat hasil scoring. Coba lagi.');
      });
  }, [selectedRunId, positionDepartment]);

  // Run-specific data — refetched whenever the selected run changes.
  useEffect(() => {
    fetchRunData();
  }, [fetchRunData]);

  // Tenant-wide candidate profiles (for comparison/dossier) — loaded once.
  useEffect(() => {
    let active = true;
    loadCandidateProfilesForAnalysisAction()
      .then((data) => {
        if (active) setProfiles(data);
      })
      .catch((err) => {
        console.error('loadCandidateProfilesForAnalysis failed', err);
        if (active) setProfiles([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // The run forest, loaded once here for its three readers — the run history's
  // Silsilah view, the breadcrumb above a ranking, and the "Komparasi Versi"
  // navigator. Deliberately UNFILTERED (see lib/run-tree-actions.ts). Re-read
  // when the run on screen changes (a run created from a dialog must appear)
  // and when the picks change (the forum-decision badges). The previous tree
  // stays on screen while the next one loads.
  const [tree, setTree] = useState<RunTree | null>(null);
  const picksKey = useMemo(() => picks.map((p) => `${p.id}:${p.updatedAt}`).join('|'), [picks]);
  useEffect(() => {
    let active = true;
    getRunTreeAction(positionId)
      .then((t) => {
        if (active) setTree(t);
      })
      .catch((err) => {
        console.error('getRunTree failed', err);
        if (active) setTree({ roots: [], totalRuns: 0, orphanCount: 0, maxDepth: 0 });
      });
    return () => {
      active = false;
    };
  }, [positionId, selectedRunId, picksKey]);

  // The result tab and the comparison pair live here, not in the tabs: the
  // tabs remount whenever the run on screen changes, and the run history's
  // "Bandingkan" — a sibling of the tabs — has to be able to open one of them.
  // Retired ids (`perbandingan-run`) open their current tab, and the mirror
  // below rewrites the URL to the current id; hidden tabs (AI Assistant) and
  // unknown values open Kandidat.
  const [activeTab, setActiveTab] = useState<string>(() => parseResultTab(initialTab));
  const [pair, setPair] = useState<ComparePair>(initialComparePair ?? { a: null, b: null });

  // Mirror both into the URL, so a refresh or a shared link reopens the same
  // tab and the same pair (FR-CMP-11). replaceState, not router.push: switching
  // a tab is not a navigation and must not re-run the page's server reads.
  // Re-applied after a run switch, whose navigation drops these parameters.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const before = url.search;
      if (activeTab !== DEFAULT_RESULT_TAB) url.searchParams.set('tab', activeTab);
      else url.searchParams.delete('tab');
      if (activeTab === RUN_COMPARE_TAB && pair.a && pair.b) {
        url.searchParams.set('a', pair.a);
        url.searchParams.set('b', pair.b);
      } else {
        url.searchParams.delete('a');
        url.searchParams.delete('b');
      }
      if (url.search !== before) window.history.replaceState(null, '', url);
    } catch {
      // URL sync is a convenience; the state already changed.
    }
  }, [activeTab, pair.a, pair.b, selectedRunId]);

  // "Bandingkan" anywhere on the page — the Silsilah ticks and shortcuts, the
  // derived-run banner, the Selisih Peringkat panel — lands here.
  const tabsRef = useRef<HTMLDivElement>(null);
  const openComparison = useCallback((a: string, b: string) => {
    setPair({ a, b });
    setActiveTab(RUN_COMPARE_TAB);
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);
  const compareNav = useMemo(() => ({ openComparison }), [openComparison]);

  return (
    <RunCompareNavProvider value={compareNav}>
      {runError ? (
        <Card className="border-rose-200/70 dark:border-rose-900/60">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <AlertTriangle className="h-5 w-5 text-rose-500" />
            <span>{runError}</span>
            <Button variant="outline" size="sm" onClick={fetchRunData}>
              Coba lagi
            </Button>
          </CardContent>
        </Card>
      ) : runData ? (
        <PositionRunTableClient
          positionId={positionId}
          positionTitle={positionTitle}
          runs={runs}
          availablePrograms={availablePrograms}
          selectedRunId={selectedRunId}
          qualifiedCount={runData.qualifiedCount}
          readinessCoverage={readinessCoverage}
          excludeEmployeeIds={excludeEmployeeIds}
          tenants={tenants}
          gradeLevels={gradeLevels}
          programLabels={programLabels}
          defaultProgram={defaultProgram}
          defaultDateFrom={defaultDateFrom}
          defaultDateTo={defaultDateTo}
          tree={tree}
        />
      ) : (
        <LoadingCard label="Memuat hasil scoring…" />
      )}

      {jobQualificationSlot}

      {/* FR-DEC-02's "Rekomendasi sistem dan keputusan forum" is no longer a
          card here: it lives in the "Komparasi Versi" tab, beside the
          comparison it is read with. */}
      <div ref={tabsRef} id="hasil-scoring" className="scroll-mt-4">
      {!runError &&
        (runData && profiles ? (
          <PositionDetailTabs
            position={position}
            runs={runs}
            selectedRun={selectedRun}
            selectedRunId={selectedRunId}
            candidates={runData.candidates}
            candidateProfiles={profiles}
            candidateBusinessUnits={runData.candidateBusinessUnits}
            picks={picks}
            initialTieOverrides={runData.initialTieOverrides}
            readinessConfig={readinessConfig}
            incumbent={incumbent}
            exclusions={runData.exclusions}
            criterionOrder={runData.criterionOrder}
            onExclusionsChanged={fetchRunData}
            incumbentEmployeeIds={excludeEmployeeIds}
            incumbentCandidateIdList={incumbentCandidateIds}
            runTree={tree}
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
            comparePair={pair}
            onComparePairChange={setPair}
            programLabels={programLabels}
          />
        ) : (
          <LoadingCard label="Memuat analisis kandidat…" />
        ))}
      </div>
    </RunCompareNavProvider>
  );
}
