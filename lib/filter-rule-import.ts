import type { FilterCondition, FilterConditionGroup, FilterRule } from '@/lib/db/schema';
import { flattenFilterTree } from '@/lib/filter-rules';

/**
 * Applying rules that are ALREADY SAVED on a program template to the Talent
 * Pool's draft tree ("Terapkan dari template program").
 *
 * Client-safe and pure: the dialog previews exactly what `applyImportedRules`
 * will produce, and the result only becomes the DRAFT — the panel's own preview
 * then counts what it does to the list, and nothing is written until the user
 * presses Simpan. So importing is never a second save path.
 *
 * The unit of choice is a TOP-LEVEL child of the source tree: a rule, or a whole
 * group. A group cannot be split, because picking one branch out of an `or`
 * turns "A or B" into "A" — a stricter rule than the one that was saved, under
 * the same name.
 *
 * Rules are copied VERBATIM (label, message, severity, enabled). A saved
 * advisory MCU rule stays advisory: the Talent Pool panel does not offer the
 * severity choice, but it renders an imported advisory rule's note, and
 * silently hardening it on the way in would be a change nobody chose.
 */

export type ImportMode = 'append' | 'replace';

export type ImportOptions = {
  mode: ImportMode;
  /**
   * Append only: drop the draft's TOP-LEVEL rules on the same field as an
   * imported rule before adding it. Without this, importing "PA A/B/C" into a
   * tree that already says "PA A/B" ANDs the two, and the stricter one silently
   * wins — the import would look applied and change nothing. Rules nested in a
   * draft group are never touched: removing one would rewrite that group's
   * logic rather than replace a rule.
   */
  replaceSameField: boolean;
  /** The source's root operator — used when `mode === 'replace'`. */
  sourceOp: 'and' | 'or';
};

export type ImportResult = {
  tree: FilterConditionGroup;
  /** Nodes actually added. */
  added: number;
  /** Picked nodes already present, identically, at the draft's top level. */
  skippedDuplicates: number;
  /** Draft top-level rules removed because an imported rule took their field. */
  replaced: number;
};

/** Status of one source node against the current draft. */
export type ImportNodeStatus =
  /** Identical node already sits at the draft's top level. */
  | 'same'
  /** A rule on a field the draft already has a rule on, with different terms. */
  | 'conflict'
  | 'new';

function canonicalValue(value: FilterRule['value']): unknown {
  if (Array.isArray(value)) return [...(value as (string | number)[])].map(String).sort();
  return value == null ? null : String(value);
}

/**
 * What a rule DECIDES — field, operator, value, severity, on/off. Label and
 * message are prose and do not change who passes, so two rules that differ only
 * in wording are the same rule.
 */
export function ruleIdentity(rule: FilterRule): string {
  return JSON.stringify([
    rule.field,
    rule.operator,
    canonicalValue(rule.value),
    rule.severity === 'advisory' ? 'advisory' : 'hard',
    rule.enabled === false ? 'off' : 'on',
  ]);
}

/** Same as `ruleIdentity`, recursively; group children are order-insensitive. */
export function nodeIdentity(node: FilterCondition): string {
  if (node.kind === 'rule') return `r:${ruleIdentity(node.rule)}`;
  return `g:${node.op}(${node.children.map(nodeIdentity).sort().join(',')})`;
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export function importNodeStatus(
  draft: FilterConditionGroup,
  node: FilterCondition,
): ImportNodeStatus {
  const key = nodeIdentity(node);
  // Under an `or` root a top-level rule is an alternative, not a requirement,
  // so the same rule there is not the same constraint — `applyImportedRules`
  // AND-s an import beside the whole tree in that case.
  if (draft.op === 'and' && draft.children.some((c) => nodeIdentity(c) === key)) return 'same';
  const draftFields = new Set(flattenFilterTree(draft).map((r) => r.field));
  if (flattenFilterTree(node).some((r) => draftFields.has(r.field))) return 'conflict';
  return 'new';
}

/** Fields of the picked nodes — the ones `replaceSameField` would clear. */
function pickedFields(picked: FilterCondition[]): Set<string> {
  return new Set(picked.flatMap((n) => flattenFilterTree(n).map((r) => r.field)));
}

export function applyImportedRules(
  draft: FilterConditionGroup,
  picked: FilterCondition[],
  options: ImportOptions,
): ImportResult {
  const nodes = clone(picked);

  if (options.mode === 'replace') {
    return {
      tree: { kind: 'group', op: options.sourceOp, children: nodes },
      added: nodes.length,
      skippedDuplicates: 0,
      replaced: draft.children.length,
    };
  }

  // A draft with an `or` root cannot take new top-level children: they would
  // become ALTERNATIVES, so importing a rule would let more people in. Wrap the
  // existing tree as one AND-ed branch instead.
  const base = clone(draft);
  const root: FilterConditionGroup =
    base.op === 'and' || base.children.length === 0
      ? { kind: 'group', op: 'and', children: base.children }
      : { kind: 'group', op: 'and', children: [base] };

  let replaced = 0;
  if (options.replaceSameField) {
    const fields = pickedFields(nodes);
    // A draft rule identical to a picked one stays where it is (and the picked
    // one counts as a duplicate): replacing a rule by itself is not a change,
    // and moving it to the end would make the draft look edited.
    const pickedKeys = new Set(nodes.map(nodeIdentity));
    root.children = root.children.filter((c) => {
      if (c.kind === 'rule' && fields.has(c.rule.field) && !pickedKeys.has(nodeIdentity(c))) {
        replaced += 1;
        return false;
      }
      return true;
    });
  }

  const present = new Set(root.children.map(nodeIdentity));
  let added = 0;
  let skippedDuplicates = 0;
  for (const node of nodes) {
    const key = nodeIdentity(node);
    if (present.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    present.add(key);
    root.children.push(node);
    added += 1;
  }

  // Nothing changed: hand back the draft as it was, so an or-root is not
  // wrapped and the panel does not light up "Belum disimpan" for a no-op.
  if (added === 0 && replaced === 0) {
    return { tree: clone(draft), added: 0, skippedDuplicates, replaced: 0 };
  }

  return { tree: root, added, skippedDuplicates, replaced };
}
