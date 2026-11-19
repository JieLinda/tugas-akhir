// Shared loaders for the AHP+TOPSIS engine: the target position row, the
// session row, readiness bands and the HAV quadrant → score rule.
//
// This file used to hold the LLM "AI Tournament" engine (aspect subagents,
// replace-worst stages, the justification agent, finalize for method 'LLM').
// That scoring method was removed: AHP+TOPSIS is the only method, a session
// carrying any other `scoring_method` is refused by the runner, and the
// tournament's prompts (aspect_subagent_*, justification_agent) are gone from
// lib/scoring-prompts.json. What stayed is what ahp-topsis-engine.ts, runner.ts
// and routes.ts import.

import { readFileSync } from "node:fs";
import { resolveSharedConfigPath } from "./shared-config-path.js";
import { log } from "./llm.js";
import { query, queryOne } from "./db/postgres.js";
import type { TournamentSession } from "./db/types.js";

// ─── Types ────────────────────────────────────────────────────────

export type PositionRow = {
  id: string;
  title: string;
  department: string | null;
  division: string | null;
  education: string | null;
  experience: string | null;
  jobFamily: string | null;
  requiredCompetencies: any;
  holderEmployeeId: string | null;
  holderName: string | null;
  // Populated from the matched job profile (sync_job_profiles): the role
  // context the insight writer is handed.
  jobPurpose?: string | null;
  responsibilities?: string[];
};

// ─── Readiness ────────────────────────────────────────────────────

let _readinessCache: { thresholds: { minScore: number; level: string }[]; defaultLevel: string } | null = null;

function loadReadinessConfig() {
  if (_readinessCache) return _readinessCache;
  // Same multi-layout resolution as the prompts file — the old ../../lib path
  // never existed inside the Docker image, so every containerized run silently
  // used the inline fallback thresholds instead of the tenant's config.
  const path = resolveSharedConfigPath("readiness-config.json", process.env.READINESS_CONFIG_PATH);
  try {
    if (!path) throw new Error("readiness-config.json not found");
    const raw = readFileSync(path, "utf-8");
    _readinessCache = JSON.parse(raw);
  } catch {
    _readinessCache = {
      thresholds: [{ minScore: 80, level: "Short" }, { minScore: 65, level: "Medium" }, { minScore: 50, level: "Long" }],
      defaultLevel: "Not Ready",
    };
  }
  return _readinessCache;
}

export function reloadReadinessConfig() {
  _readinessCache = null;
  loadReadinessConfig();
  console.log(`[Readiness] Config reloaded`);
}

export function determineReadiness(score: number) {
  const config = loadReadinessConfig()!;
  for (const t of config.thresholds) {
    if (score >= t.minScore) return t.level;
  }
  return config.defaultLevel;
}

// ─── Data loaders ────────────────────────────────────────────────

export async function loadPositionRow(positionId: string): Promise<PositionRow> {
  const row = await queryOne<PositionRow>(
    `SELECT id, title, department, division, education, experience,
            job_family as "jobFamily", required_competencies as "requiredCompetencies",
            holder_employee_id as "holderEmployeeId", holder_name as "holderName"
     FROM critical_positions
     WHERE id = $1
     LIMIT 1`,
    [positionId]
  );
  if (!row) throw new Error("Posisi sasaran tidak ditemukan.");
  const profile = await findJobProfileForPosition(row.title, positionId).catch(() => null);
  row.jobPurpose = profile?.jobPurpose ?? null;
  row.responsibilities = profile?.responsibilities ?? [];
  return row;
}

function normalizeJobProfileTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The job profile id already paired with a position via the Job Family
 * sync mapping (job_family_matches), resolved by the INCUMBENT first and the
 * linked position second:
 *   1. incumbent — critical_positions.holder_employee_id → candidates →
 *      job_family_matches.candidate_id → job_profile_id.
 *   2. position  — critical_positions.position_id → positions.position_id →
 *      job_family_matches.position_id → job_profile_id.
 * A soft-deleted candidate is PREFERRED AGAINST, not excluded: the incumbent is
 * the person an admin most often removes from the Kandidat page (they are barred
 * from their own succession pool by design), and dropping their row would strip
 * the TARGET POSITION of its Job Family pairing — shifting the technical and
 * career inputs of every candidate in the run. Both UNION branches therefore
 * expose the same liveness flag and `dead ASC` only breaks ties, so a live row
 * always wins but the pairing still resolves when only a tombstone carries it.
 * Returns null when the position has no matched profile (or the table isn't
 * migrated yet).
 */
export async function findMatchedJobProfileId(
  targetPositionId: string
): Promise<number | null> {
  try {
    const row = await queryOne<{ jobProfileId: number }>(
      `SELECT job_profile_id AS "jobProfileId" FROM (
         SELECT jfm.job_profile_id, 1 AS prio,
                (c.deleted_at IS NOT NULL)::int AS dead, jfm.updated_at
         FROM critical_positions cp
         JOIN candidates c
           ON LPAD(c.employee_id, 5, '0') = LPAD(cp.holder_employee_id, 5, '0')
          AND c.tenant_id = cp.tenant_id
         JOIN job_family_matches jfm ON jfm.candidate_id = c.id
         WHERE cp.id = $1
         UNION ALL
         -- job_family_matches holds one row per CANDIDATE carrying that
         -- candidate's current position code, so this branch resolves to a
         -- person too and must report liveness the same way the branch above
         -- does — otherwise it silently hands back the very row prio 1 ranked
         -- down. LEFT JOIN: a jfm row whose candidate is gone counts as live.
         SELECT jfm.job_profile_id, 2 AS prio,
                (c.deleted_at IS NOT NULL)::int AS dead, jfm.updated_at
         FROM critical_positions cp
         JOIN positions p ON p.id = cp.position_id
         JOIN job_family_matches jfm ON jfm.position_id = p.position_id
         LEFT JOIN candidates c ON c.id = jfm.candidate_id
         WHERE cp.id = $1
       ) x
       ORDER BY prio ASC, dead ASC, updated_at DESC NULLS LAST, job_profile_id ASC
       LIMIT 1`,
      [targetPositionId]
    );
    return row?.jobProfileId ?? null;
  } catch (err) {
    // Silent fallback to the title match, so name the likely cause: an
    // unmigrated database (candidates.deleted_at — drizzle/0045) fails here
    // exactly like an absent job_family_matches table, and the run would
    // otherwise lose its Job Family pairing with nothing in the log.
    log("findMatchedJobProfileId.failed", {
      targetPositionId,
      error: err instanceof Error ? err.message : String(err),
      hint: "job_family_matches missing, or candidates.deleted_at missing (drizzle/0045 not applied) — falling back to title match",
    });
    return null;
  }
}

function jobProfileResultFrom(p: { id?: number | null; jobPurpose: string | null; extractedData: any }) {
  const raw = p.extractedData?.responsibilities;
  const responsibilities = Array.isArray(raw)
    ? raw
        .map((r: any) => (typeof r === "string" ? r : String(r?.responsibility ?? "")))
        .filter((s: string) => s.trim().length > 0)
    : [];
  return {
    jobProfileId: p.id ?? null,
    jobPurpose: p.jobPurpose,
    responsibilities,
  };
}

/**
 * Resolve the job profile (job purpose + responsibilities) for a position:
 *   0. Job Family pairing — the profile matched to this position via
 *      job_family_matches (position-incumbent → 1 profile). Preferred.
 *   1/2. Fallback — exact then substring title match against sync_job_profiles
 *        (no embeddings).
 * Returns null when nothing reasonable matches.
 */
async function findJobProfileForPosition(
  positionTitle: string,
  targetPositionId?: string
): Promise<{
  jobProfileId: number | null;
  jobPurpose: string | null;
  responsibilities: string[];
} | null> {
  // 0. Job Family sync pairing (authoritative).
  if (targetPositionId) {
    const jpId = await findMatchedJobProfileId(targetPositionId);
    if (jpId != null) {
      const rows = await query<{ id: number; jobPurpose: string | null; extractedData: any }>(
        `SELECT id, job_purpose as "jobPurpose", extracted_data as "extractedData"
         FROM sync_job_profiles WHERE id = $1 AND status = 'completed' LIMIT 1`,
        [jpId]
      );
      if (rows[0]) return jobProfileResultFrom(rows[0]);
    }
  }

  // 1/2. Title fallback.
  const profiles = await query<{
    id: number;
    positionName: string | null;
    jobPurpose: string | null;
    extractedData: any;
  }>(
    `SELECT id, position_name as "positionName", job_purpose as "jobPurpose",
            extracted_data as "extractedData"
     FROM sync_job_profiles
     WHERE status = 'completed' AND position_name IS NOT NULL
     ORDER BY processed_at DESC NULLS LAST, id DESC`
  );
  if (profiles.length === 0) return null;

  // Rows arrive newest-first (deterministic), so first-match picks are stable
  // across runs even when two completed profiles share a normalized title.
  const target = normalizeJobProfileTitle(positionTitle);
  const exact = profiles.find((p) => normalizeJobProfileTitle(p.positionName!) === target);
  if (exact) return jobProfileResultFrom(exact);

  const substring = profiles
    .filter((p) => {
      const name = normalizeJobProfileTitle(p.positionName!);
      return name.includes(target) || target.includes(name);
    })
    .sort((a, b) => b.positionName!.length - a.positionName!.length)[0];
  if (substring) return jobProfileResultFrom(substring);

  return null;
}

// ─── Deterministic HAV quadrant → score ─────────────────────────

// Methodology doc's 5-tier categorization (score 5..1, scaled ×20):
//   Highly Recommended {1} → 5 · Recommended {2,3,4,7,8} → 4 ·
//   Belum Bisa Direkomendasikan {5,6,9} → 3 · Tidak Direkomendasikan
//   {10,11,12,15} → 2 · Bottom {16} → 1.
// Quadrants 13/14 aren't listed in the doc's table; they are SOLID
// contributors (Maximal Contributor / Contributor), same tier as 5/6/9.
export const HAV_GROUP_SCORES: Record<number, number> = {
  1: 100,
  2: 80, 3: 80, 4: 80, 7: 80, 8: 80,
  5: 60, 6: 60, 9: 60, 13: 60, 14: 60,
  10: 40, 11: 40, 12: 40, 15: 40,
  16: 20,
};

export function computeHavScore(quadrant: string | null | undefined): number {
  return traceHavScore(quadrant).score;
}

/**
 * `computeHavScore` with its two intermediates — the digits kept from the text
 * and the integer they parse to — for the run trace. The score above reads it,
 * so the two can never disagree.
 */
export function traceHavScore(quadrant: string | null | undefined): {
  digits: string | null;
  quadrant: number | null;
  score: number;
} {
  // Missing/unparseable data lands in the "Tidak Direkomendasikan" tier —
  // low, but not equated with quadrant 16 (Bottom/Deadwood).
  if (!quadrant) return { digits: null, quadrant: null, score: 40 };
  const digits = quadrant.replace(/\D/g, '');
  const num = parseInt(digits, 10);
  return {
    digits,
    quadrant: Number.isFinite(num) ? num : null,
    score: HAV_GROUP_SCORES[num] ?? 40,
  };
}

// ─── Session loader ─────────────────────────────────────────────

export async function loadSession(
  sessionId: string
): Promise<TournamentSession | null> {
  const row = await queryOne<any>(
    `SELECT id, tenant_id as "tenantId", position_id as "positionId",
            program_template_id as "programTemplateId", label,
            target_finalists as "targetFinalists",
            current_pool as "currentPool",
            pending_pool as "pendingPool",
            scoring_method as "scoringMethod", COALESCE(is_demo, false) as "isDemo",
            status, final_ranked as "finalRanked",
            run_id as "runId", created_by as "createdBy",
            created_at as "createdAt", updated_at as "updatedAt"
     FROM tournament_sessions
     WHERE id = $1
     LIMIT 1`,
    [sessionId]
  );
  if (!row) return null;
  return {
    ...row,
    currentPool: row.currentPool ?? [],
    pendingPool: row.pendingPool ?? [],
  } as TournamentSession;
}
