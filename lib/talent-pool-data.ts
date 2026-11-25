import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { candidateAge } from '@/lib/age';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { liveCandidate } from '@/lib/candidate-visibility';
import {
  applyProgramFilters,
  listProgramTemplates,
  parsePerformancePeriods,
  type FailedRule,
} from '@/lib/programs';
import {
  countDisabledFilterRules,
  countEnabledFilterRules,
  flattenFilterTree,
  isRuleEnabled,
  normalizeFilterTree,
  TALENT_MAPPING_GATE_FIELDS,
  talentMappingGateRules,
  talentMappingGateTree,
} from '@/lib/filter-rules';
import type { FilterConditionGroup, FilterRule } from '@/lib/db/schema';
import type { EffectiveHav, HavSource } from '@/lib/hav-effective';
import { withEffectiveHav } from '@/lib/hav-placements';
import { forCurrentMode, visibleCandidateIds } from '@/lib/demo/store';
import { isDemoMode } from '@/lib/app-mode';
import { MASKED_NPK } from '@/lib/app-mode-shared';
import { getCurrentTenantId } from '@/lib/tenant';

/**
 * Talent Pool — the candidates that pass a program's eligibility filter.
 *
 * WHY THIS EXISTS: the eligibility rules were only ever observable at the
 * moment a scoring run was started (the wizard's pool preview) or after the
 * fact, buried in a finished run. There was no way to ask the plain question
 * "who is in the Talent Pool right now?" without creating a scoring run —
 * which costs LLM calls and writes history for what is really just a lookup.
 *
 * This module answers it as a pure read: no run, no session, no LLM, nothing
 * persisted. It is a live projection of the CURRENT candidate rows through the
 * CURRENT program template, so it moves when either changes.
 *
 * DELIBERATELY NOT a snapshot: `scoring_runs.config_snapshot` exists precisely
 * because a finished ranking must freeze the rules it was judged under. This
 * page is the opposite view — always "as of now" — so it must never be read as
 * the rule set some past run used. Anything that needs the historical rules
 * should read the run's snapshot instead (see `run-configuration-panel.tsx`).
 */

/** The program whose filter defines the pool. Auto-seeded per tenant. */
export const TALENT_POOL_PROGRAM_CODE = 'talent';

export type TalentPoolCandidate = {
  id: string;
  name: string;
  employeeId: string;
  currentPosition: string;
  department: string;
  division: string;
  grade: string | null;
  /** Leading digits of `grade`, for numeric sorting ("5A" → 5). Null if absent. */
  gradeNumber: number | null;
  /**
   * The HAV quadrant IN FORCE, "1".."16", or '' when there is none — manual
   * (Talent Mapping) > Excel upload > formula, lib/hav-effective.ts. It is the
   * value the HAV rules were judged against.
   */
  havQuadrant: string;
  /** Where `havQuadrant` came from. */
  havSource: HavSource;
  /** The HAV Excel value as stored ('' when none), kept for reference. */
  uploadedHavQuadrant: string;
  effectiveHav: EffectiveHav;
  mcuStatus: string | null;
  disciplineStatus: string | null;
  performanceGrade: string | null;
  /**
   * PA split into its individual semester grades, newest first. Produced by the
   * filter engine's own parser so the chips shown here can never disagree with
   * the periods the eligibility rules were evaluated against.
   */
  performancePeriods: string[];
  behaviorRecommendation: string | null;
  education: string | null;
  yearsExperience: number | null;
  /** Derived from the candidate's birth date on read — see lib/age.ts. */
  age: number | null;
  /** Empty for qualified candidates; the rules they tripped otherwise. */
  failedRules: FailedRule[];
  /**
   * True when EVERY rule this candidate failed was judged against absent data.
   * Such a candidate is not "rejected" in any meaningful sense — nobody has
   * filled in the columns the program filters on yet.
   */
  blockedOnlyByMissingData: boolean;
};

export type TalentPoolData = {
  program: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    /**
     * When false the program's rules are advisory — scoring does NOT drop
     * failing candidates. The split below is still computed and shown, but the
     * UI has to say so, or the "Tidak Lolos" list reads as an exclusion that
     * never actually happens.
     */
    enforceFilterRules: boolean;
    /** Rules switched ON — the ones these verdicts were reached with. */
    ruleCount: number;
    /**
     * Rules kept in the tree but switched OFF on this page. Reported so "5
     * aturan filter" is never read as the whole tree when a sixth is merely off.
     */
    disabledRuleCount: number;
    /**
     * The condition tree these verdicts were reached with — shown, and edited,
     * on the Talent Pool page itself. Carried on the result rather than read
     * separately by the page so a preview of unsaved rules cannot render one
     * tree while its counts came from another.
     */
    filterTree: FilterConditionGroup;
  } | null;
  qualified: TalentPoolCandidate[];
  notQualified: TalentPoolCandidate[];
  /** Total live candidates evaluated (qualified + notQualified). */
  totalEvaluated: number;
  /**
   * Of `notQualified`, how many failed ONLY because the attributes the program
   * filters on are empty. Reported separately because it is a data-entry gap,
   * not an assessment outcome — and at the time of writing it is the majority.
   */
  blockedOnlyByMissingData: number;
  /**
   * How many of `totalEvaluated` Talent Mapping would show under THIS tree —
   * those who pass its switched-on discipline rule (`talentMappingGateTree`).
   * On the result so a preview of an edited discipline rule can say what it
   * does to the map, not only to this list.
   */
  mappingPopulation: number;
};

type TalentPoolBaseRow = Omit<TalentPoolCandidate, 'failedRules' | 'blockedOnlyByMissingData'>;

const toNumber = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Grade is stored with an optional trailing letter ("5A"); the numeric part is
// what orders it. Same leading-digits rule the grade-range pool filter uses.
const gradeToNumber = (raw: string | null | undefined): number | null => {
  const m = String(raw ?? '').match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * Every live candidate of one business unit, with the HAV in force
 * folded in. Shared by the Talent Pool list and the Talent Mapping population so
 * the two are computed from the same rows.
 */
async function loadTalentPoolBase(tenantId: string, onlyCandidateId?: string): Promise<TalentPoolBaseRow[]> {
  const rows = await db
    .select({
      id: schema.candidates.id,
      name: schema.candidates.name,
      employeeId: schema.candidates.employeeId,
      currentPosition: schema.candidates.currentPosition,
      department: schema.candidates.department,
      division: schema.candidates.division,
      grade: schema.candidates.grade,
      disciplineStatus: schema.candidates.disciplineStatus,
      mcuStatus: schema.candidates.mcuStatus,
      performanceGrade: schema.candidates.performanceGrade,
      havQuadrant: schema.candidates.havQuadrant,
      behaviorRecommendation: schema.candidates.behaviorRecommendation,
      yearsExperience: schema.candidates.yearsExperience,
      education: schema.candidates.education,
      birthDate: schema.candidates.birthDate,
    })
    .from(schema.candidates)
    // A tombstoned candidate must never appear in a pool listing — this is the
    // "pools/lists" category in lib/candidate-visibility.ts, which must filter.
    .where(
      and(
        inArray(schema.candidates.tenantId, [tenantId]),
        liveCandidate(),
        onlyCandidateId ? eq(schema.candidates.id, onlyCandidateId) : undefined,
      ),
    );

  const sorted = rows.sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? ''),
  );
  // Demo mode: OFF candidates are outside the pool, the map and the mapping
  // standing as if deleted; ON ones are their demo copy (lib/demo/). Before the
  // HAV fold, so the HAV in force follows the copy.
  const visible = await forCurrentMode(sorted, (r) => r.id, { onlyOn: true });
  const withHav = await withEffectiveHav(visible);

  // Demo mode: the NPK never leaves the server (lib/demo/mask.ts) — this base
  // feeds the Talent Pool list, the map, its queue and the mapping standing.
  const demo = await isDemoMode();
  return withHav.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    employeeId: demo ? MASKED_NPK : r.employeeId ?? '',
    currentPosition: r.currentPosition ?? '',
    department: r.department ?? '',
    division: r.division ?? '',
    grade: r.grade ?? null,
    gradeNumber: gradeToNumber(r.grade),
    // The quadrant IN FORCE, canonical "1".."16" — the filter engine compares
    // exactly this, so the value shown is the same one that was judged.
    havQuadrant: r.havQuadrant ?? '',
    havSource: r.havSource,
    uploadedHavQuadrant: r.uploadedHavQuadrant,
    effectiveHav: r.effectiveHav,
    mcuStatus: r.mcuStatus ?? null,
    disciplineStatus: r.disciplineStatus ?? null,
    performanceGrade: r.performanceGrade ?? null,
    performancePeriods: parsePerformancePeriods(r.performanceGrade),
    behaviorRecommendation: r.behaviorRecommendation ?? null,
    education: r.education ?? null,
    yearsExperience: toNumber(r.yearsExperience),
    age: candidateAge(r.birthDate),
  }));
}

/**
 * Evaluate every live candidate in the current tenant against the Talent Pool
 * program's filter tree.
 *
 * Tenant scope is the ACTIVE business unit only — unlike a scoring pool, which
 * can deliberately span tenants (a scoring run may draw successors from another
 * unit). A standing "who is in our talent pool" list is a per-unit question,
 * and silently folding in other units' people would misreport every count.
 */
export async function getTalentPoolData(
  programCode: string = TALENT_POOL_PROGRAM_CODE,
  /**
   * Evaluate against THIS tree instead of the program's stored one, without
   * writing anything. It is what lets the page preview an edit before saving
   * it, and it exists as a parameter rather than a second function so a preview
   * and the real thing can never drift into two evaluators — the caller changes
   * one input and every count below is produced by the same code path.
   */
  overrideTree?: FilterConditionGroup,
): Promise<TalentPoolData> {
  const tenantId = await getCurrentTenantId();

  // listProgramTemplates auto-seeds the system templates on first access, so a
  // brand-new tenant resolves the Talent Pool program here rather than 404ing.
  const templates = await listProgramTemplates(tenantId);
  const stored = templates.find((t) => t.code === programCode) ?? null;
  // A preview replaces the tree and nothing else: the program's identity, its
  // name and its enforcement flag are still the saved ones, because those are
  // not what is being previewed.
  const template =
    stored && overrideTree
      ? {
          ...stored,
          filterTree: normalizeFilterTree(overrideTree),
          filterRules: stored.filterRules,
        }
      : stored;

  const base = await loadTalentPoolBase(tenantId);

  // Counted off the TREE, not the flattened `filterRules` list: under a preview
  // the list is still the stored one, so trusting it would evaluate an override
  // that empties every rule as though the old rules were still in force. Only
  // switched-on rules count: a tree whose every rule is off constrains nobody.
  const ruleCount = template ? countEnabledFilterRules(template.filterTree) : 0;
  const disabledRuleCount = template ? countDisabledFilterRules(template.filterTree) : 0;

  // No template (or no switched-on rule) means nothing constrains the pool:
  // everyone qualifies. Reported as such rather than as an empty pool, which
  // would read as "nobody is eligible" — the opposite of the truth.
  if (!template || ruleCount === 0) {
    return {
      program: template
        ? {
            id: template.id,
            code: template.code,
            name: template.name,
            description: template.description,
            enforceFilterRules: template.enforceFilterRules,
            ruleCount: 0,
            disabledRuleCount,
            filterTree: template.filterTree,
          }
        : null,
      qualified: base.map((c) => ({
        ...c,
        failedRules: [],
        blockedOnlyByMissingData: false,
      })),
      notQualified: [],
      totalEvaluated: base.length,
      blockedOnlyByMissingData: 0,
      mappingPopulation: base.length,
    };
  }

  // Default missing-value policy ('evaluate') is correct here: these are the
  // program's hard filters, and this page must show the same verdict scoring
  // would reach. The 'pass' policy belongs to the Job Family global filter,
  // which spans employees with sparse attributes.
  const decisions = applyProgramFilters(template, base);
  const verdictById = new Map(decisions.map((d) => [d.candidateId, d]));

  const qualified: TalentPoolCandidate[] = [];
  const notQualified: TalentPoolCandidate[] = [];
  let blockedOnlyByMissingData = 0;

  for (const c of base) {
    const verdict = verdictById.get(c.id);
    // An unmatched id can't happen (applyProgramFilters maps 1:1) but treating
    // it as qualified would silently inflate the pool, so fail closed instead.
    const failedRules = verdict?.failedRules ?? [];
    if (verdict?.qualified) {
      qualified.push({ ...c, failedRules: [], blockedOnlyByMissingData: false });
    } else {
      const onlyMissing = failedRules.length > 0 && failedRules.every((r) => r.dataMissing === true);
      if (onlyMissing) blockedOnlyByMissingData++;
      notQualified.push({ ...c, failedRules, blockedOnlyByMissingData: onlyMissing });
    }
  }

  return {
    program: {
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      enforceFilterRules: template.enforceFilterRules,
      ruleCount,
      disabledRuleCount,
      filterTree: template.filterTree,
    },
    qualified,
    notQualified,
    totalEvaluated: base.length,
    blockedOnlyByMissingData,
    mappingPopulation: applyProgramFilters(
      { filterTree: talentMappingGateTree(template.filterTree) },
      base,
    ).filter((d) => d.qualified).length,
  };
}

// ── One candidate's Talent Pool standing ──────────────────────────
//
// The candidate detail page opens with "is this person in the Talent Pool",
// which is the one sentence a reader wants before anything else about them.
// Answering it by calling getTalentPoolData and searching the result would
// evaluate every candidate in the business unit to learn about one,
// so this evaluates a single row — through the SAME `applyProgramFilters` and
// the same default missing-value policy, so the two surfaces cannot disagree
// about who qualifies.

export type CandidateTalentPoolStatus = {
  /** null when the tenant has no Talent Pool program at all. */
  programName: string | null;
  /** Rules in force. 0 means nothing constrains the pool, so everyone is in. */
  ruleCount: number;
  qualified: boolean;
  /** Rules this candidate tripped; empty when they qualify. */
  failedRules: FailedRule[];
  /** True when EVERY failure was judged against an empty column. */
  blockedOnlyByMissingData: boolean;
};

export async function getCandidateTalentPoolStatus(
  candidateId: string,
  programCode: string = TALENT_POOL_PROGRAM_CODE,
): Promise<CandidateTalentPoolStatus | null> {
  const tenantId = await getCurrentTenantId();
  const templates = await listProgramTemplates(tenantId);
  const template = templates.find((t) => t.code === programCode) ?? null;

  const [row] = await db
    .select({
      id: schema.candidates.id,
      disciplineStatus: schema.candidates.disciplineStatus,
      mcuStatus: schema.candidates.mcuStatus,
      performanceGrade: schema.candidates.performanceGrade,
      havQuadrant: schema.candidates.havQuadrant,
      behaviorRecommendation: schema.candidates.behaviorRecommendation,
      yearsExperience: schema.candidates.yearsExperience,
      education: schema.candidates.education,
    })
    .from(schema.candidates)
    .where(
      and(
        eq(schema.candidates.id, candidateId),
        inArray(schema.candidates.tenantId, [tenantId]),
        liveCandidate(),
      ),
    )
    .limit(1);

  if (!row) return null;
  // Demo mode: an OFF candidate has no Talent Pool standing at all.
  if ((await visibleCandidateIds([row.id])).length === 0) return null;

  const ruleCount = template ? countEnabledFilterRules(template.filterTree) : 0;
  if (!template || ruleCount === 0) {
    return {
      programName: template?.name ?? null,
      ruleCount: 0,
      qualified: true,
      failedRules: [],
      blockedOnlyByMissingData: false,
    };
  }

  // The HAV in force, exactly as the list computes it — one person cannot be in
  // the pool on the list and out of it on their own page.
  const [candidate] = await withEffectiveHav(await forCurrentMode([row], (r) => r.id, { onlyOn: false }));

  const [decision] = applyProgramFilters(template, [
    {
      id: candidate.id,
      // Only the fields the filter engine reads. `name` is required by the
      // type and never evaluated, so it stays empty rather than costing a
      // column this query has no other use for.
      name: '',
      havQuadrant: candidate.havQuadrant ?? '',
      mcuStatus: candidate.mcuStatus ?? null,
      disciplineStatus: candidate.disciplineStatus ?? null,
      performanceGrade: candidate.performanceGrade ?? null,
      behaviorRecommendation: candidate.behaviorRecommendation ?? null,
      education: candidate.education ?? null,
      yearsExperience: toNumber(candidate.yearsExperience),
    },
  ]);

  const failedRules = decision?.failedRules ?? [];
  return {
    programName: template.name,
    ruleCount,
    qualified: Boolean(decision?.qualified),
    failedRules,
    blockedOnlyByMissingData:
      failedRules.length > 0 && failedRules.every((r) => r.dataMissing === true),
  };
}

// ── Talent Mapping population ─────────────────────────────────────
//
// WHO appears on Talent Mapping is decided by the Talent Pool's DISCIPLINE
// rule alone (HR decision, 2026-10; `talentMappingGateTree` in
// lib/filter-rules.ts). The other Talent Pool rules are deliberately NOT filters
// on the map:
//   - MCU is advisory everywhere — it flags, it never removes anybody;
//   - HAV, PA and the behavioural assessment are the very INPUTS the map
//     arranges people by. Filtering the map on them would hide exactly the
//     people whose placement is in question, and would make a move to Q9 eject
//     somebody from the screen they were just moved on.
//
// The Talent Pool verdict is still computed for everyone on the map — with the
// FULL rules and the HAV in force, exactly as the Talent Pool page reaches it —
// but here it is INFORMATION, never a gate: `inTalentPool` says whether the
// person clears every rule today, `poolQuadrants` every square under which they
// would, which is what a move would do to their membership. Both come from
// `applyProgramFilters` over the same rows the Talent Pool page evaluates;
// nothing here is a second evaluator.
//
// The gate follows the Talent Pool rule as configured: edit the discipline
// values there and the map follows; switch the rule OFF and the map shows every
// live candidate. Because the gate replaces the other rules by TRUE (not by
// removal), everyone in the Talent Pool is always on the map.

export type TalentMappingPoolEntry = TalentPoolCandidate & {
  /** Clears every Talent Pool rule with the HAV in force — information, not a gate. */
  inTalentPool: boolean;
  /** Quadrants 1..16 under which they would clear every rule. */
  poolQuadrants: number[];
};

export type TalentMappingGate = {
  /** The switched-on discipline rules that decide who is on the map (normally one). */
  rules: { label: string; message: string; operator: FilterRule['operator']; value: FilterRule['value'] }[];
  /** Discipline rules present in the Talent Pool but switched off. */
  disabledCount: number;
  /** Live candidates the gate keeps off the map. */
  excluded: number;
  /** Live candidates of the business unit, before the gate. */
  evaluated: number;
};

export type TalentMappingPopulation = {
  program: {
    name: string;
    /** Rules switched on in the Talent Pool (all fields). */
    ruleCount: number;
    /** Rules switched off in the Talent Pool. */
    disabledRuleCount: number;
    /** Switched-on HAV rules — the ones a move can change the verdict of. */
    havRuleCount: number;
  } | null;
  gate: TalentMappingGate;
  candidates: TalentMappingPoolEntry[];
};

const ALL_QUADRANTS = Array.from({ length: 16 }, (_, i) => i + 1);

function gateSummary(
  template: { filterTree: FilterConditionGroup } | null,
): Omit<TalentMappingGate, 'excluded' | 'evaluated'> {
  if (!template) return { rules: [], disabledCount: 0 };
  const rules = talentMappingGateRules(template.filterTree).map((r) => ({
    label: r.label,
    message: r.message,
    operator: r.operator,
    value: r.value,
  }));
  const gateFields: readonly string[] = TALENT_MAPPING_GATE_FIELDS;
  const disabledCount = flattenFilterTree(template.filterTree).filter(
    (r) => gateFields.includes(r.field) && !isRuleEnabled(r),
  ).length;
  return { rules, disabledCount };
}

function mappingStanding(
  template: { filterTree: FilterConditionGroup } | null,
  rows: TalentPoolBaseRow[],
): { population: TalentMappingPoolEntry[]; excluded: number } {
  // No Talent Pool program at all: nothing gates the map, and with no rules
  // there is nothing anybody could fail, so everyone counts as in the pool.
  if (!template) {
    return {
      population: rows.map((r) => ({
        ...r,
        failedRules: [],
        blockedOnlyByMissingData: false,
        inTalentPool: true,
        poolQuadrants: ALL_QUADRANTS,
      })),
      excluded: 0,
    };
  }

  const onMap = new Set(
    applyProgramFilters({ filterTree: talentMappingGateTree(template.filterTree) }, rows)
      .filter((d) => d.qualified)
      .map((d) => d.candidateId),
  );
  const population = rows.filter((r) => onMap.has(r.id));
  const verdicts = new Map(applyProgramFilters(template, population).map((d) => [d.candidateId, d]));

  // Probe every quadrant: the same evaluator over the same rows with only the
  // HAV swapped, so "a move to Q9 takes them out of the pool" is the engine's
  // own answer, not a re-reading of the rules on the side.
  const probes = population.flatMap((r) =>
    ALL_QUADRANTS.map((q) => ({ ...r, id: `${r.id}#${q}`, havQuadrant: String(q) })),
  );
  const passing = new Map<string, number[]>();
  for (const d of applyProgramFilters(template, probes)) {
    if (!d.qualified) continue;
    const [id, q] = d.candidateId.split('#');
    const list = passing.get(id!) ?? [];
    list.push(Number(q));
    passing.set(id!, list);
  }

  return {
    population: population.map((r) => {
      const verdict = verdicts.get(r.id);
      const failedRules = verdict?.qualified ? [] : (verdict?.failedRules ?? []);
      return {
        ...r,
        failedRules,
        blockedOnlyByMissingData: failedRules.length > 0 && failedRules.every((f) => f.dataMissing === true),
        inTalentPool: Boolean(verdict?.qualified),
        poolQuadrants: passing.get(r.id) ?? [],
      };
    }),
    excluded: rows.length - population.length,
  };
}

async function resolveTalentTemplate(tenantId: string) {
  const templates = await listProgramTemplates(tenantId);
  return templates.find((t) => t.code === TALENT_POOL_PROGRAM_CODE) ?? null;
}

/** The Talent Mapping population of the active business unit, with each candidate's pool standing. */
export async function getTalentMappingPopulation(): Promise<TalentMappingPopulation> {
  const tenantId = await getCurrentTenantId();
  const [template, base] = await Promise.all([resolveTalentTemplate(tenantId), loadTalentPoolBase(tenantId)]);
  const { population, excluded } = mappingStanding(template, base);
  return {
    program: template
      ? {
          name: template.name,
          ruleCount: countEnabledFilterRules(template.filterTree),
          disabledRuleCount: countDisabledFilterRules(template.filterTree),
          havRuleCount: flattenFilterTree(template.filterTree).filter(
            (r) => r.field === 'havQuadrant' && isRuleEnabled(r),
          ).length,
        }
      : null,
    gate: { ...gateSummary(template), excluded, evaluated: base.length },
    candidates: population,
  };
}

/**
 * One candidate's standing, by the same rule — null when they are not on the
 * map: a live candidate of this unit whom the discipline rule keeps off, or no
 * such live candidate at all.
 */
export async function getCandidateMappingStanding(candidateId: string): Promise<TalentMappingPoolEntry | null> {
  const tenantId = await getCurrentTenantId();
  const [template, base] = await Promise.all([
    resolveTalentTemplate(tenantId),
    loadTalentPoolBase(tenantId, candidateId),
  ]);
  return mappingStanding(template, base).population[0] ?? null;
}
