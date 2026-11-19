"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronRight,
  Edit2,
  Equal,
  ExternalLink,
  GitCompare,
  List,
  Loader2,
  MessageCircle,
  Network,
  Scale,
  SlidersHorizontal,
  UserCheck,
  X,
} from "lucide-react";
import type {
  CandidateProfile,
  PositionCandidate,
  PositionSummary,
} from "@/lib/talent-data";
import type { ReadinessConfig } from "@/lib/readiness-config-actions";
import {
  type AnalysisCandidate,
  buildRecommendation,
  buildStrengths,
  buildWeaknesses,
  displayRank,
  readinessBarTone,
  runHavText,
} from "@/lib/analysis-utils";
import { ChatbotPanel } from "@/components/analysis/chatbot-panel";
import { AskAiProvider } from "@/components/analysis/ask-ai-context";
import { DiagnosticDossier } from "@/components/analysis/diagnostic-dossier";
import { MultiComparison } from "@/components/analysis/multi-comparison";
import { TalentNetworkMap } from "@/components/analysis/talent-network-map";
import {
  JobFamilyPositionMap,
  type FamilyMapFinalist,
} from "@/components/analysis/job-family-position-map";
import { RunCandidateAnalysis } from "@/components/analysis/run-candidate-analysis";
import { RankShiftPanel } from "@/components/analysis/rank-shift-panel";
import { DerivedRunBanner } from "@/components/analysis/derived-run-banner";
import { RunTopsisBreakdownCard } from "@/components/analysis/run-compare/topsis-breakdown";
import { RunAncestry } from "@/components/analysis/run-ancestry";
import type { RunTree, RunTreeNode } from "@/lib/run-tree";
import {
  RunCompareWorkspace,
  type ComparePair,
} from "@/components/analysis/run-compare/run-compare-workspace";
import { RUN_COMPARE_TAB } from "@/lib/run-history";
import { AI_ASSISTANT_TAB_ENABLED } from "@/lib/position-result-tabs";
import { RunConfigurationPanel } from "@/components/analysis/run-configuration-panel";
import {
  AhpCriterionPopupProvider,
  BreakdownChip,
} from "@/components/analysis/ahp-criterion-popup";
import {
  criterionWeightHint,
  UNKNOWN_CRITERION_ORDER,
  type RunCriterionOrder,
} from "@/lib/criterion-weight-order";
import type { ScoringAspectKey } from "@/lib/scoring-criteria";
import {
  savePositionPickAction,
  deletePositionPickAction,
  reorderPicksAction,
  updatePickNotesAction,
  type PositionPick,
} from "@/lib/position-pick-actions";
import { reorderTiedCandidatesAction } from "@/lib/tied-candidates-actions";
import { useActivityThread } from "@/components/activity-thread";
import { LightbulbIcon } from "@phosphor-icons/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { InfoHint } from "@/components/ui/info-hint";
import { ExportButtons } from "@/components/analysis/export-buttons";
import { exportPickedCandidatesHtml } from "@/lib/analysis-export";
import { AlertTriangle, Printer, Ban, Undo2, UserPlus } from "lucide-react";
import {
  ExcludeCandidateDialog,
  ExclusionSummaryBar,
  exclusionReasonLabel,
} from "@/components/exclude-candidate-dialog";
import type { RunExclusionEntry } from "@/lib/scoring-engine";

type FilterSummary = {
  templateId: string | null;
  totalEvaluated: number;
  qualifiedCount: number;
  disqualifiedCount: number;
  disqualified: { candidateId: string; name: string; reasons: string[] }[];
  /** Grade range ("rentang level") the candidate pool was filtered with */
  minGradeId?: string | null;
  maxGradeId?: string | null;
} | null;

export type RunSummary = {
  id: string;
  positionId: string;
  method: string;
  program: string | null;
  label: string | null;
  status: string;
  candidateCount: number;
  createdAt: string;
  completedAt: string | null;
  filterSummary: FilterSummary;
  /** Set when the run stopped before finishing (FR-RR-12). */
  failure?: { kind: 'error' | 'cancelled'; message: string } | null;
};

interface PositionDetailTabsProps {
  position: PositionSummary;
  runs: RunSummary[];
  selectedRun: RunSummary | null;
  selectedRunId: string | null;
  candidates: PositionCandidate[];
  candidateProfiles: CandidateProfile[];
  /** candidateId → owning business unit name (for cross-tenant runs). */
  candidateBusinessUnits?: Record<string, string>;
  picks: PositionPick[];
  initialTieOverrides: Record<string, string[]>;
  readinessConfig: ReadinessConfig;
  incumbent?: { name: string; employeeId: string; profile: CandidateProfile | null } | null;
  /** Candidates marked "tidak dipertimbangkan" on this run (soft exclude). */
  exclusions?: RunExclusionEntry[];
  /**
   * Breakdown-chip order for this run, heaviest-weighted criterion first,
   * resolved from what the run itself recorded. Defaults to the canonical order
   * so a caller that cannot resolve it renders exactly what it always did.
   */
  criterionOrder?: RunCriterionOrder;
  /** Re-fetch the run view after an exclusion is added or undone. */
  onExclusionsChanged?: () => void;
  /** NPKs of everyone sitting in this seat now — none of them can be picked (FR-DEC-03). */
  incumbentEmployeeIds?: string[];
  /** Incumbents as candidate ids from the server — preferred: NPKs are masked in demo mode. */
  incumbentCandidateIdList?: string[];
  /**
   * The position's run forest, loaded once by the page section and shared with
   * the run history's Silsilah view; null while loading. Required: a caller
   * that forgot it would leave the "Komparasi Versi" tab loading forever.
   */
  runTree: RunTree | null;
  /** Controlled tab — the section keeps it (and mirrors it into ?tab=). */
  activeTab?: string;
  onActiveTabChange?: (tab: string) => void;
  /** The "Komparasi Versi" pair (?a=&b=). */
  comparePair?: ComparePair;
  onComparePairChange?: (pair: ComparePair) => void;
  /** Program code → display name, for the forum decisions. */
  programLabels?: Record<string, string>;
}

/** NPK identity: numeric ids padded to 5 (`370` = `00370`), others as written. */
const npkKey = (v: string) => {
  const t = v.trim();
  return /^[0-9]+$/.test(t) ? t.padStart(5, "0") : t;
};

/** Longest justification a decision may carry — the server enforces the same. */
const PICK_JUSTIFICATION_MAX = 2000;

const codeLabels: Record<string, string> = {
  talent: "Talent Pool",
  successor: "Critical Position",
  emergency: "Emergency Position",
};

const readinessTone: Record<string, string> = {
  Short: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  Medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Long: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "Not Ready": "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

/** Excluded rows keep their number but stop reading as a live candidate. */
const excludedRowTone =
  "border-slate-200/70 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900/40 opacity-60";

/**
 * Label + colour for each breakdown chip.
 *
 * A table rather than six JSX blocks because the render ORDER is now the run's
 * own weight order — the six blocks could only ever be in one order, which was
 * the bug. Colour is keyed to the criterion, not to the position in the row, so
 * a reader who knows "teal is career" keeps that across runs weighted
 * differently.
 */
const CRITERION_CHIPS: Record<ScoringAspectKey, { label: string; tone: string }> = {
  technical: {
    label: "Tech",
    tone: "border-sky-200/60 dark:border-sky-900/50 bg-sky-50/60 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300",
  },
  behavior: {
    label: "Beh",
    tone: "border-fuchsia-200/60 dark:border-fuchsia-900/50 bg-fuchsia-50/60 dark:bg-fuchsia-950/20 text-fuchsia-700 dark:text-fuchsia-300",
  },
  hav: {
    label: "HAV",
    tone: "border-violet-200/60 dark:border-violet-900/50 bg-violet-50/60 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300",
  },
  performance: {
    label: "PA",
    tone: "border-emerald-200/60 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300",
  },
  education: {
    label: "Edu",
    tone: "border-amber-200/60 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300",
  },
  career: {
    label: "Career",
    tone: "border-teal-200/60 dark:border-teal-900/50 bg-teal-50/60 dark:bg-teal-950/20 text-teal-700 dark:text-teal-300",
  },
};

const readinessRowTone: Record<string, string> = {
  Short:
    "border-sky-200 bg-sky-50/70 dark:border-sky-900/40 dark:bg-sky-950/20",
  Medium:
    "border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20",
  Long: "border-lime-200 bg-lime-50/70 dark:border-lime-900/40 dark:bg-lime-950/20",
  "Not Ready":
    "border-rose-200 bg-rose-50/70 dark:border-rose-900/40 dark:bg-rose-950/20",
};

export function PositionDetailTabs({
  position,
  runs,
  selectedRun,
  selectedRunId,
  candidates,
  candidateProfiles,
  candidateBusinessUnits = {},
  picks,
  initialTieOverrides,
  readinessConfig,
  incumbent = null,
  exclusions = [],
  criterionOrder = UNKNOWN_CRITERION_ORDER,
  onExclusionsChanged,
  incumbentEmployeeIds = [],
  incumbentCandidateIdList,
  runTree,
  activeTab: controlledTab,
  onActiveTabChange,
  comparePair,
  onComparePairChange,
  programLabels = {},
}: PositionDetailTabsProps) {
  const router = useRouter();
  const { complete: completeThread } = useActivityThread();

  // Soft exclusions on this run. The excluded rows stay in the list with their
  // original rank and score — a finished run is a record of an assessment, so
  // this annotates it rather than rewriting it — but they are struck through and
  // dropped from the picks/derived counts.
  const exclusionByCandidate = useMemo(
    () => new Map(exclusions.map((e) => [e.candidateId, e])),
    [exclusions],
  );
  // The same marks, worded as the row's tooltip words them, for the exports.
  const exportExclusions = useMemo(
    () =>
      new Map(
        exclusions.map((e) => [
          e.candidateId,
          `${exclusionReasonLabel(e.reason)}${e.note ? ` — ${e.note}` : ""}`,
        ]),
      ),
    [exclusions],
  );
  const [excludeTarget, setExcludeTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Candidates who hold this seat NOW. A carried-over pool can still contain
  // one (the child keeps its parent's pool as it was), and nobody can be named
  // successor to their own seat — the server refuses it, the row says so first.
  const incumbentCandidateIds = useMemo(() => {
    if (incumbentCandidateIdList) return new Set(incumbentCandidateIdList);
    const npks = new Set(incumbentEmployeeIds.filter(Boolean).map(npkKey));
    return new Set(
      candidateProfiles.filter((p) => p.employeeId && npks.has(npkKey(p.employeeId))).map((p) => p.id),
    );
  }, [incumbentCandidateIdList, incumbentEmployeeIds, candidateProfiles]);
  const [pickExcludedConfirmed, setPickExcludedConfirmed] = useState(false);

  // Distinct business units represented in this run's candidates. When more than
  // one, the run is cross-tenant and we surface where each candidate came from.
  const businessUnitsInRun = useMemo(
    () => Array.from(new Set(Object.values(candidateBusinessUnits))).sort(),
    [candidateBusinessUnits],
  );
  const isCrossTenantRun = businessUnitsInRun.length > 1;
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [uncontrolledTab, setUncontrolledTab] = useState("candidates");
  const activeTab = controlledTab ?? uncontrolledTab;
  const setActiveTab = useCallback(
    (tab: string) => (onActiveTabChange ? onActiveTabChange(tab) : setUncontrolledTab(tab)),
    [onActiveTabChange],
  );
  // Used only when the caller does not hold the pair itself.
  const [localPair, setLocalPair] = useState<ComparePair>({ a: null, b: null });

  // Jump to the diagnostic dossier (in the Analisis Visual tab) for a candidate.
  function openInDossier(candidateId: string) {
    setSelectedCandidateId(candidateId);
    setActiveTab("analisis-visual");
  }

  // Tie-reorder state: Map<score, candidateId[] in custom order>
  const [tieOrderOverrides, setTieOrderOverrides] =
    useState<Record<string, string[]>>(initialTieOverrides);

  // Pick dialog state
  const [pickCandidate, setPickCandidate] = useState<PositionCandidate | null>(
    null,
  );
  const [pickNotes, setPickNotes] = useState("");
  const [pickProgram, setPickProgram] = useState("");
  const [pickScore, setPickScore] = useState(0);
  const [pickReadiness, setPickReadiness] = useState("Medium");
  const [pickRunId, setPickRunId] = useState<string | null>(null);
  const [savingPick, setSavingPick] = useState(false);
  const [removingPickId, setRemovingPickId] = useState<string | null>(null);
  const [savingPickNotes, setSavingPickNotes] = useState(false);
  const [reorderingPick, setReorderingPick] = useState(false);
  const [editingNotesPickId, setEditingNotesPickId] = useState<string | null>(
    null,
  );
  const [editingNotesText, setEditingNotesText] = useState("");

  const programOptions = useMemo(() => {
    const codes = new Set<string>();
    // Use programs from position metadata
    (position as any).programs?.forEach?.((p: string) => codes.add(p));
    // Also from the selected run
    if (selectedRun?.program) codes.add(selectedRun.program);
    // From picks
    picks.forEach((p) => codes.add(p.programCode));
    return Array.from(codes);
  }, [position, selectedRun, picks]);

  const picksByProgram = useMemo(() => {
    const map = new Map<string, PositionPick[]>();
    for (const pick of picks) {
      const arr = map.get(pick.programCode) ?? [];
      arr.push(pick);
      map.set(pick.programCode, arr);
    }
    return map;
  }, [picks]);

  // Active program tab for picked successors sidebar
  const programList = useMemo(
    () => Array.from(picksByProgram.keys()),
    [picksByProgram],
  );
  const [activePickProgram, setActivePickProgram] = useState<string>("");

  useEffect(() => {
    if (!activePickProgram && programList.length > 0) {
      setActivePickProgram(programList[0]!);
    } else if (activePickProgram && !programList.includes(activePickProgram)) {
      setActivePickProgram(programList[0] ?? "");
    }
  }, [programList, activePickProgram]);

  const decisionByProgram = picksByProgram; // backwards compat (unused now)

  function openPickDialog(candidate: PositionCandidate) {
    const defaultProgram = selectedRun?.program ?? programOptions[0] ?? "";
    // Pre-fill with this candidate's existing pick notes (if they already picked this person in this program)
    const existing = picks.find(
      (p) => p.programCode === defaultProgram && p.candidateId === candidate.id,
    );
    setPickCandidate(candidate);
    setPickExcludedConfirmed(false);
    setPickProgram(defaultProgram);
    setPickNotes(existing?.notes ?? "");
    setPickScore(candidate.weightedScore);
    setPickReadiness(candidate.readiness);
    setPickRunId(selectedRunId);
  }

  const alreadyPickedCount = pickCandidate
    ? (picksByProgram.get(pickProgram)?.length ?? 0)
    : 0;

  async function handlePickSave() {
    if (!pickCandidate || !pickProgram) return;
    setSavingPick(true);
    try {
      const fd = new FormData();
      fd.set("positionId", position.id);
      fd.set("candidateId", pickCandidate.id);
      fd.set("programCode", pickProgram);
      fd.set("notes", pickNotes);
      fd.set("score", String(pickScore));
      fd.set("readiness", pickReadiness);
      if (pickRunId) fd.set("runId", pickRunId);
      await savePositionPickAction(fd);
      toast.success(
        `${pickCandidate.name} ditambahkan ke suksesor program ${codeLabels[pickProgram] ?? pickProgram}.`,
      );
      // Terminal milestone of the assessment thread: a successor is on record.
      completeThread(position.id, {
        label: `Suksesor tersimpan: ${pickCandidate.name}`,
        href: `/positions/${position.id}`,
      });
      router.refresh();
      setPickCandidate(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setSavingPick(false);
    }
  }

  async function handleRemovePick(pickId: string) {
    setRemovingPickId(pickId);
    try {
      const fd = new FormData();
      fd.set("pickId", pickId);
      await deletePositionPickAction(fd);
      toast.success("Suksesor dihapus.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus.");
    } finally {
      setRemovingPickId(null);
    }
  }

  async function handleViewRun(pickRunId: string | null) {
    if (!pickRunId) {
      toast.error("Run tidak tercatat untuk kandidat ini.");
      return;
    }
    router.push(`/positions/${position.id}?runId=${pickRunId}`);
  }

  async function handleReorderPick(pickId: string, direction: "up" | "down") {
    setReorderingPick(true);
    try {
      await reorderPicksAction({ positionId: position.id, pickId, direction });
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal mengubah urutan.",
      );
    } finally {
      setReorderingPick(false);
    }
  }

  // Tie-reorder: swap two candidates within a tied score group.
  // Persists the new order to the DB via reorderTiedCandidatesAction.
  //
  // The swap is computed HERE, not inside the setTieOrderOverrides updater:
  // React treats a state updater as pure and may re-run it during render, so
  // firing the server action from inside it dispatched a Router transition
  // mid-render ("Cannot update a component (Router) while rendering a
  // different component"). Reading tieOrderOverrides from the closure is
  // equivalent — effectiveTieOrder is derived from that same state in the same
  // render, and these swaps only happen one click at a time.
  function moveTiedCandidate(
    score: string,
    candidateId: string,
    direction: "up" | "down",
  ) {
    if (!selectedRunId) return;
    const seededOrder = effectiveTieOrder[score];
    if (!seededOrder || seededOrder.length === 0) return;

    const existing = tieOrderOverrides[score];
    const order =
      existing && existing.includes(candidateId) ? existing : seededOrder;
    const idx = order.indexOf(candidateId);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= order.length) return;
    const next = [...order];
    [next[idx], next[newIdx]] = [next[newIdx]!, next[idx]!];

    setTieOrderOverrides((prev) => ({ ...prev, [score]: next }));

    // Persist the new order to the DB. Each candidate gets a manualRank
    // equal to its 1-based position within the tied group.
    reorderTiedCandidatesAction({
      runId: selectedRunId,
      order: next.map((cid, i) => ({ candidateId: cid, manualRank: i + 1 })),
    }).catch((err) =>
      toast.error(
        err instanceof Error ? err.message : "Gagal menyimpan urutan.",
      ),
    );
  }

  const profileMap = useMemo(
    () => new Map(candidateProfiles.map((profile) => [profile.id, profile])),
    [candidateProfiles],
  );

  const rankedCandidates = useMemo<AnalysisCandidate[]>(() => {
    function resolveReadiness(score: number): string {
      for (const t of readinessConfig.thresholds) {
        if (score >= t.minScore) return t.level;
      }
      return readinessConfig.defaultLevel;
    }
    function resolveReadinessEta(level: string): string {
      const found = readinessConfig.thresholds.find((t) => t.level === level);
      return found?.eta ?? '> 5 tahun';
    }

    return [...candidates]
      .sort((left, right) => right.weightedScore - left.weightedScore)
      .map((candidate) => {
        const profile = profileMap.get(candidate.id) ?? null;
        const computedReadiness = resolveReadiness(candidate.weightedScore);
        const enrichedCandidate: PositionCandidate = {
          ...candidate,
          readiness: computedReadiness as PositionCandidate['readiness'],
          currentPosition:
            profile?.currentPosition ?? candidate.currentPosition,
          yearsOfService: profile?.yearsOfService ?? candidate.yearsOfService,
          // The quadrant the RUN scored, as the loader resolved it — never the
          // profile's HAV today, which a placement or upload since the run may
          // have moved (runHavText in lib/analysis-utils.ts).
          havQuadrant: candidate.havQuadrant,
          discipline:
            candidate.discipline !== "-"
              ? candidate.discipline
              : (profile?.disciplinaryStatus ?? "-"),
          mcu:
            candidate.mcu !== "-" ? candidate.mcu : (profile?.mcuStatus ?? "-"),
          performance:
            candidate.performance !== "-"
              ? candidate.performance
              : (profile?.raw?.performanceGrade ?? "-"),
          behaviorRecommendation:
            candidate.behaviorRecommendation ??
            profile?.behaviorRecommendation ??
            "-",
          behaviorNotes:
            candidate.behaviorNotes ?? profile?.behaviorNotes ?? null,
        };

        return {
          ...enrichedCandidate,
          profile,
          readinessWindow: resolveReadinessEta(computedReadiness),
          eligiblePrograms:
            profile?.programs.filter(
              (program) => program.status === "Qualified",
            ).length ?? 0,
          strengths: buildStrengths(enrichedCandidate, profile),
          weaknesses: buildWeaknesses(enrichedCandidate, profile),
          recommendation: buildRecommendation(enrichedCandidate),
        };
      });
  }, [candidates, profileMap, readinessConfig]);

  useEffect(() => {
    const primaryId = rankedCandidates[0]?.id ?? "";
    const secondaryId =
      rankedCandidates.find((candidate) => candidate.id !== primaryId)?.id ??
      "";
    setSelectedCandidateId(primaryId);
    setCompareIds([primaryId, secondaryId].filter(Boolean));
  }, [rankedCandidates, position.id, selectedRunId]);

  const selectedCandidate =
    rankedCandidates.find(
      (candidate) => candidate.id === selectedCandidateId,
    ) ??
    rankedCandidates[0] ??
    null;

  // Deterministic (AHP + TOPSIS) run — only those carry a per-aspect breakdown.
  const isAhpRun = selectedRun?.method === "AHP_TOPSIS";

  // ── Lineage of the run on screen ────────────────────────────────────────
  // The forest comes from the page section, which loads it once for the three
  // readers that need it — this breadcrumb, the run history's Silsilah view and
  // the "Komparasi Versi" navigator — so they can never show different trees.
  const ancestryRoots = useMemo<RunTreeNode[]>(() => runTree?.roots ?? [], [runTree]);

  const { ancestryPath, ancestrySiblings } = useMemo(() => {
    const path: RunTreeNode[] = [];
    let parentOf: RunTreeNode | null = null;
    const walk = (node: RunTreeNode, trail: RunTreeNode[], parent: RunTreeNode | null): boolean => {
      const next = [...trail, node];
      if (node.runId === selectedRunId) {
        path.push(...next);
        parentOf = parent;
        return true;
      }
      return node.children.some((c) => walk(c, next, node));
    };
    ancestryRoots.some((r) => walk(r, [], null));
    const siblings = ((parentOf as RunTreeNode | null)?.children ?? [])
      .filter((c) => c.runId !== selectedRunId)
      .map((c) => ({ runId: c.runId, shortLabel: c.shortLabel, mode: c.mode }));
    return {
      ancestryPath: path.map((n) => ({
        runId: n.runId,
        shortLabel: n.shortLabel,
        mode: n.mode,
        candidateCount: n.candidateCount,
        createdAt: n.createdAt,
        reason: n.reason,
      })),
      ancestrySiblings: siblings,
    };
  }, [ancestryRoots, selectedRunId]);

  const selectRunById = useCallback(
    (runId: string) => {
      window.location.href = `/positions/${position.id}?runId=${runId}`;
    },
    [position.id],
  );

  // "Konfigurasi Run" exists only for AHP+TOPSIS. Switching to a legacy run of
  // another method while it is open would leave the tab selected with nothing to
  // render, so fall back to the candidate list.
  useEffect(() => {
    if (!isAhpRun && activeTab === "konfigurasi-run") setActiveTab("candidates");
  }, [isAhpRun, activeTab]);

  // EVERY candidate of this run goes on the Job Family map. A hardcoded top-10
  // used to silently drop candidates added later to an AHP+TOPSIS run (an
  // 11-candidate re-run plotted only 10), which read as "the map didn't update".
  const familyMapFinalists = useMemo<FamilyMapFinalist[]>(
    () =>
      rankedCandidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        photoUrl: candidate.profile?.photoUrl ?? candidate.photoUrl ?? null,
        currentPosition: candidate.currentPosition ?? null,
        weightedScore: candidate.weightedScore,
        readiness: candidate.readiness ?? null,
      })),
    [rankedCandidates],
  );

  const compareCandidate = useMemo(() => {
    const options = rankedCandidates.filter(
      (candidate) => candidate.id !== selectedCandidate?.id,
    );
    return options[0] ?? null;
  }, [rankedCandidates, selectedCandidate?.id]);

  /**
   * Candidates that are in this run because somebody put them there, not
   * because they cleared the rules — keyed by candidate id.
   *
   * A full-pool re-scoring force-includes the base run's finalists and anyone
   * the user picked, walking past the grade range and the program's hard
   * filters. That used to leave no trace at all: the row was simply deleted
   * from `disqualified`, so a ranking that overrode "Disiplin: sanksi aktif"
   * looked exactly like one where nobody had. Absent on every other kind of run
   * and on runs finished before it was recorded.
   */
  const forceIncludedByCandidate = useMemo(() => {
    const rows =
      (
        selectedRun?.filterSummary as
          | {
              forceIncluded?: {
                candidateId: string;
                name: string;
                source: 'added' | 'base_finalist';
                reasons: string[];
                outsideEvaluatedPool: boolean;
              }[];
            }
          | null
          | undefined
      )?.forceIncluded ?? [];
    return new Map(rows.map((r) => [r.candidateId, r]));
  }, [selectedRun]);

  const filterSummary = useMemo(
    () => ({
      qualified:
        selectedRun?.filterSummary?.qualifiedCount ??
        rankedCandidates.filter(
          (candidate) => candidate.readiness !== "Not Ready",
        ).length,
      rejected:
        selectedRun?.filterSummary?.disqualifiedCount ??
        rankedCandidates.filter(
          (candidate) => candidate.readiness === "Not Ready",
        ).length,
      topScore: Math.max(
        ...rankedCandidates.map((candidate) =>
          isNaN(candidate.weightedScore) ? 0 : candidate.weightedScore,
        ),
        0,
      ),
    }),
    [rankedCandidates, selectedRun],
  );

  const displayedCandidates = rankedCandidates;

  // Group candidates by score and apply tie-order overrides so users can
  // manually reorder candidates that share a score.
  const orderedCandidates = useMemo(() => {
    const byScore = new Map<string, AnalysisCandidate[]>();
    for (const c of displayedCandidates) {
      const key = String(c.weightedScore);
      const arr = byScore.get(key) ?? [];
      arr.push(c);
      byScore.set(key, arr);
    }
    const ordered: AnalysisCandidate[] = [];
    for (const [scoreKey, group] of byScore) {
      const override = tieOrderOverrides[scoreKey];
      if (group.length <= 1) {
        ordered.push(...group);
        continue;
      }
      // For tied groups, use override if present, else fall back to original order
      const effectiveOrder =
        override && override.length > 0 ? override : group.map((c) => c.id);
      const groupMap = new Map(group.map((c) => [c.id, c]));
      const seen = new Set<string>();
      for (const id of effectiveOrder) {
        const c = groupMap.get(id);
        if (c && !seen.has(id)) {
          ordered.push(c);
          seen.add(id);
        }
      }
      // Append any leftover (e.g. new candidates not yet in override)
      for (const c of group) {
        if (!seen.has(c.id)) ordered.push(c);
      }
    }
    return ordered;
  }, [displayedCandidates, tieOrderOverrides]);

  // For each score, how many candidates share it?
  const tiedGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of displayedCandidates) {
      const key = String(c.weightedScore);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [displayedCandidates]);

  // For each tied score, the effective order of candidate IDs (default = original order)
  const effectiveTieOrder = useMemo(() => {
    const byScore = new Map<string, string[]>();
    for (const c of displayedCandidates) {
      const key = String(c.weightedScore);
      const arr = byScore.get(key) ?? [];
      arr.push(c.id);
      byScore.set(key, arr);
    }
    const result: Record<string, string[]> = {};
    for (const [scoreKey, group] of byScore) {
      if (group.length <= 1) continue;
      const override = tieOrderOverrides[scoreKey];
      result[scoreKey] = override && override.length > 0 ? override : group;
    }
    return result;
  }, [displayedCandidates, tieOrderOverrides]);

  // Succession pipeline: one lane per readiness tier (highest first), each
  // holding its candidates plus the score gap to the next-higher tier — the
  // actionable bit ("how far from Ready Now") that isn't shown elsewhere.
  const readinessPipeline = useMemo(() => {
    const thresholds = readinessConfig.thresholds; // descending by minScore
    const lanes = thresholds.map((t, i) => ({
      level: t.level,
      eta: t.eta,
      minScore: t.minScore,
      nextLevel: i > 0 ? thresholds[i - 1]!.level : null,
      nextMinScore: i > 0 ? thresholds[i - 1]!.minScore : null,
      candidates: [] as AnalysisCandidate[],
    }));
    const byLevel = new Map(lanes.map((l) => [l.level, l]));
    for (const c of orderedCandidates) {
      (byLevel.get(c.readiness) ?? lanes[lanes.length - 1])?.candidates.push(c);
    }
    return lanes;
  }, [orderedCandidates, readinessConfig]);

  return (
    <>
      {/* Picked successors (outside tabs, shown when picks exist) */}
      {picks.length > 0 && (
        <Card className="border-emerald-500/30">
          <CardHeader className="pb-3 border-b border-emerald-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-emerald-500" />
                <CardTitle className="text-base">Kandidat Terpilih</CardTitle>
                <Badge
                  variant="secondary"
                  className="text-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                >
                  {picks.length} total
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-[10px] border-emerald-400/40 text-emerald-700 dark:text-emerald-400"
                  onClick={() => {
                    const exportPicks = (picksByProgram.get(activePickProgram) ?? []).map((pick) => {
                      const candidate = rankedCandidates.find((c) => c.id === pick.candidateId);
                      const profile = profileMap.get(pick.candidateId) ?? null;
                      return { pick, candidate: candidate ?? null, profile };
                    });
                    exportPickedCandidatesHtml(
                      position,
                      exportPicks,
                      codeLabels[activePickProgram] ?? activePickProgram,
                    );
                  }}
                >
                  <Printer className="h-3 w-3" />
                  Cetak Kandidat
                </Button>
                <Tabs
                  value={activePickProgram}
                  onValueChange={setActivePickProgram}
                >
                <TabsList className="h-9">
                  {programList.map((code) => {
                    const count = picksByProgram.get(code)?.length ?? 0;
                    return (
                      <TabsTrigger
                        key={code}
                        value={code}
                        className="text-xs gap-1.5 px-3"
                      >
                        {codeLabels[code] ?? code}
                        <Badge
                          variant="secondary"
                          className="text-[10px] py-0 px-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0"
                        >
                          {count}
                        </Badge>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Tabs>
              </div>
            </div>
          </CardHeader>
          {activePickProgram && picksByProgram.has(activePickProgram) && (
            <div className="divide-y divide-emerald-500/10">
              {(picksByProgram.get(activePickProgram) ?? []).map(
                (pick, idx, arr) => {
                  const candidate = rankedCandidates.find(
                    (c) => c.id === pick.candidateId,
                  );
                  return (
                    <div
                      key={pick.id}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-emerald-500/5 transition-colors"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-sm font-bold">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">
                            {candidate?.name ?? pick.candidateName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {candidate?.currentPosition ??
                              profileMap.get(pick.candidateId)
                                ?.currentPosition ??
                              "-"}
                          </p>
                        </div>
                        {editingNotesPickId === pick.id ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Input
                              className="h-8 w-56 text-xs"
                              value={editingNotesText}
                              onChange={(e) =>
                                setEditingNotesText(e.target.value)
                              }
                              placeholder="Catatan..."
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  updatePickNotesAction(
                                    pick.id,
                                    editingNotesText,
                                  ).then(() => {
                                    setEditingNotesPickId(null);
                                    router.refresh();
                                  });
                                }
                                if (e.key === "Escape")
                                  setEditingNotesPickId(null);
                              }}
                            />
                            <Button
                              size="sm"
                              className="h-8 text-xs"
                              onClick={async () => {
                                await updatePickNotesAction(
                                  pick.id,
                                  editingNotesText,
                                );
                                setEditingNotesPickId(null);
                                router.refresh();
                              }}
                            >
                              Simpan
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs"
                              onClick={() => setEditingNotesPickId(null)}
                            >
                              Batal
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="group flex items-center gap-1 text-xs text-muted-foreground truncate italic max-w-[200px] text-left hover:text-foreground transition-colors"
                            onClick={() => {
                              setEditingNotesPickId(pick.id);
                              setEditingNotesText(pick.notes ?? "");
                            }}
                            title={
                              pick.notes
                                ? "Klik untuk mengedit catatan"
                                : "Klik untuk menambah catatan"
                            }
                          >
                            <Edit2 className="h-3 w-3 shrink-0 opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                            {pick.notes ? (
                              <span className="truncate">"{pick.notes}"</span>
                            ) : (
                              <span className="text-muted-foreground/50 italic group-hover:text-foreground/70">
                                + tambah catatan
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {pick.runId && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-sky-600"
                            onClick={() => handleViewRun(pick.runId)}
                            title="Lihat run asal"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          disabled={idx === 0 || reorderingPick}
                          onClick={() => handleReorderPick(pick.id, "up")}
                          title="Naikkan prioritas"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          disabled={idx === arr.length - 1 || reorderingPick}
                          onClick={() => handleReorderPick(pick.id, "down")}
                          title="Turunkan prioritas"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemovePick(pick.id)}
                          disabled={removingPickId === pick.id}
                          title="Hapus dari daftar"
                        >
                          {removingPickId === pick.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </Card>
      )}

      <AskAiProvider onNavigate={setActiveTab} currentTab={activeTab} enabled={AI_ASSISTANT_TAB_ENABLED}>
      <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="flex gap-6 items-start">
        <TabsList className="flex flex-col w-48 shrink-0 gap-1 rounded-xl border-2 border-slate-300/80 dark:border-slate-700 bg-card p-2 shadow-sm">
          <TabsTrigger
            value="candidates"
            className="w-full justify-start gap-3 rounded-lg border-l-4 border-transparent px-4 py-3 text-sm font-bold transition-all hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-950/40 dark:hover:text-sky-300 data-[state=active]:bg-sky-100 data-[state=active]:text-sky-800 dark:data-[state=active]:bg-sky-950/50 dark:data-[state=active]:text-sky-200"
          >
            <List className="h-4 w-4 shrink-0" />
            <span>Kandidat</span>
          </TabsTrigger>
          <TabsTrigger
            value="readiness"
            className="w-full justify-start gap-3 rounded-lg border-l-4 border-transparent px-4 py-3 text-sm font-bold transition-all hover:bg-emerald-100 hover:text-emerald-700 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-800 dark:data-[state=active]:bg-emerald-950/50 dark:data-[state=active]:text-emerald-200"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Readiness</span>
          </TabsTrigger>
          <TabsTrigger
            value="analisis-visual"
            className="w-full justify-start gap-3 rounded-lg border-l-4 border-transparent px-4 py-3 text-sm font-bold transition-all hover:bg-violet-100 hover:text-violet-700 dark:hover:bg-violet-950/40 dark:hover:text-violet-300 data-[state=active]:bg-violet-100 data-[state=active]:text-violet-800 dark:data-[state=active]:bg-violet-950/50 dark:data-[state=active]:text-violet-200"
          >
            <BarChart3 className="h-4 w-4 shrink-0" />
            <span>Analisis Visual</span>
          </TabsTrigger>
          <TabsTrigger
            value="komparasi"
            className="w-full justify-start gap-3 rounded-lg border-l-4 border-transparent px-4 py-3 text-sm font-bold transition-all hover:bg-fuchsia-100 hover:text-fuchsia-700 dark:hover:bg-fuchsia-950/40 dark:hover:text-fuchsia-300 data-[state=active]:bg-fuchsia-100 data-[state=active]:text-fuchsia-800 dark:data-[state=active]:bg-fuchsia-950/50 dark:data-[state=active]:text-fuchsia-200"
          >
            <Scale className="h-4 w-4 shrink-0" />
            <span>Komparasi</span>
          </TabsTrigger>
          {/* Hidden, not deleted — see AI_ASSISTANT_TAB_ENABLED. */}
          {AI_ASSISTANT_TAB_ENABLED && (
            <TabsTrigger
              value="ai-assistant"
              className="w-full justify-start gap-3 rounded-lg border-l-4 border-transparent px-4 py-3 text-sm font-bold transition-all hover:bg-pink-100 hover:text-pink-700 dark:hover:bg-pink-950/40 dark:hover:text-pink-300 data-[state=active]:bg-pink-100 data-[state=active]:text-pink-800 dark:data-[state=active]:bg-pink-950/50 dark:data-[state=active]:text-pink-200"
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              <span>AI Assistant</span>
            </TabsTrigger>
          )}

          <TabsTrigger
            value="job-family-map"
            className="w-full justify-start gap-3 rounded-lg border-l-4 border-transparent px-4 py-3 text-sm font-bold transition-all hover:bg-teal-100 hover:text-teal-700 dark:hover:bg-teal-950/40 dark:hover:text-teal-300 data-[state=active]:bg-teal-100 data-[state=active]:text-teal-800 dark:data-[state=active]:bg-teal-950/50 dark:data-[state=active]:text-teal-200"
          >
            <Network className="h-4 w-4 shrink-0" />
            <span>Peta Job Family</span>
          </TabsTrigger>
        
          {isAhpRun && selectedRunId && (
            <TabsTrigger
              value="konfigurasi-run"
              className="w-full justify-start gap-3 rounded-lg border-l-4 border-transparent px-4 py-3 text-sm font-bold transition-all hover:bg-indigo-100 hover:text-indigo-700 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300 data-[state=active]:bg-indigo-100 data-[state=active]:text-indigo-800 dark:data-[state=active]:bg-indigo-950/50 dark:data-[state=active]:text-indigo-200">
              <SlidersHorizontal className="h-4 w-4 shrink-0" />
              <span>Konfigurasi</span>
            </TabsTrigger>
          )}
          {/* Versions of this position's ranking compared 1:1, and the forum's
              decisions — right under Konfigurasi, because the question it
              answers ("what changed between these two runs, and why") is a
              question about configuration and data, read after the run's own
              configuration. It replaced the standalone comparison page and the
              decision card that used to sit above these tabs. Any position, any
              method: the navigator says which runs can be compared. */}
          <TabsTrigger
            value={RUN_COMPARE_TAB}
            className="w-full justify-start gap-3 rounded-lg border-l-4 border-transparent px-4 py-3 text-sm font-bold whitespace-normal text-left leading-tight transition-all hover:bg-cyan-100 hover:text-cyan-700 dark:hover:bg-cyan-950/40 dark:hover:text-cyan-300 data-[state=active]:bg-cyan-100 data-[state=active]:text-cyan-800 dark:data-[state=active]:bg-cyan-950/50 dark:data-[state=active]:text-cyan-200"
          >
            <GitCompare className="h-4 w-4 shrink-0" />
            <span>Komparasi Versi</span>
          </TabsTrigger>
        </TabsList>
        <div className="flex-1 min-w-0 space-y-4">

        {/* ── Kandidat ─────────────────────────────────────────── */}
        <TabsContent value="candidates" className="space-y-6">
          {/* L-3: what this run is relative to its lineage — before its ranking. */}
          {selectedRunId && <DerivedRunBanner runId={selectedRunId} positionId={position.id} />}
          {/* Breakdown chips become clickable only for AHP+TOPSIS runs — those
              are the only ones with a per-criterion analysis to show. */}
          <AhpCriterionPopupProvider runId={isAhpRun ? selectedRunId : null}>
          {/* Summary cards */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-sky-200/60 dark:border-sky-900/50 p-4 bg-linear-to-br from-sky-500/8 to-card">
              <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 dark:text-sky-300">
                Kandidat
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                {rankedCandidates.length}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Total dari run terpilih
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200/60 dark:border-emerald-900/50 p-4 bg-linear-to-br from-emerald-500/8 to-card">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                Lolos
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {filterSummary.qualified}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Kandidat qualified
              </p>
            </div>
            <div className="rounded-xl border border-rose-200/60 dark:border-rose-900/50 p-4 bg-linear-to-br from-rose-500/8 to-card">
              <p className="text-[10px] font-bold uppercase tracking-widest text-rose-700 dark:text-rose-300">
                Tidak Lolos
              </p>
              <p className="mt-1 text-2xl font-bold text-rose-600 dark:text-rose-400">
                {filterSummary.rejected}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Gagal primary filter
              </p>
            </div>
            <div className="rounded-xl border border-amber-200/60 dark:border-amber-900/50 p-4 bg-linear-to-br from-amber-500/8 to-card">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                Skor Tertinggi
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                {filterSummary.topScore}%
              </p>
              <p className="text-[11px] text-muted-foreground">
                Weighted core score
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {rankedCandidates.length} kandidat diranking · klik kanan untuk ekspor
            </p>
            {/* orderedCandidates, not rankedCandidates: the rows below apply the
                manual tie order, and the file must list them in that order. */}
            <ExportButtons
              position={position}
              rankedCandidates={orderedCandidates}
              selectedCandidate={selectedCandidate}
              filterSummary={filterSummary}
              method={selectedRun?.method ?? null}
              exclusions={exportExclusions}
            />
          </div>

          {/* Which business unit(s) this run's candidates come from */}
          {businessUnitsInRun.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                <Building2 className="h-3.5 w-3.5" />
                {isCrossTenantRun
                  ? "Kandidat lintas unit bisnis:"
                  : "Unit bisnis kandidat:"}
              </span>
              {businessUnitsInRun.map((bu) => {
                const count = rankedCandidates.filter(
                  (c) => candidateBusinessUnits[c.id] === bu,
                ).length;
                return (
                  <Badge
                    key={bu}
                    variant="outline"
                    className="border-primary/30 bg-background text-[10px] font-semibold text-primary"
                  >
                    {bu} · {count}
                  </Badge>
                );
              })}
            </div>
          )}

          {/* Exclusions on this run — marks only, nothing is re-ranked */}
          {selectedRunId && (
            <ExclusionSummaryBar
              exclusions={exclusions}
              candidateNames={Object.fromEntries(
                rankedCandidates.map((c) => [c.id, c.name]),
              )}
              onUndo={(candidateId) => {
                const c = rankedCandidates.find((x) => x.id === candidateId);
                setExcludeTarget({ id: candidateId, name: c?.name ?? '' });
              }}
            />
          )}

          {/* Candidate list */}
          {displayedCandidates.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Belum ada kandidat untuk run ini. Jalankan scoring terlebih
                dahulu.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {orderedCandidates.map((candidate, idx) => {
                const scoreKey = String(candidate.weightedScore);
                const tiedCount = tiedGroups.get(scoreKey) ?? 0;
                const isTied = tiedCount > 1;
                const effectiveOrder = effectiveTieOrder[scoreKey] ?? [];
                const orderInGroup = effectiveOrder.indexOf(candidate.id);
                const isFirstInGroup = isTied && orderInGroup === 0;
                const isLastInGroup =
                  isTied && orderInGroup === effectiveOrder.length - 1;
                const exclusion = exclusionByCandidate.get(candidate.id) ?? null;
                // Written by the AHP+TOPSIS engine into the row's details blob.
                // Absent on every run finished before appended below-cut rows
                // existed, hence every read is optional.
                const ahpMeta = (
                  candidate as {
                    ahpTopsis?: {
                      poolRank?: number;
                      poolSize?: number;
                      finalistCut?: number;
                      manuallyAdded?: boolean;
                      belowFinalistCut?: boolean;
                      /** "Tambah Kandidat Pembanding" child rows only. */
                      rerunSource?: 'new' | 'existing_pool' | 'carried' | null;
                      rerunAnchorsSource?: 'parent' | 'live_fallback' | null;
                    };
                  }
                ).ahpTopsis;
                const forced = forceIncludedByCandidate.get(candidate.id) ?? null;
                return (
                  <div
                    key={candidate.id}
                    className={cn(
                      "rounded-xl border shadow-xs overflow-hidden",
                      exclusion
                        ? excludedRowTone
                        : "border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-950",
                    )}
                  >
                    {/* Header row */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200/60 dark:border-slate-800">
                      {/* Rank against the whole scored pool, not the row index.
                          A candidate somebody added by name is persisted even
                          when they land below the finalist cut, and numbering
                          them by position would turn "23rd of 24" into "#12". */}
                      <span className="text-[11px] font-mono font-bold text-slate-400 w-7 shrink-0">
                        #{displayRank(candidate, idx)}
                      </span>
                      {ahpMeta?.rerunSource === 'new' && (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 cursor-help">
                              <UserPlus className="h-3 w-3" />
                              Baru dinilai
                              {ahpMeta.belowFinalistCut && ` · di luar ${ahpMeta.finalistCut ?? ''} besar`}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-72">
                              Kandidat pembanding yang belum ada di pool run induk. Hanya keenam
                              aspek kandidat seperti ini yang dihitung di run ini; kandidat lain
                              memakai nilai run induk apa adanya.
                              {ahpMeta.poolRank != null && ahpMeta.poolSize != null && (
                                <> Hasilnya: peringkat {ahpMeta.poolRank} dari {ahpMeta.poolSize}.</>
                              )}
                              {ahpMeta.belowFinalistCut &&
                                ' Ia berada di luar batas finalis; baris ini ada untuk menjawab penempatannya.'}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {ahpMeta?.rerunSource === 'existing_pool' && (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/50 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300 cursor-help">
                              <UserPlus className="h-3 w-3" />
                              Sudah di pool induk
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-72">
                              Diminta sebagai pembanding, tetapi sudah dinilai di run induk (di luar
                              finalisnya). Tidak dinilai ulang — keenam aspeknya diambil dari run
                              induk — dan ditampilkan dengan peringkat pool penuhnya
                              {ahpMeta.poolRank != null && ahpMeta.poolSize != null
                                ? ` (${ahpMeta.poolRank} dari ${ahpMeta.poolSize})`
                                : ''}
                              .
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {ahpMeta?.rerunSource === 'new' && ahpMeta.rerunAnchorsSource === 'live_fallback' && (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 cursor-help">
                              <AlertTriangle className="h-3 w-3" />
                              Jangkar live
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-72">
                              Run induk tidak menyimpan jangkar kalibrasi, jadi kandidat ini
                              direntangkan ke skala yang dihitung saat run ini dibuat. Skala itu
                              bisa sedikit berbeda dari skala kandidat lama; nilainya tercatat
                              di Konfigurasi Run.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {ahpMeta?.manuallyAdded && !ahpMeta.rerunSource && (
                        <Tooltip>
                          <TooltipTrigger>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold cursor-help",
                                ahpMeta.belowFinalistCut
                                  ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300",
                              )}
                            >
                              <UserPlus className="h-3 w-3" />
                              {ahpMeta.belowFinalistCut
                                ? `Ditambahkan · di luar ${ahpMeta.finalistCut ?? ''} besar`.trim()
                                : 'Ditambahkan'}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-72">
                              Kandidat ini disertakan atas permintaan eksplisit, lalu dinilai
                              bersama seluruh pool.
                              {ahpMeta.poolRank != null && ahpMeta.poolSize != null && (
                                <> Hasilnya: peringkat {ahpMeta.poolRank} dari {ahpMeta.poolSize} kandidat yang dinilai.</>
                              )}
                              {ahpMeta.belowFinalistCut
                                ? ' Ia berada di luar batas finalis, jadi baris ini ada untuk menjawab penempatannya — bukan karena ia masuk daftar suksesor.'
                                : ' Ia masuk daftar finalis atas skornya sendiri.'}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {forced && forced.reasons.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/50 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300 cursor-help">
                              <Ban className="h-3 w-3" />
                              Force-include
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-72">
                              Kandidat ini gagal aturan run induk tetapi tetap disertakan{' '}
                              {forced.source === 'added'
                                ? 'karena dipilih sebagai kandidat pembanding'
                                : 'karena sudah menjadi finalis run dasar'}
                              . Aturan yang dilanggar: {forced.reasons.join('; ')}.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {forced && forced.reasons.length === 0 && forced.outsideEvaluatedPool && (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="inline-flex items-center gap-1 rounded-md border border-slate-400/50 bg-slate-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 cursor-help">
                              <UserPlus className="h-3 w-3" />
                              Di luar populasi
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-72">
                              Kandidat ini tidak termasuk populasi yang dievaluasi run ini (di luar
                              rentang level atau business unit-nya), jadi tidak ada keputusan filter
                              untuknya. Ia masuk karena{' '}
                              {forced.source === 'added'
                                ? 'dipilih manual'
                                : 'merupakan finalis run dasar'}
                              .
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {exclusion && (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="inline-flex items-center gap-1 rounded-md border border-slate-300/70 dark:border-slate-700 bg-slate-200/60 dark:bg-slate-800/60 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 cursor-help">
                              <Ban className="h-3 w-3" />
                              Ditandai dikecualikan (tidak memengaruhi angka)
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-64">
                              Penandaan forum, bukan kategori filter &ldquo;di luar rentang grade&rdquo;.{" "}
                              {exclusionReasonLabel(exclusion.reason)}
                              {exclusion.note ? ` — ${exclusion.note}` : ''}
                              {exclusion.excludedByName
                                ? ` (oleh ${exclusion.excludedByName})`
                                : ''}
                              . Peringkat dan skor run ini tidak diubah.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {isTied && (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/60 dark:border-amber-700/50 bg-amber-50/80 dark:bg-amber-950/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 cursor-help">
                              <Equal className="h-3 w-3" />
                              Tied
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{`${tiedCount} kandidat memiliki skor yang sama. Gunakan tombol ↑/↓ untuk mengubah urutan dalam kelompok ini.`}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <div className="h-8 w-8 shrink-0 rounded-full bg-muted">
                        {candidate.profile?.photoUrl && (
                          <img
                            src={candidate.profile?.photoUrl}
                            alt={candidate.name}
                            className="h-full w-full rounded-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.remove();
                            }}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => openInDossier(candidate.id)}
                          className="group flex items-center gap-1 text-left"
                          title="Lihat diagnostic dossier kandidat"
                        >
                          <span
                            className={cn(
                              "text-sm font-semibold group-hover:text-primary underline truncate",
                              exclusion
                                ? "text-slate-500 dark:text-slate-400 line-through decoration-slate-400"
                                : "text-slate-900 dark:text-slate-100",
                            )}
                          >
                            {candidate.name}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                        </button>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                          {isCrossTenantRun && candidateBusinessUnits[candidate.id] && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-px text-[9px] font-semibold text-primary">
                              <Building2 className="h-2.5 w-2.5" />
                              {candidateBusinessUnits[candidate.id]}
                            </span>
                          )}
                          <span className="truncate">{candidate.currentPosition}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {picks.some((p) => p.candidateId === candidate.id) && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] py-0 px-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                          >
                            <UserCheck className="h-2.5 w-2.5 mr-0.5" />
                            Dipilih
                          </Badge>
                        )}
                        {incumbentCandidateIds.has(candidate.id) ? (
                          <span
                            className="inline-flex h-7 items-center rounded-md border border-slate-300/70 px-2 text-[10px] text-muted-foreground"
                            title="Kandidat ini kini memegang posisi target, sehingga tidak dapat dipilih sebagai suksesornya sendiri."
                          >
                            Pejabat posisi ini
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-[10px] border-emerald-400/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                            onClick={() => openPickDialog(candidate)}
                          >
                            <UserCheck className="h-3 w-3" />
                            Pilih Kandidat
                          </Button>
                        )}
                        {selectedRunId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className={cn(
                              "h-7 gap-1 text-[10px]",
                              exclusion
                                ? "text-slate-600 dark:text-slate-300"
                                : "text-muted-foreground hover:text-rose-600",
                            )}
                            onClick={() =>
                              setExcludeTarget({
                                id: candidate.id,
                                name: candidate.name,
                              })
                            }
                            title={
                              exclusion
                                ? 'Batalkan tanda dikecualikan. Skor dan peringkat run tidak pernah berubah.'
                                : 'Tandai dikecualikan (tidak memengaruhi angka): skor, peringkat, dan snapshot run ini tidak berubah, dan tidak ada run baru yang dibuat.'
                            }
                          >
                            {exclusion ? (
                              <>
                                <Undo2 className="h-3 w-3" />
                                Batalkan tanda
                              </>
                            ) : (
                              <>
                                <Ban className="h-3 w-3" />
                                Tandai dikecualikan
                              </>
                            )}
                          </Button>
                        )}
                        {isTied && (
                          <div className="flex flex-col -space-y-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 text-muted-foreground hover:text-foreground"
                              disabled={isFirstInGroup}
                              onClick={() =>
                                moveTiedCandidate(scoreKey, candidate.id, "up")
                              }
                            >
                              <ArrowUp className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 text-muted-foreground hover:text-foreground"
                              disabled={isLastInGroup}
                              onClick={() =>
                                moveTiedCandidate(
                                  scoreKey,
                                  candidate.id,
                                  "down",
                                )
                              }
                            >
                              <ArrowDown className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground font-medium">
                            Score
                          </p>
                          <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                            {candidate.weightedScore}%
                          </p>
                        </div>
                        <Badge
                          className={`text-[10px] font-bold py-0.5 px-2 ${readinessTone[candidate.readiness]}`}
                          variant="secondary"
                        >
                          {candidate.readiness}
                        </Badge>
                      </div>
                    </div>

                    {/* Body */}
                    <div className="px-4 py-3 space-y-3">
                      {/* Score breakdown chips — clickable on AHP+TOPSIS runs,
                          each opening that criterion's readiness analysis.

                          Ordered by THIS run's own recorded weights, heaviest
                          first (lib/criterion-weight-order.ts), so the first
                          chip is the criterion that actually moved the ranking.
                          A fixed order put a 5%-weight criterion in the same
                          position as a 35% one on every run alike. The weights
                          come from what the run stored, never from governance
                          as it stands today — a finished ranking's badges must
                          not re-order when somebody edits the matrix. */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="text-[10px] text-muted-foreground font-medium mr-1"
                          title={
                            criterionOrder.source === "unknown"
                              ? criterionOrder.note
                              : `Urut bobot tertinggi → terendah. ${criterionOrder.note}`
                          }
                        >
                          Breakdown:
                        </span>
                        {criterionOrder.order.map((key) => {
                          // A row with no career value (a legacy run) shows
                          // no chip rather than a zero.
                          if (key === "career" && candidate.scoreBreakdown.career == null) {
                            return null;
                          }
                          const chip = CRITERION_CHIPS[key];
                          const value =
                            key === "hav"
                              ? runHavText(candidate, { withHash: true })
                              : (candidate.scoreBreakdown[key] ?? 0);
                          return (
                            <BreakdownChip
                              key={key}
                              candidateId={candidate.id}
                              name={candidate.name}
                              criterion={key}
                              tone={chip.tone}
                              weightHint={criterionWeightHint(criterionOrder, key)}
                            >
                              {chip.label} {value}
                            </BreakdownChip>
                          );
                        })}
                      </div>

                      {/* Insight / Constraint — hero element */}
                      <div className="rounded-lg border border-amber-200/50 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/15 px-3.5 py-2.5">
                        <div className="flex gap-2">
                          <span className="text-sm leading-none mt-0.5 shrink-0">
                            <LightbulbIcon
                              weight="duotone"
                              className="text-primary"
                            />
                          </span>
                          <div>
                            <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
                              Insight
                            </p>
                            <p className="mt-0.5 text-sm leading-snug text-slate-700 dark:text-slate-300">
                              {candidate.constraint}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </AhpCriterionPopupProvider>
        </TabsContent>

        {/* ── Readiness ────────────────────────────────────────── */}
        <TabsContent value="readiness" className="space-y-6">
          {/* Succession pipeline — candidates grouped by readiness tier, each
              with the score gap to the next tier. Click a name to open its dossier. */}
          <Card className="border-sky-200/70 dark:border-sky-900/60 shadow-xs">
            <CardHeader className="pb-4 border-b border-sky-200/60 dark:border-sky-900/50">
              <CardTitle className="flex items-center gap-1.5 text-base font-semibold">
                Pipeline Kesiapan Suksesi
                <InfoHint title="Pipeline Kesiapan Suksesi">
                  Kandidat dikelompokkan per tingkat kesiapan. Tanda{" "}
                  <span className="font-semibold text-amber-600 dark:text-amber-400">+N %</span>{" "}
                  menunjukkan tambahan skor yang dibutuhkan untuk naik ke tingkat berikutnya. Klik nama untuk membuka dossier.
                </InfoHint>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {displayedCandidates.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Belum ada kandidat untuk run ini.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {readinessPipeline.map((lane) => (
                    <div
                      key={lane.level}
                      className={`flex flex-col rounded-xl border ${readinessRowTone[lane.level] ?? "border-slate-200 bg-card"} p-3`}
                    >
                      <div className="flex items-center justify-between">
                        <Badge
                          className={`${readinessTone[lane.level] ?? ""} border-0`}
                          variant="secondary"
                        >
                          {lane.level}
                        </Badge>
                        <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {lane.candidates.length}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                        {lane.eta}
                      </p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className={`h-full rounded-full bg-linear-to-r ${readinessBarTone[lane.level] ?? "from-slate-300 to-slate-400"}`}
                          style={{
                            width: `${displayedCandidates.length ? (lane.candidates.length / displayedCandidates.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <div className="mt-3 space-y-1.5">
                        {lane.candidates.length === 0 ? (
                          <p className="py-3 text-center text-[11px] italic text-muted-foreground/60">
                            Tidak ada kandidat
                          </p>
                        ) : (
                          lane.candidates.map((c) => {
                            const gap =
                              lane.nextMinScore != null
                                ? Math.max(0, lane.nextMinScore - c.weightedScore)
                                : null;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => openInDossier(c.id)}
                                className="group w-full rounded-lg border border-transparent bg-white/70 dark:bg-slate-950/40 px-2.5 py-1.5 text-left transition-colors hover:border-primary/30 hover:bg-white dark:hover:bg-slate-900"
                                title="Lihat diagnostic dossier kandidat"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-primary">
                                    {c.name}
                                  </span>
                                  <span className="shrink-0 text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">
                                    {c.weightedScore}%
                                  </span>
                                </div>
                                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                  {lane.nextLevel ? (
                                    <>
                                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                                        +{gap}%
                                      </span>{" "}
                                      menuju {lane.nextLevel}
                                    </>
                                  ) : (
                                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                      Tingkat kesiapan tertinggi
                                    </span>
                                  )}
                                </p>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Threshold reference */}
          <Card className="border-sky-200/70 dark:border-sky-900/60 shadow-xs">
            <CardHeader className="pb-3 border-b border-sky-200/60 dark:border-sky-900/50">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-sky-700 dark:text-sky-300">
                Threshold Level
                <InfoHint title="Threshold Level">Ambang batas readiness berdasarkan weighted score.</InfoHint>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3 grid gap-2 sm:grid-cols-2">
              {readinessConfig.thresholds.map((t, idx) => {
                const prev = idx > 0 ? readinessConfig.thresholds[idx - 1] : null;
                const range = idx === 0
                  ? `>= ${t.minScore}%`
                  : t.minScore <= 0
                    ? `< ${prev!.minScore}%`
                    : `${t.minScore}% - ${prev!.minScore - 1}%`;
                return (
                  <div
                    key={t.level}
                    className={`rounded-lg border ${readinessRowTone[t.level] ?? 'border-slate-200 bg-card'} p-3`}
                  >
                    <div className="flex items-center justify-between">
                      <Badge
                        className={`${readinessTone[t.level] ?? ''} border-0`}
                        variant="secondary"
                      >
                        {t.level}
                      </Badge>
                      <span className="text-xs font-semibold text-slate-500">
                        {range}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.description}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Where this ranking sits in its lineage. Renders nothing for a
              baseline run — but nobody should study a DERIVED ranking without
              being told, on the same screen, that it is one and of what. */}
          <RunAncestry path={ancestryPath} siblings={ancestrySiblings} onSelect={selectRunById} />

          {/* Before/after of an exclusion re-rank. Renders nothing on any other
              kind of run — TOPSIS only reshuffles when the alternative set does. */}
          {isAhpRun && selectedRunId && <RankShiftPanel runId={selectedRunId} positionId={position.id} />}

          {/* Per-candidate AHP+TOPSIS breakdown. AHP+TOPSIS runs only. */}
          {isAhpRun && selectedRunId && <RunCandidateAnalysis runId={selectedRunId} />}

          {/* FR-SN-06: the TOPSIS line by line for one candidate, replayed from
              what the run stored — the same table the comparison page uses. */}
          {isAhpRun && selectedRunId && <RunTopsisBreakdownCard runId={selectedRunId} />}
        </TabsContent>

        {/* ── Komparasi Versi ──────────────────────────────────── */}
        <TabsContent value={RUN_COMPARE_TAB}>
          <RunCompareWorkspace
            positionId={position.id}
            positionTitle={position.title}
            tree={runTree}
            openRunId={selectedRunId}
            pair={comparePair ?? localPair}
            onPairChange={onComparePairChange ?? setLocalPair}
            programLabels={programLabels}
            decisionsRefreshKey={picks.map((p) => `${p.id}:${p.updatedAt}`).join("|")}
          />
        </TabsContent>

        {/* ── Analisis Visual ──────────────────────────────────── */}
        <TabsContent value="analisis-visual" className="space-y-4">
          {rankedCandidates.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Belum ada hasil scoring untuk posisi ini. Jalankan scoring atau
                pilih run lain dari riwayat posisi.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-primary/20 bg-linear-to-br from-primary/10 via-card to-card p-4 shadow-sm">
                  <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-primary/80">
                    Sumber
                  </p>
                  <p className="mt-1 text-sm font-extrabold text-slate-950 dark:text-slate-50 truncate">
                    {position.title}
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-2 text-[10px] font-bold"
                  >
                    {selectedRun?.method ?? "Latest"}
                  </Badge>
                </div>
                <div className="rounded-lg border border-slate-200/80 bg-card/90 p-4 shadow-sm dark:border-slate-800">
                  <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-slate-400 dark:text-slate-500">
                    Shortlist
                  </p>
                  <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {rankedCandidates.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {filterSummary.qualified} kandidat lolos
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-sm">
                  <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-emerald-700 dark:text-emerald-300">
                    Top Successor
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {rankedCandidates[0]?.name ?? "-"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Score {rankedCandidates[0]?.weightedScore ?? 0}%
                  </p>
                </div>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 shadow-sm">
                  <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-amber-700 dark:text-amber-300">
                    Filter
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {filterSummary.rejected} tidak lolos
                  </p>
                  <p className="text-xs text-slate-500">
                    Skor tertinggi {filterSummary.topScore}%
                  </p>
                </div>
              </div>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)] items-start">
                {/* Graph stays pinned in view while the (long) dossier scrolls beside it. */}
                <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-8.5rem)]">
                  <TalentNetworkMap
                    rankedCandidates={rankedCandidates}
                    selectedCandidate={selectedCandidate}
                    compareCandidate={compareCandidate}
                    selectedPosition={position}
                    onSelectCandidate={setSelectedCandidateId}
                  />
                </div>
                <DiagnosticDossier
                  selectedCandidate={selectedCandidate}
                  rankedCandidates={rankedCandidates}
                  selectedPosition={position}
                />
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Komparasi ────────────────────────────────────────── */}
        <TabsContent value="komparasi">
          {rankedCandidates.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Belum ada hasil scoring. Jalankan scoring atau pilih run lain.
              </CardContent>
            </Card>
          ) : (
            <MultiComparison
              rankedCandidates={rankedCandidates}
              compareIds={compareIds}
              setCompareIds={setCompareIds}
              incumbent={incumbent}
            />
          )}
        </TabsContent>

        {/* ── AI Assistant (hidden — AI_ASSISTANT_TAB_ENABLED) ─────── */}
        {AI_ASSISTANT_TAB_ENABLED && (
          <TabsContent value="ai-assistant">
            <ChatbotPanel
              rankedCandidates={rankedCandidates}
              selectedCandidate={selectedCandidate}
              selectedPosition={position}
              runId={selectedRunId}
              run={selectedRun}
              businessUnits={businessUnitsInRun}
            />
          </TabsContent>
        )}

        {/* ── Konfigurasi Run (AHP+TOPSIS saja) ────────────────── */}
        {isAhpRun && selectedRunId && (
          <TabsContent value="konfigurasi-run" className="space-y-4">
            {/* One hierarchy: the run's configuration and its snapshot (L-5,
                FR-SN-01, every item with its origin) used to be two stacked
                panels repeating each other; RunConfigurationPanel now places
                each snapshot item in the section it belongs to. */}
            <RunConfigurationPanel runId={selectedRunId} />
          </TabsContent>
        )}

        {/* ── Peta Job Family ──────────────────────────────────── */}
        <TabsContent value="job-family-map" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Network className="h-4 w-4 text-teal-500 shrink-0" />
                Peta Job Family — finalis vs posisi target
                <InfoHint title="Peta Job Family">
                  Seluruh {familyMapFinalists.length} kandidat run ini diletakkan pada peta job family
                  sesuai job profile posisi mereka saat ini, relatif terhadap job profile{" "}
                  <strong>{position.title}</strong>. Arahkan kursor ke foto kandidat untuk melihat
                  jaraknya ke posisi target.
                </InfoHint>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {familyMapFinalists.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Belum ada kandidat pada run ini.
                </p>
              ) : (
                <JobFamilyPositionMap
                  positionId={position.id}
                  positionTitle={position.title}
                  finalists={familyMapFinalists}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        </div>
      </Tabs>
      </AskAiProvider>

      {/* ── Pick Successor Dialog ─── */}
      <Dialog
        open={!!pickCandidate}
        onOpenChange={() => setPickCandidate(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <UserCheck className="h-5 w-5 text-emerald-500 shrink-0" />
              Tetapkan sebagai Suksesor
            </DialogTitle>
            <DialogDescription className="text-xs">
              Keputusan forum untuk <strong>{pickCandidate?.name}</strong>, merujuk run yang sedang
              dibuka. Justifikasi wajib diisi; ia tersimpan bersama keputusan dan tampil di riwayat
              posisi berdampingan dengan rekomendasi sistem.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Program</Label>
              <Select value={pickProgram} onValueChange={setPickProgram}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih program..." />
                </SelectTrigger>
                <SelectContent>
                  {programOptions.map((code) => {
                    const count = picksByProgram.get(code)?.length ?? 0;
                    return (
                      <SelectItem key={code} value={code}>
                        <span className="flex items-center justify-between gap-2 w-full">
                          <span>{codeLabels[code] ?? code}</span>
                          {count > 0 && (
                            <Badge
                              variant="secondary"
                              className="text-[9px] py-0 px-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            >
                              {count} dipilih
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                  {programOptions.length === 0 && (
                    <SelectItem value="__none__" disabled>
                      Tidak ada program tersedia
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs" htmlFor="pick-justification">
                Justifikasi keputusan (wajib)
              </Label>
              <Textarea
                id="pick-justification"
                value={pickNotes}
                onChange={(e) => setPickNotes(e.target.value)}
                placeholder="Mengapa forum memilih kandidat ini — terutama bila ia bukan peringkat 1 run ini."
                rows={4}
                maxLength={PICK_JUSTIFICATION_MAX}
                className="text-sm"
                aria-required
              />
              <p className="text-right text-[10px] text-muted-foreground">
                {pickNotes.length}/{PICK_JUSTIFICATION_MAX}
              </p>
            </div>
            {pickCandidate && exclusionByCandidate.get(pickCandidate.id) && (
              <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
                <p className="font-semibold text-amber-800 dark:text-amber-200">
                  Kandidat ini ditandai dikecualikan pada run ini
                </p>
                <p className="text-amber-900 dark:text-amber-100">
                  Alasan: {exclusionReasonLabel(exclusionByCandidate.get(pickCandidate.id)!.reason)}
                  {exclusionByCandidate.get(pickCandidate.id)!.note
                    ? ` — ${exclusionByCandidate.get(pickCandidate.id)!.note}`
                    : ""}
                  .
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-primary"
                    checked={pickExcludedConfirmed}
                    onChange={(e) => setPickExcludedConfirmed(e.target.checked)}
                  />
                  <span>Saya tetap menetapkan kandidat yang ditandai ini sebagai suksesor.</span>
                </label>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPickCandidate(null)}
              className="h-9 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handlePickSave}
              disabled={
                savingPick ||
                !pickProgram ||
                !pickNotes.trim() ||
                (pickCandidate != null &&
                  exclusionByCandidate.has(pickCandidate.id) &&
                  !pickExcludedConfirmed)
              }
              title={!pickNotes.trim() ? "Isi justifikasi keputusan terlebih dahulu." : undefined}
              className="h-9 text-xs"
            >
              {savingPick ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedRunId && (
        <ExcludeCandidateDialog
          open={Boolean(excludeTarget)}
          onOpenChange={(open) => {
            if (!open) setExcludeTarget(null);
          }}
          runId={selectedRunId}
          candidate={excludeTarget}
          existing={
            excludeTarget ? (exclusionByCandidate.get(excludeTarget.id) ?? null) : null
          }
          onDone={() => {
            setExcludeTarget(null);
            onExclusionsChanged?.();
            router.refresh();
          }}
        />
      )}
    </>
  );
}
