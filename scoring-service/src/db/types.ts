// Shared row types matching the Next.js app's Drizzle schema
// (lib/db/schema.ts). Kept manually in sync.

export type ReadinessLevel = "Short" | "Medium" | "Long" | "Not Ready";

export type TournamentSession = {
  id: string;
  tenantId: string;
  positionId: string;
  programTemplateId: string | null;
  label: string | null;
  targetFinalists: number;
  currentPool: string[];
  pendingPool: string[];
  scoringMethod: string;
  /** Demo session (drizzle/0093): candidates are scored as their demo copy. */
  isDemo?: boolean;
  status: "running" | "finalizing" | "completed" | "failed";
  finalRanked: unknown;
  runId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ScoringRun = {
  id: string;
  positionId: string;
  tenantId: string;
  programTemplateId: string | null;
  method: string;
  program: string | null;
  label: string | null;
  status: string;
  candidateCount: number;
  filterSummary: unknown;
  createdBy: string;
  createdAt: Date;
  completedAt: Date | null;
};
