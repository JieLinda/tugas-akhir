export type TemplateSerialized = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  targetFinalists: number;
  defaultMethod: string;
  filterRules: FilterRule[];
  filterTree: FilterConditionGroup;
  defaultCriteria: DefaultCriterion[];
  enforceFilterRules: boolean;
  ahpConfig: AhpConfig | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuditEntrySerialized = {
  id: string;
  actorName: string;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string | null;
  createdAt: string;
};

export type GradeLevelSerialized = {
  companyId: string;
  levelId: string;
  levelName: string | null;
  gradeId: string;
};

import type { ScoringPromptsData } from '@/lib/scoring-prompt-actions';
import type { ReadinessConfig } from '@/lib/readiness-config-actions';
import type { RetirementConfig } from '@/lib/retirement-config';

export interface GovernanceClientProps {
  templates: TemplateSerialized[];
  auditLog: AuditEntrySerialized[];
  auditTotal: number;
  gradeLevels: GradeLevelSerialized[];
  scoringPrompts: ScoringPromptsData;
  readinessConfig: ReadinessConfig;
  retirementConfig: RetirementConfig;
  /** Distinct values present in candidate data, per filter field (for the value picker). */
  fieldValues: Partial<Record<string, string[]>>;
  /** Section opened on first render — deep-linked via `?tab=` (see GOVERNANCE_TAB_IDS). */
  initialTab?: GovernanceTabId;
}

/**
 * Section ids of /governance, also the `?tab=` query values. The grade ladder
 * (former `grades` tab) sits under `readiness` as the reference the retirement
 * thresholds are keyed on. An unknown value opens `programs`.
 */
export const GOVERNANCE_TAB_IDS = ['programs', 'prompts', 'readiness', 'audit'] as const;

export type GovernanceTabId = (typeof GOVERNANCE_TAB_IDS)[number];

/** Old `?tab=` values still linked from docs and dashboards. */
const LEGACY_TAB_ALIASES: Record<string, GovernanceTabId> = {
  contexts: 'prompts',
  grades: 'readiness',
};

export function parseGovernanceTab(value: unknown): GovernanceTabId {
  if (typeof value !== 'string') return 'programs';
  if (GOVERNANCE_TAB_IDS.includes(value as GovernanceTabId)) return value as GovernanceTabId;
  return LEGACY_TAB_ALIASES[value] ?? 'programs';
}

export const FIELD_LABELS: Record<string, string> = {
  disciplineStatus: 'Status Disiplin',
  mcuStatus: 'Status MCU',
  performanceGrade: 'Performance Appraisal',
  havQuadrant: 'HAV Quadrant',
  behaviorRecommendation: 'Behavior Recommendation',
  yearsExperience: 'Masa Kerja',
  education: 'Pendidikan',
};

export const OPERATOR_LABELS: Record<string, string> = {
  eq: 'sama dengan',
  neq: 'tidak sama dengan',
  in: 'termasuk',
  notIn: 'tidak termasuk',
  gte: '≥',
  lte: '≤',
  gt: '>',
  lt: '<',
  notExpired: 'belum kadaluarsa',
  isExpired: 'sudah kadaluarsa',
};

export const ALL_FIELDS = [
  'disciplineStatus',
  'mcuStatus',
  'performanceGrade',
  'havQuadrant',
  'behaviorRecommendation',
  'yearsExperience',
  'education',
] as const;

export const ALL_OPERATORS = [
  'eq',
  'neq',
  'in',
  'notIn',
  'gte',
  'lte',
  'gt',
  'lt',
  'notExpired',
  'isExpired',
] as const;

// Re-export schema types so importing files don't need @/lib/db/schema directly
import type { AhpConfig, DefaultCriterion, FilterRule, FilterCondition, FilterConditionGroup } from '@/lib/db/schema';
export type { AhpConfig, DefaultCriterion, FilterRule, FilterCondition, FilterConditionGroup };
