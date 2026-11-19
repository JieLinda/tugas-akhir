import 'server-only';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import type {
  AhpConfig,
  CandidateAttributeField,
  DefaultCriterion,
  FilterCondition,
  FilterConditionGroup,
  FilterOperator,
  FilterRule,
} from '@/lib/db/schema';
import { liveCandidate } from '@/lib/candidate-visibility';
import {
  decidingFilterTree,
  flattenFilterTree,
  isAdvisoryRule,
  isRuleEnabled,
  normalizeFilterTree,
} from '@/lib/filter-rules';
import { normalizeHavQuadrant } from '@/lib/hav-quadrant';
import { withEffectiveHav } from '@/lib/hav-placements';
import { forCurrentMode } from '@/lib/demo/store';
import { isDemoMode } from '@/lib/app-mode';
import { ensureUnlocked } from '@/lib/crypto/key-store';
import { systemProgramTemplates } from '@/lib/program-defaults';
import { getCurrentTenantId } from '@/lib/tenant';
import { ahpWeightPercentages, matchCanonicalCriterion } from '@/lib/scoring-criteria';
import {
  decryptCandidateRow,
  decryptCandidateRows,
  decryptCandidateValue,
} from '@/lib/candidate-crypto';

export type ProgramTemplate = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  targetFinalists: number;
  /** Flattened list of every leaf rule in the tree (counts, compat). */
  filterRules: FilterRule[];
  /** Nested boolean condition tree used by the eligibility engine + editor. */
  filterTree: FilterConditionGroup;
  defaultCriteria: DefaultCriterion[];
  defaultMethod: string;
  /** When true, filter rules hard-exclude failing candidates from scoring. */
  enforceFilterRules: boolean;
  /** Pairwise matrix for the AHP+TOPSIS method (null → system default weights). */
  ahpConfig: AhpConfig | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function rowToTemplate(row: typeof schema.programTemplates.$inferSelect): ProgramTemplate {
  const filterTree = normalizeFilterTree(row.filterRules);
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    name: row.name,
    description: row.description,
    targetFinalists: row.targetFinalists,
    filterRules: flattenFilterTree(filterTree),
    filterTree,
    defaultCriteria: (row.defaultCriteria as unknown as DefaultCriterion[]) ?? [],
    defaultMethod: row.defaultMethod,
    enforceFilterRules: row.enforceFilterRules ?? true,
    ahpConfig: (row.ahpConfig as AhpConfig | null) ?? null,
    isSystem: row.isSystem,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Program codes that never target a position.
 *
 * Talent Pool answers "who in this business unit clears the bar?" — it filters
 * the candidate list and has its own menu (/talent-pool). It is not a succession
 * track for a seat, so offering it when adding a position or starting a run
 * would invite a run whose result the Talent Pool page would never show.
 *
 * The template itself stays fully editable in governance — those filter rules
 * are exactly what the Talent Pool page evaluates.
 */
export const NON_POSITION_PROGRAM_CODES = new Set(['talent']);

/** True for programs that a position can be registered under. */
export function isPositionProgram(code: string | null | undefined): boolean {
  return Boolean(code) && !NON_POSITION_PROGRAM_CODES.has(String(code).toLowerCase());
}

/** The subset of a tenant's templates that positions and runs may use. */
export function positionProgramTemplates<T extends { code: string }>(templates: T[]): T[] {
  return templates.filter((t) => isPositionProgram(t.code));
}

export async function listProgramTemplates(tenantId?: string): Promise<ProgramTemplate[]> {
  const id = tenantId ?? (await getCurrentTenantId());
  let rows = await db
    .select()
    .from(schema.programTemplates)
    .where(eq(schema.programTemplates.tenantId, id))
    .orderBy(asc(schema.programTemplates.name));

  // Auto-seed system templates on first access for this tenant
  if (rows.length === 0) {
    await autoSeedSystemTemplates(id);
    rows = await db
      .select()
      .from(schema.programTemplates)
      .where(eq(schema.programTemplates.tenantId, id))
      .orderBy(asc(schema.programTemplates.name));
  }

  return rows.map(rowToTemplate);
}

/** Internal: seed system templates without requiring an actorId (uses null). */
async function autoSeedSystemTemplates(tenantId: string): Promise<void> {
  const existing = await db
    .select({ code: schema.programTemplates.code })
    .from(schema.programTemplates)
    .where(eq(schema.programTemplates.tenantId, tenantId));
  const existingCodes = new Set(existing.map((r) => r.code));

  const toInsert = systemProgramTemplates.filter((tpl) => !existingCodes.has(tpl.code));
  if (toInsert.length === 0) return;

  await db.insert(schema.programTemplates).values(
    toInsert.map((tpl) => ({
      tenantId,
      code: tpl.code,
      name: tpl.name,
      description: tpl.description,
      targetFinalists: (tpl as any).targetFinalists || 10,
      filterRules: tpl.filterRules as unknown as object,
      defaultCriteria: tpl.defaultCriteria as unknown as object,
      defaultMethod: tpl.defaultMethod,
      isSystem: true,
      createdBy: null,
    }))
  );
}

export async function getProgramTemplate(id: string): Promise<ProgramTemplate | null> {
  const rows = await db
    .select()
    .from(schema.programTemplates)
    .where(eq(schema.programTemplates.id, id))
    .limit(1);
  return rows[0] ? rowToTemplate(rows[0]) : null;
}

/**
 * Seed the three system program templates for the current tenant if missing.
 * Returns the list of newly inserted codes (empty if all already existed).
 */
export async function ensureSystemTemplatesForTenant(tenantId: string, actorId: string): Promise<string[]> {
  const existing = await db
    .select({ code: schema.programTemplates.code })
    .from(schema.programTemplates)
    .where(eq(schema.programTemplates.tenantId, tenantId));
  const existingCodes = new Set(existing.map((r) => r.code));

  const toInsert = systemProgramTemplates.filter((tpl) => !existingCodes.has(tpl.code));
  if (toInsert.length === 0) return [];

  await db.insert(schema.programTemplates).values(
    toInsert.map((tpl) => ({
      tenantId,
      code: tpl.code,
      name: tpl.name,
      description: tpl.description,
      filterRules: tpl.filterRules as unknown as object,
      defaultCriteria: tpl.defaultCriteria as unknown as object,
      defaultMethod: tpl.defaultMethod,
      isSystem: true,
      createdBy: actorId,
    }))
  );

  return toInsert.map((tpl) => tpl.code);
}

// ── Filter engine ────────────────────────────────────────────────────────────

const PA_GRADE_LETTERS = new Set(['A', 'B', 'C', 'D', 'E']);

/**
 * Parse the multi-period `performanceGrade` CSV into its individual semester
 * grades (uppercased, blanks dropped).
 *
 * `performanceGrade` is a CSV of up to six semester slots covering the last 3
 * years, newest first (see sync-service candidate-populate:
 * [yr-1 s2, yr-1 s1, yr-2 s2, …]). PA rules are *window* rules ("… dalam 3 tahun
 * terakhir"), so we evaluate every period rather than collapsing to one slot.
 */
export function parsePerformancePeriods(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter((p) => PA_GRADE_LETTERS.has(p));
}

/**
 * Evaluate a set/equality rule against ALL of a candidate's PA periods with
 * proper existential/universal semantics so a filter can express both:
 *   • "PA min B dalam 3 tahun terakhir"  → `in ['A','B']`  = ∃ period ∈ {A,B}
 *   • "tidak boleh ada D/E"              → `notIn ['D','E']` = ∄ period ∈ {D,E}
 * (These are exact negations of each other; a single collapsed value could not
 * represent both — e.g. best-grade "A,A,A,A,D,E" would wrongly pass notIn[D,E].)
 * Numeric operators are meaningless for letter grades and evaluate to false.
 */
function evaluatePerformanceRule(
  periods: string[],
  operator: FilterOperator,
  ruleValue: FilterRule['value'],
): boolean {
  const set = (Array.isArray(ruleValue) ? ruleValue : [ruleValue])
    .map((v) => String(v).trim().toUpperCase());
  switch (operator) {
    case 'in':
      return periods.some((p) => set.includes(p));
    case 'notIn':
      return periods.every((p) => !set.includes(p));
    case 'eq':
      return periods.some((p) => p === set[0]);
    case 'neq':
      return periods.every((p) => p !== set[0]);
    default:
      return false;
  }
}

/** How to treat a candidate whose value for a targeted field is missing/blank. */
export type MissingValuePolicy = 'evaluate' | 'pass';

type EvalOptions = { missing: MissingValuePolicy };
const DEFAULT_EVAL_OPTIONS: EvalOptions = { missing: 'evaluate' };

export type CandidateForFilter = {
  id: string;
  name: string;
  disciplineStatus: string | null;
  mcuStatus: string | null;
  performanceGrade: string | null;
  havQuadrant: string | null;
  behaviorRecommendation: string | null;
  yearsExperience: number | null;
  education: string | null;
};

function getFieldValue(candidate: CandidateForFilter, field: CandidateAttributeField): unknown {
  switch (field) {
    case 'disciplineStatus':
      return candidate.disciplineStatus;
    case 'mcuStatus':
      return candidate.mcuStatus;
    case 'performanceGrade':
      // Handled specially per-period in evaluateRuleNode; this is only a
      // fallback (e.g. value display). Returns the raw CSV.
      return candidate.performanceGrade;
    case 'havQuadrant':
      // Canonicalize "6" / "Kuadran #6" / etc. to "6" so strict-equality rules
      // match regardless of how the value was stored.
      return normalizeHavQuadrant(candidate.havQuadrant);
    case 'behaviorRecommendation':
      return candidate.behaviorRecommendation;
    case 'yearsExperience':
      return candidate.yearsExperience;
    case 'education':
      return candidate.education;
  }
}

/**
 * Scalar comparison for the set/equality operators, tolerant of the STORED TYPE
 * of a rule value.
 *
 * Why this cannot be strict `===`: rule values live in `program_templates`
 * jsonb, which enforces no type, and the two writers disagree. The seed in
 * lib/program-defaults.ts writes HAV as strings (`['1','2','3','4','7']`) while
 * the governance editor's numeric-list input writes numbers (`[1,2,3,4,7]` —
 * see governance-filter-editor.tsx, which runs every entry through `Number()`).
 * The candidate side is always a string: `getFieldValue` returns
 * `normalizeHavQuadrant(...)`, which yields "1".."16".
 *
 * With `Array.includes` that mismatch is total and silent — `[1,2,3,4,7]
 * .includes('1')` is false, so EVERY candidate fails the rule no matter which
 * quadrant they are in, and the failure looks like a legitimate rejection. That
 * is a wrong answer, not a degraded one, which is why the coercion belongs here
 * rather than in a one-off data cleanup: the next governance edit would
 * otherwise reintroduce it.
 *
 * Case is deliberately NOT folded. Value domains like 'CLEAR' / 'FIT' are
 * compared case-sensitively today, and quietly making them insensitive would
 * change which candidates pass unrelated rules. `evaluatePerformanceRule`
 * already does exactly this coercion for PA letters.
 */
function sameScalar(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // null/undefined never equals a concrete rule value (and must not become the
  // string "null" via coercion).
  if (a == null || b == null) return false;
  if (typeof a === 'object' || typeof b === 'object') return false;
  return String(a).trim() === String(b).trim();
}

function evaluateRule(value: unknown, operator: FilterOperator, ruleValue: FilterRule['value']): boolean {
  switch (operator) {
    case 'eq':
      return sameScalar(value, ruleValue);
    case 'neq':
      return !sameScalar(value, ruleValue);
    case 'in':
      return Array.isArray(ruleValue) && (ruleValue as unknown[]).some((v) => sameScalar(value, v));
    case 'notIn':
      return Array.isArray(ruleValue) && !(ruleValue as unknown[]).some((v) => sameScalar(value, v));
    case 'gte':
      return typeof value === 'number' && typeof ruleValue === 'number' && value >= ruleValue;
    case 'lte':
      return typeof value === 'number' && typeof ruleValue === 'number' && value <= ruleValue;
    case 'gt':
      return typeof value === 'number' && typeof ruleValue === 'number' && value > ruleValue;
    case 'lt':
      return typeof value === 'number' && typeof ruleValue === 'number' && value < ruleValue;
    case 'notExpired': {
      if (!value) return false;
      const dt = value instanceof Date ? value : new Date(value as string);
      return Number.isFinite(dt.getTime()) && dt.getTime() >= Date.now();
    }
    case 'isExpired': {
      if (!value) return true;
      const dt = value instanceof Date ? value : new Date(value as string);
      return Number.isFinite(dt.getTime()) && dt.getTime() < Date.now();
    }
  }
}

export type FailedRule = {
  label: string;
  message: string;
  /** Which candidate attribute the rule targets. */
  field?: CandidateAttributeField;
  /**
   * True when the candidate has NO value for that attribute, so the rule was
   * judged against absent data rather than against something the person is.
   *
   * Both outcomes reject under the default 'evaluate' policy, but they mean
   * completely different things to whoever reads the list: one is "this person
   * does not qualify", the other is "nobody has filled this column in yet".
   * Reporting them identically is what makes an unsynced column look like mass
   * disqualification.
   */
  dataMissing?: boolean;
};

export type FilterDecision = {
  candidateId: string;
  name: string;
  qualified: boolean;
  failedRules: FailedRule[];
  /**
   * Advisory rules this candidate fails. These did NOT disqualify — the person
   * is in the pool and scored — they are reported beside the ranking so the
   * decision-maker sees them. Empty for a candidate who fails nothing advisory,
   * and independent of `qualified`: a candidate can be disqualified by a hard
   * rule AND carry advisory flags.
   */
  flaggedRules: FailedRule[];
};

/** Is the candidate's value for a field absent (so the rule can't be judged)? */
function isFieldValueMissing(candidate: CandidateForFilter, field: CandidateAttributeField): boolean {
  if (field === 'performanceGrade') return parsePerformancePeriods(candidate.performanceGrade).length === 0;
  const v = getFieldValue(candidate, field);
  // havQuadrant already normalizes unknown data to '' via getFieldValue.
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/** Evaluate a single leaf rule against a candidate, honoring the missing policy. */
function evaluateRuleNode(rule: FilterRule, candidate: CandidateForFilter, opts: EvalOptions): boolean {
  // Missing data: under the 'pass' policy a rule can never disqualify on absent
  // data (e.g. non-candidate employees whose attributes aren't populated yet).
  if (opts.missing === 'pass' && isFieldValueMissing(candidate, rule.field)) return true;

  if (rule.field === 'performanceGrade') {
    const periods = parsePerformancePeriods(candidate.performanceGrade);
    // Under 'evaluate', empty PA reads as a single "C" (legacy default) so
    // program hard-filters behave exactly as before this change.
    if (periods.length === 0) periods.push('C');
    return evaluatePerformanceRule(periods, rule.operator, rule.value);
  }
  return evaluateRule(getFieldValue(candidate, rule.field), rule.operator, rule.value);
}

/**
 * Advisory leaf rules the candidate fails, each judged ON ITS OWN. A switched-off
 * advisory rule flags nobody — off means off, whatever its severity.
 *
 * Deliberately not group-aware: once a rule is separated from the hard siblings
 * it used to share an AND/OR with, its group no longer means anything — an `or`
 * over one remaining advisory rule is just that rule. Evaluating each leaf
 * independently is the only reading that stays true whatever shape the rule was
 * stored in, and it is what the reader wants anyway ("which advisory rules does
 * this person fail").
 */
function collectAdvisoryFlags(
  node: FilterCondition,
  candidate: CandidateForFilter,
  opts: EvalOptions,
): FailedRule[] {
  if (node.kind === 'rule') {
    if (!isAdvisoryRule(node.rule) || !isRuleEnabled(node.rule)) return [];
    if (evaluateRuleNode(node.rule, candidate, opts)) return [];
    return [
      {
        label: node.rule.label,
        message: node.rule.message,
        field: node.rule.field,
        dataMissing: isFieldValueMissing(candidate, node.rule.field),
      },
    ];
  }
  return node.children.flatMap((c) => collectAdvisoryFlags(c, candidate, opts));
}

/** Recursively evaluate whether a candidate satisfies a condition node. */
function evaluateCondition(node: FilterCondition, candidate: CandidateForFilter, opts: EvalOptions): boolean {
  if (node.kind === 'rule') {
    return evaluateRuleNode(node.rule, candidate, opts);
  }
  // An empty group is vacuously satisfied (imposes no constraint).
  if (node.children.length === 0) return true;
  return node.op === 'and'
    ? node.children.every((c) => evaluateCondition(c, candidate, opts))
    : node.children.some((c) => evaluateCondition(c, candidate, opts));
}

/**
 * Collect the leaf rules responsible for a candidate failing a node, so the
 * "Tidak Lolos" list can explain why. Returns [] when the node passes. For a
 * failing AND-node we surface the failing children; for a failing OR-node
 * (nothing matched) we surface all its alternatives.
 */
function collectFailedRules(
  node: FilterCondition,
  candidate: CandidateForFilter,
  opts: EvalOptions,
): FailedRule[] {
  if (node.kind === 'rule') {
    if (evaluateCondition(node, candidate, opts)) return [];
    return [
      {
        label: node.rule.label,
        message: node.rule.message,
        field: node.rule.field,
        dataMissing: isFieldValueMissing(candidate, node.rule.field),
      },
    ];
  }
  if (node.children.length === 0) return [];
  if (node.op === 'and') {
    return node.children
      .filter((c) => !evaluateCondition(c, candidate, opts))
      .flatMap((c) => collectFailedRules(c, candidate, opts));
  }
  // OR: if any child passes the group is satisfied → no failures.
  if (node.children.some((c) => evaluateCondition(c, candidate, opts))) return [];
  return node.children.flatMap((c) => collectFailedRules(c, candidate, opts));
}

/**
 * Evaluate the nested condition tree. A candidate qualifies iff the root group
 * is satisfied (empty tree → everyone qualifies). When rejected, the reasons are
 * the leaf rules on the unsatisfied branches.
 *
 * `opts.missing` controls absent data: 'evaluate' (default) judges it as-is
 * (program hard-filters); 'pass' lets a rule never disqualify on missing data
 * (the Job Family global filter, which spans employees with sparse attributes).
 *
 * Rules marked `severity: 'advisory'` take no part in that verdict at all —
 * they are evaluated separately into `flaggedRules`, so failing one is
 * something the ranking REPORTS rather than something it acts on. Rules
 * switched off (`enabled: false`) take part in nothing.
 */
export function applyProgramFilters(
  template: Pick<ProgramTemplate, 'filterTree'>,
  candidates: CandidateForFilter[],
  opts: EvalOptions = DEFAULT_EVAL_OPTIONS,
): FilterDecision[] {
  const tree = template.filterTree;
  // Qualification is decided by the switched-on hard rules alone; advisory
  // rules are reported separately and never remove anybody from the pool.
  const hardTree: FilterCondition = decidingFilterTree(tree);
  return candidates.map((candidate) => {
    const qualified = evaluateCondition(hardTree, candidate, opts);
    return {
      candidateId: candidate.id,
      name: candidate.name,
      qualified,
      failedRules: qualified ? [] : collectFailedRules(hardTree, candidate, opts),
      flaggedRules: collectAdvisoryFlags(tree, candidate, opts),
    };
  });
}

/**
 * `applyProgramFilters`, OPENED UP for the run trace (drizzle/0092): every leaf
 * rule's own verdict per candidate, the values it was judged on, and the
 * DECIDING tree as groups of rule indices — so the XLSX export can restate the
 * qualification as AND/OR formulas over the per-rule cells.
 *
 * One evaluator: the per-rule verdicts come from `evaluateRuleNode` and the
 * qualification from `evaluateCondition` over `decidingFilterTree`, exactly as
 * `applyProgramFilters` decides it, so a trace cannot disagree with the pool it
 * describes. Rules switched off are listed (they were in the configuration) and
 * evaluated by nothing — their result is null.
 */
export function traceProgramFilters(
  template: Pick<ProgramTemplate, 'filterTree'>,
  candidates: CandidateForFilter[],
  opts: EvalOptions = DEFAULT_EVAL_OPTIONS,
): {
  rules: {
    index: number;
    path: number[];
    field: string;
    operator: string;
    value: unknown;
    label: string;
    severity: 'hard' | 'advisory';
    enabled: boolean;
  }[];
  groups: { path: number[]; op: 'and' | 'or'; children: ({ rule: number } | { group: number[] })[] }[];
  candidates: {
    candidateId: string;
    values: Record<string, unknown>;
    results: Record<string, boolean | null>;
    dataMissing: Record<string, boolean>;
    qualified: boolean;
    flagged: string[];
  }[];
} {
  const tree = template.filterTree;
  const indexOf = new Map<FilterRule, number>();
  const rules: ReturnType<typeof traceProgramFilters>['rules'] = [];
  const walk = (node: FilterCondition, path: number[]) => {
    if (node.kind === 'rule') {
      const index = rules.length + 1;
      indexOf.set(node.rule, index);
      rules.push({
        index,
        path,
        field: node.rule.field,
        operator: node.rule.operator,
        value: node.rule.value ?? null,
        label: node.rule.label,
        severity: isAdvisoryRule(node.rule) ? 'advisory' : 'hard',
        enabled: isRuleEnabled(node.rule),
      });
      return;
    }
    node.children.forEach((child, i) => walk(child, [...path, i]));
  };
  walk(tree, []);

  // The deciding tree keeps the rule objects, so indices carry over.
  const groups: ReturnType<typeof traceProgramFilters>['groups'] = [];
  const collect = (node: FilterConditionGroup, path: number[]) => {
    groups.push({
      path,
      op: node.op,
      children: node.children.map((child, i) =>
        child.kind === 'rule' ? { rule: indexOf.get(child.rule)! } : { group: [...path, i] },
      ),
    });
    node.children.forEach((child, i) => {
      if (child.kind === 'group') collect(child, [...path, i]);
    });
  };
  const hardTree = decidingFilterTree(tree);
  collect(hardTree, []);

  const fields = Array.from(new Set(rules.map((r) => r.field))) as CandidateAttributeField[];
  return {
    rules,
    groups,
    candidates: candidates.map((candidate) => {
      const results: Record<string, boolean | null> = {};
      const dataMissing: Record<string, boolean> = {};
      walkRules(tree, (rule) => {
        const idx = String(indexOf.get(rule));
        results[idx] = isRuleEnabled(rule) ? evaluateRuleNode(rule, candidate, opts) : null;
        dataMissing[idx] = isFieldValueMissing(candidate, rule.field);
      });
      const values: Record<string, unknown> = {};
      for (const f of fields) {
        const v = getFieldValue(candidate, f);
        values[f] = v instanceof Date ? v.toISOString() : v ?? null;
      }
      return {
        candidateId: candidate.id,
        values,
        results,
        dataMissing,
        qualified: evaluateCondition(hardTree, candidate, opts),
        flagged: collectAdvisoryFlags(tree, candidate, opts).map((f) => f.label),
      };
    }),
  };
}

function walkRules(node: FilterCondition, visit: (rule: FilterRule) => void): void {
  if (node.kind === 'rule') visit(node.rule);
  else node.children.forEach((c) => walkRules(c, visit));
}

/**
 * Distinct, non-empty values actually present in this tenant's candidate rows,
 * per filter-targetable field. Powers the governance filter editor's value
 * picker so it mirrors real data (including drift the curated lists don't know
 * about). Soft-deleted candidates are excluded — a tombstone's stale HAV or
 * education value would otherwise keep offering itself as a pickable option
 * long after the person left the pool.
 * `performanceGrade` and `yearsExperience` are intentionally omitted —
 * the former is a comma-joined multi-slot string (its letters are the fixed
 * A–E domain), the latter is a free numeric field.
 */
export async function getCandidateFilterValues(
  tenantId?: string
): Promise<Partial<Record<CandidateAttributeField, string[]>>> {
  const id = tenantId ?? (await getCurrentTenantId());
  // Demo mode: the values the pickers offer are the ones the rules will judge
  // — the ON candidates, as their demo copy merged with the live record, HAV
  // in force — not the real column, which includes people switched off and
  // values nobody in the demo has.
  if (await isDemoMode()) {
    const rows = await loadFilterableCandidates(id);
    const distinct = (pick: (c: CandidateForFilter) => string | null) =>
      Array.from(new Set(rows.map(pick).filter((v): v is string => v != null && v.trim() !== '' && !/^[-–—\s]+$/.test(v))))
        .sort((a, b) => a.localeCompare(b));
    return {
      disciplineStatus: distinct((c) => c.disciplineStatus),
      mcuStatus: distinct((c) => c.mcuStatus),
      havQuadrant: distinct((c) => normalizeHavQuadrant(c.havQuadrant) || null).sort((a, b) => Number(a) - Number(b)),
      behaviorRecommendation: distinct((c) => c.behaviorRecommendation),
      education: distinct((c) => c.education),
    };
  }
  const result = await db.execute(sql`
    SELECT
      array_agg(DISTINCT discipline_status) FILTER (WHERE discipline_status IS NOT NULL AND discipline_status <> '') AS "disciplineStatus",
      array_agg(DISTINCT mcu_status) FILTER (WHERE mcu_status IS NOT NULL AND mcu_status <> '') AS "mcuStatus",
      array_agg(DISTINCT hav_quadrant) FILTER (WHERE hav_quadrant IS NOT NULL AND hav_quadrant <> '') AS "havQuadrant",
      array_agg(DISTINCT behavior_recommendation) FILTER (WHERE behavior_recommendation IS NOT NULL AND behavior_recommendation <> '') AS "behaviorRecommendation",
      array_agg(DISTINCT education) FILTER (WHERE education IS NOT NULL AND education <> '') AS "education"
    FROM candidates
    WHERE tenant_id = ${id} AND deleted_at IS NULL
  `);
  const row = (result.rows?.[0] ?? {}) as Record<string, string[] | null>;
  // The DISTINCT above ran over ciphertext (each value encrypts with its own
  // IV), so decrypt every distinct ciphertext and dedupe the resulting
  // plaintext values.
  const clean = (v: string[] | null | undefined) =>
    Array.from(
      new Set(
        (v ?? [])
          .map((s) => decryptCandidateValue(s))
          .filter((s): s is string => s != null && s !== ''),
      ),
    )
      // Drop nulls, blanks, and dash-only placeholders (e.g. "-", "—") that HR data uses for "unknown".
      .filter((s) => s.trim() !== '' && !/^[-–—\s]+$/.test(s))
      .sort((a, b) => a.localeCompare(b));
  // HAV values are stored in mixed forms ("6" vs "Kuadran #6"); canonicalize to
  // the quadrant number and de-duplicate so the picker never shows duplicates.
  const havCanonical = Array.from(
    new Set((row.havQuadrant ?? []).map((s) => normalizeHavQuadrant(decryptCandidateValue(s) ?? '')).filter((s) => s !== '')),
  ).sort((a, b) => Number(a) - Number(b));

  return {
    disciplineStatus: clean(row.disciplineStatus),
    mcuStatus: clean(row.mcuStatus),
    havQuadrant: havCanonical,
    behaviorRecommendation: clean(row.behaviorRecommendation),
    education: clean(row.education),
  };
}

export async function loadFilterableCandidates(
  tenantId?: string | string[],
): Promise<CandidateForFilter[]> {
  // Accept one tenant or several (cross-tenant scoring pool). Falls back to the
  // current tenant when omitted.
  const ids = Array.isArray(tenantId)
    ? tenantId
    : [tenantId ?? (await getCurrentTenantId())];
  const rows = await db
    .select({
      id: schema.candidates.id,
      name: schema.candidates.name,
      disciplineStatus: schema.candidates.disciplineStatus,
      mcuStatus: schema.candidates.mcuStatus,
      performanceGrade: schema.candidates.performanceGrade,
      havQuadrant: schema.candidates.havQuadrant,
      behaviorRecommendation: schema.candidates.behaviorRecommendation,
      yearsExperience: schema.candidates.yearsExperience,
      education: schema.candidates.education,
    })
    .from(schema.candidates)
    // Every filter-rule evaluation in the app reads this pool, so a tombstone
    // slipping through here reaches a scoring run itself.
    .where(and(inArray(schema.candidates.tenantId, ids), liveCandidate()));
  // Every targeted column is encrypted at rest, so decrypt first; ORDER BY name
  // happens here (after decryption) rather than in SQL. Unlock BEFORE that: a
  // sealed row decrypted while the DEK is still unloaded (the first request
  // after a restart races the layout's unlock) reads as all-null and would be
  // dropped from a scoring pool as if it had failed every rule.
  await ensureUnlocked();
  const decrypted = decryptCandidateRows(rows).sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? ''),
  );
  // HAV rules judge the quadrant IN FORCE (manual > upload > formula), not the
  // raw Excel column — the same value the HAV aspect scores, or one run would
  // filter on one HAV and score on another (lib/hav-effective.ts).
  // Demo mode: OFF candidates take no part in any eligibility evaluation, and
  // the ON ones are judged on their demo copy (lib/demo/). BEFORE the HAV fold,
  // so the HAV in force follows the copy too.
  const visible = await forCurrentMode(decrypted, (r) => r.id, { onlyOn: true });
  return (await withEffectiveHav(visible)) as CandidateForFilter[];
}

/**
 * The same rows as `loadFilterableCandidates`, but for a NAMED handful.
 *
 * Exists because a rerun has to answer "does this one person clear the program's
 * rules?" for a badge, and the only loader took tenants — so answering it meant
 * decrypting every live candidate of every business unit to look at two of them.
 *
 * Keeps `liveCandidate()` for the reason the tombstone exists at all: a
 * soft-deleted person must never be evaluated as if they were still a candidate.
 * Tenant is NOT constrained: a rerun pool may legitimately span business units,
 * and the caller already chose these ids deliberately.
 */
export async function loadFilterableCandidatesByIds(
  candidateIds: string[],
): Promise<CandidateForFilter[]> {
  const ids = candidateIds.filter(Boolean);
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: schema.candidates.id,
      name: schema.candidates.name,
      disciplineStatus: schema.candidates.disciplineStatus,
      mcuStatus: schema.candidates.mcuStatus,
      performanceGrade: schema.candidates.performanceGrade,
      havQuadrant: schema.candidates.havQuadrant,
      behaviorRecommendation: schema.candidates.behaviorRecommendation,
      yearsExperience: schema.candidates.yearsExperience,
      education: schema.candidates.education,
    })
    .from(schema.candidates)
    .where(and(inArray(schema.candidates.id, ids), liveCandidate()));
  await ensureUnlocked();
  const visible = await forCurrentMode(decryptCandidateRows(rows), (r) => r.id, { onlyOn: true });
  return (await withEffectiveHav(visible)) as CandidateForFilter[];
}

/**
 * Copy a program template's default criteria into the `criteria` table for a position
 * IF the position currently has no criteria. Returns the count of inserted rows.
 */
export async function syncTemplateCriteriaToPosition(
  positionId: string,
  templateId: string
): Promise<number> {
  const existing = await db
    .select({ id: schema.criteria.id })
    .from(schema.criteria)
    .where(eq(schema.criteria.positionId, positionId))
    .limit(1);
  if (existing.length > 0) return 0;

  const template = await getProgramTemplate(templateId);
  if (!template || template.defaultCriteria.length === 0) return 0;

  // `criteria.weight` is NOT NULL and no reader has ever read it back — only the
  // row COUNT is (prepareMatrixAction). It used to be copied from the template's
  // own criteria weights; those are gone, so it carries the program's AHP weight
  // instead. A criterion whose name maps to no aspect is skipped rather than
  // stored at 0, which is the same rule the engines apply to it.
  const weights = ahpWeightPercentages(template.ahpConfig?.pairwise ?? null);
  const rows = template.defaultCriteria
    .map((c) => ({ criterion: c, canonical: matchCanonicalCriterion(c.name) }))
    .filter((r) => r.canonical != null);
  if (rows.length === 0) return 0;

  await db.insert(schema.criteria).values(
    rows.map(({ criterion, canonical }) => ({
      positionId,
      name: criterion.name,
      description: criterion.description ?? null,
      weight: (weights[canonical!.aspect] ?? 0).toFixed(2),
      type: criterion.type,
      category: 'score' as const,
      sourceTemplateId: templateId,
    }))
  );
  return rows.length;
}
