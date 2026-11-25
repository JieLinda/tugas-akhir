import type {
  CandidateAttributeField,
  FilterCondition,
  FilterConditionGroup,
  FilterOperator,
  FilterRule,
} from '@/lib/db/schema';

/**
 * Helpers for the nested boolean condition tree used by program eligibility
 * filters. Client-safe (no server-only imports) so the governance editor and
 * the server actions share one normalization path.
 *
 * A node is either a rule or a group (`and`/`or`) over child nodes, so filters
 * can nest arbitrarily: `A AND B AND ((C AND D) OR (E AND F))`.
 *
 * Stored `filter_rules` jsonb may be any of:
 *   - `{ tree: FilterConditionGroup }`  (current canonical)
 *   - `{ groups: [{ rules }] }`         (legacy AND-of-OR)
 *   - `FilterRule[]`                    (legacy all-AND list)
 * All three normalize to a single root group.
 */

export function ruleNode(rule: FilterRule): FilterCondition {
  return { kind: 'rule', rule };
}

export function newGroup(op: 'and' | 'or' = 'and'): FilterConditionGroup {
  return { kind: 'group', op, children: [] };
}

function isGroupLike(x: unknown): x is { op?: unknown; children?: unknown } {
  return !!x && typeof x === 'object' && (x as { kind?: unknown }).kind === 'group';
}

function coerceChild(x: unknown): FilterCondition | null {
  if (!x || typeof x !== 'object') return null;
  const node = x as { kind?: unknown; rule?: unknown; field?: unknown; operator?: unknown };
  if (node.kind === 'group') return coerceGroup(x);
  if (node.kind === 'rule' && node.rule) return { kind: 'rule', rule: node.rule as FilterRule };
  // Tolerate a bare FilterRule object (has field + operator).
  if ('field' in node && 'operator' in node) return { kind: 'rule', rule: x as FilterRule };
  return null;
}

function coerceGroup(x: unknown): FilterConditionGroup {
  if (!isGroupLike(x)) return newGroup('and');
  const op = (x as { op?: unknown }).op === 'or' ? 'or' : 'and';
  const rawChildren = Array.isArray((x as { children?: unknown }).children)
    ? ((x as { children: unknown[] }).children)
    : [];
  const children = rawChildren.map(coerceChild).filter((c): c is FilterCondition => c !== null);
  return { kind: 'group', op, children };
}

/** Parse stored jsonb into a normalized root condition group. */
export function normalizeFilterTree(raw: unknown): FilterConditionGroup {
  // Current canonical: { tree: <group> }
  if (raw && typeof raw === 'object' && 'tree' in raw && (raw as { tree?: unknown }).tree) {
    return coerceGroup((raw as { tree: unknown }).tree);
  }
  // A bare group node.
  if (isGroupLike(raw)) return coerceGroup(raw);
  // Legacy AND-of-OR: { groups: [{ rules }] } → AND of (OR of each group's rules).
  if (raw && typeof raw === 'object' && Array.isArray((raw as { groups?: unknown }).groups)) {
    const groups = (raw as { groups: unknown[] }).groups;
    const children: FilterCondition[] = groups
      .map((g) => (g && typeof g === 'object' && Array.isArray((g as { rules?: unknown }).rules)
        ? ((g as { rules: FilterRule[] }).rules)
        : []))
      .filter((rules) => rules.length > 0)
      .map((rules) =>
        rules.length === 1
          ? ruleNode(rules[0])
          : ({ kind: 'group', op: 'or', children: rules.map(ruleNode) } as FilterCondition),
      );
    return { kind: 'group', op: 'and', children };
  }
  // Legacy flat AND-list.
  if (Array.isArray(raw)) {
    return { kind: 'group', op: 'and', children: (raw as FilterRule[]).map(ruleNode) };
  }
  return newGroup('and');
}

/** Wrap a root group in the canonical stored shape. */
export function toFilterTreeSet(tree: FilterConditionGroup): { tree: FilterConditionGroup } {
  return { tree };
}

/** Every leaf rule in the tree (for counts, prompt hints, legacy compat). */
export function flattenFilterTree(node: FilterCondition): FilterRule[] {
  return node.kind === 'rule' ? [node.rule] : node.children.flatMap(flattenFilterTree);
}

/** Total leaf-rule count, switched-off rules included. */
export function countFilterRules(node: FilterCondition): number {
  return flattenFilterTree(node).length;
}

/** Off only when explicitly `enabled: false`; a rule written before the switch existed is on. */
export function isRuleEnabled(rule: FilterRule): boolean {
  return rule.enabled !== false;
}

/** True when this rule only flags rather than disqualifies (missing severity = hard). */
export function isAdvisoryRule(rule: FilterRule): boolean {
  return rule.severity === 'advisory';
}

/** Rules that are switched on — what "N aturan filter berlaku" counts. */
export function countEnabledFilterRules(node: FilterCondition): number {
  return flattenFilterTree(node).filter(isRuleEnabled).length;
}

/** Rules switched off: kept in the tree, evaluated by nothing. */
export function countDisabledFilterRules(node: FilterCondition): number {
  return flattenFilterTree(node).filter((rule) => !isRuleEnabled(rule)).length;
}

/**
 * The tree that DECIDES qualification: every switched-off rule and every
 * advisory rule removed. The filter engine (lib/programs.ts) evaluates exactly
 * this; advisory rules are reported beside it, switched-off ones nowhere.
 *
 * REMOVED, not evaluated as true, and the difference is not cosmetic: inside an
 * `or` group a rule that always passes satisfies the whole group, so an
 * advisory MCU rule — or a switched-off rule — sitting beside a real
 * alternative would disable that alternative for everybody. Removing the node
 * leaves the remaining branch to decide on its own.
 *
 * A group that loses every child this way is left empty, and the evaluator
 * treats an empty group — `and` or `or` alike — as vacuously satisfied: a group
 * whose only content was advisory or off imposes no constraint, rather than
 * rejecting everyone. Pinned by scripts/verify-mcu-advisory.ts.
 */
export function decidingFilterTree(node: FilterConditionGroup): FilterConditionGroup {
  const children = node.children
    .map((child): FilterCondition | null => {
      if (child.kind === 'rule') {
        return isRuleEnabled(child.rule) && !isAdvisoryRule(child.rule) ? child : null;
      }
      return decidingFilterTree(child);
    })
    .filter((child): child is FilterCondition => child !== null);
  return { kind: 'group', op: node.op, children };
}

/**
 * The tree with every rule NOT on one of `fields` made vacuously TRUE — each
 * such leaf is replaced by an empty `and` group, which the evaluator treats as
 * satisfied.
 *
 * "True", not "removed", and that is the opposite of `decidingFilterTree`, for
 * the opposite question. Removing asks "who qualifies on the remaining rules
 * alone"; this asks "who is not turned away by `fields`, whatever the rest turns
 * out to be". Replacing leaves by TRUE can only admit more people, never fewer,
 * so the result is always a superset of the full tree's verdict — which is what
 * lets Talent Mapping promise that nobody in the Talent Pool is missing from the
 * map. Only `and`/`or` groups exist (negation lives inside operators like
 * `notIn`), so that monotonicity holds for every tree this app can store.
 */
export function keepOnlyFieldRules<T extends FilterCondition>(
  node: T,
  fields: readonly FilterRule['field'][],
): T {
  if (node.kind === 'rule') {
    return (fields.includes(node.rule.field) ? node : newGroup('and')) as T;
  }
  return {
    ...node,
    children: node.children.map((child) => keepOnlyFieldRules(child, fields)),
  } as T;
}

/**
 * The fields of the Talent Pool rules that decide who appears on Talent Mapping.
 *
 * Only discipline (HR decision, 2026-10). The other rules are not filters there:
 * MCU is already advisory everywhere (it flags, it never disqualifies), and HAV, PA and behavioural assessment are the very INPUTS the
 * map arranges people by — filtering the map on them would hide exactly the
 * people whose placement is in question.
 */
export const TALENT_MAPPING_GATE_FIELDS = ['disciplineStatus'] as const satisfies readonly FilterRule['field'][];

/**
 * Talent Mapping's population tree: the Talent Pool's DECIDING rules (switched-on,
 * non-advisory) with everything but discipline made TRUE. Evaluated through the
 * same `applyProgramFilters` as the pool itself, so editing — or switching off —
 * the discipline rule on the Talent Pool page changes the map's population too.
 */
export function talentMappingGateTree(tree: FilterConditionGroup): FilterConditionGroup {
  return keepOnlyFieldRules(decidingFilterTree(tree), TALENT_MAPPING_GATE_FIELDS);
}

/** The switched-on, non-advisory rules that gate Talent Mapping, for display. */
export function talentMappingGateRules(tree: FilterConditionGroup): FilterRule[] {
  return flattenFilterTree(talentMappingGateTree(tree));
}

// ── What a rule may say ────────────────────────────────────────────────────

const SET_OPERATORS = ['eq', 'neq', 'in', 'notIn'] as const satisfies readonly FilterOperator[];
const NUMERIC_OPERATORS = [...SET_OPERATORS, 'gte', 'lte', 'gt', 'lt'] as const satisfies readonly FilterOperator[];

/**
 * The operators that MEAN something for each field, given how the evaluator
 * (lib/programs.ts) compares. Everything else is refused on save and not offered
 * by the editor, because each of them fails SILENTLY — the rule simply rejects
 * every candidate, which reads as a legitimate verdict:
 *
 *  - `gte`/`lte`/`gt`/`lt` compare only when both sides are numbers, and only
 *    `yearsExperience` is a number. On discipline, MCU, HAV ("1".."16" are
 *    strings), behaviour or education they are false for everybody.
 *  - `notExpired`/`isExpired` read the value as a DATE. No filterable field is a
 *    date, so `notExpired` on 'CLEAR' is false for everybody too.
 *
 * Both stay in the FilterOperator type so an old stored rule still parses and
 * is reported by validateFilterTree instead of vanishing.
 */
export const FILTER_OPERATORS_BY_FIELD: Record<CandidateAttributeField, readonly FilterOperator[]> = {
  disciplineStatus: SET_OPERATORS,
  mcuStatus: SET_OPERATORS,
  performanceGrade: SET_OPERATORS,
  havQuadrant: SET_OPERATORS,
  behaviorRecommendation: SET_OPERATORS,
  education: SET_OPERATORS,
  yearsExperience: NUMERIC_OPERATORS,
};

export function operatorsForField(field: CandidateAttributeField): readonly FilterOperator[] {
  return FILTER_OPERATORS_BY_FIELD[field] ?? SET_OPERATORS;
}

const FIELD_NAMES: Record<CandidateAttributeField, string> = {
  disciplineStatus: 'Status Disiplin',
  mcuStatus: 'Status MCU',
  performanceGrade: 'Performance Appraisal',
  havQuadrant: 'HAV Quadrant',
  behaviorRecommendation: 'Behavior Recommendation',
  yearsExperience: 'Masa Kerja',
  education: 'Pendidikan',
};

const isFilled = (v: unknown): boolean =>
  (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v));

/**
 * Every reason this tree cannot be evaluated the way it reads, in Indonesian,
 * one line per rule. Empty = valid. Both save paths (Talent Pool page, Tata
 * Kelola) refuse a tree with any finding, switched-off rules included — an off
 * rule is one click from deciding again.
 *
 * Structure is already normalised by normalizeFilterTree; this checks what a
 * rule SAYS: a known field, an operator that means something for it
 * (FILTER_OPERATORS_BY_FIELD), and a value of the right shape. An `in` list
 * with no values is the one most easily saved by accident and the most
 * damaging: it rejects every candidate.
 */
export function validateFilterTree(tree: FilterConditionGroup): string[] {
  const problems: string[] = [];
  let n = 0;
  const visit = (node: FilterCondition) => {
    if (node.kind === 'group') {
      node.children.forEach(visit);
      return;
    }
    n += 1;
    const rule = node.rule as Partial<FilterRule> | undefined;
    const field = rule?.field as CandidateAttributeField | undefined;
    const name = field && FIELD_NAMES[field] ? FIELD_NAMES[field] : String(field ?? '?');
    const label = rule?.label?.trim();
    const where = `Aturan ${n}${label ? ` "${label}"` : ''} (${name})`;
    if (!rule || !field || !FIELD_NAMES[field]) {
      problems.push(`${where}: kolom "${String(field ?? '')}" tidak dikenal.`);
      return;
    }
    const operator = rule.operator as FilterOperator;
    if (!operatorsForField(field).includes(operator)) {
      problems.push(`${where}: operator "${String(operator)}" tidak berlaku untuk kolom ini dan akan menggugurkan semua kandidat.`);
      return;
    }
    if (rule.severity != null && rule.severity !== 'hard' && rule.severity !== 'advisory') {
      problems.push(`${where}: sifat aturan "${String(rule.severity)}" tidak dikenal.`);
    }
    const value = rule.value as unknown;
    if (operator === 'in' || operator === 'notIn') {
      if (!Array.isArray(value) || value.length === 0) {
        problems.push(
          `${where}: belum ada nilai yang dipilih` +
            (operator === 'in' ? ' — aturan ini akan menggugurkan semua kandidat.' : '.'),
        );
      } else if (!value.every(isFilled)) {
        problems.push(`${where}: ada nilai kosong di daftar.`);
      }
    } else if (operator === 'eq' || operator === 'neq') {
      if (Array.isArray(value) || !isFilled(value)) problems.push(`${where}: nilai belum diisi.`);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${where}: nilai harus berupa angka.`);
    }
  };
  visit(tree);
  return problems;
}
