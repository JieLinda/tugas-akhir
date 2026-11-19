// ── A stored run's configuration as the comparison reads it (FR-SN-01, I-3) ──
//
// Pure: maps what a run stored (config_snapshot, run_info, filter_summary) to
// the view every comparison item is read from, with the ORIGIN of each part —
// frozen when the run was made, inherited from its parent, read live, a live
// fallback where an older parent recorded nothing, the system default, or not
// recorded at all. Split from lib/run-compare-data.ts so the mapping can be
// tested without a database.

import { CRITERIA, type CriterionKey, type Origin, type RunConfigView } from './run-compare';
import type { RunModelsRecord } from './rerun-modes';
// The governance editor's own words for operators, so a rule reads the same here.
import { OPERATOR_LABELS } from '../components/governance/governance-types';

/** Stored codes a reader should not have to decode. */
const VALUE_LABELS: Record<string, string> = {
  fit: 'Fit',
  fit_with_note: 'Fit dengan catatan',
  unfit: 'Unfit',
  expired: 'Kedaluwarsa',
};

const KEYS = new Set<string>(CRITERIA);
export const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
export const parseJson = (v: unknown): any => {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};
/** Canonical JSON (keys sorted) — equality of two stored filter trees. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function ruleLabels(tree: unknown): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.kind === 'rule' && n.rule) {
      const r = n.rule;
      if (r.enabled === false) return;
      const word = (x: unknown) => VALUE_LABELS[String(x)] ?? String(x);
      const v = Array.isArray(r.value) ? r.value.map(word).join(', ') : r.value == null ? '' : word(r.value);
      const op = OPERATOR_LABELS[String(r.operator)] ?? String(r.operator);
      out.push(`${r.label}${r.severity === 'advisory' ? ' (hanya menandai)' : ''}: ${op} ${v}`.trim());
      return;
    }
    if (Array.isArray(n.children)) n.children.forEach(walk);
    if (n.tree) walk(n.tree);
  };
  walk(tree);
  return out;
}

function readWeights(v: any): Record<CriterionKey, number> | null {
  if (!v || typeof v !== 'object') return null;
  const out = {} as Record<CriterionKey, number>;
  for (const k of CRITERIA) {
    const n = num(v[k]);
    if (n == null) return null;
    out[k] = n;
  }
  return out;
}

const sourceToOrigin = (s: unknown, isChild: boolean): Origin =>
  s === 'parent'
    ? 'frozen_parent'
    : s === 'live_fallback'
      ? 'live_fallback'
      : s === 'own'
        ? 'root_snapshot'
        : isChild
          ? 'live'
          : 'root_snapshot';

/**
 * Where a run's weights came from. A child's weights are its parent's — even
 * when the parent used the system defaults, the child did not choose them, it
 * inherited them — so a child never reads "Bawaan sistem".
 */
export function weightsOriginOf(
  hasWeights: boolean,
  frozenSource: unknown,
  weightSource: string | null,
  isChild: boolean,
): Origin {
  if (!hasWeights) return 'not_recorded';
  if (isChild) {
    if (frozenSource === 'parent' || weightSource === 'inherited') return 'frozen_parent';
    if (frozenSource === 'live_fallback') return 'live_fallback';
    return 'live';
  }
  return weightSource === 'default' ? 'default' : 'root_snapshot';
}

/** Build the FR-SN-01 view of a run's configuration, with the origin of every part (I-3). */
export function configViewFrom(input: {
  isChild: boolean;
  configSnapshot: any;
  runInfo: any;
  filterSummary: any;
  finalistCount: number | null;
}): RunConfigView {
  const snap = input.configSnapshot ?? null;
  const info = input.runInfo ?? {};
  const fz = info.frozen ?? null;
  const fs = input.filterSummary ?? {};
  const ahp = fz?.ahp ?? info.ahp ?? null;

  const weights = readWeights(fz?.ahp?.weights) ?? readWeights(info.ahp?.weights);
  const weightSource: string | null = fz?.ahp?.weightSource ?? info.ahp?.weightSource ?? null;
  const weightsOrigin = weightsOriginOf(Boolean(weights), fz?.ahp?.source, weightSource, input.isChild);
  const pairwise: number[][] | null = Array.isArray(fz?.ahp?.pairwise)
    ? fz.ahp.pairwise
    : Array.isArray(info.ahp?.pairwise)
      ? info.ahp.pairwise
      : Array.isArray(snap?.template?.ahpConfig?.pairwise)
        ? snap.template.ahpConfig.pairwise
        : null;
  const consistency =
    fz?.ahp?.consistency && num(fz.ahp.consistency.cr) != null
      ? { cr: Number(fz.ahp.consistency.cr), lambdaMax: Number(fz.ahp.consistency.lambdaMax), ci: Number(fz.ahp.consistency.ci) }
      : num(info.ahp?.consistencyRatio) != null
        ? {
            cr: Number(info.ahp.consistencyRatio),
            lambdaMax: Number(info.ahp.lambdaMax),
            ci: Number(info.ahp.consistencyIndex),
          }
        : null;
  const activeRaw = fz?.ahp?.activeCriteria ?? info.ahp?.activeCriteria ?? null;
  const activeCriteria: CriterionKey[] | null = Array.isArray(activeRaw)
    ? (activeRaw.filter((k: unknown) => KEYS.has(String(k))) as CriterionKey[])
    : null;
  const droppedRaw = fz?.ahp?.droppedCriteria ?? info.ahp?.droppedCriteria ?? [];
  const droppedCriteria = Array.isArray(droppedRaw)
    ? droppedRaw
        .filter((d: any) => KEYS.has(String(d?.key)))
        .map((d: any) => ({ key: d.key as CriterionKey, reason: String(d.reason ?? '') }))
    : [];

  const template = snap?.template ?? null;
  const filterOrigin: Origin = !template
    ? 'not_recorded'
    : snap.templateSource === 'inherited'
      ? 'frozen_parent'
      : input.isChild
        ? 'live'
        : 'root_snapshot';
  const readiness = snap?.readiness && Array.isArray(snap.readiness.thresholds)
    ? {
        thresholds: snap.readiness.thresholds.map((t: any) => ({ minScore: Number(t.minScore), level: String(t.level) })),
        defaultLevel: String(snap.readiness.defaultLevel ?? ''),
      }
    : null;

  const anchorsFz = fz?.anchors ?? null;
  const techLegacy =
    num(info.technical?.simFloor) != null && num(info.technical?.simCeil) != null
      ? { simFloor: Number(info.technical.simFloor), simCeil: Number(info.technical.simCeil), source: String(info.technical.simAnchorSource ?? 'measured') }
      : null;
  const careerLegacy =
    num(info.career?.scale?.simFloor) != null && num(info.career?.scale?.simCeil) != null
      ? { simFloor: Number(info.career.scale.simFloor), simCeil: Number(info.career.scale.simCeil), source: String(info.career.scale.source ?? 'measured') }
      : null;
  const depthLegacy =
    num(info.career?.depth?.targetYears) != null && num(info.career?.depth?.targetRows) != null
      ? { targetYears: Number(info.career.depth.targetYears), targetRows: Number(info.career.depth.targetRows) }
      : null;
  const anchors = {
    technical: anchorsFz?.technical ?? techLegacy,
    career: anchorsFz?.career ?? careerLegacy,
    depth: anchorsFz?.depth ?? depthLegacy,
    origin: (anchorsFz
      ? sourceToOrigin(anchorsFz.source, input.isChild)
      : techLegacy || careerLegacy
        ? input.isChild
          ? 'live'
          : 'root_snapshot'
        : 'not_recorded') as Origin,
  };

  const referenceDate: string | null = typeof fz?.referenceDate === 'string' ? fz.referenceDate : null;
  const referenceDateOrigin: Origin = !referenceDate
    ? 'not_recorded'
    : fz.referenceDateSource === 'parent_frozen'
      ? 'frozen_parent'
      : fz.referenceDateSource === 'parent_completed_at'
        ? // An older parent did not record it, so the child derived it from
          // when the parent finished — the parent's moment, not today's.
          'frozen_parent'
        : 'root_snapshot';

  const pb = fz?.positionBasis ?? null;
  const pbStatus = info.positionBasisStatus ?? null;
  const positionBasis = pb
    ? {
        jobProfileName: pb.jobProfile?.positionName ?? null,
        contentHash: pb.jobProfile?.contentHash ?? null,
        requiredCount: Array.isArray(pb.required?.items) ? pb.required.items.length : 0,
        requiredSource: pb.required?.source ?? null,
        educationSource: pb.education?.source ?? null,
        educationRequirement: pb.education?.source === 'incumbent' ? null : pb.education?.requirement ?? null,
        careerTarget: pb.careerTarget?.jobProfileName ?? (pb.careerTarget?.pseudoNote ? 'dokumen sintetis' : null),
        kamusFingerprint: pb.kamus?.fingerprint ?? null,
        origin: sourceToOrigin(pbStatus?.source, input.isChild),
        liveParts: Array.isArray(pbStatus?.liveParts) ? pbStatus.liveParts.filter((x: unknown): x is string => typeof x === 'string') : [],
        caveats: Array.isArray(pbStatus?.caveats)
          ? pbStatus.caveats
              .map((c: unknown) => (typeof c === 'string' ? c : (c as { message?: unknown } | null)?.message))
              .filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
          : [],
      }
    : null;

  return {
    weights,
    weightsOrigin,
    pairwise,
    consistency,
    weightSource,
    activeCriteria,
    droppedCriteria,
    // Which criteria were active is decided per run (a criterion nobody could
    // be scored on is dropped), so it is never a "system default".
    criteriaOrigin: !activeCriteria && droppedCriteria.length === 0 ? 'not_recorded' : weightsOrigin === 'default' ? 'root_snapshot' : weightsOrigin,
    filter: {
      ruleLabels: template ? ruleLabels(template.filterTree) : [],
      ruleCount: Number(template?.ruleCount ?? 0),
      treeKey: template ? canonicalJson(template.filterTree ?? null) : null,
      enforce: typeof template?.enforceFilterRules === 'boolean' ? template.enforceFilterRules : null,
      origin: filterOrigin,
    },
    gradeRange: { min: fs.minGradeId ?? null, max: fs.maxGradeId ?? null },
    includedTenantIds: Array.isArray(fs.includedTenantIds) ? fs.includedTenantIds : [],
    readiness,
    readinessOrigin: !readiness ? 'not_recorded' : snap.templateSource === 'inherited' || snap.rerun ? 'frozen_parent' : 'root_snapshot',
    finalistCount: input.finalistCount,
    anchors,
    referenceDate,
    referenceDateOrigin,
    positionBasis,
    models: (info.models as RunModelsRecord | undefined) ?? null,
    dataVersions: info.dataVersions ?? null,
  };
}
