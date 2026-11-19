import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  date,
  jsonb,
  serial,
  smallint,
  index,
  uniqueIndex,
  primaryKey,
  check,
  real,
  customType,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
// Type-only: erased at runtime, so drizzle-kit loading this file pulls in nothing.
import type { FrozenRunBasis } from '../rerun-modes';

/** Raw `bytea`. Drizzle has no built-in for it; node-postgres already hands
 *  bytea back as a Buffer and accepts one on the way in, so this is a passthrough. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

// ── Shared enum-ish string unions (typed at TS layer, validated via check constraints) ──
export type DisciplineStatus =
  | 'CLEAR'
  | 'ST' // Surat Teguran (warning level 1, MINOR) — qualified per methodology doc
  | 'ACTIVE_SP'
  | 'SP_UNDER_2_YEARS'
  | 'SP3'
  | 'SP_FIRST_LAST'
  | 'WARNING' // legacy manual values
  | 'SANCTION';
export type McuStatus = 'fit' | 'fit_with_note' | 'unfit' | 'expired';
export type CriteriaCategory = 'filter' | 'score';
export type ScoringRunStatus = 'draft' | 'completed' | 'archived';
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'run_scoring'
  | 'filter_override'
  | 'seed'
  | 'evaluate'
  /** A download of run data that leaves the app's custody (e.g. the calculation-trace XLSX). */
  | 'export';

export type CandidateAttributeField =
  | 'disciplineStatus'
  | 'mcuStatus'
  | 'performanceGrade'
  | 'havQuadrant'
  | 'behaviorRecommendation'
  | 'yearsExperience'
  | 'education';

export type FilterOperator = 'eq' | 'neq' | 'in' | 'notIn' | 'gte' | 'lte' | 'gt' | 'lt' | 'isExpired' | 'notExpired';

/**
 * How hard a rule bites.
 *
 * 'hard' (the default, and what an ABSENT field means so every rule written
 * before this existed keeps its behaviour) disqualifies: the candidate is
 * dropped from the pool and never scored.
 *
 * 'advisory' only FLAGS: the candidate is scored and ranked normally, and the
 * failure is reported beside the ranking. This is per-rule, unlike
 * `enforceFilterRules`, which is per-template and turns every rule off at once
 * — the reason MCU could not previously be softened without also softening
 * discipline.
 */
export type FilterRuleSeverity = 'hard' | 'advisory';

export type FilterRule = {
  field: CandidateAttributeField;
  operator: FilterOperator;
  value?: string | number | string[] | number[];
  label: string;
  /** Friendly explanation shown to the user when this rule disqualifies a candidate */
  message: string;
  /** Missing = 'hard'. See FilterRuleSeverity. */
  severity?: FilterRuleSeverity;
  /**
   * `false` = switched OFF (Talent Pool → Aturan Filter): the rule stays in the
   * tree so it can be switched back on with its values intact, and NOTHING
   * evaluates it — no verdict, no flag, no reason in "Tidak Lolos". Missing
   * means on, so every rule written before this behaves unchanged. Stripped
   * from the tree, never evaluated as true (lib/filter-rules.ts
   * `decidingFilterTree`), for the same reason advisory rules are.
   */
  enabled?: boolean;
};

/** A group of filter rules AND-ed together. */
export type FilterRuleGroup = { rules: FilterRule[] };

/**
 * Legacy grouped shape (AND-of-OR): kept only so older stored `{ groups }`
 * payloads can be migrated on read. New data uses the nested tree below.
 */
export type FilterRuleSet = { groups: FilterRuleGroup[] };

/**
 * Nested boolean condition tree for program eligibility filters. A node is
 * either a single rule or a group with a boolean operator over child nodes,
 * allowing arbitrarily nested AND/OR — e.g.
 *   A AND B AND ((C AND D) OR (E AND F))
 * The root is always a group. Stored in `filter_rules` jsonb as `{ tree }`;
 * legacy `FilterRule[]` (all-AND) and `{ groups }` payloads are migrated on read.
 */
export type FilterCondition =
  | { kind: 'rule'; rule: FilterRule }
  | { kind: 'group'; op: 'and' | 'or'; children: FilterCondition[] };

export type FilterConditionGroup = Extract<FilterCondition, { kind: 'group' }>;

export type FilterTreeSet = { tree: FilterConditionGroup };

/**
 * One row of a program's criteria list: WHICH aspect the program assesses, and
 * the prose that describes it.
 *
 * `weight` is OPTIONAL and legacy. It used to set the (since removed) AI
 * Tournament engine's weighting, which made a program weightable from two places
 * that nothing forced to agree — every weight now comes from one place, the AHP
 * pairwise matrix. drizzle/0074 strips the key from live templates;
 * it survives in this type because `RunConfigSnapshot` holds frozen copies of
 * runs that really were weighted that way, and those must keep rendering their
 * own numbers rather than a blank.
 */
export type DefaultCriterion = {
  name: string;
  description?: string;
  /** @deprecated Weights come from the AHP matrix. Present only on runs scored before drizzle/0074. */
  weight?: number;
  type: 'benefit' | 'cost';
  maxValue?: number;
  source?: string;
};

// ── AHP + TOPSIS method configuration ──
// The six criteria of the deterministic AHP+TOPSIS scoring method, in the
// canonical order used by the pairwise matrix rows/columns and the decision
// matrix built by scoring-service/src/ahp-topsis-engine.ts.
export const AHP_CRITERIA_ORDER = [
  'technical',
  'career',
  'behavior',
  'performance',
  'hav',
  'education',
] as const;

export type AhpCriterionKey = (typeof AHP_CRITERIA_ORDER)[number];

export type AhpConfig = {
  /** 6×6 Saaty-scale pairwise comparison matrix; order = AHP_CRITERIA_ORDER */
  pairwise: number[][];
};

// ── Tenants ────────────────────────────────────────────
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('idx_tenants_slug').on(table.slug)]
);

// ── Users ──────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    // In-app role assignment (fully managed in Pulse, not Keycloak). NULL means
    // the user falls back to the designated default role. Keycloak is SSO only.
    roleId: uuid('role_id').references(() => appRoles.id, { onDelete: 'set null' }),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('idx_users_email').on(table.email)]
);

// ── Custom roles (fully managed in-app via the Role Management page) ──────────
// Roles are user-defined; each grants permissions from the fixed feature
// catalog in lib/rbac.ts. Built-in roles are seeded once (is_system=true) and
// protected from deletion; exactly one role is the default for unassigned users.
export const appRoles = pgTable(
  'app_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    isSystem: boolean('is_system').default(false).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    sortOrder: integer('sort_order').default(100).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_app_roles_key').on(table.key)]
);

// Permissions granted to a role (the full set, not a delta). Permission strings
// come from lib/rbac.ts ALL_PERMISSIONS.
export const appRolePermissions = pgTable(
  'app_role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id').notNull().references(() => appRoles.id, { onDelete: 'cascade' }),
    permission: varchar('permission', { length: 40 }).notNull(),
  },
  (table) => [uniqueIndex('uq_app_role_permissions').on(table.roleId, table.permission)]
);

// ── Positions (Master positions from sync) ────────────────────────────────────────────
export const positions = pgTable(
  'positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    syncPositionId: integer('sync_position_id').references(() => syncPositions.id),
    positionId: varchar('position_id', { length: 40 }).notNull(), // External position ID from sync
    internalTitle: varchar('internal_title', { length: 300 }),
    externalTitle: varchar('external_title', { length: 300 }),
    department: varchar('department', { length: 255 }),
    division: varchar('division', { length: 255 }),
    summary: text('summary'),
    gradeId: varchar('grade_id', { length: 20 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_positions_tenant').on(table.tenantId),
    index('idx_positions_sync_position_id').on(table.syncPositionId),
    uniqueIndex('idx_positions_tenant_position_id').on(table.tenantId, table.positionId),
  ]
);

// ── Critical Positions (tenant-managed successor positions) ────────────────────────
export const criticalPositions = pgTable(
  'critical_positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    positionId: uuid('position_id').references(() => positions.id),
    title: varchar('title', { length: 255 }).notNull(),
    department: varchar('department', { length: 255 }),
    division: varchar('division', { length: 255 }),
    status: varchar('status', { length: 50 }).default('active').notNull(),
    /**
     * The succession program this seat is managed under — chosen when the
     * position is added and fixed once it has been scored (drizzle/0056).
     *
     * One position row = one program. Scoring the same seat under a second
     * program means adding it again with that program, which is what keeps a
     * "Talent Pool" bench and a "Successor" bench for the same job separate
     * lists rather than two runs sharing one row's readiness numbers.
     *
     * Both columns are kept for the same reason `scoring_runs` keeps both: the
     * id is the live link to the template (filters, criteria, AHP matrix), the
     * code survives the template being deleted so a position never loses the
     * label it was managed under.
     */
    programTemplateId: uuid('program_template_id').references(() => programTemplates.id, { onDelete: 'set null' }),
    programCode: varchar('program_code', { length: 50 }).notNull(),
    // Incumbent / current holder — the person who needs a successor
    holderName: varchar('holder_name', { length: 255 }),
    holderEmployeeId: varchar('holder_employee_id', { length: 100 }),
    // Job qualification requirements (populated from job profiles)
    education: varchar('education', { length: 500 }),
    experience: varchar('experience', { length: 500 }),
    jobFamily: varchar('job_family', { length: 255 }),
    // Grade range for successor candidates (numeric; candidate gradeId is stripped of trailing letters before comparison)
    minGradeId: varchar('min_grade_id', { length: 20 }),
    maxGradeId: varchar('max_grade_id', { length: 20 }),
    // Required technical competencies for this position
    requiredCompetencies: jsonb('required_competencies').default(sql`'[]'::jsonb`),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_critical_positions_tenant').on(table.tenantId),
    index('idx_critical_positions_position').on(table.positionId),
    index('idx_critical_positions_created_by').on(table.createdBy),
    index('idx_critical_positions_status').on(table.status),
    index('idx_critical_positions_program').on(table.tenantId, table.programCode),
  ]
);

/**
 * Every active incumbent of a managed position (drizzle/0058).
 *
 * Non-unique roles are held by several people at once. `critical_positions`
 * keeps the primary holder in its own columns because a good number of readers
 * join on that pair; this table holds the complete set, and it is what the
 * scoring pool excludes — otherwise a sitting incumbent could be ranked as their
 * own successor.
 */
export const criticalPositionHolders = pgTable(
  'critical_position_holders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    positionId: uuid('position_id').notNull().references(() => criticalPositions.id, { onDelete: 'cascade' }),
    employeeId: varchar('employee_id', { length: 100 }).notNull(),
    name: varchar('name', { length: 255 }),
    /** Mirrors `critical_positions.holder_*` — exactly one per position. */
    isPrimary: boolean('is_primary').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_critical_position_holders').on(table.positionId, table.employeeId),
    index('idx_critical_position_holders_position').on(table.positionId),
  ]
);

export type CriticalPositionHolder = typeof criticalPositionHolders.$inferSelect;

// ── Position Picks (selected successor candidates per position & program) ──
export const positionPicks = pgTable(
  'position_picks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    positionId: uuid('position_id').notNull().references(() => criticalPositions.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
    programCode: varchar('program_code', { length: 50 }).notNull(),
    notes: text('notes'),
    score: integer('score'),
    readiness: varchar('readiness', { length: 20 }),
    runId: uuid('run_id').references(() => scoringRuns.id, { onDelete: 'set null' }),
    rank: integer('rank').default(0).notNull(),
    /** Made in demo mode (drizzle/0093): counted only in demo mode, never in real mode. */
    isDemo: boolean('is_demo').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // is_demo is part of the key (drizzle/0093): a demo pick can never upsert a real one.
    uniqueIndex('idx_position_picks_unique').on(table.positionId, table.programCode, table.candidateId, table.isDemo),
    index('idx_position_picks_position_program').on(table.positionId, table.programCode),
  ]
);

// ── Candidates ─────────────────────────────────────────
export const candidates = pgTable(
  'candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    employeeId: varchar('employee_id', { length: 100 }),
    // ── At-rest encrypted columns ──
    // Everything a candidate's dossier holds EXCEPT id / tenant_id /
    // employee_id is sealed with the app's AES-256-GCM data key
    // (lib/crypto/envelope.ts), so a raw database read shows "v1:…" ciphertext
    // instead of the person's data. The web app, sync-service and
    // scoring-service each decrypt at their own read boundary (lib/candidate-crypto.ts
    // and its per-service mirrors). The columns are `text` on purpose:
    // base64 ciphertext runs ~1.5× longer than the plaintext it wraps, and the
    // exact length is a function of the value, not the schema. Reading is
    // write-through-transparent: values not in the "v1:" format pass through
    // decrypt unchanged, so pre-encryption rows stay readable and the
    // scripts/encrypt-candidates.ts backfill can migrate them in place.
    //
    // Because these values are opaque to SQL, nothing may match, search, sort,
    // or DISTINCT over them in the database — every one of those (candidate
    // search, ORDER BY name, grade-range filtering, filter-facet values) must
    // decrypt first and operate in the application layer.
    name: text('name').notNull(),
    email: text('email'),
    currentPosition: text('current_position'),
    department: text('department'),
    division: text('division'),
    yearsExperience: text('years_experience'),
    photoUrl: text('photo_url'),
    grade: text('grade'),
    // ── Attribute fields used by program filter rules ──
    disciplineStatus: text('discipline_status').default('clear').notNull(),
    mcuStatus: text('mcu_status').default('fit').notNull(),
    /**
     * Medical note from the sync (ENCRYPTED). Overwritten every Monday run.
     * Null when the source said nothing — and the upsert keeps an existing value
     * in that case rather than blanking it, because one empty upstream file must
     * not erase everybody's note unattended.
     */
    mcuNote: text('mcu_note'),
    /**
     * Medical note typed by a human on the Kandidat page (ENCRYPTED). NEVER
     * written by the sync, which is the whole point: a note somebody entered by
     * hand is often the only medical detail that exists, and an unattended cron
     * overwriting it is the quietest possible way to lose it.
     *
     * Readers prefer this over `mcuNote` and SAY which one they used — an
     * unattributed value is one nobody can check.
     */
    mcuNoteManual: text('mcu_note_manual'),
    performanceGrade: text('performance_grade'),
    havQuadrant: text('hav_quadrant'),
    /**
     * When a SYNC last changed this candidate's AUTOMATIC HAV (upload › formula
     * PA × BA) — a HAV upload, the shared HAV.xlsx, or candidate-populate
     * carrying a new PA/BA from the MSSQL syncs (drizzle/0080). Not encrypted:
     * it says when, never what.
     *
     * It is the clock a Talent Mapping placement is ordered against: a placement
     * is in force only while it is NEWER than this (lib/hav-placements.ts and its
     * scoring-service twin). Null = no sync has changed it since tracking began,
     * so an existing placement stands. Moved by sync-service AND, since
     * drizzle/0098, by the web app when PA/BA is edited on the Kandidat form or
     * "Hitung kuadran HAV" is pressed (origins 'candidate_edit' / 'hav_formula').
     */
    havAutoChangedAt: timestamp('hav_auto_changed_at', { withTimezone: true }),
    /** Which sync moved `hav_auto_changed_at`: see HavAutoChangeOrigin. */
    havAutoChangeSource: varchar('hav_auto_change_source', { length: 30 }).$type<HavAutoChangeOrigin>(),
    /**
     * Which AUTOMATIC tier the last HAV event put in force (drizzle/0098):
     * 'formula' after a PA/BA change (Kandidat edit, PA/BA workbook or MSSQL
     * sync that changed it, "Hitung kuadran HAV") — the formula then outranks an
     * older upload; 'upload' after a HAV upload that differed. NULL = the static
     * order upload › formula. See lib/hav-effective.ts.
     */
    havAutoTier: varchar('hav_auto_tier', { length: 10 }).$type<'upload' | 'formula'>(),
    behaviorRecommendation: text('behavior_recommendation'),
    behaviorNotes: text('behavior_notes'),
    education: text('education'),
    major: text('major'),
    /** ISO date (YYYY-MM-DD) from `sync_employee_personal`. Age is derived from
     *  it at render time — see candidateAge() in lib/age.ts — because a stored
     *  age is stale the day after it is written. */
    birthDate: text('birth_date'),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    // ── Soft delete (drizzle/0045_candidates_soft_delete.sql) ──
    // Rows are tombstoned, never removed: the id is referenced with ON DELETE
    // CASCADE by analysis_results / position_picks / job_family_matches, and
    // held with no FK at all inside
    // tournament_sessions' jsonb pools. A hard delete silently rewrites
    // finished scoring history; a tombstone keeps every id resolvable.
    //
    // Reads must opt IN to filtering — see liveCandidate() in
    // lib/candidate-visibility.ts. Nothing here is automatic: this codebase
    // builds every query explicitly and never uses db.query.*.findMany.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    /**
     * 'bulk'   — cleared wholesale before a re-import; the next sync brings the
     *            row back with its id intact.
     * 'manual' — removed deliberately from the Kandidat page; the sync leaves
     *            it deleted, otherwise the weekly cron would undo the decision.
     */
    deletedMode: varchar('deleted_mode', { length: 10 }),
  },
  (table) => [
    index('idx_candidates_tenant').on(table.tenantId),
    index('idx_candidates_created_by').on(table.createdBy),
    // Stays TOTAL, not partial: candidate-populate.ts upserts with
    // `ON CONFLICT (tenant_id, employee_id)`, which can only infer a total
    // index. Making it partial would make a resync insert a NEW uuid for an
    // NPK that already has a tombstone — the exact identity break the
    // tombstone prevents.
    uniqueIndex('idx_candidates_tenant_employee_id').on(table.tenantId, table.employeeId),
    // The mcu_status CHECK was dropped: mcu_status now holds ciphertext, which
    // cannot be validated against a plaintext domain in the database.
    check('candidates_deleted_mode_check', sql`deleted_mode IS NULL OR deleted_mode IN ('bulk', 'manual')`),
    check(
      'candidates_hav_auto_change_source_check',
      sql`hav_auto_change_source IS NULL OR hav_auto_change_source IN ('hav_upload', 'hav_folder', 'candidate_sync', 'pa_ba_upload', 'candidate_edit', 'hav_formula')`
    ),
    check('candidates_hav_auto_tier_check', sql`hav_auto_tier IS NULL OR hav_auto_tier IN ('upload', 'formula')`),
  ]
);

// ── Candidate Position History (derived from sync_employee_positions ⋈ sync_positions) ──
export const candidatePositionHistory = pgTable(
  'candidate_position_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
    syncEmployeePositionId: integer('sync_employee_position_id').references(() => syncEmployeePositions.id, { onDelete: 'set null' }),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    positionId: varchar('position_id', { length: 40 }).notNull(),
    internalTitle: varchar('internal_title', { length: 300 }),
    externalTitle: varchar('external_title', { length: 300 }),
    summary: text('summary'),
    gradeId: varchar('grade_id', { length: 20 }),
    primaryPosition: boolean('primary_position').default(false).notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validTo: timestamp('valid_to', { withTimezone: true }),
    sourceKey: varchar('source_key', { length: 220 }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_candidate_position_history_candidate').on(table.candidateId),
    index('idx_candidate_position_history_position_id').on(table.positionId),
    uniqueIndex('uq_candidate_position_history_source').on(table.candidateId, table.sourceKey),
  ]
);

// ── Candidate Technical Competencies (derived from sync data) ──────────────
export const candidateTechnicalCompetencies = pgTable(
  'candidate_technical_competencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
    syncTechnicalCompetencyId: integer('sync_technical_competency_id').references(() => syncTechnicalCompetencies.id, { onDelete: 'set null' }),
    technicalId: varchar('technical_id', { length: 40 }).notNull(),
    technicalName: varchar('technical_name', { length: 300 }),
    proficiencyId: varchar('proficiency_id', { length: 40 }),
    proficiencyName: varchar('proficiency_name', { length: 120 }),
    score: integer('score'),
    currentProficiencyId: varchar('current_proficiency_id', { length: 40 }),
    currentProficiencyName: varchar('current_proficiency_name', { length: 120 }),
    currentScore: integer('current_score'),
    gap: integer('gap'),
    isManual: boolean('is_manual').default(false).notNull(),
    sourceKey: varchar('source_key', { length: 220 }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_candidate_technical_candidate').on(table.candidateId),
    index('idx_candidate_technical_technical_id').on(table.technicalId),
    uniqueIndex('uq_candidate_technical_source').on(table.candidateId, table.sourceKey),
  ]
);

// ── Program Templates (tenant-managed succession programs) ────
export const programTemplates = pgTable(
  'program_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    code: varchar('code', { length: 50 }).notNull(), // 'talent' | 'successor' | 'emergency' | custom slug
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    targetFinalists: integer('target_finalists').notNull().default(10),
    /** Array of { field, operator, value, label, message } describing knockout rules */
    filterRules: jsonb('filter_rules').notNull().default(sql`'[]'::jsonb`),
    /** Array of { name, type, description, maxValue } naming the aspects this
     *  program assesses. It carries NO weight: every weight comes from
     *  `ahpConfig` below (drizzle/0074). No scoring engine reads it — AHP +
     *  TOPSIS scores all six aspects; the list is descriptive (and frozen into
     *  each run's config snapshot). */
    defaultCriteria: jsonb('default_criteria').notNull().default(sql`'[]'::jsonb`),
    defaultMethod: varchar('default_method', { length: 50 }).default('SAW').notNull(),
    /** When true, filterRules act as HARD knockouts: failing candidates are
     *  excluded from the scoring pool. */
    enforceFilterRules: boolean('enforce_filter_rules').default(true).notNull(),
    /** Pairwise comparison matrix — the ONLY weighting configuration in this
     *  product. Null → the run uses DEFAULT_ASPECT_WEIGHTS
     *  (lib/scoring-criteria.ts), the same weights for every program. */
    ahpConfig: jsonb('ahp_config').$type<AhpConfig | null>(),
    isSystem: boolean('is_system').default(false).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_program_templates_tenant').on(table.tenantId),
    uniqueIndex('idx_program_templates_tenant_code').on(table.tenantId, table.code),
  ]
);

// ── Criteria (for DSS) ────────────────────────────────
export const criteria = pgTable(
  'criteria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    positionId: uuid('position_id').notNull().references(() => criticalPositions.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    weight: numeric('weight', { precision: 5, scale: 2 }).notNull(),
    type: varchar('type', { length: 20 }).default('benefit').notNull(), // 'benefit' | 'cost'
    /** 'score' criteria feed SAW; 'filter' criteria act as knockout rules (rare — most filters live on program_templates) */
    category: varchar('category', { length: 20 }).default('score').notNull(),
    /** Origin program template (for changelog & re-sync) */
    sourceTemplateId: uuid('source_template_id').references(() => programTemplates.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_criteria_position_id').on(table.positionId),
    check('type_check', sql`type IN ('benefit', 'cost')`),
    check('category_check', sql`category IN ('filter', 'score')`),
  ]
);

/**
 * Frozen copy of the governance configuration a scoring run was created with.
 *
 * Program templates and the readiness thresholds file are edited freely after a
 * run finishes, so reading them live to explain a finished ranking shows rules
 * that may never have applied to it. A completed run is the record of an
 * assessment on a date; this blob is written ONCE at run creation and never
 * updated, so "Konfigurasi Run" can state what actually shaped the result.
 *
 * Not covered here on purpose: the AHP weights actually used. The scoring
 * service resolves those itself at scoring time and records them (matrix, λmax,
 * CI, CR, dropped criteria) in `tournament_sessions.final_ranked.runInfo.ahp` —
 * that is the authoritative record. `template.ahpConfig` below is only the
 * matrix as configured when the run was queued, used as a fallback for runs
 * whose engine record is missing.
 */
export type RunConfigSnapshot = {
  /** Blob schema version, so a later reader can migrate rather than guess. */
  version: 1;
  capturedAt: string;
  /** `live` = read from governance when this run was created · `inherited` = copied from the base run of a derived run. */
  templateSource: 'live' | 'inherited';
  /** Base run this snapshot was copied from (derived runs only). */
  inheritedFrom?: string | null;
  template: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    targetFinalists: number;
    defaultMethod: string;
    enforceFilterRules: boolean;
    isSystem: boolean;
    /** The eligibility tree exactly as it was evaluated for this run. */
    filterTree: FilterConditionGroup;
    ruleCount: number;
    defaultCriteria: DefaultCriterion[];
    ahpConfig: AhpConfig | null;
    /** Template's own updatedAt at capture time — dates the frozen copy. */
    updatedAt: string;
  } | null;
  /** Readiness thresholds as configured at capture time (structurally ReadinessConfig). */
  readiness: {
    thresholds: { minScore: number; level: string; eta?: string; description?: string }[];
    defaultLevel: string;
  } | null;
  /**
   * Present only on a "Tambah Kandidat Pembanding" child created after the
   * re-run was reduced to that one mode. Everything the child inherited from its
   * parent and everything it was asked to add, written once at creation. Absent
   * on roots and on legacy-mode children — readers treat absence as "not
   * recorded", never as "nothing inherited".
   */
  rerun?: RunRerunSnapshot;
};

/** See `RunConfigSnapshot.rerun` and lib/rerun-freeze.ts. */
export type RunRerunSnapshot = {
  mode: 'incremental_add';
  parentRunId: string;
  /** Top of the lineage — carried-over candidates hold its values. */
  rootRunId: string;
  /** Mirrors `scoring_runs.rerun_reason`. */
  reason: string;
  /** When the NEW candidates' data was read (this run's creation). Distinct from `frozen.referenceDate`. */
  dataPulledAt: string;
  /** Mirrors `frozen.anchors.source`, at the top level because the UI badges it. */
  anchorsSource: 'parent' | 'live_fallback';
  /** Every candidate the request accepted, with what that meant. */
  added: {
    candidateId: string;
    name: string;
    classification: 'new' | 'existing_pool';
    /**
     * Range rules of the PARENT this person breaks — set only for a confirmed
     * out-of-range ("Excluded") candidate. Rejected candidates are never added.
     * Runs created before FR-RR-05 hold every failed rule here.
     */
    failedRules: string[];
    /** Grade outside the parent's range, added on explicit confirmation. Absent on older runs. */
    outOfRange?: boolean;
    /** Advisory rules flagged ("Reconsidered", e.g. MCU). Absent on older runs. */
    advisory?: string[];
  }[];
  /** Candidates the request named and the server refused, each with why. */
  skipped: { candidateId: string; name: string | null; reason: string; message: string; rules?: string[] }[];
  /** Weights, active criteria, anchors, reference date and position basis taken from the parent. */
  frozen: FrozenRunBasis;
  /** Identity of the request, so a double submission yields one run (FR-RR-13). Absent on older runs. */
  requestKey?: string;
};

// ── Scoring Runs (groups each calculation execution) ──
export const scoringRuns = pgTable(
  'scoring_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    positionId: uuid('position_id').notNull().references(() => criticalPositions.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    programTemplateId: uuid('program_template_id').references(() => programTemplates.id, { onDelete: 'set null' }),
    method: varchar('method', { length: 50 }).notNull(), // 'AHP_TOPSIS' (the only method written now)
    program: varchar('program', { length: 50 }), // legacy program code mirror — kept for compatibility
    label: varchar('label', { length: 255 }),
    status: varchar('status', { length: 20 }).default('completed').notNull(),
    candidateCount: integer('candidate_count').notNull().default(0),
    /** { qualified: number, disqualified: [{ candidateId, reasons: string[] }], overrides: [{ candidateId, by, reason }] } */
    filterSummary: jsonb('filter_summary'),
    /** Governance config frozen at run creation — see RunConfigSnapshot. Null on runs created before this column. */
    configSnapshot: jsonb('config_snapshot').$type<RunConfigSnapshot | null>(),
    /**
     * Run-level diagnostics written by the AHP engine at completion (drizzle/0065):
     * reference-set provenance, technical similarity anchors, career scale/depth,
     * AHP criteria dropped + effective weights, augment/exclusion summaries.
     *
     * It ALSO still goes into `tournament_sessions.final_ranked.runInfo`, which
     * is where it used to live alone — and that was the wrong home: a session is
     * working space and is legitimately transient, while a completed ranking is a
     * permanent record. The wizard used to delete its session on success, which
     * silently erased every run's diagnostics the moment it succeeded. Readers
     * COALESCE this column first, the session second. Null on runs created before
     * the column, and on runs whose session was already deleted (unrecoverable).
     */
    runInfo: jsonb('run_info'),
    /**
     * The run this one was derived from (drizzle/0069). Written by the web app at
     * CREATION, unlike the `runInfo.{augment,exclude}.baseRunId` it replaces —
     * which scoring-service wrote at completion, so a failed or in-progress
     * derived run had no parent at all, and the full-pool re-run wrote neither
     * key and was therefore recorded as a root from its first minute.
     *
     * `ON DELETE SET NULL`, never CASCADE: deleting one run must not delete the
     * assessments derived from it — same rule `position_picks.run_id` and
     * `tournament_sessions.run_id` already follow. A child whose parent is gone
     * becomes an orphan root and the lineage view says so.
     */
    parentRunId: uuid('parent_run_id'),
    /**
     * HOW it was derived — see `RerunMode` in lib/rerun-modes.ts. Deliberately
     * separate from `parentRunId`: having a parent (structural) and the rules a
     * rerun ran under (semantic) are different statements. `refresh_full` has a
     * parent yet genuinely re-applies the eligibility filters and freezes its own
     * live config, so it must not inherit the "filters ran on the base run" note.
     *
     * Nullable = a run created before the column; readers treat it as `baseline`,
     * which is also structurally true since it has no parent either.
     */
    rerunMode: varchar('rerun_mode', { length: 32 }),
    /**
     * Why this child run exists — the forum request or question it answers
     * (drizzle/0086). Required by `startRerunAction` for every child created
     * since; NULL on roots and on every run created before the column.
     */
    rerunReason: text('rerun_reason'),
    /**
     * Created in demo mode (drizzle/0093): scored on demo candidates (the dupp
     * overlay, ON candidates only). Listed only in demo mode, never in real
     * mode — and real runs are not listed in demo mode.
     */
    isDemo: boolean('is_demo').notNull().default(false),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [
    index('idx_scoring_runs_position').on(table.positionId),
    index('idx_scoring_runs_tenant').on(table.tenantId),
    index('idx_scoring_runs_status').on(table.status),
    index('idx_scoring_runs_parent').on(table.parentRunId),
    check('scoring_runs_status_check', sql`status IN ('draft', 'in_progress', 'completed', 'archived')`),
  ]
);

// ── Analysis Results (cached DSS output) ──────────────
export const analysisResults = pgTable(
  'analysis_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => scoringRuns.id, { onDelete: 'cascade' }),
    positionId: uuid('position_id').notNull().references(() => criticalPositions.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
    method: varchar('method', { length: 50 }).notNull(), // 'AHP_TOPSIS' (the only method written now)
    finalScore: numeric('final_score', { precision: 10, scale: 6 }).notNull(),
    rank: integer('rank').notNull(),
    /** Manual rank override (for tie-breaking). When set, used in place of `rank`. */
    manualRank: integer('manual_rank'),
    details: text('details'), // JSON string of breakdown
    calculatedAt: timestamp('calculated_at').defaultNow().notNull(),
    calculatedBy: uuid('calculated_by').notNull().references(() => users.id),
  },
  (table) => [
    index('idx_analysis_position').on(table.positionId),
    index('idx_analysis_run').on(table.runId),
    index('idx_analysis_rank').on(table.positionId, table.rank),
  ]
);

// ── Scoring Run Exclusions (kandidat dikecualikan dari hasil) ──────────
// A completed run's ranking is a record of an assessment on a date, so an
// exclusion never mutates it: the row stays in `analysis_results` with its
// original rank and score, and this table marks it as "tidak dipertimbangkan"
// (pensiun / resign / sudah promosi / conflict of interest).
//
// Two consumers:
//  • display + export — the results table strikes the row through and drops it
//    from finalisation, leaving the base run's numbers untouched (soft exclude);
//  • `rerunScoringExcludingCandidatesAction` — reads this list as the input of an
//    AHP+TOPSIS re-rank that recomputes closeness without those alternatives.
// Un-excluding is a plain delete, so the history is the audit_log entries.
export type ScoringRunExclusionReason =
  | 'retired'
  | 'resigned'
  | 'promoted'
  | 'conflict_of_interest'
  | 'other';

export const scoringRunExclusions = pgTable(
  'scoring_run_exclusions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull().references(() => scoringRuns.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
    /** Reason code — see ScoringRunExclusionReason. */
    reason: varchar('reason', { length: 30 }).notNull().default('other'),
    /** Free-text detail; required by the UI when reason = 'other'. */
    note: text('note'),
    excludedBy: uuid('excluded_by').notNull().references(() => users.id),
    excludedAt: timestamp('excluded_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_scoring_run_exclusions_run_candidate').on(table.runId, table.candidateId),
    index('idx_scoring_run_exclusions_run').on(table.runId),
    index('idx_scoring_run_exclusions_tenant').on(table.tenantId),
    check(
      'scoring_run_exclusions_reason_check',
      sql`reason IN ('retired', 'resigned', 'promoted', 'conflict_of_interest', 'other')`
    ),
  ]
);

export type ScoringRunExclusion = typeof scoringRunExclusions.$inferSelect;
export type NewScoringRunExclusion = typeof scoringRunExclusions.$inferInsert;

// ── AHP+TOPSIS pool aspect snapshot (every scored candidate) ────────────
// `analysis_results` only keeps the top-N finalists, but the six AHP aspects are
// computed for the WHOLE pool and are per-candidate — they do not depend on who
// else is in it. Persisting them for everyone is what makes two things possible:
//
//  • backfill — excluding a finalist frees a slot, and the re-rank can promote
//    the candidate who was ranked N+1 instead of returning a short list;
//  • re-ranking without re-scoring — TOPSIS is set-relative (ideal/anti-ideal
//    come from the alternatives present), so removing a candidate needs a fresh
//    `topsisRank` but no LLM/embedding work at all.
//
// Written by scoring-service at persist time for every ranked candidate,
// finalist or not. Runs that predate this table simply have no rows: the
// exclusion re-rank then falls back to the finalists in `analysis_results` and
// says so, rather than silently ranking a truncated pool.
export const scoringRunPoolAspects = pgTable(
  'scoring_run_pool_aspects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull().references(() => scoringRuns.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
    /** Rank within the FULL scored pool (1-based), not within the finalist cut. */
    poolRank: integer('pool_rank').notNull(),
    /** TOPSIS closeness coefficient of this run, kept for rank-shift diagnostics. */
    closeness: numeric('closeness', { precision: 10, scale: 6 }).notNull(),
    /** Whether this candidate made the finalist cut (has an analysis_results row). */
    isFinalist: boolean('is_finalist').notNull().default(false),
    /** The six aspect scores, keyed by AHP_CRITERIA_ORDER. */
    aspects: jsonb('aspects').$type<Record<string, number>>().notNull(),
    /** technicalMatching / careerMatching / educationEval — the reusable detail blobs. */
    details: jsonb('details'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_scoring_run_pool_aspects_run_candidate').on(table.runId, table.candidateId),
    index('idx_scoring_run_pool_aspects_run').on(table.runId),
  ]
);

export type ScoringRunPoolAspect = typeof scoringRunPoolAspects.$inferSelect;
export type NewScoringRunPoolAspect = typeof scoringRunPoolAspects.$inferInsert;

// ── Run calculation trace (drizzle/0092) ────────────────────────────────
// The numbers BETWEEN a candidate's raw data and the six aspect scores that no
// other table keeps: stint dates, whole months and decay factors, the Hungarian
// cell matrix, PA slot weights, education ranks, TOPSIS divisors and ideals, the
// env-tunable parameters the scoring process ran with. Read by the "Unduh trace
// perhitungan (XLSX)" export (lib/run-trace/), never by scoring.
//
// `stage = 'pool'` is written by the web app when the run is created (filter
// field values and gate outcomes per candidate); `stage = 'engine'` by
// scoring-service before the run is marked completed. `payload` is JSON SEALED
// with the app data key (it is candidate data) — read it with
// `readRunTracePayload` in lib/run-trace/load.ts, never JSON.parse it directly.
// A completed run's trace is immutable (I-1, trigger in 0092). Shape:
// `scoring-service/src/run-trace-types.ts`.
export const scoringRunTraces = pgTable(
  'scoring_run_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull().references(() => scoringRuns.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    /** 'pool' (web app, at creation) | 'engine' (scoring-service, before completion). */
    stage: varchar('stage', { length: 16 }).notNull(),
    version: integer('version').notNull(),
    payload: text('payload').notNull(),
    /** False only on an install that never enabled encryption. */
    sealed: boolean('sealed').notNull().default(false),
    byteSize: integer('byte_size').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_scoring_run_traces_run_stage').on(table.runId, table.stage),
    index('idx_scoring_run_traces_tenant').on(table.tenantId),
    check('scoring_run_traces_stage_check', sql`stage IN ('pool', 'engine')`),
  ]
);

export type ScoringRunTrace = typeof scoringRunTraces.$inferSelect;

// ── Census distributions behind the anchors (drizzle/0092) ─────────────
// What a census MEASURED, per (kind, input fingerprint): the kamus best-wrong-
// match distribution, the job-profile pair cosines, the job-family precision
// sweep (labels from the topic-service run), the cosines of real internal moves,
// the appointment record, the competency document frequencies. The calibration
// singletons above keep only the result and are overwritten when the corpus
// moves; these rows are never overwritten (insert-if-absent), so a finished
// run's anchors stay recomputable. No candidate identity is stored here.
export const scoringCensusSnapshots = pgTable(
  'scoring_census_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: varchar('kind', { length: 40 }).notNull(),
    fingerprint: varchar('fingerprint', { length: 200 }).notNull(),
    payload: jsonb('payload').notNull(),
    sampleCount: integer('sample_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_scoring_census_snapshots_kind_fingerprint').on(table.kind, table.fingerprint)]
);

export type ScoringCensusSnapshot = typeof scoringCensusSnapshots.$inferSelect;

// ── Audit Log (powers Governance page) ────────────────
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    // Deliberately not uuid: audited entities have heterogeneous keys — UUIDs
    // (programs, positions, scoring runs), integer serials (sync_* tables,
    // sync_job_profiles), and emails (users, which are pre-provisioned by email
    // before a row exists). A uuid column made every non-UUID write fail the
    // 22P02 cast, and logAudit swallows errors, so those entries vanished silently.
    entityId: varchar('entity_id', { length: 128 }),
    action: varchar('action', { length: 30 }).notNull(),
    summary: varchar('summary', { length: 500 }),
    diff: jsonb('diff'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_audit_entity').on(table.entityType, table.entityId),
  ]
);

// ── Sync: Divisions (derived from sync_employees) ───────────
export const syncDivisions = pgTable(
  'sync_divisions',
  {
    id: serial('id').primaryKey(),
    iddivision: varchar('iddivision', { length: 20 }).notNull(),
    divisionName: varchar('division_name', { length: 200 }).notNull(),
    companyId: varchar('company_id', { length: 10 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_divisions_iddivision').on(table.iddivision),
    index('idx_sync_divisions_company_id').on(table.companyId),
  ]
);

// ── Sync: Departments (derived from sync_employees) ──────────
export const syncDepartments = pgTable(
  'sync_departments',
  {
    id: serial('id').primaryKey(),
    iddepartment: varchar('iddepartment', { length: 20 }).notNull(),
    departmentName: varchar('department_name', { length: 200 }).notNull(),
    iddivision: varchar('iddivision', { length: 20 }),
    companyId: varchar('company_id', { length: 10 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_departments_iddepartment').on(table.iddepartment),
    index('idx_sync_departments_iddivision').on(table.iddivision),
    index('idx_sync_departments_company_id').on(table.companyId),
  ]
);

// ── Sync: Employees (from DB MPMDS – MPMDS_ORANGE_DATA) ─────────
export const syncEmployees = pgTable(
  'sync_employees',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    displayName: varchar('display_name', { length: 200 }),
    gradeId: varchar('grade_id', { length: 20 }),
    internalTitle: varchar('internal_title', { length: 200 }),
    companyOffice: varchar('company_office', { length: 100 }),
    iddivision: varchar('iddivision', { length: 20 }),
    division: varchar('division', { length: 200 }),
    iddepartment: varchar('iddepartment', { length: 20 }),
    department: varchar('department', { length: 200 }),
    isBranchHead: boolean('is_branch_head').default(false),
    isAfc: boolean('is_afc').default(false),
    isHomso: boolean('is_homso').default(false),
    entryDate: date('entry_date'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_employees_employee_id').on(table.employeeId),
    index('idx_sync_employees_company_id').on(table.companyId),
    index('idx_sync_employees_synced_at').on(table.syncedAt),
  ]
);

/**
 * Sync: employee personal information (from the HR API gateway).
 *
 * Feeds candidate AGE. The upstream endpoint returns far more — national ID,
 * NPWP, BPJS, phone, email — and none of it is stored: only the birth date the
 * product actually needs, plus the display name so a row can be identified when
 * reconciling. Identity documents have no reader here and would only widen what
 * a database leak costs.
 */
export const syncEmployeePersonal = pgTable(
  'sync_employee_personal',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    displayName: varchar('display_name', { length: 200 }),
    birthDate: date('birth_date'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_employee_personal').on(table.companyId, table.employeeId),
    index('idx_sync_employee_personal_employee').on(table.employeeId),
  ]
);

// ── Sync: Performance Appraisals (from DB MPMHRGA) ─────────────────
export const syncPerformanceAppraisals = pgTable(
  'sync_performance_appraisals',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    companyOffice: varchar('company_office', { length: 100 }),
    costCenter: varchar('cost_center', { length: 20 }),
    orgId: varchar('org_id', { length: 20 }),
    positionId: varchar('position_id', { length: 20 }),
    gradeId: varchar('grade_id', { length: 10 }),
    seq: integer('seq'),
    tahun: integer('tahun'),
    s1: varchar('s1', { length: 10 }),
    s2: varchar('s2', { length: 10 }),
    promosi: varchar('promosi', { length: 50 }),
    isPrintReport: boolean('is_print_report'),
    createBy: varchar('create_by', { length: 50 }),
    createDate: timestamp('create_date', { withTimezone: true }),
    modiBy: varchar('modi_by', { length: 50 }),
    modiDate: timestamp('modi_date', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_perf_appraisal').on(table.companyId, table.employeeId, table.tahun, table.seq),
    index('idx_sync_performance_employee_id').on(table.employeeId),
    index('idx_sync_performance_company_id').on(table.companyId),
    index('idx_sync_performance_tahun').on(table.tahun),
  ]
);

// ── Sync: Position Master (from DB MPMHRGA) ────────────────────────
export const syncPositions = pgTable(
  'sync_positions',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    positionId: varchar('position_id', { length: 40 }).notNull(),
    internalTitle: varchar('internal_title', { length: 300 }),
    externalTitle: varchar('external_title', { length: 300 }),
    summary: text('summary'),
    gradeId: varchar('grade_id', { length: 20 }),
    posLevelNo: integer('pos_level_no'),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validTo: timestamp('valid_to', { withTimezone: true }),
    createBy: varchar('create_by', { length: 100 }),
    createDate: timestamp('create_date', { withTimezone: true }),
    modiBy: varchar('modi_by', { length: 100 }),
    modiDate: timestamp('modi_date', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_positions_company_position_valid_from').on(table.companyId, table.positionId, table.validFrom),
    index('idx_sync_positions_company_position').on(table.companyId, table.positionId),
    index('idx_sync_positions_valid_to').on(table.validTo),
  ]
);

// ── Sync: Position Hierarchy (from DB MPMHRGA) ─────────────────────
export const syncPositionHierarchy = pgTable(
  'sync_position_hierarchy',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    positionId: varchar('position_id', { length: 40 }).notNull(),
    parentPositionId: varchar('parent_position_id', { length: 40 }),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validTo: timestamp('valid_to', { withTimezone: true }),
    createBy: varchar('create_by', { length: 100 }),
    createDate: timestamp('create_date', { withTimezone: true }),
    modiBy: varchar('modi_by', { length: 100 }),
    modiDate: timestamp('modi_date', { withTimezone: true }),
    sourceKey: varchar('source_key', { length: 200 }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_position_hierarchy_source_key').on(table.sourceKey),
    index('idx_sync_position_hierarchy_company_position').on(table.companyId, table.positionId),
    index('idx_sync_position_hierarchy_parent').on(table.parentPositionId),
    index('idx_sync_position_hierarchy_valid_to').on(table.validTo),
  ]
);

// ── Sync: Employee ↔ Position Mapping (from DB MPMHRGA) ────────────
export const syncEmployeePositions = pgTable(
  'sync_employee_positions',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    positionId: varchar('position_id', { length: 40 }).notNull(),
    isPrimary: boolean('primary_position').default(false).notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validTo: timestamp('valid_to', { withTimezone: true }),
    createBy: varchar('create_by', { length: 100 }),
    createDate: timestamp('create_date', { withTimezone: true }),
    modiBy: varchar('modi_by', { length: 100 }),
    modiDate: timestamp('modi_date', { withTimezone: true }),
    sourceKey: varchar('source_key', { length: 220 }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_employee_positions_source_key').on(table.sourceKey),
    index('idx_sync_employee_positions_company_employee').on(table.companyId, table.employeeId),
    index('idx_sync_employee_positions_company_position').on(table.companyId, table.positionId),
    index('idx_sync_employee_positions_valid_to').on(table.validTo),
  ]
);

// ── Sync: Technical Competency Mapping (from DB MPMHRGA) ───────────
export const syncTechnicalCompetencies = pgTable(
  'sync_technical_competencies',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    companyOffice: varchar('company_office', { length: 100 }),
    costCenter: varchar('cost_center', { length: 20 }),
    orgId: varchar('org_id', { length: 20 }),
    positionId: varchar('position_id', { length: 40 }),
    gradeId: varchar('grade_id', { length: 20 }),
    technicalId: varchar('technical_id', { length: 40 }).notNull(),
    technicalName: varchar('technical_name', { length: 300 }),
    proficiencyId: varchar('proficiency_id', { length: 40 }),
    proficiencyName: varchar('proficiency_name', { length: 120 }),
    score: integer('score'),
    currentProficiencyId: varchar('current_proficiency_id', { length: 40 }),
    currentProficiencyName: varchar('current_proficiency_name', { length: 120 }),
    currentScore: integer('current_score'),
    gap: integer('gap'),
    isActive: boolean('is_active').default(true).notNull(),
    createBy: varchar('create_by', { length: 100 }),
    createDate: timestamp('create_date', { withTimezone: true }),
    modiBy: varchar('modi_by', { length: 100 }),
    modiDate: timestamp('modi_date', { withTimezone: true }),
    sourceKey: varchar('source_key', { length: 220 }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_technical_competencies_source_key').on(table.sourceKey),
    index('idx_sync_technical_competencies_company_employee').on(table.companyId, table.employeeId),
    index('idx_sync_technical_competencies_position').on(table.positionId),
    index('idx_sync_technical_competencies_active').on(table.isActive),
  ]
);

// ── Sync: Disciplinary (from API) ────────────────────────────
export const syncDisciplinary = pgTable(
  'sync_disciplinary',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    displayName: varchar('display_name', { length: 200 }),
    disciplinaryNo: integer('disciplinary_no').notNull(),
    incidentDate: timestamp('incident_date', { withTimezone: true }),
    violation: text('violation'),
    violationDegree: integer('violation_degree'),
    violationType: integer('violation_type'),
    warningLevel: integer('warning_level'),
    effectViolation: text('effect_violation'),
    adviceGiven: varchar('advice_given', { length: 200 }),
    sanctionGiven: varchar('sanction_given', { length: 200 }),
    letterNo: varchar('letter_no', { length: 200 }),
    dateIssue: timestamp('date_issue', { withTimezone: true }),
    expiryDate: timestamp('expiry_date', { withTimezone: true }),
    disciplinaryNote: text('disciplinary_note'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_disciplinary').on(table.companyId, table.employeeId, table.disciplinaryNo),
    index('idx_sync_disciplinary_employee_id').on(table.employeeId),
    index('idx_sync_disciplinary_company_id').on(table.companyId),
    index('idx_sync_disciplinary_warning_level').on(table.warningLevel),
  ]
);

// ── Sync: Education (from API) ───────────────────────────────
export const syncEducation = pgTable(
  'sync_education',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    displayName: varchar('display_name', { length: 200 }),
    educationLevel: varchar('education_level', { length: 50 }),
    educationLevelRank: integer('education_level_rank'),
    educationField: varchar('education_field', { length: 100 }),
    institutionName: varchar('institution_name', { length: 300 }),
    institutionLocation: varchar('institution_location', { length: 100 }),
    startYear: integer('start_year'),
    endYear: integer('end_year'),
    gpa: numeric('gpa', { precision: 4, scale: 2 }),
    achievement: text('achievement'),
    educationNote: text('education_note'),
    // Deterministic md5 of the identifying fields — lets education-sync upsert
    // instead of delete-then-insert. Built in education-sync.ts (educationSourceKey).
    sourceKey: varchar('source_key', { length: 32 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_sync_education_employee_id').on(table.employeeId),
    index('idx_sync_education_company_id').on(table.companyId),
    index('idx_sync_education_level_rank').on(table.educationLevelRank),
    uniqueIndex('uq_sync_education_source_key').on(table.sourceKey),
  ]
);

// ── Sync: Job Profiles (from SharePoint PDFs + LLM) ──────────
export const syncJobProfiles = pgTable(
  'sync_job_profiles',
  {
    id: serial('id').primaryKey(),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    filePath: varchar('file_path', { length: 1000 }).notNull(),
    sourceFolder: varchar('source_folder', { length: 200 }),
    fileHash: varchar('file_hash', { length: 64 }),
    jobProfileNumber: varchar('job_profile_number', { length: 50 }),
    positionName: varchar('position_name', { length: 300 }),
    divisionDepartment: varchar('division_department', { length: 300 }),
    supervisor: varchar('supervisor', { length: 300 }),
    jobPurpose: text('job_purpose'),
    extractedData: jsonb('extracted_data'),
    rawText: text('raw_text'),
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    errorMessage: text('error_message'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /**
     * Set when a run has decided this file needs (re)extraction, cleared when it
     * reaches a terminal state. Deliberately NOT folded into `status`: nine
     * readers select on `status = 'completed'`, so marking a whole batch pending
     * up front would empty the job-profile corpus for the length of the run.
     * `status` is the state of the extracted content; this is the queue.
     */
    queuedAt: timestamp('queued_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_sync_job_profiles_file_path').on(table.filePath),
    index('idx_sync_job_profiles_source_folder').on(table.sourceFolder),
    index('idx_sync_job_profiles_status').on(table.status),
    index('idx_sync_job_profiles_position').on(table.positionName),
  ]
);

// ── Job Profile: document ↔ tenant ownership (many-to-many) ───────
// Resolved ownership of a single job-profile document, assigned DIRECTLY —
// either chosen at upload time or set/changed on the Job Profiles page. There
// used to be an indirection here (job_profile_folder_map: an admin-editable
// share-subfolder → tenant table, materialized into this one by a sync-time
// reconciliation job) but in practice every real folder mapped 1:1 to a tenant
// of the same name, so the indirection only ever added a step — go register the
// folder in Tata Kelola before its documents would scope correctly — for an
// answer that was known the moment the document appeared. Dropped in
// drizzle/0055_drop_job_profile_folder_map.sql; see docs/job-profile-tenant-scope.md.
//
// A document with zero rows here is unassigned (visible to every tenant) — see
// lib/job-profile-tenant-scope.ts. `source` records how the row was created; it
// no longer varies in practice (there is only one path now: direct assignment)
// but is kept for schema stability and to distinguish it from the historical
// 'folder' value should an old snapshot ever need to be read.
//
// IMPORTANT: this scopes DISPLAY and ANALYSIS only (Job Profiles page, Job Family,
// job-profile match). The scoring engines deliberately ignore it so cross-tenant
// talent search keeps comparing every candidate against the same corpus — see the
// note on scoring-service/src/ahp-topsis-engine.ts.
export const jobProfileTenants = pgTable(
  'job_profile_tenants',
  {
    jobProfileId: integer('job_profile_id')
      .notNull()
      .references(() => syncJobProfiles.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** 'manual' (direct assignment) | 'folder' (historical — no longer written). */
    source: varchar('source', { length: 10 }).default('manual').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobProfileId, table.tenantId] }),
    index('idx_job_profile_tenants_tenant').on(table.tenantId),
    index('idx_job_profile_tenants_source').on(table.source),
  ]
);

export type JobProfileTenant = typeof jobProfileTenants.$inferSelect;
export type NewJobProfileTenant = typeof jobProfileTenants.$inferInsert;

// ── Job Family: candidate ↔ job profile match mapping ─────────────
// Persisted result of the Job Family "Sync" matching: maps a job-profile
// document to a candidate and that candidate's CURRENT position, together with
// HOW they matched (filename code / exact / substring / embedding) and the
// reason detail. One row per candidate (their current best match).
export const jobFamilyMatches = pgTable(
  'job_family_matches',
  {
    id: serial('id').primaryKey(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    candidateName: varchar('candidate_name', { length: 255 }),
    /** Tenant the candidate belongs to (Pulse tenant division). */
    tenantId: uuid('tenant_id'),
    /** MSSQL company_id resolved for the candidate (company division). */
    companyId: varchar('company_id', { length: 20 }),
    /** The candidate's current position title used for matching. */
    candidatePosition: varchar('candidate_position', { length: 400 }),
    /** The candidate's sync position_id (drives the filename-code match). */
    positionId: varchar('position_id', { length: 40 }),
    jobProfileId: integer('job_profile_id')
      .notNull()
      .references(() => syncJobProfiles.id, { onDelete: 'cascade' }),
    jobProfileName: varchar('job_profile_name', { length: 400 }),
    /** 'filename' | 'exact' | 'embedding'. */
    matchType: varchar('match_type', { length: 20 }).notNull(),
    /** Cosine similarity (0..1) — embedding matches only. */
    similarity: real('similarity'),
    /** Leading code parsed from the job-profile file_name — filename matches. */
    matchedCode: varchar('matched_code', { length: 60 }),
    /** "JD-..." token from the file_name — filename matches. */
    jdNumber: varchar('jd_number', { length: 60 }),
    /** Job-profile file name — filename matches. */
    fileName: varchar('file_name', { length: 500 }),
    /** The overlapping title fragment — substring matches. */
    matchedPart: text('matched_part'),
    /** Full structured reason (superset of the columns above). */
    reason: jsonb('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_job_family_matches_candidate').on(table.candidateId),
    index('idx_job_family_matches_job_profile').on(table.jobProfileId),
    index('idx_job_family_matches_match_type').on(table.matchType),
    index('idx_job_family_matches_position_id').on(table.positionId),
    index('idx_job_family_matches_tenant').on(table.tenantId),
    index('idx_job_family_matches_company').on(table.companyId),
  ]
);

export type JobFamilyMatch = typeof jobFamilyMatches.$inferSelect;
export type NewJobFamilyMatch = typeof jobFamilyMatches.$inferInsert;

/**
 * Cached decisions of the AI matching tier (drizzle/0059).
 *
 * The tier only sees titles the deterministic tiers could not place, and its
 * answer is cached per NORMALIZED title: the decision is about the title, not
 * the person, and an LLM is not a pure function — without this the same title
 * could pair differently between two page loads and the report would reshuffle
 * itself. `jobProfileId` NULL is a real cached answer ("none of the shortlist is
 * this role"), not a missing one.
 */
export const jobFamilyAiMatchCache = pgTable(
  'job_family_ai_match_cache',
  {
    id: serial('id').primaryKey(),
    /** Lowercased, whitespace-collapsed title — the cache key. */
    titleKey: varchar('title_key', { length: 400 }).notNull(),
    /** The title as it was seen, for display and debugging. */
    title: text('title').notNull(),
    jobProfileId: integer('job_profile_id').references(() => syncJobProfiles.id, { onDelete: 'cascade' }),
    confidence: real('confidence'),
    reason: text('reason'),
    /** Model that produced the decision, so a model change is traceable. */
    model: varchar('model', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_job_family_ai_match_cache_title').on(table.titleKey)],
);

/**
 * The last Job Profile Match RUN per business unit (drizzle/0076).
 *
 * `job_family_matches` is the MAPPING — the pairs an operator committed with
 * "Simpan Pemetaan", read by position→job-profile suggestion and the scoring
 * family map. It holds matched pairs only, so a page rebuilt from it cannot
 * say which positions have no profile or which profiles have no incumbent:
 * those exist only as by-products of a full run. Before this table the run
 * itself lived nowhere but the browser tab that started it, so every visit to
 * the section began with a blank report and a ~20s "Jalankan Pencocokan".
 *
 * One row per tenant (the `pulse_tenant` in force when the run started),
 * upserted on every run — a re-run REPLACES the stored result, it does not
 * version it, because this is a cache of a deterministic-enough computation
 * (the AI tier is itself cached per title), not a record of a decision. The
 * whole `JobFamilyMatchReport` is stored as jsonb so the page can open on
 * exactly what the last run showed, including its tenant scope.
 */
export const jobProfileMatchRuns = pgTable(
  'job_profile_match_runs',
  {
    id: serial('id').primaryKey(),
    /** Business unit whose cookie was active when the run was started. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Tenant ids the run actually covered (the in-view scope selector). */
    selectedTenantIds: jsonb('selected_tenant_ids').notNull(),
    /** Full JobFamilyMatchReport as returned by getJobFamilyMatchReport. */
    report: jsonb('report').notNull(),
    /** Display name / email of whoever pressed the button; null for the local System User. */
    runBy: varchar('run_by', { length: 255 }),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_job_profile_match_runs_tenant').on(table.tenantId)],
);

export type JobFamilyAiMatchCache = typeof jobFamilyAiMatchCache.$inferSelect;

/**
 * Persistent cache of TITLE embeddings for the Job Profile Match report
 * (drizzle/0070).
 *
 * The report's embedding tier needs a vector for every job-profile NAME plus
 * every still-unplaced position title — ~740 texts here. The embedding source is
 * a remote gateway (measured: 5.2s per 200-text call), so a cold report spent
 * ~20s embedding before it could render, against a 0.35s database phase. An
 * in-process Map already existed but is per-process, so every restart, deploy
 * and extra worker paid it again.
 *
 * A vector is a pure function of (source, model, EXACT text), which is why this
 * table has no invalidation column: a model or source change simply lands on
 * different rows. Caching VECTORS rather than match DECISIONS is deliberate —
 * a decision depends on the whole JD corpus, so importing one job profile would
 * invalidate every row, while a cached vector makes that cost one embed call.
 *
 * `embedding` is bytea (little-endian Float32, `dims` entries), not
 * vector(768): the cosines are computed in JS against an in-memory corpus, so
 * nothing here needs pgvector and the row stays out of VECTOR_DATABASE_URL's
 * way. Float32 halves the read (442ms vs 1030ms for the full set) and its ~1e-6
 * rounding cannot move a decision taken at a 0.98 threshold — but it does mean
 * cached vectors are not bit-identical to freshly-embedded ones, so
 * `embedTitles` quantizes fresh vectors the same way and every run compares
 * float32 against float32.
 */
export const jobFamilyTitleEmbed = pgTable(
  'job_family_title_embed',
  {
    id: serial('id').primaryKey(),
    source: varchar('source', { length: 40 }).notNull(),
    model: varchar('model', { length: 160 }).notNull(),
    /** md5 of the EXACT text handed to the model, not a normalized form. */
    textHash: varchar('text_hash', { length: 32 }).notNull(),
    text: text('text').notNull(),
    dims: integer('dims').notNull(),
    embedding: bytea('embedding').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_job_family_title_embed').on(table.source, table.model, table.textHash),
  ],
);

export type JobFamilyTitleEmbed = typeof jobFamilyTitleEmbed.$inferSelect;

// ── Demo mode (drizzle/0093) ────────────────────────────────────────────
// "dupp": the demo copy of a candidate's displayed fields, upserted by the
// demo-mode edit and read INSTEAD of `candidates` for that candidate while in
// demo mode. `candidates` itself is never written by demo mode. Reload deletes
// the row. `payload` is a sealed DemoCandidateFields JSON (lib/demo/fields.ts).
export const candidatesDupp = pgTable(
  'candidates_dupp',
  {
    candidateId: uuid('candidate_id').primaryKey().references(() => candidates.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    payload: text('payload').notNull(),
    sealed: boolean('sealed').notNull().default(false),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_candidates_dupp_tenant').on(table.tenantId)],
);
export type CandidateDupp = typeof candidatesDupp.$inferSelect;

/** Demo-mode visibility. No row (or `enabled = false`) = OFF, the default. */
export const candidateDemoStates = pgTable('candidate_demo_states', {
  candidateId: uuid('candidate_id').primaryKey().references(() => candidates.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  enabled: boolean('enabled').notNull().default(false),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Competency name → kamus code resolution (drizzle/0063) ─────────
// The kamus is the canonical vocabulary, but job-profile PDFs are extracted by
// an LLM and name competencies loosely ("Business Process Analyst" for the
// kamus's BUSINESS PROCESS ANALYSIS). An unresolved name has no level vector,
// so its whole column scores 0 — and since Hungarian maximises, the candidate
// competency that belonged there gets spent on a column that scores above zero.
// Making the kamus CODE the identity is what stops that. Only NON-EXACT
// resolutions are cached; `code` NULL is a real answer ("no kamus entry means
// this"), which is why behavioural names like "Leadership" cost one call ever.
export const kamusCompetencyMatchCache = pgTable(
  'kamus_competency_match_cache',
  {
    id: serial('id').primaryKey(),
    /** Normalized competency name — the cache key the services look up by. */
    nameKey: varchar('name_key', { length: 400 }).notNull(),
    /** One original spelling, for display in the review UI. */
    name: text('name').notNull(),
    /** Resolved kamus code, or NULL for a cached "no match". */
    code: varchar('code', { length: 40 }),
    /** 'fuzzy' = deterministic token match, 'ai' = LLM arbitration. */
    tier: varchar('tier', { length: 20 }).notNull(),
    confidence: real('confidence'),
    reason: text('reason'),
    model: varchar('model', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_kamus_competency_match_cache_key').on(table.nameKey)],
);

export type KamusCompetencyMatchCache = typeof kamusCompetencyMatchCache.$inferSelect;

// ── Technical similarity anchors, derived from the corpus (drizzle/0064) ──
// The floor/ceil a semantic competency cosine is stretched onto 0..1 with are
// statements about ONE embedding corpus, so they cannot be constants: a
// re-embed, an added or removed competency, or a model switch moves the
// distribution they describe while every cosine keeps computing — the score
// silently changes meaning. `fingerprint` hashes (code, level, content_hash)
// over every embedded row plus the model, so the next scoring run recomputes
// after ANY such change without every write path having to know about this.
// Not per-run percentiles: those would vary with who is in the pool, which is
// an accident of the run rather than a property of the instrument.
export const kamusSimilarityCalibration = pgTable(
  'kamus_similarity_calibration',
  {
    id: serial('id').primaryKey(),
    /** Always true — the unique index makes this table a singleton. */
    singleton: boolean('singleton').default(true).notNull(),
    /** `md5(corpus):embedding_model` — 200, widened from 64 in drizzle/0067. */
    fingerprint: varchar('fingerprint', { length: 200 }).notNull(),
    embeddingModel: varchar('embedding_model', { length: 120 }),
    /** p25 of the per-row "best similarity to a DIFFERENT competency". */
    simFloor: real('sim_floor').notNull(),
    /** p99 of that distribution — not the max, which one near-duplicate would move. */
    simCeil: real('sim_ceil').notNull(),
    sampleCount: integer('sample_count').notNull(),
    codeCount: integer('code_count').notNull(),
    p50: real('p50'),
    p95: real('p95'),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_kamus_similarity_calibration_singleton').on(table.singleton)],
);

export type KamusSimilarityCalibration = typeof kamusSimilarityCalibration.$inferSelect;

// ── Career similarity anchors, derived from the corpus (drizzle/0066) ──
// Same reasoning as the kamus table above, for the OTHER embedding corpus the
// engine measures against: the job-profile documents in `job_profile_embed`.
// Those anchors used to fall back to literals chosen per model FAMILY (0.45/0.85
// for anything not E5) that were never measured — `.env.example` said "tune once
// real runs are observed". A census showed both ends shifted low: floor 0.45 sat
// below the 5th percentile of arbitrary document pairs, so the median UNRELATED
// pair still scored 0.28 relevance; ceil 0.85 sat below the median document's
// genuine twin (0.905), so over half the corpus saturated at 1.0.
//
// `fingerprint` hashes (job_profile_id, content_hash) over every embedded row
// plus the model, so any re-embed / insert / delete / model switch makes the next
// scoring run recompute — none of the write paths in lib/job-family-actions.ts
// need to know this table exists. Still fixed rather than per-run percentiles:
// these describe the instrument, not who happened to be in the pool.
/**
 * One estimate of the career similarity anchors. Three estimators answer the
 * same question from different evidence (see drizzle/0068):
 *
 *   corpus      — percentiles of the arbitrary cross-document pair distribution.
 *                 Needs only the vectors, so it is always available.
 *   family      — the cosine at which P(same job family) crosses 50% / 95%.
 *                 Partly circular: the families were clustered from these vectors.
 *   transitions — REVEALED PREFERENCE: percentiles of the cosine distribution of
 *                 internal moves people actually made. The only non-circular
 *                 estimator, and the smallest sample.
 */
export type CareerAnchorEstimate = {
  source: 'corpus' | 'family' | 'transitions';
  floor: number;
  ceil: number;
  /** Observations behind this estimate (pairs, labelled pairs, or moves). */
  sampleCount: number;
  /** What was measured, in the operator's language. */
  note: string;
};

export type CareerAnchorEstimators = {
  estimates: CareerAnchorEstimate[];
  /** How `simFloor`/`simCeil` were combined — always the median of `estimates`. */
  combine: 'median';
};

export const jobProfileSimilarityCalibration = pgTable(
  'job_profile_similarity_calibration',
  {
    id: serial('id').primaryKey(),
    /** Always true — the unique index makes this table a singleton. */
    singleton: boolean('singleton').default(true).notNull(),
    /** `md5(corpus):embedding_model` — 200 because 64 cannot hold both. */
    fingerprint: varchar('fingerprint', { length: 200 }).notNull(),
    embeddingModel: varchar('embedding_model', { length: 120 }),
    /** p25 of the arbitrary cross-document pair distribution (see 0066 for why not the median). */
    simFloor: real('sim_floor').notNull(),
    /** p99 of the per-document best genuine match, near-duplicates (>= 0.999) excluded first. */
    simCeil: real('sim_ceil').notNull(),
    /** Cross-pairs the percentiles were taken over. */
    sampleCount: integer('sample_count').notNull(),
    docCount: integer('doc_count').notNull(),
    /** Median arbitrary pair — the "unrelated baseline". */
    arbitraryP50: real('arbitrary_p50'),
    /** Median genuine best match — a typical real twin. */
    bestP50: real('best_p50'),
    /** Pairs discarded as duplicates before the ceiling was measured. */
    duplicatePairs: integer('duplicate_pairs'),
    /**
     * Every estimator that was measured, not just the one that won (drizzle/0068).
     * `simFloor`/`simCeil` above are the MEDIAN across the available estimates,
     * so a single estimator cannot move the scale alone. NULL on rows written
     * before 0068 — those came from `corpus` only.
     */
    estimators: jsonb('estimators').$type<CareerAnchorEstimators>(),
    /** Comma-joined names of the estimators that contributed, e.g. "corpus,family,transitions". */
    estimatorSources: varchar('estimator_sources', { length: 120 }),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_job_profile_similarity_calibration_singleton').on(table.singleton),
  ],
);

export type JobProfileSimilarityCalibration =
  typeof jobProfileSimilarityCalibration.$inferSelect;

// ── Job Family: qualified employee pool (global-filter result) ─────
// Persisted, re-syncable result of the Job Family GLOBAL filter (distinct from
// program_templates' per-run hard filters). One row per employee_id that passes
// the global-default filter rules — INCLUDING employees not yet in `candidates`
// (the universe is candidates ⟕ sync_employees).
// NOTE: ORPHANED — the Filtering tab that populated and read this table was
// removed with the /job-family route. Kept so existing rows and the migration
// stay intact; drop it (with a migration) if the feature isn't coming back.
export const qualifiedEmployeePool = pgTable(
  'qualified_employee_pool',
  {
    id: serial('id').primaryKey(),
    /** Employee NIK — the stable key across candidates & sync_employees. */
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    /** Linked candidate row when the employee is already a candidate. */
    candidateId: uuid('candidate_id').references(() => candidates.id, { onDelete: 'set null' }),
    isCandidate: boolean('is_candidate').default(false).notNull(),
    /** Resolved Pulse tenant (via candidate or company→tenant map). */
    tenantId: uuid('tenant_id'),
    companyId: varchar('company_id', { length: 20 }),
    name: varchar('name', { length: 255 }),
    currentPosition: varchar('current_position', { length: 400 }),
    grade: varchar('grade', { length: 20 }),
    /** Snapshot of the filter-relevant attributes at qualification time. */
    attributes: jsonb('attributes'),
    /** Labels of the global-filter rules the employee satisfied. */
    passedRules: jsonb('passed_rules'),
    /** Tenant scope active when this pool row was synced. */
    scopeTenantIds: jsonb('scope_tenant_ids'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_qualified_employee_pool_employee').on(table.employeeId),
    index('idx_qualified_employee_pool_tenant').on(table.tenantId),
    index('idx_qualified_employee_pool_candidate').on(table.candidateId),
    index('idx_qualified_employee_pool_is_candidate').on(table.isCandidate),
  ]
);

export type QualifiedEmployeePool = typeof qualifiedEmployeePool.$inferSelect;
export type NewQualifiedEmployeePool = typeof qualifiedEmployeePool.$inferInsert;

// ── Sync: Company → Tenant mapping (UI-managed) ───────────────
/**
 * Audit trail for sync executions. Distinct from each sync table's `synced_at`,
 * which only moves when data changes — this records the run itself, so a
 * zero-row, failed, or never-triggered sync is visible.
 */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Module key as used by the HTTP API / CLI: 'employees', 'hav', 'all', 'upload:job-profiles'. */
    jobKey: varchar('job_key', { length: 64 }).notNull(),
    /** running | success | failed */
    status: varchar('status', { length: 16 }).notNull(),
    /** ui | api | cron | cli */
    triggerSource: varchar('trigger_source', { length: 16 }).notNull().default('api'),
    /** upsert | rebuild (candidates only) */
    mode: varchar('mode', { length: 16 }),
    tenantIds: text('tenant_ids').array(),
    companyIds: text('company_ids').array(),
    /** Email of the user who triggered it from the UI; null for cron/cli. */
    actor: varchar('actor', { length: 200 }),
    synced: integer('synced'),
    total: integer('total'),
    message: text('message'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
  },
  (table) => [
    index('idx_sync_runs_job_started').on(table.jobKey, table.startedAt.desc()),
    index('idx_sync_runs_started').on(table.startedAt.desc()),
    index('idx_sync_runs_status').on(table.status),
  ]
);

export const syncCompanyTenantMap = pgTable(
  'sync_company_tenant_map',
  {
    id: serial('id').primaryKey(),
    // MSSQL company_id (e.g. 'MPM2')
    companyId: varchar('company_id', { length: 20 }).notNull(),
    // References tenants.id – kept as varchar to avoid cross-schema FK issues
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 100 }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_company_tenant_map_company_id').on(table.companyId),
    index('idx_sync_company_tenant_map_tenant_id').on(table.tenantId),
    index('idx_sync_company_tenant_map_is_active').on(table.isActive),
  ]
);

// ── Sync: HAV (from Excel HAV.xlsx) ───────────────────
export const syncHav = pgTable(
  'sync_hav',
  {
    id: serial('id').primaryKey(),
    npk: varchar('npk', { length: 20 }).notNull(),
    nama: varchar('nama', { length: 255 }),
    quadrant: varchar('quadrant', { length: 30 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_hav_npk').on(table.npk),
    index('idx_sync_hav_quadrant').on(table.quadrant),
  ]
);

// ── Sync: MCU (from Excel MCU.xlsx) ───────────────────
export const syncMcu = pgTable(
  'sync_mcu',
  {
    id: serial('id').primaryKey(),
    npk: varchar('npk', { length: 20 }).notNull(),
    nama: varchar('nama', { length: 255 }),
    status: varchar('status', { length: 20 }), // 'fit', 'fit_with_note', 'unfit', 'expired'
    /**
     * The "Kesimpulan" cell verbatim, before normalizeMcuStatus() reduces it to
     * one token. The template already tolerates prose there ("FIT (dengan note
     * tekanan darah)"), so the medical detail was always being sent — it was
     * simply thrown away at parse time. Kept as the candidate's MCU note
     * (`candidates.mcu_note`).
     */
    kesimpulanRaw: text('kesimpulan_raw'),
    /** Optional dedicated column, for a note longer than a Kesimpulan cell. */
    keterangan: text('keterangan'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_mcu_npk').on(table.npk),
    index('idx_sync_mcu_status').on(table.status),
  ]
);

// ── Relations ─────────────────────────────────────────
export const syncCompanyTenantMapRelations = relations(syncCompanyTenantMap, ({ one }) => ({
  tenant: one(tenants, { fields: [syncCompanyTenantMap.tenantId], references: [tenants.id] }),
}));

// ── Sync: Grade Levels (from MPMHRGA Behaviour Competency Master) ────────────
export const syncGradeLevels = pgTable(
  'sync_grade_levels',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    levelId: varchar('level_id', { length: 20 }).notNull(),
    levelName: varchar('level_name', { length: 200 }),
    gradeId: varchar('grade_id', { length: 20 }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_grade_levels').on(table.companyId, table.levelId, table.gradeId),
    index('idx_sync_grade_levels_company').on(table.companyId),
  ]
);

// ── Sync: Kamus Kompetensi Teknis (competency dictionary, parsed from PDF) ───
// One row per competency from the "Dictionary Technical Competency for MPM"
// PDF (kamus-kompetensi folder): code (TC 003), name, description, and the
// four proficiency-level definitions.
export const syncKamusKompetensi = pgTable(
  'sync_kamus_kompetensi',
  {
    id: serial('id').primaryKey(),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 300 }).notNull(),
    description: text('description'),
    levelBasic: text('level_basic'),
    levelIntermediate: text('level_intermediate'),
    levelAdvance: text('level_advance'),
    levelMastery: text('level_mastery'),
    sourceFile: varchar('source_file', { length: 500 }),
    fileHash: varchar('file_hash', { length: 64 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_kamus_kompetensi_code').on(table.code),
    index('idx_sync_kamus_kompetensi_name').on(table.name),
  ]
);

// ── Sync: Behavior Competencies (latest assessment per employee) ──────────────
export const syncBehaviorCompetencies = pgTable(
  'sync_behavior_competencies',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    rekomendasiName: varchar('rekomendasi_name', { length: 255 }),
    keterangan: text('keterangan'),
    tglPelaksanaan: timestamp('tgl_pelaksanaan', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_behavior_company_employee').on(table.companyId, table.employeeId),
    index('idx_sync_behavior_company').on(table.companyId),
  ]
);

// ── Sync: Behavioural-assessment HISTORY (drizzle/0081) ────────────
// The newest few assessment-center results per employee — the table above keeps
// only the latest (what the HAV formula reads). Written by the behaviour sync
// (sync-service/src/services/behavior-history.ts), replaced per employee on each
// run; read by the Talent Mapping work queue, which merges the current row back
// in so an Excel-uploaded BA still appears and an empty table means "latest
// only", never "nothing".
export const syncBehaviorCompetencyHistory = pgTable(
  'sync_behavior_competency_history',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }).notNull(),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    /** 1 = newest assessment date. */
    rank: smallint('rank').notNull(),
    tglPelaksanaan: timestamp('tgl_pelaksanaan', { withTimezone: true }).notNull(),
    rekomendasiName: varchar('rekomendasi_name', { length: 255 }),
    keterangan: text('keterangan'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_behavior_history_assessment').on(table.companyId, table.employeeId, table.tglPelaksanaan),
    index('idx_sync_behavior_history_employee').on(table.companyId, table.employeeId, table.rank),
  ]
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  positions: many(positions),
  criticalPositions: many(criticalPositions),
  candidates: many(candidates),
  programTemplates: many(programTemplates),
  auditLog: many(auditLog),
  companyMappings: many(syncCompanyTenantMap),
}));

export const programTemplatesRelations = relations(programTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [programTemplates.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [programTemplates.createdBy], references: [users.id] }),
  scoringRuns: many(scoringRuns),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  tenant: one(tenants, { fields: [auditLog.tenantId], references: [tenants.id] }),
  actor: one(users, { fields: [auditLog.actorId], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  criticalPositions: many(criticalPositions),
  candidates: many(candidates),
}));

export const positionsRelations = relations(positions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [positions.tenantId], references: [tenants.id] }),
  syncPosition: one(syncPositions, { fields: [positions.syncPositionId], references: [syncPositions.id] }),
  criticalPositions: many(criticalPositions),
}));

export const criticalPositionsRelations = relations(criticalPositions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [criticalPositions.tenantId], references: [tenants.id] }),
  position: one(positions, { fields: [criticalPositions.positionId], references: [positions.id] }),
  creator: one(users, { fields: [criticalPositions.createdBy], references: [users.id] }),
  criteria: many(criteria),
  scoringRuns: many(scoringRuns),
  analysisResults: many(analysisResults),
}));

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [candidates.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [candidates.createdBy], references: [users.id] }),
  analysisResults: many(analysisResults),
  positionHistory: many(candidatePositionHistory),
}));

export const candidatePositionHistoryRelations = relations(candidatePositionHistory, ({ one }) => ({
  candidate: one(candidates, { fields: [candidatePositionHistory.candidateId], references: [candidates.id] }),
  syncEmployeePosition: one(syncEmployeePositions, {
    fields: [candidatePositionHistory.syncEmployeePositionId],
    references: [syncEmployeePositions.id],
  }),
}));

export const criteriaRelations = relations(criteria, ({ one }) => ({
  position: one(criticalPositions, { fields: [criteria.positionId], references: [criticalPositions.id] }),
  sourceTemplate: one(programTemplates, {
    fields: [criteria.sourceTemplateId],
    references: [programTemplates.id],
  }),
}));

export const scoringRunsRelations = relations(scoringRuns, ({ one, many }) => ({
  position: one(positions, { fields: [scoringRuns.positionId], references: [positions.id] }),
  tenant: one(tenants, { fields: [scoringRuns.tenantId], references: [tenants.id] }),
  creator: one(users, { fields: [scoringRuns.createdBy], references: [users.id] }),
  programTemplate: one(programTemplates, {
    fields: [scoringRuns.programTemplateId],
    references: [programTemplates.id],
  }),
  results: many(analysisResults),
}));

export const analysisResultsRelations = relations(analysisResults, ({ one }) => ({
  run: one(scoringRuns, { fields: [analysisResults.runId], references: [scoringRuns.id] }),
  position: one(positions, { fields: [analysisResults.positionId], references: [positions.id] }),
  candidate: one(candidates, { fields: [analysisResults.candidateId], references: [candidates.id] }),
  calculator: one(users, { fields: [analysisResults.calculatedBy], references: [users.id] }),
}));

// ── Chat Messages (per user per scoring run) ─────────────────────
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull().references(() => scoringRuns.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_chat_messages_run').on(table.runId),
    index('idx_chat_messages_user_run').on(table.userId, table.runId),
  ]
);

// ── Scoring sessions ──────────────────────────────────────────────────────
// Working state of one AHP+TOPSIS run while scoring-service computes it (the
// table name is from the removed LLM "AI Tournament", which used it for
// per-stage state). A session is transient; the run row is the record.
export const tournamentSessions = pgTable(
  'tournament_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    positionId: uuid('position_id').notNull().references(() => criticalPositions.id, { onDelete: 'cascade' }),
    programTemplateId: uuid('program_template_id').references(() => programTemplates.id, { onDelete: 'set null' }),
    label: varchar('label', { length: 255 }),
    targetFinalists: integer('target_finalists').notNull().default(10),
    // Every candidate ID (uuid strings) the run scores.
    currentPool: jsonb('current_pool').$type<string[]>().notNull(),
    // Always [] now; the engine still reads currentPool ∪ pendingPool.
    pendingPool: jsonb('pending_pool').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // 'ahp_topsis' is the only method. scoring-service refuses any other value
    // (the LLM tournament's 'sequential' was removed; drizzle/0097).
    scoringMethod: varchar('scoring_method', { length: 20 }).notNull().default('ahp_topsis'),
    /** Demo session (drizzle/0093): scoring-service scores the dupp overlay instead of `candidates`. */
    isDemo: boolean('is_demo').notNull().default(false),
    status: varchar('status', { length: 20 }).notNull().default('running'),
    // Engine progress (`ahpProgress`) and, mirrored from the run, `runInfo`.
    finalRanked: jsonb('final_ranked'),
    // The scoring run this session computes (placeholder until completed)
    runId: uuid('run_id').references(() => scoringRuns.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_tournament_sessions_tenant').on(table.tenantId),
    index('idx_tournament_sessions_position').on(table.positionId),
    index('idx_tournament_sessions_status').on(table.status),
    check('tournament_sessions_status_check', sql`status IN ('running', 'finalizing', 'completed', 'failed')`),
  ]
);

// ── Job Family: BERTopic topic-modeling runs + results ─────────────
// The downstream topic-modeling job over job_profile_embed. A standalone Python
// topic-service (FastAPI) reads the precomputed document vectors and runs the
// BERTopic pipeline (UMAP → HDBSCAN → tokenization → c-TF-IDF), writing results
// here while the web app polls the run row for progress — mirroring how
// scoring-service drives tournament_sessions. Topics/assignments are keyed by
// run_id so history is retained and the Family Tree view reads the latest
// completed run for the active scope.
//
// SCOPE: `tenant_id` NULL = a GLOBAL run over every embedded job profile (the
// original behaviour, and the baseline when a BU has too few documents to cluster
// on its own). A non-null tenant_id restricts the corpus to that tenant's
// documents (job_profile_tenants). Both kinds coexist; the admin picks which run
// a tenant's Family Tree reads.
/**
 * Jejak langkah pasca-clustering sebuah run. Setiap bidang boleh absen: yang
 * absen berarti langkahnya memang tidak diminta, bukan bahwa ia diam-diam
 * gagal — itulah bedanya dengan keadaan sebelum kolom ini ada.
 */
export type JobFamilyRunDiagnostics = {
  /** Penempatan ulang dokumen outlier (reduceOutliers). */
  outlierReduction?: {
    strategy: string;
    cascade: boolean;
    /**
     * Cascade benar-benar melintasi strategi. False saat diminta tetapi
     * dibatasi — ambang > 0 dikalibrasi untuk satu skala kemiripan saja.
     */
    cascadeApplied?: boolean;
    /** Kemiripan minimum agar sebuah outlier boleh dipindahkan (0..1). */
    threshold: number;
    before: number;
    after: number;
    reassigned: number;
    steps: {
      strategy: string;
      reassigned?: number;
      remaining?: number;
      /** Strategi ini tidak dijalankan, dengan alasannya. */
      skipped?: string;
      error?: string;
    }[];
  };
  /** Pemangkasan jumlah topik (nrTopics). */
  topicReduction?: {
    requested: number;
    before: number;
    after: number;
    note?: string | null;
    error?: string;
  };
  /** Penyusunan Family Tree; hanya diisi bila TIDAK terbentuk. */
  hierarchy?: { built: false; note?: string; error?: string };
  /** Parameter yang diminta tetapi tidak berpengaruh pada pipeline ini. */
  diversityIgnored?: string;
  /**
   * The corpus this run clustered (topic-service `corpus_fingerprint`; same
   * formula as lib/job-family/corpus.ts). Absent on runs built before it was
   * recorded.
   */
  corpus?: { fingerprint: string; documents: number };
  /**
   * What reproducing this run needs besides the corpus: the UMAP seed, the
   * document order, and the exact library versions (requirements.txt holds
   * ranges, so an image rebuild can move the map under the same seed).
   */
  reproducibility?: {
    randomState: number;
    documentOrder: string;
    versions: Record<string, string | null>;
  };
  /**
   * How much the published map depends on its UMAP seed: `cluster()` re-run
   * under `publishedSeed + 1 … + k` and compared by ARI, plus documents whose
   * family-mates change under most other seeds. Measured only — the map stays
   * the configured seed's. `{ error }` when the check itself failed.
   */
  seedStability?:
    | {
        publishedSeed: number;
        seeds: { seed: number; ari: number; topicCount: number; outlierCount: number }[];
        ariMean: number;
        ariMin: number;
        meanAgreement: number | null;
        agreementThreshold: number;
        unstableCount: number;
        unstableJobProfileIds: number[];
        unstableAgreement: number[];
      }
    | { error: string };
};

export const jobFamilyTopicRuns = pgTable(
  'job_family_topic_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL = global run over the whole corpus; else the tenant it was scoped to. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    /** pending | processing | completed | failed */
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    /** Live phase progress the topic-service updates as it runs: { phase, done, total, message }. */
    progress: jsonb('progress'),
    /** Snapshot of the BERTopic config used for this run (from lib/job-family-config.json). */
    config: jsonb('config'),
    /** BERTopic hierarchical_topics tree — drives the Family Tree visualization. */
    hierarchy: jsonb('hierarchy'),
    /** How many embedded documents entered the run. */
    numDocuments: integer('num_documents').default(0).notNull(),
    /** Number of topics found (excludes the -1 noise/outlier topic). */
    numTopics: integer('num_topics').default(0).notNull(),
    /** Embedding-model label the input vectors were produced with (audit). */
    embeddingModel: varchar('embedding_model', { length: 120 }),
    /** The config version (job_family_topic_configs) this run executed with. */
    configId: uuid('config_id'),
    /**
     * What the post-clustering steps actually did — outlier re-homing, topic
     * reduction, Family Tree construction (`JobFamilyRunDiagnostics`).
     *
     * All three may fail without failing the run, and until this column they
     * failed silently: a run read `completed` while the thing the user asked
     * for had not happened. A completed run is now only as good as this column
     * says it is, and the optimizer assistant explains a result from here
     * rather than inferring it from the numbers.
     */
    diagnostics: jsonb('diagnostics').$type<JobFamilyRunDiagnostics | null>(),
    /** Failure detail when status = 'failed'. */
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_job_family_topic_runs_status').on(table.status),
    index('idx_job_family_topic_runs_created').on(table.createdAt),
    index('idx_job_family_topic_runs_tenant').on(table.tenantId),
  ]
);

export type JobFamilyTopicRun = typeof jobFamilyTopicRuns.$inferSelect;
export type NewJobFamilyTopicRun = typeof jobFamilyTopicRuns.$inferInsert;

// One topic (job family) produced by a run. topicId -1 is the HDBSCAN
// noise/outlier bucket. `keywords` holds the c-TF-IDF representative words.
export const jobFamilyTopics = pgTable(
  'job_family_topics',
  {
    id: serial('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => jobFamilyTopicRuns.id, { onDelete: 'cascade' }),
    /** BERTopic topic number (-1 = outliers/noise). */
    topicId: integer('topic_id').notNull(),
    /** Human label (top c-TF-IDF words joined, or a generated name). */
    label: varchar('label', { length: 400 }),
    /** c-TF-IDF keywords for the topic: [{ word, score }]. */
    keywords: jsonb('keywords'),
    /** Number of documents in this topic. */
    size: integer('size').default(0).notNull(),
    /** Representative job_profile_id list (BERTopic representative_docs). */
    representativeDocIds: jsonb('representative_doc_ids'),
    /** 2-D centroid (mean of member doc coords) for the scatter view. */
    x: real('x'),
    y: real('y'),
    /**
     * Generalized "topic recognition" for this cluster (hybrid: aggregated
     * keywords + centroid reps + optional Gemini). Null on older runs → the UI
     * falls back to the keyword label. Internal sub-family nodes store theirs in
     * job_family_topic_runs.hierarchy (parentTitle/parentDescription).
     */
    generalTitle: varchar('general_title', { length: 300 }),
    generalDescription: text('general_description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_job_family_topics_run_topic').on(table.runId, table.topicId),
    index('idx_job_family_topics_run').on(table.runId),
  ]
);

export type JobFamilyTopic = typeof jobFamilyTopics.$inferSelect;
export type NewJobFamilyTopic = typeof jobFamilyTopics.$inferInsert;

// Per-document cluster assignment for a run: which topic each job profile
// landed in, its membership probability, and its 2-D projection coords. Keyed by
// job_profile_id (a snapshot — kept as a plain int, not an FK, so deleting a
// source profile never mutates historical run results).
export const jobFamilyTopicAssignments = pgTable(
  'job_family_topic_assignments',
  {
    id: serial('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => jobFamilyTopicRuns.id, { onDelete: 'cascade' }),
    jobProfileId: integer('job_profile_id').notNull(),
    positionName: varchar('position_name', { length: 300 }),
    divisionDepartment: varchar('division_department', { length: 300 }),
    /** Assigned topic number (-1 = noise). */
    topicId: integer('topic_id').notNull(),
    /** HDBSCAN membership probability (0..1). */
    probability: real('probability'),
    /** 2-D UMAP projection coords for the scatter view. */
    x: real('x'),
    y: real('y'),
    /**
     * Per-document "reason" it landed in this family (computed by the
     * topic-service): the family c-TF-IDF keywords `[{word, score}]` that occur
     * in this document. Null/[] on older runs.
     */
    matchedKeywords: jsonb('matched_keywords'),
    /** Cosine of this document's embedding to its family centroid (0..1). */
    centroidSimilarity: real('centroid_similarity'),
    /** Nearest ALTERNATIVE family (topic_id) by centroid cosine — borderline signal. */
    altTopicId: integer('alt_topic_id'),
    /** Cosine similarity to that alternative family's centroid (0..1). */
    altSimilarity: real('alt_similarity'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_job_family_topic_assign_run_profile').on(table.runId, table.jobProfileId),
    index('idx_job_family_topic_assign_run').on(table.runId),
    index('idx_job_family_topic_assign_topic').on(table.runId, table.topicId),
  ]
);

export type JobFamilyTopicAssignment = typeof jobFamilyTopicAssignments.$inferSelect;
export type NewJobFamilyTopicAssignment = typeof jobFamilyTopicAssignments.$inferInsert;

// Calculation trace of a map build (drizzle/0094): everything between the
// embedded documents and the persisted families that the fitted models held and
// the run row does not — UMAP's neighbour graph and bandwidths, HDBSCAN's trees,
// the c-TF-IDF counts and idf, the soft-membership matrix, re-homing
// similarities. Written by topic-service (app/trace.py) after the results are
// persisted; read by the "Unduh trace pembentukan peta" export
// (lib/job-family-trace/). `payload` is gzip(JSON).
export const jobFamilyTopicTraces = pgTable('job_family_topic_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => jobFamilyTopicRuns.id, { onDelete: 'cascade' }),
  formatVersion: integer('format_version').notNull(),
  payload: bytea('payload').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type JobFamilyTopicTrace = typeof jobFamilyTopicTraces.$inferSelect;

// ── Job Family: persisted BERTopic config versions ─────────────────
// The active BERTopic configuration the topic-service runs with, stored in the
// DB as the source of truth for the Configuration editor. VERSIONED: saving a
// changed parameter set inserts a new active row and deactivates the previous
// one, so every run's `config_id` points at the immutable version it actually
// ran with (the run also keeps a jsonb snapshot in `config`). `params` mirrors
// JobFamilyConfig.bertopic.
export const jobFamilyTopicConfigs = pgTable(
  'job_family_topic_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * NULL = the global default config. A non-null tenant_id is a per-tenant
     * override — needed because BERTopic parameters that suit a 275-document
     * corpus (min_cluster_size, n_neighbors) collapse a 30-document one into
     * all-outliers, so small BUs must be tunable independently.
     */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    /** Optional label (e.g. 'active', or a preset name). */
    name: varchar('name', { length: 120 }),
    /** The BERTopic parameter object (JobFamilyConfig.bertopic). */
    params: jsonb('params').notNull(),
    /** Hash of params — lets a save skip inserting an identical version. */
    contentHash: varchar('content_hash', { length: 64 }),
    /** Exactly one row is the active config consumed by the next run. */
    isActive: boolean('is_active').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_job_family_topic_configs_active').on(table.isActive),
    index('idx_job_family_topic_configs_created').on(table.createdAt),
    index('idx_job_family_topic_configs_tenant').on(table.tenantId),
  ]
);

export type JobFamilyTopicConfig = typeof jobFamilyTopicConfigs.$inferSelect;
export type NewJobFamilyTopicConfig = typeof jobFamilyTopicConfigs.$inferInsert;

// ── Job Family optimizer: the measurement behind an applied setting (drizzle/0090) ──
// The optimizer applies a BERTopic setting only after topic-service measured it
// on the current corpus. This row keeps that measurement so the run later built
// with the setting — right away, or from the map page days later — can be
// checked against it (`verifyRun` in lib/job-family/optimize/measured.ts).
// Looked up by `config_hash` (sha256 of `configKey(bertopic)`), not by config
// version id: saving the template creates a new version with the same
// parameters, and the expectation still applies to it. Append-only.
export const jobFamilyOptimizationExpectations = pgTable(
  'job_family_optimization_expectations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** OptimizeGoal the setting was chosen for. */
    goal: varchar('goal', { length: 40 }).notNull(),
    configHash: varchar('config_hash', { length: 64 }).notNull(),
    /** The full BERTopic config that was applied (JobFamilyConfig.bertopic). */
    bertopic: jsonb('bertopic').notNull(),
    /** Corpus fingerprint the measurement was made on (lib/job-family/corpus.ts). */
    corpusFingerprint: varchar('corpus_fingerprint', { length: 64 }).notNull(),
    corpusDocuments: integer('corpus_documents').notNull(),
    /** strict_outliers' similarity bar; null for other goals. */
    threshold: real('threshold'),
    /** MeasuredMetrics of the setting in force before, and of the applied one. */
    baseline: jsonb('baseline').notNull(),
    predicted: jsonb('predicted').notNull(),
    /** GoalVerdict as measured. */
    verdict: jsonb('verdict').notNull(),
    regressions: jsonb('regressions').notNull(),
    /** Display name / email; null for the local System User. */
    createdBy: varchar('created_by', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_jf_opt_expectations_hash_created').on(table.configHash, table.createdAt)],
);

// ── Encryption key material (drizzle/0046_app_encryption_keys.sql) ───────────
// Holds the DATA key sealed under the MASTER key the user holds. The master key
// is never persisted anywhere — losing it makes every value encrypted under
// this DEK permanently unreadable, which is the point.
export const appEncryptionKeys = pgTable(
  'app_encryption_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    label: varchar('label', { length: 80 }).default('default').notNull(),
    /** The 32-byte DEK, sealed under the master key. */
    wrappedDek: text('wrapped_dek').notNull(),
    /** A fixed known string sealed under the DEK — proves a master key is right. */
    verifier: text('verifier').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // The "at most one active row" rule is a partial unique index created in the
  // migration; Drizzle cannot express `UNIQUE ((is_active)) WHERE is_active`, so
  // it is intentionally absent here. Do not "fix" this by adding a plain unique
  // index — that would forbid more than one INACTIVE row and break rotation.
  () => []
);

export type AppEncryptionKey = typeof appEncryptionKeys.$inferSelect;

// ── MSSQL source connections (drizzle/0047_sync_source_connections.sql) ──────
// UI-editable replacements for DB_MPMDS_* / DB_MPMHRGA_*. An absent or inactive
// row means "fall back to the environment variables", so an untouched
// deployment behaves exactly as before.
export const syncSourceConnections = pgTable(
  'sync_source_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'MPMDS' | 'MPMHRGA' */
    sourceKey: varchar('source_key', { length: 20 }).notNull(),
    server: varchar('server', { length: 255 }).notNull(),
    port: integer('port').default(1433).notNull(),
    username: varchar('username', { length: 128 }).notNull(),
    /** Sealed with the data key. NULL means "no password here — use the env var". */
    passwordEncrypted: text('password_encrypted'),
    databaseName: varchar('database_name', { length: 128 }).notNull(),
    encrypt: boolean('encrypt').default(true).notNull(),
    trustServerCertificate: boolean('trust_server_certificate').default(true).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_source_connections_key').on(table.sourceKey),
    check('sync_source_connections_key_check', sql`source_key IN ('MPMDS', 'MPMHRGA')`),
  ]
);

export type SyncSourceConnection = typeof syncSourceConnections.$inferSelect;
export type SyncSourceKey = 'MPMDS' | 'MPMHRGA';

// ── Agent Studio ───────────────────────────────────────────────────
// Satu perintah bahasa alami user → rencana → eksekusi bertahap → jawaban.
// Rancangan lengkap: docs/agent-studio.md (modul M8).
//
// Tiga tabel, dan alasan pemisahannya:
//
// DELETED FROM MAIN — the /studio Agent Studio these six tables served was a
// throwaway prototype and now lives on branch `parked/agent-studio`. See
// docs/agent-studio-parked.md.
//
// The tables exist in every deployed database (drizzle/0047, 0049, 0050, 0062)
// and still hold whatever the last session wrote — including configuration
// changes a person applied (`agent_config_proposals`) and preferences a person
// stated (`agent_memories`). Nothing was dropped.
// The DEFINITIONS below are deliberately kept even though nothing on main reads
// them. Removing a table from the schema does not drop it — it only makes
// Drizzle stop knowing about a table that is still there, and `drizzle-kit push`
// compares schema against database, so an unmodelled table becomes a DROP
// proposal against real data. They stay modelled so that stays safe.
//
// `agent_sessions.scope` (drizzle/0062) was added for the Job Family optimizer,
// which is live.
//   agent_sessions   — utas percakapan. Beberapa perintah berturut-turut milik
//                      satu sesi, sehingga riwayat Studio bisa dibuka kembali.
//
//   agent_runs       — SATU perintah user beserta rencana yang disusun planner
//                      dan jawaban akhirnya. Rencana disimpan utuh sebagai jsonb
//                      supaya sebuah run bisa diaudit dan diputar ulang persis
//                      seperti saat dijalankan, meski registry sudah berubah.
//
//   agent_run_steps  — satu baris per langkah. Terpisah dari `plan` karena
//                      langkah punya SIKLUS HIDUP sendiri (pending → running →
//                      polling → done) dan dimutasi berkali-kali oleh tick loop.
//                      Menyimpannya di dalam jsonb rencana berarti menulis ulang
//                      seluruh rencana tiap detak, dan dua tab yang membuka run
//                      yang sama akan saling menimpa.
//
// Kenapa state ada di Postgres, bukan di memori: eksekusi digerakkan oleh
// pemanggilan berulang dari klien (lihat docs/agent-studio.md §1.1), jadi tiap
// detak adalah request yang berbeda. Tab yang tertutup menghentikan detak, bukan
// menghilangkan run — ia dilanjutkan saat dibuka lagi.
export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    title: varchar('title', { length: 255 }),
    /**
     * TIDAK DIPAKAI. Disiapkan untuk membatasi sebuah sesi pada satu bidang
     * pekerjaan, ketika panel Optimasi Job Family masih berupa percakapan.
     * Panel itu kini berupa tombol dan tidak memakai agent sama sekali, sehingga
     * tidak ada lagi yang menulis kolom ini — nilainya selalu NULL.
     *
     * Dibiarkan ada karena migrasi 0062 mungkin sudah diterapkan, dan sebuah
     * kolom nullable yang tidak dibaca siapa pun jauh lebih murah daripada
     * migrasi penghapusan yang harus benar di setiap deployment.
     */
    scope: varchar('scope', { length: 40 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_agent_sessions_tenant_user').on(table.tenantId, table.userId),
    index('idx_agent_sessions_scope').on(table.tenantId, table.userId, table.scope),
  ]
);

export type AgentRunStatus =
  /** Rencana tersusun, menunggu user menekan "Jalankan". */
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  /** Planner mengembalikan pertanyaan, bukan rencana — tidak ada yang dijalankan. */
  | 'needs_clarification';

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    /** Perintah user, apa adanya. */
    query: text('query').notNull(),
    /** Rencana hasil planner (lib/agent/plan/schema.ts: Plan). */
    plan: jsonb('plan'),
    /** Model + varian aturan yang menyusunnya — agar hasil dapat direproduksi. */
    plannerModel: varchar('planner_model', { length: 120 }),
    status: varchar('status', { length: 30 }).notNull().default('awaiting_approval'),
    /** Kartu jawaban akhir (lib/agent/present/answer.ts: AnswerCard). */
    answer: jsonb('answer'),
    error: text('error'),
    /**
     * Pagu eksekusi: { maxSteps, maxTicks, ticksUsed, startedAt }. Disimpan per-run
     * agar sebuah run yang macet berhenti sendiri, bukan berdetak selamanya.
     */
    budget: jsonb('budget'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
  },
  (table) => [
    index('idx_agent_runs_session').on(table.sessionId),
    index('idx_agent_runs_tenant_user').on(table.tenantId, table.userId),
    index('idx_agent_runs_status').on(table.status),
    check(
      'agent_runs_status_check',
      sql`status IN ('awaiting_approval', 'running', 'completed', 'failed', 'cancelled', 'needs_clarification')`
    ),
  ]
);

export type AgentStepStatus =
  | 'pending'
  /** Sedang dieksekusi oleh sebuah detak — juga kunci anti eksekusi ganda. */
  | 'running'
  /** Sudah dimulai di layanan lain; menunggu selesai (scoring, clustering). */
  | 'polling'
  | 'done'
  | 'failed'
  | 'skipped';

export const agentRunSteps = pgTable(
  'agent_run_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
    /** Id langkah di dalam rencana, mis. "s1". Unik per run. */
    stepId: varchar('step_id', { length: 40 }).notNull(),
    /** Urutan kemunculan — menentukan langkah mana yang dieksekusi lebih dulu. */
    seq: integer('seq').notNull(),
    toolId: varchar('tool_id', { length: 80 }).notNull(),
    /** Parameter mentah dari rencana, rujukan "$s1.runId" masih utuh. */
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
    /** Parameter setelah rujukan diselesaikan — inilah yang benar-benar dikirim. */
    resolvedParams: jsonb('resolved_params'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    /** auto | confirm — diturunkan dari effectClass manifest, bukan dari LLM. */
    gate: varchar('gate', { length: 10 }).notNull().default('auto'),
    /**
     * State milik adapter di antara dua detak, mis. { sessionId } sebuah sesi
     * scoring yang masih berjalan. Inilah yang membuat langkah panjang tidak memblokir.
     */
    externalRef: jsonb('external_ref'),
    progress: text('progress'),
    output: jsonb('output'),
    error: text('error'),
    attempt: integer('attempt').notNull().default(0),
    /**
     * Kapan langkah ini dikonfirmasi user. Hanya relevan bagi langkah ber-gate
     * 'confirm'. Langkah yang parameternya sudah konkret saat rencana ditinjau
     * dicap pada persetujuan awal; yang parameternya masih berupa rujukan
     * ($s1.runId) menunggu sampai nilainya nyata, lalu ditanyakan ulang.
     */
    approvedAt: timestamp('approved_at'),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_agent_run_steps_run_step').on(table.runId, table.stepId),
    index('idx_agent_run_steps_run_seq').on(table.runId, table.seq),
    check(
      'agent_run_steps_status_check',
      sql`status IN ('pending', 'running', 'polling', 'done', 'failed', 'skipped')`
    ),
  ]
);

export type AgentSession = typeof agentSessions.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type AgentRunStep = typeof agentRunSteps.$inferSelect;

// ── Agent Studio: usulan perubahan konfigurasi (M9) ────────────────
// Konfigurasi di aplikasi ini berlaku global per unit bisnis (bobot AHP, ambang
// readiness, parameter BERTopic, prompt scoring), dan kepatuhan agent pada
// kebijakan konfigurasi adalah satu-satunya kemampuannya yang terukur di bawah
// 100%. Maka agent TIDAK PERNAH menulis konfigurasi: ia menulis USULAN — diff
// yang menunggu ditinjau — dan manusia pemegang governance.manage yang
// menerapkannya.
//
// `base` direkam saat usulan dibuat dan diperiksa ulang saat diterapkan: bila
// nilai yang hendak diubah sudah berubah oleh orang lain sejak usulan disusun,
// penerapan ditolak alih-alih menimpa perubahan yang tidak pernah dilihat
// peninjau. `previous` direkam saat penerapan, sehingga setiap usulan yang
// diterapkan dapat dibatalkan kembali persis ke keadaan sebelumnya.
export type AgentProposalDomain =
  | 'bertopic'
  | 'ahp_weights'
  | 'readiness'
  | 'scoring_prompt'
  | 'program_criteria'
  /** Aturan filter: siapa yang BOLEH dinilai (bukan bobot penilaian). */
  | 'program_filter_rules'
  /** Template restrukturisasi dokumen job profile, per-dokumen. */
  | 'restructure_template';

export type AgentProposalStatus = 'pending' | 'applied' | 'rejected' | 'rolled_back';

export const agentConfigProposals = pgTable(
  'agent_config_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    /** Run agent yang melahirkan usulan ini; null bila run-nya sudah dihapus. */
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    domain: varchar('domain', { length: 40 }).notNull(),
    /** Sasaran spesifik domain: id program template (ahp/criteria), key prompt. */
    targetId: varchar('target_id', { length: 120 }),
    /** Perubahan yang diusulkan — hanya field yang berubah. */
    patch: jsonb('patch').notNull(),
    /** Nilai field-field itu SAAT USULAN DIBUAT — bahan diff + deteksi basi. */
    base: jsonb('base'),
    rationale: text('rationale').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    /** Nilai penuh yang ditimpa SAAT DITERAPKAN — bahan pembatalan. */
    previous: jsonb('previous'),
    appliedBy: uuid('applied_by').references(() => users.id, { onDelete: 'set null' }),
    appliedAt: timestamp('applied_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_agent_config_proposals_tenant_status').on(table.tenantId, table.status),
    index('idx_agent_config_proposals_run').on(table.runId),
    check(
      'agent_config_proposals_status_check',
      sql`status IN ('pending', 'applied', 'rejected', 'rolled_back')`
    ),
    check(
      'agent_config_proposals_domain_check',
      sql`domain IN ('bertopic', 'ahp_weights', 'readiness', 'scoring_prompt', 'program_criteria', 'program_filter_rules', 'restructure_template')`
    ),
  ]
);

export type AgentConfigProposal = typeof agentConfigProposals.$inferSelect;

// ── Agent Studio: memori preferensi + resep (M10/M14) ──────────────
// Dua bentuk "ingatan" dengan sumber dan masa hidup berbeda:
//
//   agent_memories — preferensi yang dinyatakan user kepada agent ("jangan
//   sertakan kandidat unit lain kecuali diminta"). Disuntikkan ke prompt
//   planner pada SETIAP perencanaan milik user itu. Dua syarat dari dokumen
//   rencana ditegakkan strukturnya: TERLIHAT (ada panelnya di Studio) dan
//   BISA DIHAPUS (hapus = delete baris) — preferensi yang tak terlihat dan tak
//   bisa dicabut adalah sumber keluhan "kenapa hasilnya aneh".
//
//   agent_recipes — rencana yang berhasil, disimpan untuk dijalankan ulang.
//   Menyimpan RENCANA (bukan hasil): pemutaran ulang membuat run baru yang
//   divalidasi ulang terhadap registry, izin, dan prasyarat HARI INI — resep
//   berumur enam bulan yang menunjuk tool yang sudah berubah harus ditolak
//   validator, bukan dijalankan membabi buta.
export const agentMemories = pgTable(
  'agent_memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    /** Pemilik: preferensi bersifat per-orang, bukan per-tenant. */
    userId: uuid('user_id').notNull().references(() => users.id),
    content: varchar('content', { length: 500 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_agent_memories_tenant_user').on(table.tenantId, table.userId)]
);

export const agentRecipes = pgTable(
  'agent_recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    /** Rencana tersimpan (lib/agent/plan/schema.ts: Plan) — apa adanya. */
    plan: jsonb('plan').notNull(),
    /** Run asal resep ini disimpan; null bila run-nya sudah dihapus. */
    sourceRunId: uuid('source_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_agent_recipes_tenant').on(table.tenantId)]
);

export type AgentMemory = typeof agentMemories.$inferSelect;
export type AgentRecipe = typeof agentRecipes.$inferSelect;

// ── Talent 5-Box (talent succession staging + validation) ──────────────
// DELETED FROM MAIN — the /talent feature these six tables served was a
// throwaway prototype and now lives on branch `parked/talent-5box`. See
// docs/talent-5box-parked.md.
//
// ONE EXCEPTION, since drizzle/0078: `talent_audit_logs` is live again. The
// Talent Mapping page (/talent-pool/mapping — the 16-box HAV map of the Talent
// Pool, docs/talent-mapping.md) records every manual move there, told apart from
// the prototype's 5-Box rows by `mapping_kind`. The other five tables are still
// unread.
//
// The tables exist in every deployed database (drizzle/0055_talent_succession.sql)
// and still hold whatever the last staging build wrote — including human
// validation decisions in `talent_audit_logs`. Nothing was dropped.
// The DEFINITIONS below are deliberately kept even though nothing on main reads
// them. Removing a table from the schema does not drop it — it only makes
// Drizzle stop knowing about a table that is still there, and `drizzle-kit push`
// compares schema against database, so an unmodelled table becomes a DROP
// proposal against real data. They stay modelled so that stays safe.
//
// sync-service never imported from here: its talent jobs carried their own
// `TalentBox` / `DEFAULT_TALENT_BOX_CONFIG`, and those files went with the branch.
// Digitizes Talent Management System Stage 1 (data preparation) and Stage 2
// (talent data validation): sync-owned raw data is merged per employee into
// `talent_data_staging` (keyed by tenant + employee_id), the rule-based engine
// (was sync-service/src/services/talent-box-engine.ts, now on branch
// `parked/talent-5box`) computes Performance /
// Potential scores and `system_recommended_box`, and HC / division heads
// validate via the Talent Matrix UI. Every override lands in
// `talent_audit_logs` (the dedicated audit trail — separate from audit_log,
// which records app-level actions).
//
// The engine reuses the repo's existing PA convention (letters A-E, see
// `PA_GRADE_VALUES` in scoring-service/src/pa-score.ts — formerly `PA_SCORE_MAP`
// in scoring-engine.ts, which mapped letters straight to 0-100 and has been
// removed): performance rows are letters in the source DBs, and an unknown grade
// reads as null so the staging row is flagged `missing_pa` instead of quietly
// scoring a made-up value. That flag is the right instinct — the removed scorer
// did the opposite and returned a passing 60 for a missing record.

export type TalentLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type TalentBox = 'TOP' | 'STRONG' | 'SOLID' | 'BORDER' | 'BOTTOM';

/** Tenant-scoped 5-Box thresholds & weights (editable via the Talent UI). */
export type TalentBoxConfig = {
  /** PA score at/above which performance counts as HIGH. */
  performanceHigh: number;
  /** PA score at/above which performance counts as MEDIUM (below = LOW). */
  performanceMedium: number;
  /** Potential score at/above which potential counts as HIGH. */
  potentialHigh: number;
  /** Potential score at/above which potential counts as MEDIUM (below = LOW). */
  potentialMedium: number;
  /** Weights of the Performance_Score weighted average (current, year-1, year-2). */
  paWeights: { current: number; year1: number; year2: number };
  /** Weights of the Potential_Score blend (assessment center, competency). */
  potentialWeights: { assessmentCenter: number; competency: number };
};

export const DEFAULT_TALENT_BOX_CONFIG: TalentBoxConfig = {
  performanceHigh: 75,
  performanceMedium: 60,
  potentialHigh: 75,
  potentialMedium: 60,
  paWeights: { current: 0.5, year1: 0.3, year2: 0.2 },
  potentialWeights: { assessmentCenter: 0.7, competency: 0.3 },
};

// ── Unified talent data (Stage 1 output + validation state) ───────────
export const talentDataStaging = pgTable(
  'talent_data_staging',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    /** Stable join key across sync_employees / sync_performance_appraisals / candidates. */
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    companyId: varchar('company_id', { length: 10 }),
    name: varchar('name', { length: 200 }),
    department: varchar('department', { length: 200 }),
    division: varchar('division', { length: 200 }),
    positionTitle: varchar('position_title', { length: 300 }),
    gradeId: varchar('grade_id', { length: 20 }),
    entryDate: date('entry_date'),
    // ── EDP inputs (per-employee merge of sync_* rows) ──
    /** Average of S1/S2 for the CURRENT appraisal year (letter A-E or null). */
    paCurrentYear: varchar('pa_current_year', { length: 10 }),
    paYear1: varchar('pa_year1', { length: 10 }),
    paYear2: varchar('pa_year2', { length: 10 }),
    /** Past Talent Mapping status (e.g. TOP/STRONG/...) from EDP, if any. */
    pastTalentMapping: varchar('past_talent_mapping', { length: 30 }),
    pastTalentMappingYear: integer('past_talent_mapping_year'),
    /** Count of RTC records (Ready-to-Continue readiness programs attended). */
    rtcCount: integer('rtc_count').notNull().default(0),
    rtcHistory: jsonb('rtc_history').$type<{ year: number | null; name: string | null; status: string | null }[]>().notNull().default(sql`'[]'::jsonb`),
    // ── SDP / Orange inputs ──
    /** Assessment Center score (0-100) averaged from sync_assessment_center. */
    assessmentCenterScore: numeric('assessment_center_score', { precision: 5, scale: 2 }),
    assessmentCenterDate: timestamp('assessment_center_date', { withTimezone: true }),
    /** Average technical-competency rating (1-4 scale, x25 → 0-100). */
    competencyScore: numeric('competency_score', { precision: 5, scale: 2 }),
    competencyCount: integer('competency_count').notNull().default(0),
    // ── Engine output (FEATURE B) ──
    performanceScore: numeric('performance_score', { precision: 5, scale: 2 }),
    potentialScore: numeric('potential_score', { precision: 5, scale: 2 }),
    performanceLevel: varchar('performance_level', { length: 10 }).$type<TalentLevel>(),
    potentialLevel: varchar('potential_level', { length: 10 }).$type<TalentLevel>(),
    systemRecommendedBox: varchar('system_recommended_box', { length: 10 }).$type<TalentBox>(),
    // ── Missing-data flags (graceful degradation, surfaced in the UI) ──
    missingPa: boolean('missing_pa').notNull().default(false),
    missingAssessment: boolean('missing_assessment').notNull().default(false),
    missingCompetency: boolean('missing_competency').notNull().default(false),
    // ── Validation state (Stage 2, set by HC / division head) ──
    finalValidatedBox: varchar('final_validated_box', { length: 10 }).$type<TalentBox>(),
    finalValidatedBy: uuid('final_validated_by').references(() => users.id, { onDelete: 'set null' }),
    finalValidatedAt: timestamp('final_validated_at', { withTimezone: true }),
    justificationReason: text('justification_reason'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_talent_data_staging_tenant_employee').on(table.tenantId, table.employeeId),
    index('idx_talent_data_staging_tenant_box').on(table.tenantId, table.systemRecommendedBox),
    index('idx_talent_data_staging_tenant_validated').on(table.tenantId, table.finalValidatedBox),
    index('idx_talent_data_staging_division').on(table.division),
    index('idx_talent_data_staging_employee').on(table.employeeId),
    check(
      'talent_data_staging_box_check',
      sql`system_recommended_box IS NULL OR system_recommended_box IN ('TOP', 'STRONG', 'SOLID', 'BORDER', 'BOTTOM')`
    ),
    check(
      'talent_data_staging_validated_check',
      sql`final_validated_box IS NULL OR final_validated_box IN ('TOP', 'STRONG', 'SOLID', 'BORDER', 'BOTTOM')`
    ),
  ]
);

export type TalentDataStaging = typeof talentDataStaging.$inferSelect;
export type NewTalentDataStaging = typeof talentDataStaging.$inferInsert;

// ── Talent validation audit trail (FEATURE D.4) ──────────────────────
// Every box change — override or re-validation to the same box — is a row:
// who changed it, from which box to which, the required justification when
// the boxes differ, and when. History is never rewritten; a corrected mistake
// is a new row.
//
// Two kinds of row share it since drizzle/0078, told apart by `mapping_kind`:
//   'five_box' — the parked 5-Box prototype: employee_id + old/new_box.
//   'hav16'    — Talent Mapping: every change to a candidate's HAV — by hand,
//                or by a sync that changed the automatic answer (and with it,
//                possibly, superseded a hand placement). Together they are the
//                ORDER of sync and manual events, which is what decides which
//                one is in force. old/new_box stay NULL (the 5-Box is derivable
//                from the quadrant, and storing it in plaintext beside an
//                encrypted quadrant would leak the half that matters); the
//                quadrants, the automatic answer at the time and the
//                justification are SEALED like `candidates.hav_quadrant`.
// Who did it — `changed_by_user_id` plus a `changed_by_username` snapshot that
// survives the user row being deleted, or `sync:<job>` for a sync — and when
// stay plaintext, because "who moved this person, and when" is exactly what the
// trail exists to answer.
export type TalentMappingKind = 'five_box' | 'hav16';
/**
 * 'manual_place'          a placement was written by a reviewer.
 * 'revert_to_automatic'   a reviewer removed it; the upload/formula applies again.
 * 'superseded_by_upload'  a HAV upload (UI file or shared HAV.xlsx) changed the
 *                         candidate's uploaded quadrant AFTER their hand placement,
 *                         which therefore stops applying (sync-service).
 * 'superseded_by_sync'    the same, caused by the candidate sync carrying a new
 *                         PA/BA (from the MSSQL syncs) that moved the formula.
 * 'automatic_changed'     a sync changed the automatic HAV of a candidate who had
 *                         no hand placement — recorded so the trail shows every
 *                         sync event, not only the ones that displaced somebody.
 * 'formula_applied'       a reviewer edited PA/BA on the Kandidat form or pressed
 *                         "Hitung kuadran HAV", putting the formula in force
 *                         (drizzle/0098); no hand placement was displaced.
 * 'superseded_by_formula' the same, AFTER a hand placement, which therefore
 *                         stops applying.
 */
export type TalentMappingAuditAction =
  | 'manual_place'
  | 'revert_to_automatic'
  | 'superseded_by_upload'
  | 'superseded_by_sync'
  | 'automatic_changed'
  | 'formula_applied'
  | 'superseded_by_formula';
/**
 * Which sync changed a candidate's automatic HAV (`candidates.hav_auto_change_source`):
 * 'hav_upload'     a HAV workbook uploaded on Sinkronisasi (any day, not only the Monday cron);
 * 'hav_folder'     HAV.xlsx re-read from LOCAL_HAV_FOLDER;
 * 'candidate_sync' candidate-populate (Monday cron or on demand) writing a
 *                  CHANGED PA or BA (pins the formula, drizzle/0098);
 * 'pa_ba_upload'   the same, run straight after a PA or BA workbook upload;
 * 'candidate_edit' PA or BA edited on the Kandidat form (web app);
 * 'hav_formula'    "Hitung kuadran HAV" on the Kandidat form (web app).
 */
export type HavAutoChangeOrigin =
  | 'hav_upload'
  | 'hav_folder'
  | 'candidate_sync'
  | 'pa_ba_upload'
  | 'candidate_edit'
  | 'hav_formula';
/** What a manual placement overrode: the HAV upload, else the formula, else nothing. */
export type TalentMappingBaselineSource = 'upload' | 'formula' | 'none';

export const talentAuditLogs = pgTable(
  'talent_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    oldBox: varchar('old_box', { length: 10 }).$type<TalentBox>(),
    /** NOT NULL until drizzle/0078; null on 'hav16' rows (see above). */
    newBox: varchar('new_box', { length: 10 }).$type<TalentBox>(),
    /** Mandatory when new_box != system_recommended_box (enforced in the action). ENCRYPTED on 'hav16' rows. */
    justificationReason: text('justification_reason'),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    // ── drizzle/0078: Talent Mapping (16-box HAV) ──
    mappingKind: varchar('mapping_kind', { length: 20 }).$type<TalentMappingKind>().default('five_box').notNull(),
    /** SET NULL, not CASCADE: an audit row must outlive what it describes. */
    candidateId: uuid('candidate_id').references(() => candidates.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 30 }).$type<TalentMappingAuditAction>(),
    /** ENCRYPTED "1".."16"; null = the candidate was not on the map before the move. */
    oldQuadrant: text('old_quadrant'),
    /** ENCRYPTED "1".."16"; null = the move cleared the placement and nothing automatic places them. */
    newQuadrant: text('new_quadrant'),
    /**
     * ENCRYPTED — the AUTOMATIC answer at the moment of the move (upload, else
     * formula; drizzle/0079 renamed it from formula_quadrant). Null = none.
     */
    baselineQuadrant: text('baseline_quadrant'),
    /** Which automatic source `baseline_quadrant` came from. Null on 'five_box' rows. */
    baselineSource: varchar('baseline_source', { length: 10 }).$type<TalentMappingBaselineSource>(),
    /** Login identity of the actor at the time (the SSO email in this deployment). */
    changedByUsername: varchar('changed_by_username', { length: 255 }),
  },
  (table) => [
    index('idx_talent_audit_tenant_timestamp').on(table.tenantId, table.timestamp),
    index('idx_talent_audit_employee').on(table.employeeId),
    index('idx_talent_audit_candidate').on(table.candidateId),
    index('idx_talent_audit_kind_tenant').on(table.tenantId, table.mappingKind, table.timestamp),
    check('talent_audit_logs_kind_check', sql`mapping_kind IN ('five_box', 'hav16')`),
  ]
);

export type TalentAuditLog = typeof talentAuditLogs.$inferSelect;
export type NewTalentAuditLog = typeof talentAuditLogs.$inferInsert;

// ── Talent Mapping: manual 16-box placements (drizzle/0078, 0079) ────
// The CURRENT manual placement of a candidate on the HAV 16-box, one row per
// candidate — the top tier of the HAV in force (lib/hav-effective.ts: manual >
// upload > formula), read by the eligibility rules, both scoring engines, the
// candidate profile and Beranda. Moving someone back onto the AUTOMATIC square
// (the upload, else the formula) DELETES the row rather than storing a
// placement equal to it, so they follow the automatic answer again when it
// changes.
//
// ORDER decides, by timestamp (drizzle/0080): a placement is in force only while
// its `updated_at` is NEWER than `candidates.hav_auto_changed_at` — the last
// time a sync (HAV upload, shared HAV.xlsx, or the candidate sync carrying a new
// PA/BA from MSSQL) changed the automatic answer. The sync that moves that clock
// also deletes the older row and logs 'superseded_by_upload' / '_by_sync'; the
// read-time comparison is what keeps the answer right if those two ever race.
// `updated_at` is written with the database's now(), never the web container's
// clock, because it is compared against a clock the database wrote.
//
// `baseline_quadrant` + `baseline_source` are the automatic answer at the moment
// of placement. They are how the page can say "this was decided against an
// automatic answer that has since moved" — the decision is still in force, but
// no longer for the reason it was made.
//
// History lives in `talent_audit_logs` ('hav16' rows); this table is state.
// quadrant / baseline_quadrant / justification are ENCRYPTED, for the same
// reason `candidates.hav_quadrant` is: which box a named person sits in is the
// datum this table exists to hold.
export const talentMappingPlacements = pgTable(
  'talent_mapping_placements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
    /** ENCRYPTED "1".."16". */
    quadrant: text('quadrant').notNull(),
    /** ENCRYPTED "1".."16" — the automatic answer this placement overrode; null = there was none. */
    baselineQuadrant: text('baseline_quadrant'),
    baselineSource: varchar('baseline_source', { length: 10 })
      .$type<TalentMappingBaselineSource>()
      .default('none')
      .notNull(),
    /** ENCRYPTED. Mandatory — every deviation from the automatic answer carries its reason. */
    justification: text('justification').notNull(),
    placedBy: uuid('placed_by').references(() => users.id, { onDelete: 'set null' }),
    placedByUsername: varchar('placed_by_username', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_talent_mapping_placements_candidate').on(table.tenantId, table.candidateId),
    check(
      'talent_mapping_placements_baseline_source_check',
      sql`baseline_source IN ('upload', 'formula', 'none')`
    ),
  ]
);

export type TalentMappingPlacement = typeof talentMappingPlacements.$inferSelect;
export type NewTalentMappingPlacement = typeof talentMappingPlacements.$inferInsert;

// ── Tenant-scoped 5-Box thresholds & weights ─────────────────────────
// One row per tenant. Absent row → DEFAULT_TALENT_BOX_CONFIG. Editable from
// the Talent page (governance.manage), so the same engine run can be
// re-interpreted under a different policy without touching the source data.
export const talentBoxConfigs = pgTable(
  'talent_box_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    performanceHigh: numeric('performance_high', { precision: 5, scale: 2 }).notNull(),
    performanceMedium: numeric('performance_medium', { precision: 5, scale: 2 }).notNull(),
    potentialHigh: numeric('potential_high', { precision: 5, scale: 2 }).notNull(),
    potentialMedium: numeric('potential_medium', { precision: 5, scale: 2 }).notNull(),
    /** { current, year1, year2 } PA weights (sum ≈ 1). */
    paWeights: jsonb('pa_weights').$type<{ current: number; year1: number; year2: number }>().notNull(),
    /** { assessmentCenter, competency } potential weights (sum ≈ 1). */
    potentialWeights: jsonb('potential_weights').$type<{ assessmentCenter: number; competency: number }>().notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_talent_box_configs_tenant').on(table.tenantId)]
);

export type TalentBoxConfigRow = typeof talentBoxConfigs.$inferSelect;
export type NewTalentBoxConfig = typeof talentBoxConfigs.$inferInsert;

// ── Sync: Talent Mapping history (EDP) ───────────────────────────────
// Past Talent Mapping assessments per employee, pulled from the EDP
// database by sync-service (defensive: the source table may not exist in a
// deployment yet — the sync reports 0 rows rather than failing).
export const syncTalentMappingHistory = pgTable(
  'sync_talent_mapping_history',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    /** Assessment year (tahun). */
    mappingYear: integer('mapping_year'),
    /** Past box / category reported by EDP (e.g. TOP / STRONG / ...). */
    mappingStatus: varchar('mapping_status', { length: 30 }),
    note: text('note'),
    sourceTable: varchar('source_table', { length: 120 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_talent_mapping_history').on(table.companyId, table.employeeId, table.mappingYear),
    index('idx_sync_talent_mapping_employee').on(table.employeeId),
  ]
);

// ── Sync: RTC history (EDP) ──────────────────────────────────────────
// Historical RTC (Ready to Continue / readiness) program records per
// employee, from EDP.
export const syncRtcHistory = pgTable(
  'sync_rtc_history',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    rtcYear: integer('rtc_year'),
    rtcName: varchar('rtc_name', { length: 255 }),
    rtcStatus: varchar('rtc_status', { length: 50 }),
    rtcDate: timestamp('rtc_date', { withTimezone: true }),
    note: text('note'),
    sourceTable: varchar('source_table', { length: 120 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sync_rtc_history').on(table.companyId, table.employeeId, table.rtcYear, table.rtcName),
    index('idx_sync_rtc_employee').on(table.employeeId),
  ]
);

// ── Sync: Assessment Center scores (SDP / Orange) ────────────────────
// Per-employee Assessment Center measurement history. One row per
// assessment (a dimension may carry a score; the staging build averages
// them into assessment_center_score).
export const syncAssessmentCenter = pgTable(
  'sync_assessment_center',
  {
    id: serial('id').primaryKey(),
    companyId: varchar('company_id', { length: 10 }),
    employeeId: varchar('employee_id', { length: 20 }).notNull(),
    assessmentDate: timestamp('assessment_date', { withTimezone: true }),
    /** Score on whatever scale the source provides (normalized 0-100 in staging). */
    score: numeric('score', { precision: 5, scale: 2 }),
    dimension: varchar('dimension', { length: 120 }),
    rekomendasiName: varchar('rekomendasi_name', { length: 255 }),
    sourceTable: varchar('source_table', { length: 120 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_sync_assessment_center_employee').on(table.employeeId),
    index('idx_sync_assessment_center_company_employee').on(table.companyId, table.employeeId),
  ]
);
