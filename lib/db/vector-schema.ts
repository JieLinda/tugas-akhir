import {
  pgTable,
  varchar,
  text,
  timestamp,
  integer,
  serial,
  index,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

// ── Job Family: restructured job-profile paragraphs + embeddings ──────────

/**
 * Compile-time default vector dimension. The LIVE column is reconciled at
 * runtime by `ensureVectorDbSchema` in lib/db/vector-db.ts, which reads the
 * configured dimension and DROPs/recreates a table whose column differs — so a
 * re-embed can run at e.g. 1024 without a migration. Drizzle's schema is only a
 * default; it is never used to DDL these tables at runtime.
 */
export const DEFAULT_VECTOR_DIMENSIONS = 768;

export const jobProfileEmbed = pgTable(
  'job_profile_embed',
  {
    id: serial('id').primaryKey(),
    jobProfileId: integer('job_profile_id').notNull(),
    positionName: varchar('position_name', { length: 300 }),
    divisionDepartment: varchar('division_department', { length: 300 }),
    /** The restructured continuous paragraph fed to the embedding model. */
    document: text('document').notNull(),
    /** Sentence embedding of `document` (dims = runtime config, default 768). */
    embedding: vector('embedding', { dimensions: DEFAULT_VECTOR_DIMENSIONS }),
    /** Which embedding model produced the vector (for auditing/re-embeds). */
    embeddingModel: varchar('embedding_model', { length: 120 }),
    /** Hash of (document + model) — lets a rebuild skip unchanged rows. */
    contentHash: varchar('content_hash', { length: 64 }),
    /**
     * Provenance of the vector (drizzle/0094), so a map's calculation trace can
     * say what text a vector came from after the template has changed: the
     * restructure template it was built with, the embedding source and
     * dimension, and sha256 of the extracted data it was restructured from
     * (`hashExtracted`). Null on rows embedded before they were recorded.
     */
    embedTemplate: text('embed_template'),
    embedSource: varchar('embed_source', { length: 40 }),
    embedDimensions: integer('embed_dimensions'),
    extractedHash: varchar('extracted_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_job_profile_embed_job_profile').on(table.jobProfileId),
    index('idx_job_profile_embed_position').on(table.positionName),
  ]
);

export type JobProfileEmbed = typeof jobProfileEmbed.$inferSelect;
export type NewJobProfileEmbed = typeof jobProfileEmbed.$inferInsert;

// ── Job Family: kamus-kompetensi document embeddings (pgvector) ────
export const kamusKompetensiEmbed = pgTable(
  'kamus_kompetensi_embed',
  {
    id: serial('id').primaryKey(),
    /** Competency code — stable business key shared with sync_kamus_kompetensi. */
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 300 }),
    /** The searchable document (code, name, description, level descriptors). */
    document: text('document').notNull(),
    /** Sentence embedding of `document` (dims = runtime config, default 768). */
    embedding: vector('embedding', { dimensions: DEFAULT_VECTOR_DIMENSIONS }),
    embeddingModel: varchar('embedding_model', { length: 120 }),
    /** Hash of (model + document) — lets a rebuild skip unchanged rows. */
    contentHash: varchar('content_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_kamus_kompetensi_embed_code').on(table.code),
    index('idx_kamus_kompetensi_embed_name').on(table.name),
  ]
);

export type KamusKompetensiEmbed = typeof kamusKompetensiEmbed.$inferSelect;
export type NewKamusKompetensiEmbed = typeof kamusKompetensiEmbed.$inferInsert;

// ── Job Family: per-LEVEL cumulative competency-dictionary embeddings ─────
export const kamusKompetensiLevelEmbed = pgTable(
  'kamus_kompetensi_level_embed',
  {
    id: serial('id').primaryKey(),
    /** Competency code — stable business key shared with sync_kamus_kompetensi. */
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 300 }),
    /** Proficiency level 1..4 (1=Basic, 2=Intermediate, 3=Advance, 4=Mastery). */
    level: integer('level').notNull(),
    /** Cumulative searchable document: name + description + level descriptors 1..level. */
    document: text('document').notNull(),
    /** Sentence embedding of `document` (dims = runtime config, default 768). */
    embedding: vector('embedding', { dimensions: DEFAULT_VECTOR_DIMENSIONS }),
    embeddingModel: varchar('embedding_model', { length: 120 }),
    /** Hash of (model + document) — lets a rebuild skip unchanged rows. */
    contentHash: varchar('content_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_kamus_kompetensi_level_embed_code_level').on(table.code, table.level),
    index('idx_kamus_kompetensi_level_embed_code').on(table.code),
  ]
);

export type KamusKompetensiLevelEmbed = typeof kamusKompetensiLevelEmbed.$inferSelect;
export type NewKamusKompetensiLevelEmbed = typeof kamusKompetensiLevelEmbed.$inferInsert;
