'use server';

// Job Family "Sync" report: match every candidate's CURRENT position (from
// sync_employee_positions where the assignment has no real end date —
// sep.valid_to > CURRENT_DATE) against the extracted job profiles by position name,
// reusing the same matching approach as scoring-service's
// findJobProfileForPosition (exact → substring → optional embedding).
//
// SCOPE: cross-tenant. Candidates and positions are pulled across ALL tenants /
// company_ids (job profiles are not tenant-scoped), so a single job profile can
// carry multiple incumbents when candidates from different companies share the
// same position title. This models succession-need potential platform-wide.
//
// Produces three lists + coverage statistics:
//   • candidates whose current position matches no job profile
//   • job profiles with no candidate incumbent
//   • matched candidate ↔ job profile pairs
//   • (stat) current sync_positions titles with no job profile at all

import { and, eq, exists, ilike, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import {
  candidates,
  syncJobProfiles,
  jobFamilyMatches,
  jobFamilyAiMatchCache,
  jobProfileMatchRuns,
} from '@/lib/db/schema';
import { liveCandidate } from '@/lib/candidate-visibility';
import { requirePermission } from '@/lib/rbac';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentTenantId, listTenants, liveTenantIdSet, tenantNameMap } from '@/lib/tenant';
import { embedViaService } from '@/lib/job-family/embed';
import {
  loadTitleVectors,
  quantizeVector,
  saveTitleVectors,
} from '@/lib/job-family/title-embed-cache';
import { getJobFamilyConfig } from '@/lib/job-family-actions';
import { withEffectiveHav } from '@/lib/hav-placements';
import { isDemoMode } from '@/lib/app-mode';
import { MASKED_CODE, MASKED_NPK } from '@/lib/app-mode-shared';
import { forCurrentMode, loadDemoCopies } from '@/lib/demo/store';
import {
  buildDeterministicMatcher,
  normalizeCode,
  normalizeTitle,
  parseJobProfileFileName,
  type ProfileLite,
} from '@/lib/job-family/match';
import {
  aiMatchConfigured,
  aiMatchModelName,
  aiMatchTitles,
  AI_MATCH_MIN_CONFIDENCE,
  AI_MATCH_SHORTLIST_SIZE,
  type AiShortlistProfile,
} from '@/lib/job-family/ai-match';
import type { JobProfileRow } from '@/components/job-profiles/job-profile-detail-content';
import { demoScrub } from '@/lib/demo/names';
import { demoMaskJobProfile } from '@/lib/demo/content';

// Minimum cosine similarity for an EMBEDDING pairing (user requirement:
// only pair at > 98% similarity). Embedding always runs (no toggle).
const EMBED_MATCH_MIN_SIM = 0.98;

// ── Result types ──────────────────────────────────────────────────

// Matching tiers (substring removed): 'filename' (position_id == file-name code),
// 'exact' (normalized title equals a position_name), 'file-alias' (it equals the
// title written in the PDF's FILE NAME instead — the two routinely disagree, and
// the file name is often the one naming the seat the document is for),
// 'embedding' (>98% cosine),
// plus 'manual' — an operator-chosen pairing for the cases the three automatic
// tiers cannot reach (no position id, a title nobody wrote a JD under, a JD
// filed under a code the HR sync never assigned).
//
// 'manual' is a PIN, not a tier: it is evaluated BEFORE the automatic tiers and
// short-circuits them, so re-running the matcher can never silently overwrite a
// human decision with a worse automatic guess. This mirrors how
// job_profile_tenants treats source='manual' — the sync never touches those rows
// either. See setManualMatchAction / saveMatchesToDbAction for the other half of
// the contract: the snapshot save neither deletes nor rewrites manual rows.
// 'ai' is the LAST tier, not a peer of the three above it: it only ever sees
// titles none of them could place, it may only choose from the shortlist the
// embedding ranking produced, and its decisions are cached per title
// (job_family_ai_match_cache) so a re-run cannot reshuffle the report. See
// lib/job-family/ai-match.ts for why "no match" stays a first-class answer.
export type MatchType = 'filename' | 'exact' | 'file-alias' | 'embedding' | 'manual' | 'ai';

export type MatchedPair = {
  candidateId: string;
  candidateName: string;
  currentPosition: string;
  jobProfileId: number;
  jobProfileName: string;
  matchType: MatchType;
  /** Candidate's Pulse tenant + MSSQL company division. */
  tenantId?: string;
  companyId?: string;
  /** The candidate's sync position_id (any match type, when known). */
  positionId?: string;
  /** Cosine similarity (0..1), present only for embedding matches. */
  similarity?: number;
  /** Job profile file name — present for 'filename' matches. */
  fileName?: string;
  /** The position code that matched (candidate position_id) — 'filename'. */
  matchedCode?: string;
  /** The "JD-..." token parsed from the file name — 'filename' (if any). */
  jdNumber?: string;
  /** Model's 0..1 confidence — 'ai' matches only. */
  aiConfidence?: number;
  /** One-sentence justification from the model — 'ai' matches only. */
  aiReason?: string;
};

// Why a candidate has no job profile:
//  • no-active-position — no active sync_employee_positions row (no position_id)
//  • no-jd             — has an active position, but neither its id nor title
//                        matches any job profile
export type CandidateScenario = 'no-active-position' | 'no-jd';

export type UnmatchedCandidate = {
  candidateId: string;
  candidateName: string;
  currentPosition: string | null;
  tenantId?: string;
  companyId?: string;
  scenario: CandidateScenario;
};

export type MatchTenant = {
  tenantId: string;
  tenantName: string;
  companyIds: string[];
  candidateCount: number;
};

// Why a job profile has no candidate incumbent (by its file-name code):
//  • candidate-other-tenant — held by a candidate in an UNSELECTED tenant
//  • non-candidate-incumbent— held by a non-candidate employee
//  • no-active-incumbent    — nobody actively holds this position (by code)
// NOTE: profiles whose position code IS held by a SELECTED-tenant candidate (who
// matched a same-code sibling JD) are dropped from the list entirely — that
// position already has a matched incumbent, so it isn't "tanpa incumbent".
export type ProfileScenario =
  | 'candidate-other-tenant'
  | 'non-candidate-incumbent'
  | 'no-active-incumbent';

export type UnmatchedProfile = {
  jobProfileId: number;
  positionName: string;
  divisionDepartment: string | null;
  scenario: ProfileScenario;
};

export type MatchReportSource = 'live' | 'saved';

export type JobFamilyMatchReport = {
  /**
   * 'saved' = rebuilt from job_family_matches without running any matching
   * tier (what the page shows on open); 'live' / absent = computed just now.
   * A saved report has no "profil tanpa incumbent" / "posisi tanpa profil"
   * answer — those only exist as the by-product of a full run.
   */
  source?: MatchReportSource;
  /** ISO time of the newest persisted row in scope — 'saved' reports only. */
  savedAt?: string | null;
  /**
   * ISO time the run that produced this report finished — set by
   * runJobProfileMatchAction and carried by the stored run it reloads. Absent
   * on a report built by getJobFamilyMatchReport directly and on 'saved'.
   */
  runAt?: string | null;
  /** Who started that run (display name or email); null for the System User. */
  runBy?: string | null;
  /** false when the scoring-service (embedding) was unreachable this run. */
  embeddingAvailable: boolean;
  /** Whether the AI tier was asked to run at all (operator toggle). */
  aiEnabled: boolean;
  /** false when the AI tier was wanted but the LLM is unset or unreachable. */
  aiAvailable: boolean;
  /** Titles left for the AI this run that exceeded the per-run cap. */
  aiDeferredTitles: number;
  /** Tenants included in this run (drives candidate scope). */
  selectedTenantIds: string[];
  stats: {
    totalCandidates: number;
    totalProfiles: number;
    totalCurrentPositions: number;
    matchedCandidates: number;
    unmatchedCandidates: number;
    unmatchedProfiles: number;
    unmatchedPositions: number;
  };
  matched: MatchedPair[];
  unmatchedCandidates: UnmatchedCandidate[];
  unmatchedProfiles: UnmatchedProfile[];
  unmatchedPositions: string[];
};

// ── Available tenants (for the include/exclude checkboxes) ────────

export async function getMatchTenantsAction(): Promise<MatchTenant[]> {
  await requirePermission('job_profiles.view');

  // Soft-deleted candidates are excluded: this count is the size of the pool the
  // checkbox would actually add to the report.
  const countRes = await db.execute(sql`
    SELECT tenant_id::text AS tenant_id, COUNT(*)::int AS cnt
    FROM candidates WHERE deleted_at IS NULL GROUP BY tenant_id
  `);
  const counts = new Map(
    (countRes.rows as Array<{ tenant_id: string; cnt: number }>).map((r) => [r.tenant_id, Number(r.cnt)]),
  );

  const mapRes = await db.execute(sql`
    SELECT tenant_id::text AS tenant_id, array_agg(DISTINCT company_id) AS companies
    FROM sync_company_tenant_map WHERE is_active = true GROUP BY tenant_id
  `);
  const companyMap = new Map(
    (mapRes.rows as Array<{ tenant_id: string; companies: string[] | null }>).map((r) => [
      r.tenant_id,
      (r.companies ?? []).filter(Boolean),
    ]),
  );

  return (await listTenants()).map((t) => ({
    tenantId: t.id,
    tenantName: t.name,
    companyIds: companyMap.get(t.id) ?? [],
    candidateCount: counts.get(t.id) ?? 0,
  }));
}

// ── Embedding tier (optional, via scoring-service /api/embed) ──────

const EMBED_CHUNK = 200; // /api/embed caps at 256 texts per call

/** Chunks embedded at once. The chunks were sequential, which on the remote
 *  gateway (5.2s per 200 texts, measured) made a 742-text cold run take ~20s of
 *  pure wall-clock waiting. Three at a time because the ceiling here is the
 *  gateway's, not ours — this is a report, not a batch job. */
const EMBED_CONCURRENCY = 3;

// A title's embedding is a pure function of (source, model, EXACT text), so we
// cache vectors across requests. Without a cache, /job-profiles/match
// re-embedded every job-profile name + candidate/position title on every load —
// the dominant cost of the page by two orders of magnitude.
//
// TWO levels, because this Map alone was not enough: it is per-process, so every
// restart, deploy and extra worker paid the full ~20s again, and this page is not
// one anybody keeps warm. `job_family_title_embed` (drizzle/0070) makes the
// vectors survive the process; this Map keeps a warm process at zero queries.
// Bounded to cap memory.
const titleVectorCache = new Map<string, number[]>();
const TITLE_VECTOR_CACHE_MAX = 20_000;

function titleCacheKey(source: string, model: string, text: string): string {
  return `${source} ${model} ${text}`;
}

function cacheTitleVector(key: string, vec: number[]): void {
  // Simple bound: once at capacity, drop the oldest-inserted entry.
  if (titleVectorCache.size >= TITLE_VECTOR_CACHE_MAX) {
    const oldest = titleVectorCache.keys().next().value;
    if (oldest !== undefined) titleVectorCache.delete(oldest);
  }
  titleVectorCache.set(key, vec);
}

/**
 * Batched, cached embed; returns null if the service is unset/unreachable, or
 * one vector per input text (same order) otherwise.
 *
 * Resolution order per text: in-process Map → `job_family_title_embed` → the
 * embedding backend. Only texts nobody has ever embedded under this
 * (source, model) reach the backend, and those are written back so the next
 * process starts warm.
 *
 * Everything stored and compared is Float32-quantized — including vectors that
 * came straight from the backend this call. Mixing float64 fresh vectors with
 * float32 cached ones would let the same title fall on either side of the 0.98
 * threshold depending on whether this process happened to have embedded it
 * already, which is the kind of between-page-loads reshuffle the AI tier's
 * decision cache exists to prevent on its own side.
 */
async function embedTitles(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  try {
    const config = await getJobFamilyConfig();
    const model = config.embedding.model;
    const source = config.embedding.source;

    // Resolve every unique text for THIS call (from cache or freshly embedded)
    // into `local`, which is never evicted — so readback below can't miss even
    // if the bounded global cache evicts an entry mid-call.
    const local = new Map<string, number[]>();
    const misses: string[] = [];
    for (const t of texts) {
      if (local.has(t)) continue;
      const cached = titleVectorCache.get(titleCacheKey(source, model, t));
      if (cached) local.set(t, cached);
      else {
        local.set(t, EMPTY_VECTOR); // placeholder; also dedups misses
        misses.push(t);
      }
    }

    // Level 2: the persistent cache. One query for every process-cache miss.
    if (misses.length > 0) {
      const persisted = await loadTitleVectors(source, model, misses);
      if (persisted.size > 0) {
        const stillMissing: string[] = [];
        for (const t of misses) {
          const v = persisted.get(t);
          if (v) {
            local.set(t, v);
            cacheTitleVector(titleCacheKey(source, model, t), v);
          } else {
            stillMissing.push(t);
          }
        }
        misses.length = 0;
        misses.push(...stillMissing);
      }
    }

    // Level 3: the backend, for texts nobody has embedded under this
    // (source, model) yet. Chunks run EMBED_CONCURRENCY at a time.
    const fresh: Array<{ text: string; vector: number[] }> = [];
    const chunks: string[][] = [];
    for (let i = 0; i < misses.length; i += EMBED_CHUNK) {
      chunks.push(misses.slice(i, i + EMBED_CHUNK));
    }
    for (let i = 0; i < chunks.length; i += EMBED_CONCURRENCY) {
      const wave = chunks.slice(i, i + EMBED_CONCURRENCY);
      const results = await Promise.all(
        wave.map((chunk) => embedViaService(chunk, model, source)),
      );
      for (let w = 0; w < wave.length; w++) {
        const chunk = wave[w]!;
        const vectors = results[w];
        if (!vectors || vectors.length !== chunk.length) return null;
        for (let j = 0; j < chunk.length; j++) {
          const t = chunk[j]!;
          const v = quantizeVector(vectors[j]!);
          local.set(t, v);
          cacheTitleVector(titleCacheKey(source, model, t), v);
          fresh.push({ text: t, vector: v });
        }
      }
    }

    // Write-back is best-effort and deliberately awaited: it is one INSERT per
    // 200 rows (~265ms measured) against ~20s of embedding it saves next time,
    // and letting it float would let the process exit mid-write.
    await saveTitleVectors(source, model, fresh);

    return texts.map((t) => local.get(t)!);
  } catch {
    return null;
  }
}

const EMPTY_VECTOR: number[] = [];

/** Dot product — E5 vectors are L2-normalized, so dot == cosine similarity. */
function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/**
 * Best-above-threshold embedding match for a set of query titles against the
 * profile names. Returns a title→profile map (only titles that cleared the
 * threshold), or null when embedding is unavailable.
 */
type EmbeddingHit = { profile: ProfileLite; similarity: number };

async function embeddingMatch(
  queryTitles: string[],
  profiles: ProfileLite[],
  threshold: number,
): Promise<Map<string, EmbeddingHit> | null> {
  const result = new Map<string, EmbeddingHit>();
  if (queryTitles.length === 0 || profiles.length === 0) return result;

  const profNames = profiles.map((p) => p.positionName);
  const vectors = await embedTitles([...profNames, ...queryTitles]);
  if (!vectors) return null;

  const profVecs = vectors.slice(0, profNames.length);
  for (let q = 0; q < queryTitles.length; q++) {
    const qv = vectors[profNames.length + q]!;
    let bestIdx = -1;
    let bestSim = 0;
    for (let i = 0; i < profVecs.length; i++) {
      const sim = dot(qv, profVecs[i]!);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestSim > threshold) {
      result.set(queryTitles[q]!, { profile: profiles[bestIdx]!, similarity: bestSim });
    }
  }
  return result;
}

/**
 * Top-K nearest profiles per title, regardless of threshold — the shortlist the
 * AI tier arbitrates over.
 *
 * Deliberately unthresholded: the whole point of the tier is titles whose right
 * answer sits below the >98% bar (abbreviations, reordered words). Ranking is
 * still embedding-based, so the model is comparing plausible options rather
 * than searching the catalogue.
 *
 * Falls back to token overlap when embedding is unavailable, so the tier still
 * works on a deployment with no embedding service — a worse shortlist, but the
 * model is the one deciding either way.
 */
async function embeddingShortlist(
  queryTitles: string[],
  profiles: ProfileLite[],
  k: number,
): Promise<Map<string, EmbeddingHit[]>> {
  const result = new Map<string, EmbeddingHit[]>();
  if (queryTitles.length === 0 || profiles.length === 0) return result;

  const profNames = profiles.map((p) => p.positionName);
  const vectors = await embedTitles([...profNames, ...queryTitles]);

  if (!vectors) {
    // Lexical fallback: share of the title's words that appear in the JD name.
    const tokenize = (s: string) => new Set(normalizeTitle(s).split(' ').filter((w) => w.length > 2));
    const profTokens = profiles.map((p) => tokenize(p.positionName));
    for (const title of queryTitles) {
      const qt = tokenize(title);
      if (qt.size === 0) continue;
      const scored = profiles
        .map((profile, i) => {
          let shared = 0;
          for (const w of qt) if (profTokens[i]!.has(w)) shared++;
          return { profile, similarity: shared / qt.size };
        })
        .filter((hit) => hit.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k);
      if (scored.length > 0) result.set(title, scored);
    }
    return result;
  }

  const profVecs = vectors.slice(0, profNames.length);
  for (let q = 0; q < queryTitles.length; q++) {
    const qv = vectors[profNames.length + q]!;
    const scored = profVecs
      .map((pv, i) => ({ profile: profiles[i]!, similarity: dot(qv, pv) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
    result.set(queryTitles[q]!, scored);
  }
  return result;
}

// ── Main report ───────────────────────────────────────────────────

/** Titles handed to the model in one report run. Everything above the cap waits
 *  for the next run — a first sync on a fresh database must not turn into
 *  thousands of sequential LLM calls before the page can render. */
const AI_MATCH_MAX_TITLES_PER_RUN = 150;


// ── Scoped candidates (shared by the live report and the saved snapshot) ──
// Candidates for the SELECTED tenants + their CURRENT position title from
// sync_employee_positions (valid_to > today), plus the resolved company_id.
// Falls back to candidates.current_position when no active sync assignment is
// found. LEFT JOINs so every candidate shows.
function scopedCandidatesSql(selectedTenantIds: string[]) {
  return sql`
      SELECT DISTINCT ON (c.id)
        c.id::text                                   AS candidate_id,
        c.name                                       AS candidate_name,
        c.tenant_id::text                            AS tenant_id,
        COALESCE(sep.company_id, sctm.company_id)    AS company_id,
        c.current_position                           AS candidate_current_position,
        c.department                                 AS candidate_department,
        c.division                                   AS candidate_division,
        sep.position_id                              AS position_id,
        COALESCE(sp.internal_title, sp.external_title) AS sync_title
      FROM candidates c
      LEFT JOIN sync_company_tenant_map sctm
        ON sctm.tenant_id = c.tenant_id AND sctm.is_active = true
      LEFT JOIN sync_employee_positions sep
        ON sep.company_id = sctm.company_id
       AND sep.employee_id = LPAD(c.employee_id, 5, '0')
       AND sep.valid_to > CURRENT_DATE
      LEFT JOIN sync_positions sp
        ON sp.company_id = sep.company_id AND sp.position_id = sep.position_id
      WHERE c.tenant_id::text IN (${sql.join(
        selectedTenantIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND c.deleted_at IS NULL
      ORDER BY c.id, sep.primary_position DESC NULLS LAST, sep.valid_from DESC NULLS LAST
    `;
}

type ScopedCandidateRow = {
  candidate_id: string;
  candidate_name: string;
  tenant_id: string | null;
  company_id: string | null;
  candidate_current_position: string | null;
  candidate_department: string | null;
  candidate_division: string | null;
  position_id: string | null;
  sync_title: string | null;
};

type ScopedCandidate = {
  id: string;
  name: string;
  tenantId: string | null;
  companyId: string | null;
  title: string | null;
  positionId: string | null;
  department: string | null;
  division: string | null;
};

function toScopedCandidate(r: ScopedCandidateRow): ScopedCandidate {
  const name = r.candidate_name ?? '';
  const currentPosition = r.candidate_current_position ?? '';
  const title = (r.sync_title ?? currentPosition ?? '').trim();
  return {
    id: r.candidate_id,
    name,
    tenantId: r.tenant_id ?? null,
    companyId: r.company_id?.trim() || null,
    title: title.length > 0 ? title : null,
    positionId: r.position_id?.trim() || null,
    // Org context for the AI tier: two JDs with near-identical names are
    // usually told apart by the division/department they sit in.
    department: r.candidate_department || null,
    division: r.candidate_division || null,
  };
}

export async function getJobFamilyMatchReport(opts?: {
  /** Tenants to include. Empty/undefined → current tenant only. */
  tenantIds?: string[];
  /** Run the AI tier on what the deterministic tiers could not place (default true). */
  useAi?: boolean;
}): Promise<JobFamilyMatchReport> {
  await requirePermission('job_profiles.view');

  // Tenant scope: default to the current tenant (Pulse division). The UI can
  // add more tenants (cross-company inclusivity) via checkboxes.
  const validTenantIds = await liveTenantIdSet();
  const requested = (opts?.tenantIds ?? []).filter((id) => validTenantIds.has(id));
  const selectedTenantIds = requested.length > 0 ? requested : [await getCurrentTenantId()];

  // Fetch the three independent inputs concurrently — job profiles, candidates +
  // their current title, and current position titles don't depend on each other,
  // so parallelizing trims the DB phase without changing what's computed. The
  // tuple cast keeps `profileRows` typed (db.execute is loosely typed, so the
  // mixed Promise.all would otherwise widen the whole tuple to any).
  const [profileRows, candResult, posResult] = (await Promise.all([
    // 1. Completed job profiles with a usable position name (+ file_name for the
    //    filename-code matcher).
    db
      .select({
        id: syncJobProfiles.id,
        positionName: syncJobProfiles.positionName,
        divisionDepartment: syncJobProfiles.divisionDepartment,
        fileName: syncJobProfiles.fileName,
      })
      .from(syncJobProfiles)
      .where(and(eq(syncJobProfiles.status, 'completed'), isNotNull(syncJobProfiles.positionName))),

    // 2. Candidates for the SELECTED tenants + their CURRENT position title from
    //    sync_employee_positions (valid_to > today), plus the resolved company_id.
    //    Falls back to candidates.current_position when no active sync assignment
    //    is found. LEFT JOINs so every candidate shows.
    db.execute(scopedCandidatesSql(selectedTenantIds)),

    // 3. Distinct CURRENT position titles across sync_positions for the SELECTED
    //    tenants' companies (valid_to > today) — "positions with no profile".
    db.execute(sql`
      SELECT DISTINCT COALESCE(sp.internal_title, sp.external_title) AS title
      FROM sync_positions sp
      JOIN sync_company_tenant_map sctm
        ON sctm.company_id = sp.company_id AND sctm.is_active = true
      WHERE sctm.tenant_id::text IN (${sql.join(
        selectedTenantIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND sp.valid_to > CURRENT_DATE
        AND COALESCE(sp.internal_title, sp.external_title) IS NOT NULL
    `),
  ])) as [
    Array<{
      id: number;
      positionName: string | null;
      divisionDepartment: string | null;
      fileName: string;
    }>,
    { rows: Array<Record<string, unknown>> },
    { rows: Array<Record<string, unknown>> },
  ];

  const profiles: ProfileLite[] = profileRows
    .filter((p) => p.positionName && p.positionName.trim().length > 0)
    .map((p) => ({
      id: p.id,
      positionName: p.positionName!,
      divisionDepartment: p.divisionDepartment,
      fileName: p.fileName,
    }));

  // Filename-code index: leading code in file_name → ALL profiles with that code.
  // Multiple JD files can share one position_id code but describe different roles
  // (e.g. CS20000100 → "Business Control Analyst" AND "Business Control Officer"),
  // so we keep every profile and disambiguate by title at match time — otherwise
  // a candidate would match the wrong same-code JD (first-wins) and the correct
  // one would be orphaned as "tanpa incumbent".
  type CodeHit = { profile: ProfileLite; fileName: string; jdNumber: string | null };
  const codeToProfiles = new Map<string, CodeHit[]>();
  for (const r of profileRows) {
    if (!r.positionName?.trim()) continue;
    const parsed = parseJobProfileFileName(r.fileName);
    if (!parsed.code) continue;
    const key = normalizeCode(parsed.code);
    if (!key) continue;
    const hit: CodeHit = {
      profile: {
        id: r.id,
        positionName: r.positionName,
        divisionDepartment: r.divisionDepartment,
        fileName: r.fileName,
      },
      fileName: r.fileName,
      jdNumber: parsed.jdNumber,
    };
    const arr = codeToProfiles.get(key);
    if (arr) arr.push(hit);
    else codeToProfiles.set(key, [hit]);
  }

  // Among profiles sharing a code, pick the one whose position_name best matches
  // the candidate's title: exact > longest substring > first.
  const pickCodeHit = (hits: CodeHit[], title: string | null): CodeHit => {
    if (hits.length === 1 || !title) return hits[0]!;
    const t = normalizeTitle(title);
    const exact = hits.find((h) => normalizeTitle(h.profile.positionName) === t);
    if (exact) return exact;
    const substring = hits
      .filter((h) => {
        const n = normalizeTitle(h.profile.positionName);
        return n.includes(t) || t.includes(n);
      })
      .sort((a, b) => b.profile.positionName.length - a.profile.positionName.length)[0];
    return substring ?? hits[0]!;
  };

  const candidates = (candResult.rows as ScopedCandidateRow[]).map(toScopedCandidate);

  const positionTitles = (posResult.rows as Array<{ title: string | null }>)
    .map((r) => (r.title ?? '').trim())
    .filter((t) => t.length > 0);

  // ── Manual pins ───────────────────────────────────────────────────
  // Operator-chosen pairings, read BEFORE any automatic tier runs. Scoped to
  // the candidates in this report so a pin belonging to an unselected tenant
  // can't leak into these lists.
  const candidateIds = candidates.map((c) => c.id);
  const manualPins = new Map<string, { jobProfileId: number; jobProfileName: string | null }>();
  if (candidateIds.length > 0) {
    const pinRows = await db
      .select({
        candidateId: jobFamilyMatches.candidateId,
        jobProfileId: jobFamilyMatches.jobProfileId,
        jobProfileName: jobFamilyMatches.jobProfileName,
      })
      .from(jobFamilyMatches)
      .where(
        and(
          eq(jobFamilyMatches.matchType, 'manual'),
          inArray(jobFamilyMatches.candidateId, candidateIds),
        ),
      );
    for (const r of pinRows) {
      manualPins.set(r.candidateId, {
        jobProfileId: r.jobProfileId,
        jobProfileName: r.jobProfileName,
      });
    }
  }
  // Current names for pinned profiles, so a renamed JD shows its live name
  // rather than the label frozen at pin time.
  const profileNameById = new Map(profiles.map((p) => [p.id, p.positionName]));

  // ── Matching per candidate: manual pin → filename-code → exact → embedding ──
  const matcher = buildDeterministicMatcher(profiles);

  const matched: MatchedPair[] = [];
  const unmatchedCandidates: UnmatchedCandidate[] = [];
  const pendingCandidates: {
    id: string;
    name: string;
    title: string;
    positionId: string | null;
    tenantId: string | null;
    companyId: string | null;
    department: string | null;
    division: string | null;
  }[] = [];

  for (const c of candidates) {
    // Tenant/company division carried onto every match/unmatch record.
    const div = {
      ...(c.tenantId ? { tenantId: c.tenantId } : {}),
      ...(c.companyId ? { companyId: c.companyId } : {}),
    };

    // 0. Manual pin wins outright. Deliberately ahead of the filename tier —
    //    the operator pinned this precisely because the automatic answer was
    //    absent or wrong, so letting any tier below override it would undo the
    //    correction on the next run. A pin whose JD is no longer 'completed'
    //    keeps its stored name: the human choice still stands, and dropping it
    //    would silently return the candidate to the unmatched list.
    const pin = manualPins.get(c.id);
    if (pin) {
      matched.push({
        candidateId: c.id,
        candidateName: c.name,
        currentPosition: c.title ?? c.positionId ?? '',
        jobProfileId: pin.jobProfileId,
        jobProfileName:
          profileNameById.get(pin.jobProfileId) ?? pin.jobProfileName ?? `JD #${pin.jobProfileId}`,
        matchType: 'manual',
        ...(c.positionId ? { positionId: c.positionId } : {}),
        ...div,
      });
      continue;
    }

    // 1. Authoritative: candidate position_id equals the leading code in a job
    //    profile's file_name. When several JDs share the code, pick the one whose
    //    title best matches the candidate's title.
    if (c.positionId) {
      const hits = codeToProfiles.get(normalizeCode(c.positionId));
      if (hits && hits.length > 0) {
        const hit = pickCodeHit(hits, c.title);
        matched.push({
          candidateId: c.id,
          candidateName: c.name,
          currentPosition: c.title ?? c.positionId,
          jobProfileId: hit.profile.id,
          jobProfileName: hit.profile.positionName,
          matchType: 'filename',
          positionId: c.positionId,
          fileName: hit.fileName,
          matchedCode: c.positionId,
          ...(hit.jdNumber ? { jdNumber: hit.jdNumber } : {}),
          ...div,
        });
        continue;
      }
    }

    // 2/3. Title-based exact / substring.
    if (!c.title) {
      unmatchedCandidates.push({
        candidateId: c.id,
        candidateName: c.name,
        currentPosition: null,
        scenario: c.positionId ? 'no-jd' : 'no-active-position',
        ...div,
      });
      continue;
    }
    const m = matcher(c.title);
    if (m) {
      matched.push({
        candidateId: c.id,
        candidateName: c.name,
        currentPosition: c.title,
        jobProfileId: m.profile.id,
        jobProfileName: m.profile.positionName,
        matchType: m.matchType,
        ...(c.positionId ? { positionId: c.positionId } : {}),
        ...div,
      });
    } else {
      pendingCandidates.push({
        id: c.id,
        name: c.name,
        title: c.title,
        positionId: c.positionId,
        tenantId: c.tenantId,
        companyId: c.companyId,
        department: c.department,
        division: c.division,
      });
    }
  }

  const pendingPositionTitles: string[] = [];
  for (const t of positionTitles) {
    if (!matcher(t)) pendingPositionTitles.push(t);
  }

  // ── Embedding tier for the still-unmatched titles (always runs, > 98%) ──
  let embeddingAvailable = true;
  let embMap: Map<string, EmbeddingHit> | null = null;
  {
    const queryTitles = Array.from(
      new Set<string>([
        ...pendingCandidates.map((p) => p.title),
        ...pendingPositionTitles,
      ]),
    );
    embMap = await embeddingMatch(queryTitles, profiles, EMBED_MATCH_MIN_SIM);
    if (!embMap) embeddingAvailable = false;
  }

  // ── AI tier (last resort) ────────────────────────────────────────
  // Only titles no deterministic tier could place reach this point. Decisions
  // are cached per normalized title, so the first run pays for a title and
  // every later run reads it back — which is also what keeps the report stable
  // between page loads (an LLM is not a pure function).
  const aiEnabled = opts?.useAi !== false;
  let aiAvailable = aiEnabled ? aiMatchConfigured() : false;
  let aiDeferredTitles = 0;
  const aiMap = new Map<string, { profile: ProfileLite; confidence: number; reason: string }>();

  if (aiEnabled && aiAvailable) {
    try {
      const profileById = new Map(profiles.map((p) => [p.id, p]));
      const unresolvedTitles = Array.from(
        new Set<string>([
          ...pendingCandidates.filter((p) => !embMap?.get(p.title)).map((p) => p.title),
          ...pendingPositionTitles.filter((t) => !embMap?.get(t)),
        ]),
      );

      if (unresolvedTitles.length > 0) {
        // 1. Cached decisions first — including cached rejections, which are what
        //    stop a title the model already turned down from costing a call on
        //    every run.
        const keyed = new Map(unresolvedTitles.map((t) => [normalizeTitle(t), t]));
        const cachedRows = await db
          .select({
            titleKey: jobFamilyAiMatchCache.titleKey,
            jobProfileId: jobFamilyAiMatchCache.jobProfileId,
            confidence: jobFamilyAiMatchCache.confidence,
            reason: jobFamilyAiMatchCache.reason,
          })
          .from(jobFamilyAiMatchCache)
          .where(inArray(jobFamilyAiMatchCache.titleKey, Array.from(keyed.keys())));

        const decided = new Set<string>();
        for (const row of cachedRows) {
          const title = keyed.get(row.titleKey);
          if (!title) continue;
          decided.add(title);
          if (row.jobProfileId == null) continue; // cached "none of them"
          const profile = profileById.get(row.jobProfileId);
          // A cached pick whose JD has since been re-imported under a new id is
          // simply skipped; the title returns to the queue on the next run.
          if (profile) {
            aiMap.set(title, {
              profile,
              confidence: row.confidence ?? 0,
              reason: row.reason ?? '',
            });
          }
        }

        // 2. Ask the model about the rest, capped per run.
        const toAsk = unresolvedTitles.filter((t) => !decided.has(t));
        aiDeferredTitles = Math.max(0, toAsk.length - AI_MATCH_MAX_TITLES_PER_RUN);
        const batch = toAsk.slice(0, AI_MATCH_MAX_TITLES_PER_RUN);

        if (batch.length > 0) {
          const shortlists = await embeddingShortlist(batch, profiles, AI_MATCH_SHORTLIST_SIZE);

          // Job purpose for shortlisted profiles only — the strongest signal for
          // telling near-identical JD names apart, and far too heavy to load for
          // the whole catalogue.
          const shortlistedIds = Array.from(
            new Set(Array.from(shortlists.values()).flatMap((hits) => hits.map((h) => h.profile.id))),
          );
          const purposeById = new Map<number, string | null>();
          if (shortlistedIds.length > 0) {
            const purposeRows = await db
              .select({ id: syncJobProfiles.id, jobPurpose: syncJobProfiles.jobPurpose })
              .from(syncJobProfiles)
              .where(inArray(syncJobProfiles.id, shortlistedIds));
            for (const row of purposeRows) purposeById.set(row.id, row.jobPurpose);
          }

          // Divisions/departments of the people who actually hold each title.
          const departmentsByTitle = new Map<string, Set<string>>();
          for (const p of pendingCandidates) {
            const org = [p.division, p.department].filter(Boolean).join(' - ');
            if (!org) continue;
            const set = departmentsByTitle.get(p.title) ?? new Set<string>();
            set.add(org);
            departmentsByTitle.set(p.title, set);
          }

          const requests = batch
            .map((title) => {
              const hits = shortlists.get(title) ?? [];
              const shortlist: AiShortlistProfile[] = hits.map((h) => ({
                id: h.profile.id,
                positionName: h.profile.positionName,
                divisionDepartment: h.profile.divisionDepartment ?? null,
                jobPurpose: purposeById.get(h.profile.id) ?? null,
                similarity: h.similarity,
              }));
              return {
                title,
                departments: Array.from(departmentsByTitle.get(title) ?? []),
                shortlist,
              };
            })
            .filter((r) => r.shortlist.length > 0);

          const { available, decisions } = await aiMatchTitles(requests);
          aiAvailable = available;

          if (decisions.size > 0) {
            const model = aiMatchModelName();
            const now = new Date();
            const cacheRows: (typeof jobFamilyAiMatchCache.$inferInsert)[] = [];

            for (const [title, decision] of decisions) {
              // Below the confidence floor the pick is discarded — and cached as
              // "none", so the same guess is not re-litigated every run.
              const accepted =
                decision.jobProfileId != null && decision.confidence >= AI_MATCH_MIN_CONFIDENCE
                  ? profileById.get(decision.jobProfileId) ?? null
                  : null;

              if (accepted) {
                aiMap.set(title, {
                  profile: accepted,
                  confidence: decision.confidence,
                  reason: decision.reason,
                });
              }

              cacheRows.push({
                titleKey: normalizeTitle(title).slice(0, 400),
                title,
                jobProfileId: accepted ? accepted.id : null,
                confidence: decision.confidence,
                reason: decision.reason || null,
                model: model.slice(0, 120),
                updatedAt: now,
              });
            }

            // One statement, not one per title: this loop used to await a
            // round-trip per decision, so a full 150-title batch spent several
            // seconds on the wire after the LLM calls were already done. Two
            // titles can normalize to the same key, and Postgres refuses to
            // update the same row twice in one ON CONFLICT statement, so dedupe
            // on titleKey first — last decision wins, as the per-row upsert did.
            const byKey = new Map(cacheRows.map((r) => [r.titleKey, r]));
            await db
              .insert(jobFamilyAiMatchCache)
              .values(Array.from(byKey.values()))
              .onConflictDoUpdate({
                target: jobFamilyAiMatchCache.titleKey,
                set: {
                  title: sql`excluded.title`,
                  jobProfileId: sql`excluded.job_profile_id`,
                  confidence: sql`excluded.confidence`,
                  reason: sql`excluded.reason`,
                  model: sql`excluded.model`,
                  updatedAt: sql`excluded.updated_at`,
                },
              });
          }
        }
      }
    } catch (err) {
      // job_family_ai_match_cache arrives with drizzle/0059. Until that
      // migration runs — and on any transient DB failure — the tier degrades
      // to unavailable instead of taking the whole match report down.
      console.error('[JOB-FAMILY] AI tier skipped:', err);
      aiAvailable = false;
    }
  }

  // Resolve pending candidates (embMap, then the AI tier; the rest are unmatched).
  for (const p of pendingCandidates) {
    const div = {
      ...(p.tenantId ? { tenantId: p.tenantId } : {}),
      ...(p.companyId ? { companyId: p.companyId } : {}),
    };
    const hit = embMap?.get(p.title);
    if (hit) {
      matched.push({
        candidateId: p.id,
        candidateName: p.name,
        currentPosition: p.title,
        jobProfileId: hit.profile.id,
        jobProfileName: hit.profile.positionName,
        matchType: 'embedding',
        similarity: hit.similarity,
        ...(p.positionId ? { positionId: p.positionId } : {}),
        ...div,
      });
      continue;
    }

    const aiHit = aiMap.get(p.title);
    if (aiHit) {
      matched.push({
        candidateId: p.id,
        candidateName: p.name,
        currentPosition: p.title,
        jobProfileId: aiHit.profile.id,
        jobProfileName: aiHit.profile.positionName,
        matchType: 'ai',
        aiConfidence: aiHit.confidence,
        ...(aiHit.reason ? { aiReason: aiHit.reason } : {}),
        ...(p.positionId ? { positionId: p.positionId } : {}),
        ...div,
      });
      continue;
    }

    unmatchedCandidates.push({
      candidateId: p.id,
      candidateName: p.name,
      currentPosition: p.title,
      scenario: p.positionId ? 'no-jd' : 'no-active-position',
      ...div,
    });
  }

  // Resolve pending position titles (for the unmatched-positions stat).
  const unmatchedPositionSet = new Set<string>();
  for (const t of pendingPositionTitles) {
    if (!embMap?.get(t) && !aiMap.get(t)) unmatchedPositionSet.add(t);
  }

  // ── Profiles with no candidate incumbent ──
  // Several JD files can share the SAME position_name (e.g. "Cashier" appears
  // twice). A candidate only matches ONE of them, so its identical-named
  // sibling(s) would wrongly stay "tanpa incumbent" — showing the same title in
  // both the matched and unmatched lists. Treat a profile as covered when a
  // candidate matched it OR matched another profile with the same normalized
  // position_name.
  const matchedProfileIds = new Set(matched.map((m) => m.jobProfileId));
  const matchedNames = new Set<string>();
  for (const m of matched) matchedNames.add(normalizeTitle(m.jobProfileName));

  const unmatchedProfileBase = profiles.filter((p) => {
    if (matchedProfileIds.has(p.id)) return false;
    if (matchedNames.has(normalizeTitle(p.positionName))) return false; // same-name sibling matched
    return true;
  });

  // Scenario per unmatched profile: aggregate active incumbents of its position
  // (by file-name code == sep.position_id) with their candidate/tenant status,
  // in one batch query.
  const profileCode = new Map<number, string | null>();
  for (const r of profileRows) {
    const c = parseJobProfileFileName(r.fileName).code;
    profileCode.set(r.id, c ? normalizeCode(c) : null);
  }
  const codes = Array.from(
    new Set(
      unmatchedProfileBase.map((p) => profileCode.get(p.id)).filter((x): x is string => !!x),
    ),
  );
  const codeAgg = new Map<string, { sel: boolean; other: boolean; non: boolean }>();
  if (codes.length > 0) {
    const tenantListSql = sql.join(selectedTenantIds.map((id) => sql`${id}`), sql`, `);
    const aggRes = await db.execute(sql`
      SELECT upper(sep.position_id) AS code,
        bool_or(c.id IS NOT NULL AND c.tenant_id::text IN (${tenantListSql}))     AS has_cand_selected,
        bool_or(c.id IS NOT NULL AND c.tenant_id::text NOT IN (${tenantListSql})) AS has_cand_other,
        bool_or(c.id IS NULL)                                                     AS has_non_cand
      FROM sync_employee_positions sep
      -- Soft-deleted candidates must not count as an incumbent: the join is
      -- skipped for them, so they fall into has_non_cand (still an employee,
      -- no longer a candidate) instead of claiming the profile.
      LEFT JOIN candidates c
        ON LPAD(c.employee_id, 5, '0') = sep.employee_id
       AND c.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM sync_company_tenant_map cm
         WHERE cm.tenant_id = c.tenant_id AND cm.is_active = true AND cm.company_id = sep.company_id
       )
      WHERE sep.valid_to > CURRENT_DATE
        AND upper(sep.position_id) IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
      GROUP BY upper(sep.position_id)
    `);
    for (const r of aggRes.rows as any[]) {
      codeAgg.set(String(r.code), {
        sel: r.has_cand_selected === true,
        other: r.has_cand_other === true,
        non: r.has_non_cand === true,
      });
    }
  }

  const unmatchedProfiles: UnmatchedProfile[] = [];
  for (const p of unmatchedProfileBase) {
    const code = profileCode.get(p.id);
    const agg = code ? codeAgg.get(code) : undefined;
    // Position code IS held by a matched selected-tenant candidate (who paired
    // with a same-code sibling JD) → already has an incumbent; drop it.
    if (agg?.sel) continue;
    const scenario: ProfileScenario = !agg
      ? 'no-active-incumbent'
      : agg.other
        ? 'candidate-other-tenant'
        : agg.non
          ? 'non-candidate-incumbent'
          : 'no-active-incumbent';
    unmatchedProfiles.push({
      jobProfileId: p.id,
      positionName: p.positionName,
      divisionDepartment: p.divisionDepartment ?? null,
      scenario,
    });
  }

  // Stable ordering for display.
  matched.sort((a, b) => a.candidateName.localeCompare(b.candidateName));
  unmatchedCandidates.sort((a, b) => a.candidateName.localeCompare(b.candidateName));
  unmatchedProfiles.sort((a, b) => a.positionName.localeCompare(b.positionName));
  const unmatchedPositions = Array.from(unmatchedPositionSet).sort((a, b) => a.localeCompare(b));

  return {
    embeddingAvailable,
    aiEnabled,
    aiAvailable,
    aiDeferredTitles,
    selectedTenantIds,
    stats: {
      totalCandidates: candidates.length,
      totalProfiles: profiles.length,
      totalCurrentPositions: positionTitles.length,
      matchedCandidates: matched.length,
      unmatchedCandidates: unmatchedCandidates.length,
      unmatchedProfiles: unmatchedProfiles.length,
      unmatchedPositions: unmatchedPositions.length,
    },
    matched,
    unmatchedCandidates,
    unmatchedProfiles,
    unmatchedPositions,
  };
}

// ── Candidate enrichment detail (for the unmatched-candidate dropdown) ──
//
// Everything obtainable about a candidate whose current position has no job
// profile: their candidate profile fields plus every scrap of context about the
// position itself (master row, supervising position, subordinate count, and the
// co-incumbents who share the same active position across the company).

export type CandidateEnrichmentDetail = {
  candidate: {
    id: string;
    name: string;
    employeeId: string | null;
    email: string | null;
    currentPosition: string | null;
    department: string | null;
    division: string | null;
    yearsExperience: number | null;
    grade: string | null;
    education: string | null;
    major: string | null;
    performanceGrade: string | null;
    havQuadrant: string | null;
    behaviorRecommendation: string | null;
    disciplineStatus: string | null;
    mcuStatus: string | null;
    photoUrl: string | null;
  };
  position: {
    companyId: string | null;
    positionId: string | null;
    internalTitle: string | null;
    externalTitle: string | null;
    summary: string | null;
    gradeId: string | null;
    posLevelNo: number | null;
    validFrom: string | null;
    supervisorTitle: string | null;
    subordinateCount: number;
    coIncumbents: { employeeId: string; name: string | null; isCandidate: boolean }[];
  } | null;
  competencies: {
    technicalName: string | null;
    proficiencyName: string | null;
    currentProficiencyName: string | null;
  }[];
  history: {
    title: string | null;
    gradeId: string | null;
    validFrom: string | null;
    validTo: string | null;
  }[];
};

const toIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;

// Demo mode: candidate and co-incumbent names leave the server as initials.
export async function getCandidateDetailAction(
  ...args: Parameters<typeof getCandidateDetailActionImpl>
): ReturnType<typeof getCandidateDetailActionImpl> {
  return demoScrub(await getCandidateDetailActionImpl(...args));
}

async function getCandidateDetailActionImpl(
  candidateId: string,
): Promise<CandidateEnrichmentDetail | null> {
  await requirePermission('job_profiles.view');

  // Candidate + current active position (year(valid_to) = 9999) master row.
  const base = await db.execute(sql`
    SELECT
      c.id::text            AS id,
      c.name                AS name,
      c.employee_id         AS employee_id,
      c.email               AS email,
      c.current_position    AS current_position,
      c.department          AS department,
      c.division            AS division,
      c.years_experience    AS years_experience,
      c.grade               AS grade,
      c.education           AS education,
      c.major               AS major,
      c.performance_grade   AS performance_grade,
      c.hav_quadrant        AS hav_quadrant,
      c.behavior_recommendation AS behavior_recommendation,
      c.discipline_status   AS discipline_status,
      c.mcu_status          AS mcu_status,
      c.photo_url           AS photo_url,
      sctm.company_id       AS company_id,
      sep.position_id       AS position_id,
      sep.valid_from        AS position_valid_from,
      sp.internal_title     AS internal_title,
      sp.external_title     AS external_title,
      sp.summary            AS position_summary,
      sp.grade_id           AS position_grade_id,
      sp.pos_level_no       AS pos_level_no
    FROM candidates c
    LEFT JOIN sync_company_tenant_map sctm
      ON sctm.tenant_id = c.tenant_id AND sctm.is_active = true
    LEFT JOIN sync_employee_positions sep
      ON sep.company_id = sctm.company_id
     AND sep.employee_id = LPAD(c.employee_id, 5, '0')
     AND sep.valid_to > CURRENT_DATE
    LEFT JOIN sync_positions sp
      ON sp.company_id = sep.company_id AND sp.position_id = sep.position_id
    WHERE c.id = ${candidateId}
      AND c.deleted_at IS NULL
    ORDER BY sep.primary_position DESC NULLS LAST, sep.valid_from DESC NULLS LAST
    LIMIT 1
  `);

  const baseRow = (base.rows as any[])[0];
  if (!baseRow) return null;
  // Demo mode shows the candidate's demo copy (lib/demo/), photo removed.
  const demo = await isDemoMode();
  const [row] = await forCurrentMode([baseRow as Record<string, any>], (r) => String(r.id), { onlyOn: false });
  if (!row) return null;
  // The HAV in force (manual > upload > formula), as on every other candidate view.
  const [hav] = await withEffectiveHav([
    {
      id: row.id as string,
      havQuadrant: row.hav_quadrant ?? null,
      performanceGrade: row.performance_grade ?? null,
      behaviorRecommendation: row.behavior_recommendation ?? null,
    },
  ]);

  const companyId: string | null = row.company_id ?? null;
  const positionId: string | null = row.position_id ?? null;
  const employeeId: string | null = row.employee_id ?? null;

  // Position context (supervisor / subordinates / co-incumbents) — only when
  // the candidate has a resolved active position.
  let position: CandidateEnrichmentDetail['position'] = null;
  if (positionId && companyId) {
    const [supRes, subRes, coRes] = await Promise.all([
      db.execute(sql`
        SELECT COALESCE(psp.internal_title, psp.external_title) AS supervisor_title
        FROM sync_position_hierarchy sph
        LEFT JOIN sync_positions psp
          ON psp.company_id = ${companyId} AND psp.position_id = sph.parent_position_id
        WHERE sph.company_id = ${companyId} AND sph.position_id = ${positionId}
          AND sph.valid_to > CURRENT_DATE
        LIMIT 1
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS n
        FROM sync_position_hierarchy sph
        WHERE sph.company_id = ${companyId} AND sph.parent_position_id = ${positionId}
          AND sph.valid_to > CURRENT_DATE
      `),
      // Co-incumbents = everyone else holding this active position. Names come
      // from sync_employees (covers non-candidates too). sync_employee_positions
      // stores a 5-digit zero-padded employee_id (e.g. "00682") while
      // sync_employees / candidates use 4 digits ("0682"), so both sides are
      // zero-padded to 5 before comparison. is_candidate flags whether the
      // employee also exists in candidates.
      db.execute(sql`
        SELECT sep.employee_id AS employee_id,
               COALESCE(se.display_name, se.internal_title) AS name,
               EXISTS (
                 SELECT 1 FROM candidates cc
                 WHERE LPAD(cc.employee_id, 5, '0') = sep.employee_id
                   AND cc.deleted_at IS NULL
               ) AS is_candidate
        FROM sync_employee_positions sep
        LEFT JOIN sync_employees se
          ON se.company_id = sep.company_id
         AND LPAD(se.employee_id, 5, '0') = sep.employee_id
        WHERE sep.company_id = ${companyId} AND sep.position_id = ${positionId}
          AND sep.valid_to > CURRENT_DATE
          AND sep.employee_id <> LPAD(${employeeId ?? ''}, 5, '0')
        ORDER BY name NULLS LAST
        LIMIT 25
      `),
    ]);

    position = {
      companyId,
      positionId,
      internalTitle: row.internal_title ?? null,
      externalTitle: row.external_title ?? null,
      summary: row.position_summary ?? null,
      gradeId: row.position_grade_id ?? null,
      posLevelNo: row.pos_level_no ?? null,
      validFrom: toIso(row.position_valid_from),
      supervisorTitle: (supRes.rows as any[])[0]?.supervisor_title ?? null,
      subordinateCount: Number((subRes.rows as any[])[0]?.n ?? 0),
      coIncumbents: (coRes.rows as any[]).map((r) => ({
        // sync_employee_positions ids are 5-digit zero-padded ("00682"); drop the
        // leading 0 to match the 4-digit form used by sync_employees/candidates.
        employeeId: String(r.employee_id).replace(/^0/, ''),
        name: r.name ?? null,
        isCandidate: r.is_candidate === true,
      })),
    };
  }

  const [compRes, histRes] = await Promise.all([
    db.execute(sql`
      SELECT technical_name, proficiency_name, current_proficiency_name
      FROM candidate_technical_competencies
      WHERE candidate_id = ${candidateId}
      ORDER BY technical_name NULLS LAST
      LIMIT 60
    `),
    db.execute(sql`
      SELECT COALESCE(internal_title, external_title) AS title,
             grade_id, valid_from, valid_to
      FROM candidate_position_history
      WHERE candidate_id = ${candidateId}
      ORDER BY valid_from DESC NULLS LAST
      LIMIT 40
    `),
  ]);

  const demoCompetencies = demo ? (await loadDemoCopies([String(row.id)])).get(String(row.id))?.technicalCompetencies ?? null : null;
  const detail: CandidateEnrichmentDetail = {
    candidate: {
      id: row.id,
      name: row.name,
      employeeId,
      email: row.email ?? null,
      currentPosition: row.current_position ?? null,
      department: row.department ?? null,
      division: row.division ?? null,
      yearsExperience:
        row.years_experience == null || row.years_experience === ''
          ? null
          : Number.isNaN(Number(row.years_experience))
            ? row.years_experience
            : Number(row.years_experience),
      grade: row.grade ?? null,
      education: row.education ?? null,
      major: row.major ?? null,
      performanceGrade: row.performance_grade ?? null,
      havQuadrant: hav?.havQuadrant ?? null,
      behaviorRecommendation: row.behavior_recommendation ?? null,
      disciplineStatus: row.discipline_status ?? null,
      mcuStatus: row.mcu_status ?? null,
      photoUrl: row.photo_url ?? null,
    },
    position,
    competencies: (compRes.rows as any[]).map((r) => ({
      technicalName: r.technical_name ?? null,
      proficiencyName: r.proficiency_name ?? null,
      currentProficiencyName: r.current_proficiency_name ?? null,
    })),
    history: (histRes.rows as any[]).map((r) => ({
      title: r.title ?? null,
      gradeId: r.grade_id ?? null,
      validFrom: toIso(r.valid_from),
      validTo: toIso(r.valid_to),
    })),
  };
  if (!demo) return detail;
  // Demo mode: no NPK and no position code leaves the server; a demo copy that
  // lists competencies replaces the real ones, as everywhere else.
  return {
    ...detail,
    candidate: { ...detail.candidate, employeeId: detail.candidate.employeeId ? MASKED_NPK : null, photoUrl: null },
    position: detail.position
      ? {
          ...detail.position,
          positionId: detail.position.positionId ? MASKED_CODE : null,
          coIncumbents: detail.position.coIncumbents.map((e) => ({ ...e, employeeId: MASKED_NPK })),
        }
      : null,
    competencies: demoCompetencies
      ? demoCompetencies.map((c) => ({
          technicalName: c.technicalName || MASKED_CODE,
          proficiencyName: c.proficiencyName || null,
          currentProficiencyName: c.currentProficiencyName || null,
        }))
      : detail.competencies,
  };
}

// ── Full job profile row (to reuse the existing detail renderer) ──

// Demo mode: purpose and the named sections keep three words per point.
export async function getJobProfileByIdAction(
  ...args: Parameters<typeof getJobProfileByIdActionImpl>
): ReturnType<typeof getJobProfileByIdActionImpl> {
  return demoMaskJobProfile(await getJobProfileByIdActionImpl(...args));
}

async function getJobProfileByIdActionImpl(id: number): Promise<JobProfileRow | null> {
  await requirePermission('job_profiles.view');
  const rows = await db
    .select({
      id: syncJobProfiles.id,
      fileName: syncJobProfiles.fileName,
      filePath: syncJobProfiles.filePath,
      sourceFolder: syncJobProfiles.sourceFolder,
      fileHash: syncJobProfiles.fileHash,
      jobProfileNumber: syncJobProfiles.jobProfileNumber,
      positionName: syncJobProfiles.positionName,
      divisionDepartment: syncJobProfiles.divisionDepartment,
      supervisor: syncJobProfiles.supervisor,
      jobPurpose: syncJobProfiles.jobPurpose,
      extractedData: syncJobProfiles.extractedData,
      status: syncJobProfiles.status,
      errorMessage: syncJobProfiles.errorMessage,
      syncedAt: syncJobProfiles.syncedAt,
      processedAt: syncJobProfiles.processedAt,
      queuedAt: syncJobProfiles.queuedAt,
    })
    .from(syncJobProfiles)
    .where(eq(syncJobProfiles.id, id))
    .limit(1);

  const p = rows[0];
  if (!p) return null;
  // rawText is intentionally not loaded (huge OCR dump, never rendered).
  return { ...p, rawText: null } satisfies JobProfileRow;
}

// ── Why-unmatched diagnosis for a job profile ─────────────────────
//
// Traces a job profile through the source tables to explain why it has no
// candidate incumbent: whether its filename code / position name was FOUND in
// sync_positions & sync_employee_positions, who the active incumbents are, and
// whether those incumbents are candidates (and in which tenant) or only
// non-candidate employees in sync_employees.

export type IncumbentTrace = {
  employeeId: string; // 4-digit normalized
  companyId: string | null;
  positionId: string | null;
  /** how this person's position was linked to the profile: 'code', 'title', or 'code,title' */
  foundVia: string;
  name: string | null;
  /** Extra sync_employees info (shown "seadanya" for non-candidates). */
  internalTitle: string | null;
  division: string | null;
  department: string | null;
  gradeId: string | null;
  inSyncEmployees: boolean;
  inCandidates: boolean;
  candidateTenantId: string | null;
  candidateTenantName: string | null;
  tenantSelected: boolean;
};

export type UnmatchedProfileDiagnosis = {
  jobProfileId: number;
  positionName: string | null;
  fileName: string;
  fileCode: string | null;
  jdNumber: string | null;
  /** filename code == a sync_positions.position_id */
  codeInSyncPositions: boolean;
  /** active (valid_to 9999) sync_employee_positions incumbents for the code */
  activeIncumbents: IncumbentTrace[];
  /** position_name matches an active sync_positions title (exact/substring) */
  titleInSyncPositions: boolean;
  /** a selected-tenant candidate currently holds a position with this title */
  titleHeldByCandidate: boolean;
  reasons: string[];
};

// Demo mode: incumbent names leave the server as initials.
export async function getUnmatchedProfileDiagnosisAction(
  ...args: Parameters<typeof getUnmatchedProfileDiagnosisActionImpl>
): ReturnType<typeof getUnmatchedProfileDiagnosisActionImpl> {
  return demoScrub(await getUnmatchedProfileDiagnosisActionImpl(...args));
}

async function getUnmatchedProfileDiagnosisActionImpl(input: {
  jobProfileId: number;
  selectedTenantIds?: string[];
}): Promise<UnmatchedProfileDiagnosis | null> {
  await requirePermission('job_profiles.view');

  const valid = await liveTenantIdSet();
  const req = (input.selectedTenantIds ?? []).filter((id) => valid.has(id));
  const selectedTenantIds = req.length > 0 ? req : [await getCurrentTenantId()];
  const selectedSet = new Set(selectedTenantIds);
  const tenantNames = await tenantNameMap();
  const tenantName = (id: string | null) => (id ? tenantNames.get(id) ?? null : null);
  const tenantIdsSql = () => sql.join(selectedTenantIds.map((id) => sql`${id}`), sql`, `);

  const prof = (
    await db
      .select({
        id: syncJobProfiles.id,
        positionName: syncJobProfiles.positionName,
        fileName: syncJobProfiles.fileName,
      })
      .from(syncJobProfiles)
      .where(eq(syncJobProfiles.id, input.jobProfileId))
      .limit(1)
  )[0];
  if (!prof) return null;

  const parsed = parseJobProfileFileName(prof.fileName);
  const code = parsed.code;
  const positionName = prof.positionName ?? '';

  // Code → sync_positions?
  let codeInSyncPositions = false;
  if (code) {
    const r = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM sync_positions sp WHERE upper(sp.position_id) = upper(${code})
      ) AS ok
    `);
    codeInSyncPositions = (r.rows as any[])[0]?.ok === true;
  }

  // Active incumbents (people currently holding a matching position), resolved
  // across sync_employee_positions → sync_employees → candidates. The search is
  // EXPANDED to two paths so we also catch non-candidate employees:
  //   • code:  sep.position_id == filename code
  //   • title: sep's position (sync_positions) title matches position_name
  // Person info comes from sync_employees so non-candidates still show "seadanya".
  const activeIncumbents: IncumbentTrace[] = [];
  const codeCond = code ? sql`upper(sep.position_id) = upper(${code})` : sql`false`;
  const titleCond = positionName.trim()
    ? sql`(
        lower(btrim(regexp_replace(COALESCE(sp.internal_title, sp.external_title), '\\s+', ' ', 'g')))
          = lower(btrim(regexp_replace(${positionName}, '\\s+', ' ', 'g')))
        OR lower(COALESCE(sp.internal_title, sp.external_title)) LIKE '%' || lower(${positionName}) || '%'
        OR lower(${positionName}) LIKE '%' || lower(COALESCE(sp.internal_title, sp.external_title)) || '%'
      )`
    : sql`false`;

  if (code || positionName.trim()) {
    const incRes = await db.execute(sql`
      WITH inc AS (
        SELECT sep.employee_id, sep.company_id, sep.position_id, 'code'::text AS via
        FROM sync_employee_positions sep
        WHERE sep.valid_to > CURRENT_DATE AND ${codeCond}
        UNION
        SELECT sep.employee_id, sep.company_id, sep.position_id, 'title'::text AS via
        FROM sync_employee_positions sep
        JOIN sync_positions sp
          ON sp.company_id = sep.company_id AND sp.position_id = sep.position_id
        WHERE sep.valid_to > CURRENT_DATE AND ${titleCond}
      )
      SELECT
        i.employee_id                                     AS employee_id,
        i.company_id                                      AS company_id,
        i.position_id                                     AS position_id,
        string_agg(DISTINCT i.via, ',' ORDER BY i.via)    AS found_via,
        se.display_name                                   AS display_name,
        se.internal_title                                 AS internal_title,
        se.division                                       AS division,
        se.department                                     AS department,
        se.grade_id                                       AS grade_id,
        (se.employee_id IS NOT NULL)                      AS in_sync_employees,
        c.id::text                                        AS candidate_id,
        c.name                                            AS candidate_name,
        c.tenant_id::text                                 AS candidate_tenant_id
      FROM inc i
      LEFT JOIN sync_employees se
        ON se.company_id = i.company_id AND LPAD(se.employee_id, 5, '0') = i.employee_id
      LEFT JOIN candidates c
        ON LPAD(c.employee_id, 5, '0') = i.employee_id
       AND c.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM sync_company_tenant_map cm
         WHERE cm.tenant_id = c.tenant_id AND cm.is_active = true AND cm.company_id = i.company_id
       )
      GROUP BY i.employee_id, i.company_id, i.position_id,
               se.display_name, se.internal_title, se.division, se.department, se.grade_id,
               se.employee_id, c.id, c.name, c.tenant_id
      LIMIT 100
    `);
    const seen = new Set<string>();
    for (const r of incRes.rows as any[]) {
      const emp = String(r.employee_id).replace(/^0/, '');
      if (seen.has(emp)) continue;
      seen.add(emp);
      const candTenant = r.candidate_tenant_id ?? null;
      activeIncumbents.push({
        employeeId: emp,
        companyId: r.company_id ?? null,
        positionId: r.position_id ?? null,
        foundVia: r.found_via ?? '',
        name: r.display_name ?? r.internal_title ?? r.candidate_name ?? null,
        internalTitle: r.internal_title ?? null,
        division: r.division ?? null,
        department: r.department ?? null,
        gradeId: r.grade_id ?? null,
        inSyncEmployees: r.in_sync_employees === true,
        inCandidates: Boolean(r.candidate_id),
        candidateTenantId: candTenant,
        candidateTenantName: tenantName(candTenant),
        tenantSelected: candTenant ? selectedSet.has(candTenant) : false,
      });
    }
  }

  // Title → active sync_positions? (exact normalized OR substring either way)
  let titleInSyncPositions = false;
  if (positionName.trim()) {
    const r = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM sync_positions sp
        WHERE sp.valid_to > CURRENT_DATE
          AND COALESCE(sp.internal_title, sp.external_title) IS NOT NULL
          AND (
            lower(btrim(regexp_replace(COALESCE(sp.internal_title, sp.external_title), '\\s+', ' ', 'g')))
              = lower(btrim(regexp_replace(${positionName}, '\\s+', ' ', 'g')))
            OR lower(COALESCE(sp.internal_title, sp.external_title)) LIKE '%' || lower(${positionName}) || '%'
            OR lower(${positionName}) LIKE '%' || lower(COALESCE(sp.internal_title, sp.external_title)) || '%'
          )
      ) AS ok
    `);
    titleInSyncPositions = (r.rows as any[])[0]?.ok === true;
  }

  // Title → held by a selected-tenant candidate (current active position title)?
  let titleHeldByCandidate = false;
  if (positionName.trim()) {
    const r = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM candidates c
        LEFT JOIN sync_company_tenant_map sctm
          ON sctm.tenant_id = c.tenant_id AND sctm.is_active = true
        LEFT JOIN sync_employee_positions sep
          ON sep.company_id = sctm.company_id
         AND sep.employee_id = LPAD(c.employee_id, 5, '0')
         AND sep.valid_to > CURRENT_DATE
        LEFT JOIN sync_positions sp
          ON sp.company_id = sep.company_id AND sp.position_id = sep.position_id
        WHERE c.tenant_id::text IN (${tenantIdsSql()})
          AND c.deleted_at IS NULL
          AND (
            lower(btrim(regexp_replace(COALESCE(sp.internal_title, sp.external_title, c.current_position, ''), '\\s+', ' ', 'g')))
              = lower(btrim(regexp_replace(${positionName}, '\\s+', ' ', 'g')))
            OR lower(COALESCE(sp.internal_title, sp.external_title, c.current_position, '')) LIKE '%' || lower(${positionName}) || '%'
            OR lower(${positionName}) LIKE '%' || NULLIF(lower(COALESCE(sp.internal_title, sp.external_title, c.current_position, '')), '') || '%'
          )
      ) AS ok
    `);
    titleHeldByCandidate = (r.rows as any[])[0]?.ok === true;
  }

  // ── Build human-readable reasons ──
  const reasons: string[] = [];
  const foundViaCode = activeIncumbents.some((i) => i.foundVia.includes('code'));
  const foundViaTitle = activeIncumbents.some((i) => i.foundVia.includes('title'));

  // Code presence note
  if (!code) {
    reasons.push('Nama file tidak diawali kode posisi, sehingga jalur pencocokan nama_file → position_id tidak dapat dipakai.');
  } else if (codeInSyncPositions || foundViaCode) {
    const where = [codeInSyncPositions ? 'sync_positions' : null, foundViaCode ? 'sync_employee_positions (aktif)' : null]
      .filter(Boolean)
      .join(', ');
    reasons.push(`Kode "${code}" DITEMUKAN di: ${where}.`);
  } else {
    reasons.push(`Kode "${code}" tidak ditemukan sebagai position_id di sync_positions maupun sync_employee_positions aktif.`);
  }

  // Incumbent people (search diperluas: via kode DAN via nama posisi → sync_employees)
  if (activeIncumbents.length === 0) {
    reasons.push('Tidak ada orang (kandidat maupun karyawan) yang aktif menduduki posisi ini — tak ada incumbent yang bisa dicocokkan.');
  } else {
    reasons.push(
      `Ditemukan ${activeIncumbents.length} orang yang menduduki posisi ini (lewat ${[foundViaCode ? 'kode nama_file' : null, foundViaTitle ? 'nama posisi' : null].filter(Boolean).join(' & ')}).`,
    );
    {
      const cands = activeIncumbents.filter((i) => i.inCandidates);
      if (cands.length === 0) {
        const inSE = activeIncumbents.filter((i) => i.inSyncEmployees).length;
        const onlySEP = activeIncumbents.length - inSE;
        const where =
          onlySEP > 0
            ? `${inSE} ada di sync_employees, ${onlySEP} hanya di sync_employee_positions (data karyawan tak lengkap)`
            : 'semuanya ada di sync_employees';
        reasons.push(
          `TIDAK ADA yang terdaftar di candidates (${where}) — ditampilkan seadanya dengan label "non-candidate" di bawah. Karena "Profil Tanpa Incumbent" dihitung berbasis kandidat, profil ini tetap masuk daftar.`,
        );
      } else {
        const selected = cands.filter((c) => c.tenantSelected);
        if (selected.length === 0) {
          const names = Array.from(new Set(cands.map((c) => c.candidateTenantName).filter(Boolean)));
          reasons.push(
            `Incumbent adalah kandidat, tetapi di Company yang TIDAK dicentang (${names.join(', ') || 'Company lain'}). Centang Company tersebut agar profil ini masuk pencocokan.`,
          );
        } else {
          reasons.push(
            'Posisi ini diduduki kandidat Company terpilih, tetapi kandidat itu dipasangkan ke JD LAIN yang berbagi kode/posisi sama namun judulnya lebih cocok. JD ini judulnya berbeda, jadi tidak mendapat pasangan (JD kembar kode).',
          );
        }
      }
    }
  }

  // Title path
  if (positionName.trim()) {
    if (!titleInSyncPositions) {
      reasons.push(`Nama posisi "${positionName}" tidak cocok (exact/sebagian) dengan judul posisi aktif mana pun di sync_positions.`);
    }
    if (!titleHeldByCandidate) {
      reasons.push('Tidak ada kandidat (di Company terpilih) yang menduduki posisi dengan nama ini → jalur nama_posisi juga tidak menghasilkan pasangan.');
    }
  }

  return {
    jobProfileId: prof.id,
    positionName: prof.positionName,
    fileName: prof.fileName,
    fileCode: code,
    jdNumber: parsed.jdNumber,
    codeInSyncPositions,
    activeIncumbents,
    titleInSyncPositions,
    titleHeldByCandidate,
    reasons,
  };
}

// ── Why-unmatched diagnosis for a candidate ───────────────────────
//
// Explains why a candidate's CURRENT position matches no job profile: shows the
// candidate's position_id (from sync_employee_positions) + the title used, then
// checks BOTH matching paths — position_id ↔ file-name code, and position title
// ↔ job-profile position_name — and reports what failed.

export type UnmatchedCandidateDiagnosis = {
  candidateId: string;
  candidateName: string;
  employeeId: string | null; // 4-digit
  companyId: string | null;
  hasActivePosition: boolean;
  positionId: string | null;
  positionTitle: string | null;
  titleSource: 'sync_positions' | 'candidates.current_position' | 'none';
  positionInSyncPositions: boolean;
  /** position_id equals a job-profile file-name code */
  positionIdMatchesFilename: boolean;
  /** job-profile file-name codes sharing the position_id's alpha prefix */
  filenameCodesSamePrefix: string[];
  /** position title matches a job-profile position_name (exact/substring) */
  titleMatchesProfile: boolean;
  matchingProfileNames: string[];
  reasons: string[];
};

// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function getUnmatchedCandidateDiagnosisAction(
  ...args: Parameters<typeof getUnmatchedCandidateDiagnosisActionImpl>
): ReturnType<typeof getUnmatchedCandidateDiagnosisActionImpl> {
  return demoScrub(await getUnmatchedCandidateDiagnosisActionImpl(...args));
}

async function getUnmatchedCandidateDiagnosisActionImpl(
  candidateId: string,
): Promise<UnmatchedCandidateDiagnosis | null> {
  await requirePermission('job_profiles.view');

  // Candidate + current active position (valid_to > today) — same definition as
  // the main matching, so the diagnosis reflects the exact inputs used.
  const base = await db.execute(sql`
    SELECT DISTINCT ON (c.id)
      c.id::text                                   AS id,
      c.name                                       AS name,
      c.employee_id                                AS employee_id,
      c.current_position                           AS current_position,
      COALESCE(sep.company_id, sctm.company_id)    AS company_id,
      sep.position_id                              AS position_id,
      COALESCE(sp.internal_title, sp.external_title) AS sync_title
    FROM candidates c
    LEFT JOIN sync_company_tenant_map sctm
      ON sctm.tenant_id = c.tenant_id AND sctm.is_active = true
    LEFT JOIN sync_employee_positions sep
      ON sep.company_id = sctm.company_id
     AND sep.employee_id = LPAD(c.employee_id, 5, '0')
     AND sep.valid_to > CURRENT_DATE
    LEFT JOIN sync_positions sp
      ON sp.company_id = sep.company_id AND sp.position_id = sep.position_id
    WHERE c.id = ${candidateId}
      AND c.deleted_at IS NULL
    ORDER BY c.id, sep.primary_position DESC NULLS LAST, sep.valid_from DESC NULLS LAST
    LIMIT 1
  `);
  const row = (base.rows as any[])[0];
  if (!row) return null;

  const positionId: string | null = row.position_id?.trim() || null;
  const syncTitle: string | null = row.sync_title?.trim() || null;
  const currentPosition: string | null = row.current_position?.trim() || null;
  const positionTitle = syncTitle ?? currentPosition ?? null;
  const titleSource: UnmatchedCandidateDiagnosis['titleSource'] = syncTitle
    ? 'sync_positions'
    : currentPosition
      ? 'candidates.current_position'
      : 'none';

  // position_id present in sync_positions?
  let positionInSyncPositions = false;
  if (positionId) {
    const r = await db.execute(sql`
      SELECT EXISTS (SELECT 1 FROM sync_positions sp WHERE upper(sp.position_id) = upper(${positionId})) AS ok
    `);
    positionInSyncPositions = (r.rows as any[])[0]?.ok === true;
  }

  // Filename tier: position_id == a job-profile file-name code?
  let positionIdMatchesFilename = false;
  let filenameCodesSamePrefix: string[] = [];
  if (positionId) {
    const r = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM sync_job_profiles jp
        WHERE jp.status = 'completed'
          AND upper(split_part(jp.file_name, ' ', 1)) = upper(${positionId})
      ) AS ok
    `);
    positionIdMatchesFilename = (r.rows as any[])[0]?.ok === true;

    const prefix = positionId.match(/^[A-Za-z]+/)?.[0] ?? '';
    if (prefix) {
      const pr = await db.execute(sql`
        SELECT DISTINCT split_part(jp.file_name, ' ', 1) AS code
        FROM sync_job_profiles jp
        WHERE jp.status = 'completed'
          AND upper(split_part(jp.file_name, ' ', 1)) LIKE upper(${prefix}) || '%'
        ORDER BY 1
        LIMIT 6
      `);
      filenameCodesSamePrefix = (pr.rows as any[]).map((x) => String(x.code)).filter(Boolean);
    }
  }

  // Title tier: position title matches a job-profile position_name?
  let titleMatchesProfile = false;
  let matchingProfileNames: string[] = [];
  if (positionTitle) {
    const r = await db.execute(sql`
      SELECT jp.position_name
      FROM sync_job_profiles jp
      WHERE jp.status = 'completed' AND jp.position_name IS NOT NULL
        AND (
          lower(btrim(regexp_replace(jp.position_name, '\\s+', ' ', 'g')))
            = lower(btrim(regexp_replace(${positionTitle}, '\\s+', ' ', 'g')))
          OR lower(jp.position_name) LIKE '%' || lower(${positionTitle}) || '%'
          OR lower(${positionTitle}) LIKE '%' || lower(jp.position_name) || '%'
        )
      LIMIT 5
    `);
    matchingProfileNames = (r.rows as any[]).map((x) => String(x.position_name));
    titleMatchesProfile = matchingProfileNames.length > 0;
  }

  // ── Reasons ──
  const reasons: string[] = [];
  const hasActivePosition = positionId !== null;

  if (!hasActivePosition) {
    reasons.push(
      'Kandidat tidak memiliki posisi aktif di sync_employee_positions (valid_to > hari ini) → tidak ada position_id, sehingga jalur nama_file → position_id tak dapat dipakai.',
    );
  } else {
    reasons.push(
      `position_id kandidat: "${positionId}"${positionInSyncPositions ? ' (terdaftar di sync_positions)' : ' (TIDAK ada di sync_positions)'}.`,
    );
    if (positionIdMatchesFilename) {
      reasons.push('position_id COCOK dengan kode nama file — seharusnya masuk pasangan (perlu ditinjau).');
    } else {
      reasons.push(
        `Tidak ada job profile dengan kode nama file = "${positionId}"` +
          (filenameCodesSamePrefix.length
            ? `, meski ada job profile berawalan sama: ${filenameCodesSamePrefix.join(', ')} (posisi ini belum punya JD).`
            : ' (tak ada JD berkode serupa).'),
      );
    }
  }

  if (!positionTitle) {
    reasons.push('Judul posisi kosong → jalur nama_posisi tak dapat dipakai.');
  } else if (titleMatchesProfile) {
    reasons.push(`Judul "${positionTitle}" COCOK dengan job profile: ${matchingProfileNames.join(', ')} — seharusnya masuk pasangan (perlu ditinjau).`);
  } else {
    reasons.push(
      `Judul posisi "${positionTitle}" (sumber: ${titleSource}) tidak cocok exact/sebagian dengan position_name job profile mana pun. ` +
        'Jika tier embedding aktif, kemiripannya juga ≤ 98%. Bila tier AI aktif, AI pun menilai ' +
          'tidak ada JD pada daftar terdekat yang fungsi & levelnya sama (atau keyakinannya di bawah ambang), ' +
          'sehingga tetap tak dipasangkan.',
    );
  }

  return {
    candidateId: row.id,
    candidateName: row.name,
    employeeId: row.employee_id ?? null,
    companyId: row.company_id?.trim() || null,
    hasActivePosition,
    positionId,
    positionTitle,
    titleSource,
    positionInSyncPositions,
    positionIdMatchesFilename,
    filenameCodesSamePrefix,
    titleMatchesProfile,
    matchingProfileNames,
    reasons,
  };
}

// ── Persist matches to job_family_matches ─────────────────────────

export type SaveMatchesResult = { ok: boolean; saved: number; message: string };

/**
 * Snapshot-save the current matching result into job_family_matches: replaces
 * the LIVE part of the table (delete + insert) so it always reflects the latest
 * run. One row per candidate, mapping job profile ↔ candidate ↔
 * candidate_position with the match type + reason.
 */
export async function saveMatchesToDbAction(matches: MatchedPair[]): Promise<SaveMatchesResult> {
  await requirePermission('job_profiles.manage');
  // Demo mode never writes the real mapping: the pairs it would save carry
  // demo-copy names (lib/demo/), and job_family_matches feeds real scoring.
  if (await isDemoMode()) return { ok: false, saved: 0, message: 'Aksi ini tidak tersedia.' };
  try {
    // Manual pins are owned by setManualMatchAction / removeManualMatchAction
    // alone: this snapshot neither deletes nor rewrites them. Excluding them
    // from the INSERT is what makes excluding them from the DELETE safe — the
    // report carries pins in `matched`, so re-inserting them while the delete
    // spares them would collide on uq_job_family_matches_candidate.
    const rows = matches
      .filter((m) => m.matchType !== 'manual')
      .map((m) => ({
        candidateId: m.candidateId,
        candidateName: m.candidateName?.slice(0, 255) ?? null,
        tenantId: m.tenantId ?? null,
        companyId: m.companyId?.slice(0, 20) ?? null,
        candidatePosition: m.currentPosition?.slice(0, 400) ?? null,
        positionId: (m.positionId ?? m.matchedCode)?.slice(0, 40) ?? null,
        jobProfileId: m.jobProfileId,
        jobProfileName: m.jobProfileName?.slice(0, 400) ?? null,
        matchType: m.matchType,
        similarity: m.similarity ?? null,
        matchedCode: m.matchedCode?.slice(0, 60) ?? null,
        jdNumber: m.jdNumber?.slice(0, 60) ?? null,
        fileName: m.fileName?.slice(0, 500) ?? null,
        matchedPart: null,
        reason: { ...m } as Record<string, unknown>,
      }));

    await db.transaction(async (tx) => {
      // INVARIANT — never widen this delete back to the whole table.
      // `matches` comes from the live report, which excludes soft-deleted
      // candidates, so a blanket delete would permanently drop the
      // job_family_matches row of every tombstoned candidate. That is exactly
      // the cascade loss drizzle/0045_candidates_soft_delete.sql introduced the
      // tombstone to prevent, and those rows are read back as history — a
      // finished run's Job Family map places its finalists through them
      // (lib/position-family-map-actions.ts getPositionFamilyMapAction), so
      // losing them turns a completed run into a map with holes ('no-match').
      // Deleting only rows whose candidate is still live keeps the snapshot
      // exact for everyone the report can still see, and inert for the rest.
      //
      // Manual pins are spared for a different reason: they are human decisions
      // that no re-run can reproduce. The report's tenant selection does not
      // bound this delete, so a save made with one business unit ticked would
      // otherwise wipe pins belonging to every other unit — the same hazard the
      // tombstone carve-out above exists to prevent, but on data that cannot be
      // recomputed at all.
      await tx.delete(jobFamilyMatches).where(
        and(
          ne(jobFamilyMatches.matchType, 'manual'),
          exists(
            tx
              .select({ id: candidates.id })
              .from(candidates)
              .where(and(eq(candidates.id, jobFamilyMatches.candidateId), liveCandidate())),
          ),
        ),
      );
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        if (chunk.length) await tx.insert(jobFamilyMatches).values(chunk);
      }
    });

    return { ok: true, saved: rows.length, message: `Tersimpan ${rows.length} pemetaan ke database.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation "?job_family_matches"?\s+does not exist/i.test(msg)) {
      return {
        ok: false,
        saved: 0,
        message:
          'Tabel job_family_matches belum ada. Jalankan migrasi drizzle/0032_job_family_matches.sql.',
      };
    }
    return { ok: false, saved: 0, message: msg };
  }
}

// ── Manual matching ───────────────────────────────────────────────
// The escape hatch for what the automatic tiers structurally cannot solve: a
// candidate with no active position_id, a title nobody wrote a JD under, or a
// JD filed under a code HR never assigned. Persisted immediately — unlike the
// automatic result, which is a snapshot the operator saves in bulk, a pin is a
// single deliberate decision and waiting for a later "Simpan Pemetaan" would
// lose it if the page were closed first.

export type ManualMatchResult = { ok: boolean; message: string };

export type JobProfileOption = {
  id: number;
  positionName: string;
  divisionDepartment: string | null;
  fileName: string | null;
};

/** Job profiles selectable as a manual match target. */
export async function searchJobProfilesForMatchAction(
  query: string,
  limit = 50,
): Promise<JobProfileOption[]> {
  await requirePermission('job_profiles.view');
  const q = query.trim();
  // Not tenant-scoped, matching this report's documented cross-tenant scope
  // (see the file header): a candidate may legitimately be pinned to a JD
  // owned by another business unit's folder.
  const where = [eq(syncJobProfiles.status, 'completed'), isNotNull(syncJobProfiles.positionName)];
  if (q) {
    const like = `%${q}%`;
    const fuzzy = or(
      ilike(syncJobProfiles.positionName, like),
      ilike(syncJobProfiles.fileName, like),
      ilike(syncJobProfiles.divisionDepartment, like),
    );
    if (fuzzy) where.push(fuzzy);
  }
  const rows = await db
    .select({
      id: syncJobProfiles.id,
      positionName: syncJobProfiles.positionName,
      divisionDepartment: syncJobProfiles.divisionDepartment,
      fileName: syncJobProfiles.fileName,
    })
    .from(syncJobProfiles)
    .where(and(...where))
    .orderBy(syncJobProfiles.positionName)
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((r) => ({
    id: r.id,
    positionName: r.positionName ?? `JD #${r.id}`,
    divisionDepartment: r.divisionDepartment,
    fileName: r.fileName,
  }));
}

/**
 * Pin a candidate to a job profile by hand.
 *
 * Writes the same columns the automatic path writes, so every downstream reader
 * (the Job Family position map, topic assignments, the scoring engines'
 * findMatchedJobProfileId) treats a pin exactly like any other match — the only
 * difference is match_type, which is what protects it from being recomputed.
 */
export async function setManualMatchAction(input: {
  candidateId: string;
  jobProfileId: number;
}): Promise<ManualMatchResult> {
  await requirePermission('job_profiles.manage');
  if (await isDemoMode()) return { ok: false, message: 'Aksi ini tidak tersedia.' };
  try {
    const { candidateId, jobProfileId } = input;

    // The candidate's identity + current assignment, resolved the same way the
    // report resolves it, so a pinned row is indistinguishable in shape from an
    // automatic one. liveCandidate(): pinning a tombstone would create a row
    // the report can never show and no one can remove from the UI.
    const candRes = await db.execute(sql`
      SELECT DISTINCT ON (c.id)
        c.id::text                                   AS candidate_id,
        c.name                                       AS candidate_name,
        c.tenant_id::text                            AS tenant_id,
        COALESCE(sep.company_id, sctm.company_id)    AS company_id,
        c.current_position                           AS candidate_current_position,
        sep.position_id                              AS position_id,
        COALESCE(sp.internal_title, sp.external_title) AS sync_title
      FROM candidates c
      LEFT JOIN sync_company_tenant_map sctm
        ON sctm.tenant_id = c.tenant_id AND sctm.is_active = true
      LEFT JOIN sync_employee_positions sep
        ON sep.company_id = sctm.company_id
       AND sep.employee_id = LPAD(c.employee_id, 5, '0')
       AND sep.valid_to > CURRENT_DATE
      LEFT JOIN sync_positions sp
        ON sp.company_id = sep.company_id AND sp.position_id = sep.position_id
      WHERE c.id = ${candidateId} AND c.deleted_at IS NULL
      ORDER BY c.id, sep.primary_position DESC NULLS LAST, sep.valid_from DESC NULLS LAST
      LIMIT 1
    `);
    const cand = (candRes.rows as Array<{
      candidate_id: string;
      candidate_name: string;
      tenant_id: string | null;
      company_id: string | null;
      candidate_current_position: string | null;
      position_id: string | null;
      sync_title: string | null;
    }>)[0];
    if (!cand) return { ok: false, message: 'Kandidat tidak ditemukan atau sudah dihapus.' };

    const [profile] = await db
      .select({
        id: syncJobProfiles.id,
        positionName: syncJobProfiles.positionName,
        fileName: syncJobProfiles.fileName,
      })
      .from(syncJobProfiles)
      .where(eq(syncJobProfiles.id, jobProfileId))
      .limit(1);
    if (!profile) return { ok: false, message: 'Dokumen job profile tidak ditemukan.' };

    const name = cand.candidate_name ?? '';
    const currentPosition = cand.candidate_current_position ?? '';
    const title = (cand.sync_title ?? currentPosition ?? '').trim();
    const positionId = cand.position_id?.trim() || null;

    const row = {
      candidateId,
      candidateName: name.slice(0, 255) || null,
      tenantId: cand.tenant_id ?? null,
      companyId: cand.company_id?.trim().slice(0, 20) || null,
      candidatePosition: (title || currentPosition).slice(0, 400) || null,
      positionId: positionId?.slice(0, 40) ?? null,
      jobProfileId,
      jobProfileName: (profile.positionName ?? `JD #${profile.id}`).slice(0, 400),
      matchType: 'manual' as const,
      similarity: null,
      matchedCode: null,
      jdNumber: null,
      fileName: profile.fileName?.slice(0, 500) ?? null,
      matchedPart: null,
      reason: {
        manual: true,
        pinnedAt: new Date().toISOString(),
        candidateTitle: title || currentPosition || null,
      } as Record<string, unknown>,
    };

    // One row per candidate (uq_job_family_matches_candidate), so re-pinning —
    // or overriding an automatic match — is an upsert, not a duplicate.
    await db
      .insert(jobFamilyMatches)
      .values(row)
      .onConflictDoUpdate({ target: jobFamilyMatches.candidateId, set: { ...row, updatedAt: new Date() } });

    revalidatePath('/posisi/job-family');
    revalidatePath('/job-profiles/match');
    return { ok: true, message: `Dipetakan manual ke "${row.jobProfileName}".` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation "?job_family_matches"?\s+does not exist/i.test(msg)) {
      return {
        ok: false,
        message:
          'Tabel job_family_matches belum ada. Jalankan migrasi drizzle/0032_job_family_matches.sql.',
      };
    }
    return { ok: false, message: msg };
  }
}

/**
 * Remove a manual pin. Scoped to match_type='manual' so this can never delete
 * an automatic match — that one belongs to the snapshot save, and removing it
 * here would just make it reappear on the next save, looking like a bug.
 */
export async function removeManualMatchAction(candidateId: string): Promise<ManualMatchResult> {
  await requirePermission('job_profiles.manage');
  if (await isDemoMode()) return { ok: false, message: 'Aksi ini tidak tersedia.' };
  try {
    await db
      .delete(jobFamilyMatches)
      .where(
        and(
          eq(jobFamilyMatches.candidateId, candidateId),
          eq(jobFamilyMatches.matchType, 'manual'),
        ),
      );
    revalidatePath('/posisi/job-family');
    revalidatePath('/job-profiles/match');
    return { ok: true, message: 'Pemetaan manual dilepas. Jalankan ulang pencocokan untuk hasil otomatis.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export type SavedMatchStats = {
  tableReady: boolean;
  total: number;
  byType: Partial<Record<MatchType, number>>;
  lastSaved: string | null;
};

/**
 * The persisted mapping, rebuilt as a report WITHOUT running any tier — three
 * cheap reads (scoped candidates, saved rows, profile count) instead of the
 * ~20s live build. This is what the Job Profile Match page shows on open, so
 * the last "Simpan Pemetaan" is visible immediately and the live run is an
 * explicit action. Names come from the live candidate/profile rows so a
 * renamed JD or corrected candidate name shows its current label; the
 * match-reason fields are restored from the `reason` snapshot the save wrote.
 */
// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function getSavedMatchReportAction(
  ...args: Parameters<typeof getSavedMatchReportActionImpl>
): ReturnType<typeof getSavedMatchReportActionImpl> {
  return demoScrub(await getSavedMatchReportActionImpl(...args));
}

async function getSavedMatchReportActionImpl(opts?: {
  tenantIds?: string[];
}): Promise<JobFamilyMatchReport> {
  await requirePermission('job_profiles.view');
  return presentMatchReportForMode(await buildSavedMatchReport(opts));
}

async function buildSavedMatchReport(opts?: { tenantIds?: string[] }): Promise<JobFamilyMatchReport> {
  const validTenantIds = await liveTenantIdSet();
  const requested = (opts?.tenantIds ?? []).filter((id) => validTenantIds.has(id));
  const selectedTenantIds = requested.length > 0 ? requested : [await getCurrentTenantId()];

  const [candResult, profileCountRows] = await Promise.all([
    db.execute(scopedCandidatesSql(selectedTenantIds)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(syncJobProfiles)
      .where(and(eq(syncJobProfiles.status, 'completed'), isNotNull(syncJobProfiles.positionName))),
  ]);
  const scoped = (candResult.rows as ScopedCandidateRow[]).map(toScopedCandidate);
  const totalProfiles = Number(profileCountRows[0]?.n ?? 0);

  const build = (matched: MatchedPair[], savedAt: string | null): JobFamilyMatchReport => {
    const matchedIds = new Set(matched.map((m) => m.candidateId));
    const unmatchedCandidates = scoped
      .filter((c) => !matchedIds.has(c.id))
      .map(toUnmatchedCandidate);
    return {
      source: 'saved',
      savedAt,
      embeddingAvailable: true,
      aiEnabled: false,
      aiAvailable: true,
      aiDeferredTitles: 0,
      selectedTenantIds,
      stats: {
        totalCandidates: scoped.length,
        totalProfiles,
        totalCurrentPositions: 0,
        matchedCandidates: matched.length,
        unmatchedCandidates: unmatchedCandidates.length,
        unmatchedProfiles: 0,
        unmatchedPositions: 0,
      },
      matched,
      unmatchedCandidates,
      unmatchedProfiles: [],
      unmatchedPositions: [],
    };
  };

  let savedRows: Array<{
    candidateId: string;
    candidateName: string | null;
    tenantId: string | null;
    companyId: string | null;
    candidatePosition: string | null;
    positionId: string | null;
    jobProfileId: number;
    jobProfileName: string | null;
    liveProfileName: string | null;
    matchType: string;
    similarity: number | null;
    matchedCode: string | null;
    jdNumber: string | null;
    fileName: string | null;
    reason: unknown;
    updatedAt: Date;
  }>;
  try {
    savedRows = await db
      .select({
        candidateId: jobFamilyMatches.candidateId,
        candidateName: jobFamilyMatches.candidateName,
        tenantId: jobFamilyMatches.tenantId,
        companyId: jobFamilyMatches.companyId,
        candidatePosition: jobFamilyMatches.candidatePosition,
        positionId: jobFamilyMatches.positionId,
        jobProfileId: jobFamilyMatches.jobProfileId,
        jobProfileName: jobFamilyMatches.jobProfileName,
        liveProfileName: syncJobProfiles.positionName,
        matchType: jobFamilyMatches.matchType,
        similarity: jobFamilyMatches.similarity,
        matchedCode: jobFamilyMatches.matchedCode,
        jdNumber: jobFamilyMatches.jdNumber,
        fileName: jobFamilyMatches.fileName,
        reason: jobFamilyMatches.reason,
        updatedAt: jobFamilyMatches.updatedAt,
      })
      .from(jobFamilyMatches)
      .innerJoin(candidates, eq(candidates.id, jobFamilyMatches.candidateId))
      .leftJoin(syncJobProfiles, eq(syncJobProfiles.id, jobFamilyMatches.jobProfileId))
      .where(and(liveCandidate(), inArray(candidates.tenantId, selectedTenantIds)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation "?job_family_matches"?\s+does not exist/i.test(msg)) {
      return build([], null);
    }
    throw err;
  }

  const byCandidate = new Map(scoped.map((c) => [c.id, c]));
  let newest: number | null = null;
  const matched: MatchedPair[] = [];
  for (const r of savedRows) {
    const c = byCandidate.get(r.candidateId);
    const snap = (r.reason && typeof r.reason === 'object' ? r.reason : {}) as Partial<MatchedPair>;
    const t = new Date(r.updatedAt).getTime();
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
    matched.push({
      candidateId: r.candidateId,
      candidateName: c?.name || r.candidateName || '',
      currentPosition: c?.title ?? r.candidatePosition ?? '',
      jobProfileId: r.jobProfileId,
      jobProfileName: r.liveProfileName ?? r.jobProfileName ?? snap.jobProfileName ?? '',
      matchType: r.matchType as MatchType,
      tenantId: c?.tenantId ?? r.tenantId ?? undefined,
      companyId: c?.companyId ?? r.companyId ?? undefined,
      positionId: c?.positionId ?? r.positionId ?? undefined,
      similarity: r.similarity ?? snap.similarity,
      fileName: r.fileName ?? snap.fileName,
      matchedCode: r.matchedCode ?? snap.matchedCode,
      jdNumber: r.jdNumber ?? snap.jdNumber,
      aiConfidence: snap.aiConfidence,
      aiReason: snap.aiReason,
    });
  }
  matched.sort((a, b) => a.candidateName.localeCompare(b.candidateName));

  return build(matched, newest !== null ? new Date(newest).toISOString() : null);
}

function toUnmatchedCandidate(c: ScopedCandidate): UnmatchedCandidate {
  return {
    candidateId: c.id,
    candidateName: c.name,
    currentPosition: c.title,
    tenantId: c.tenantId ?? undefined,
    companyId: c.companyId ?? undefined,
    scenario: c.positionId ? 'no-jd' : 'no-active-position',
  };
}

/** Counts of persisted matches (for the "saved" badge). */
export async function getSavedMatchStatsAction(): Promise<SavedMatchStats> {
  await requirePermission('job_profiles.view');
  try {
    // Counted over LIVE candidates only. The badge renders right next to the
    // live report's matched total, and saveMatchesToDbAction now deliberately
    // retains tombstoned candidates' rows, so an unfiltered count would sit
    // permanently above the report and read as a failed save. This is a
    // read-side filter only — the retained rows stay in the table for the
    // history reads that need them.
    const rows = await db
      .select({ matchType: jobFamilyMatches.matchType, updatedAt: jobFamilyMatches.updatedAt })
      .from(jobFamilyMatches)
      .innerJoin(candidates, eq(candidates.id, jobFamilyMatches.candidateId))
      .where(liveCandidate());
    const byType: Partial<Record<MatchType, number>> = {};
    let last: number | null = null;
    for (const r of rows) {
      const key = r.matchType as MatchType;
      byType[key] = (byType[key] ?? 0) + 1;
      const t = new Date(r.updatedAt).getTime();
      if (last === null || t > last) last = t;
    }
    return {
      tableReady: true,
      total: rows.length,
      byType,
      lastSaved: last !== null ? new Date(last).toISOString() : null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation "?job_family_matches"?\s+does not exist/i.test(msg)) {
      return { tableReady: false, total: 0, byType: {}, lastSaved: null };
    }
    throw err;
  }
}

// ── The last RUN, persisted ───────────────────────────────────────
//
// Two different things are stored about matching, and the page needs both:
//   • job_family_matches      — the MAPPING the operator committed with "Simpan
//                               Pemetaan"; matched pairs only; read by other
//                               features. Rebuilt as a report by
//                               getSavedMatchReportAction, which therefore
//                               cannot answer the two "unmatched" cards.
//   • job_profile_match_runs  — the last full RUN per business unit, stored by
//                               runJobProfileMatchAction below. This is what the
//                               section opens on, so a visit shows the previous
//                               result in full and "Jalankan" is an update, not
//                               a prerequisite for seeing anything.
// A missing table degrades to "no stored run" (the page falls back to the
// saved mapping) and a failed write is logged, never thrown: the report the
// user waited ~20s for must still reach them.

function isMissingTable(err: unknown, table: string): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return new RegExp(`relation "?${table}"?\s+does not exist`, 'i').test(msg);
}

/**
 * Run the live matching, store the whole report as this business unit's last
 * run (replacing the previous one), and return it stamped with runAt/runBy.
 * Same permission as getJobFamilyMatchReport — storing the run is caching a
 * computation any viewer may trigger, not committing a mapping.
 */
// Demo mode: the report is stored first, with the names in force; only what leaves the server carries initials.
export async function runJobProfileMatchAction(
  ...args: Parameters<typeof runJobProfileMatchActionImpl>
): ReturnType<typeof runJobProfileMatchActionImpl> {
  return demoScrub(await runJobProfileMatchActionImpl(...args));
}

async function runJobProfileMatchActionImpl(opts?: {
  tenantIds?: string[];
  useAi?: boolean;
}): Promise<JobFamilyMatchReport> {
  const startedAt = Date.now();
  const report = await getJobFamilyMatchReport(opts);
  const runAt = new Date().toISOString();
  const user = await getCurrentUser().catch(() => null);
  const runBy =
    user && user.id !== 'system-local-user' ? (user.name || user.email || null) : null;
  const stamped: JobFamilyMatchReport = { ...report, source: 'live', runAt, runBy };

  try {
    const tenantId = await getCurrentTenantId();
    await db
      .insert(jobProfileMatchRuns)
      .values({
        tenantId,
        selectedTenantIds: report.selectedTenantIds,
        report: stamped,
        runBy,
        durationMs: Date.now() - startedAt,
      })
      .onConflictDoUpdate({
        target: jobProfileMatchRuns.tenantId,
        set: {
          selectedTenantIds: report.selectedTenantIds,
          report: stamped,
          runBy,
          durationMs: Date.now() - startedAt,
          updatedAt: sql`now()`,
        },
      });
  } catch (err) {
    if (isMissingTable(err, 'job_profile_match_runs')) {
      console.warn(
        '[job-profile-match] job_profile_match_runs missing — run not stored. Apply drizzle/0076_job_profile_match_runs.sql.',
      );
    } else {
      console.error('[job-profile-match] failed to store run', err);
    }
  }
  return presentMatchReportForMode(stamped);
}

/**
 * A report as the current mode shows it. Demo mode names each candidate by
 * their demo copy (lib/demo/). Applied on the way OUT only: the stored run is
 * always the real one, so real mode never reads a demo name back.
 */
async function presentMatchReportForMode(report: JobFamilyMatchReport): Promise<JobFamilyMatchReport> {
  if (!(await isDemoMode())) return report;
  const ids = Array.from(
    new Set([...report.matched.map((m) => m.candidateId), ...report.unmatchedCandidates.map((c) => c.candidateId)]),
  );
  const copies = await loadDemoCopies(ids);
  if (copies.size === 0) return report;
  return {
    ...report,
    matched: report.matched.map((m) => {
      const copy = copies.get(m.candidateId);
      return copy ? { ...m, candidateName: copy.name, currentPosition: copy.currentPosition ?? m.currentPosition } : m;
    }),
    unmatchedCandidates: report.unmatchedCandidates.map((c) => {
      const copy = copies.get(c.candidateId);
      return copy ? { ...c, candidateName: copy.name, currentPosition: copy.currentPosition ?? c.currentPosition } : c;
    }),
  };
}

/**
 * The last stored run for the current business unit, or null when none exists
 * (or the table has not been created yet). One indexed read; the report comes
 * back exactly as the run produced it, so the two "unmatched" cards answer.
 */
// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function getLatestMatchRunAction(
  ...args: Parameters<typeof getLatestMatchRunActionImpl>
): ReturnType<typeof getLatestMatchRunActionImpl> {
  return demoScrub(await getLatestMatchRunActionImpl(...args));
}

async function getLatestMatchRunActionImpl(): Promise<JobFamilyMatchReport | null> {
  await requirePermission('job_profiles.view');
  const tenantId = await getCurrentTenantId();
  try {
    const [row] = await db
      .select({
        report: jobProfileMatchRuns.report,
        runBy: jobProfileMatchRuns.runBy,
        updatedAt: jobProfileMatchRuns.updatedAt,
      })
      .from(jobProfileMatchRuns)
      .where(eq(jobProfileMatchRuns.tenantId, tenantId))
      .limit(1);
    if (!row) return null;
    const report = row.report as JobFamilyMatchReport;
    return presentMatchReportForMode({
      ...report,
      source: 'live',
      runAt: report.runAt ?? row.updatedAt.toISOString(),
      runBy: report.runBy ?? row.runBy ?? null,
    });
  } catch (err) {
    if (!isMissingTable(err, 'job_profile_match_runs')) {
      console.error('[job-profile-match] failed to read stored run', err);
    }
    return null;
  }
}
