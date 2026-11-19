'use server';

/**
 * Server actions around the competency-name → kamus-code resolver
 * (lib/kamus-name-match.ts).
 *
 * The resolver lives in the WEB APP and the cache table is what scoring-service
 * reads. That split is deliberate: resolution needs an LLM for its last tier,
 * and scoring is the one path in this system that must stay deterministic and
 * runnable without any model being reachable — the orphan sweeper restarts
 * sessions with no browser and no operator present. So the web app decides, the
 * decision is persisted, and scoring only ever does a lookup.
 */

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { requirePermission } from '@/lib/rbac';
import {
  resolveCompetencyNames,
  normalizeCompName,
  kamusAiConfigured,
  type ResolveReport,
} from '@/lib/kamus-name-match';

/**
 * Cold-start cap for the automatic priming at session start.
 *
 * Mirrors AI_MATCH_MAX_TITLES_PER_RUN in the job-profile matcher and exists for
 * the same reason: the first run after deployment would otherwise sit through
 * every unresolved name before the scoring run is even dispatched. The surplus is
 * not lost — it is simply left for the next run or for the manual action, and
 * the deterministic tiers (which is what fixes the common cases) always run for
 * every name regardless of this cap.
 */
const AI_MAX_PER_SESSION_START = Math.max(
  0,
  parseInt(process.env.KAMUS_AI_MAX_NAMES_PER_RUN || '12', 10),
);

/**
 * Every competency name that can reach the technical matcher, from all four
 * places a required or held competency can come from.
 *
 * `sync_technical_competencies` is in the list because it is the reference set
 * whenever a position has no job profile (the incumbent / position_aggregate
 * tiers), so its names go through exactly the same identity resolution.
 */
async function collectCompetencyNames(): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT nm FROM (
      SELECT COALESCE(e->>'competency', e->>'name', e->>'technicalName') AS nm
      FROM sync_job_profiles,
           LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(extracted_data->'technicalCompetencies') = 'array'
                  THEN extracted_data->'technicalCompetencies' ELSE '[]'::jsonb END) AS e
      UNION ALL
      SELECT technical_name FROM candidate_technical_competencies
      UNION ALL
      SELECT technical_name FROM sync_technical_competencies
      UNION ALL
      SELECT COALESCE(e->>'name', e->>'competency') AS nm
      FROM critical_positions,
           LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(required_competencies) = 'array'
                  THEN required_competencies ELSE '[]'::jsonb END) AS e
    ) t
    WHERE nm IS NOT NULL AND btrim(nm) <> ''
  `);
  return (res.rows as any[]).map((r) => String(r.nm));
}

/**
 * Fill the cache before a scoring run is dispatched. Best-effort by design: a
 * failure here must never block a scoring run, because the run still works with
 * whatever the cache already holds — it just resolves fewer names, which is the
 * behaviour that existed before this resolver.
 */
export async function primeCompetencyNames(): Promise<void> {
  try {
    const names = await collectCompetencyNames();
    if (names.length === 0) return;
    await resolveCompetencyNames(names, { maxAi: AI_MAX_PER_SESSION_START });
  } catch (err) {
    console.error('[kamus-match] priming gagal:', err);
  }
}

export type CompetencyMatchRow = {
  name: string;
  nameKey: string;
  code: string | null;
  codeName: string | null;
  tier: 'exact' | 'fuzzy' | 'ai';
  confidence: number | null;
  reason: string | null;
};

export type CompetencyMatchReport = {
  rows: CompetencyMatchRow[];
  exactCount: number;
  fuzzyCount: number;
  aiCount: number;
  /** Resolved to a deliberate "no kamus entry means this". */
  noneCount: number;
  /** Names with no decision yet (AI tier not run, or unreachable). */
  pendingCount: number;
  /** FALSE means the LLM transport looks dead — a banner, not "no answers". */
  aiAvailable: boolean;
  aiConfigured: boolean;
  /** Set when drizzle/0063 has not been applied — tiers 1–2 ran, nothing saved. */
  migrationNeeded?: string;
};

/**
 * Resolve every competency name in the system and report the outcome.
 *
 * Unlike the automatic priming this is uncapped — an operator asked for it, so
 * it finishes the job rather than leaving a remainder for next time.
 */
export async function resolveCompetencyNamesAction(): Promise<CompetencyMatchReport> {
  await requirePermission('job_profiles.manage');
  const names = await collectCompetencyNames();
  const report = await resolveCompetencyNames(names);
  return buildReport(names, report);
}

/** Read the current mapping WITHOUT calling the model — for rendering the page. */
export async function getCompetencyMatchReportAction(): Promise<CompetencyMatchReport> {
  await requirePermission('job_profiles.view');
  const names = await collectCompetencyNames();
  const report = await resolveCompetencyNames(names, { skipAi: true });
  return buildReport(names, report);
}

async function buildReport(names: string[], report: ResolveReport): Promise<CompetencyMatchReport> {
  const res = await db.execute(sql`
    SELECT code, name FROM sync_kamus_kompetensi WHERE code IS NOT NULL AND name IS NOT NULL
  `);
  const codeToName = new Map<string, string>(
    (res.rows as any[]).map((r) => [String(r.code), String(r.name)]),
  );

  // One row per distinct normalized name, keeping the first spelling seen.
  const originals = new Map<string, string>();
  for (const n of names) {
    const key = normalizeCompName(n);
    if (key && !originals.has(key)) originals.set(key, n);
  }

  const rows: CompetencyMatchRow[] = [];
  let pendingCount = 0;
  for (const [key, name] of originals) {
    const hit = report.resolved.get(key);
    if (!hit) {
      pendingCount++;
      rows.push({
        name,
        nameKey: key,
        code: null,
        codeName: null,
        tier: 'ai',
        confidence: null,
        reason: null,
      });
      continue;
    }
    rows.push({
      name,
      nameKey: key,
      code: hit.code,
      codeName: hit.code ? (codeToName.get(hit.code) ?? null) : null,
      tier: hit.tier,
      confidence: hit.confidence,
      reason: hit.reason,
    });
  }

  // Unresolved first, then AI decisions, then deterministic, then exact — the
  // rows an operator can act on are the ones that need looking at.
  const order: Record<string, number> = { ai: 1, fuzzy: 2, exact: 3 };
  rows.sort((a, b) => {
    const ap = a.code == null ? 0 : order[a.tier] ?? 9;
    const bp = b.code == null ? 0 : order[b.tier] ?? 9;
    return ap - bp || a.name.localeCompare(b.name);
  });

  return {
    rows,
    exactCount: report.exactCount,
    fuzzyCount: report.fuzzyCount,
    aiCount: report.aiCount,
    noneCount: report.noneCount,
    pendingCount,
    aiAvailable: report.aiAvailable,
    aiConfigured: kamusAiConfigured(),
    migrationNeeded: report.migrationNeeded,
  };
}
