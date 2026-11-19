import { drizzle } from 'drizzle-orm/node-postgres';
// @ts-ignore
import { Pool } from 'pg';
import * as schema from './vector-schema';
import { DEFAULT_VECTOR_DIMENSIONS } from './vector-schema';
import { installPgTimeParsers } from './pg-time';
import { installDrizzleTimeMappers } from './drizzle-time';

// Idempotent; repeated because this pool can be the first one a script touches.
installPgTimeParsers();
installDrizzleTimeMappers(schema);

const vectorDatabaseUrl =
  process.env.VECTOR_DATABASE_URL ||
  process.env.VECTOR_POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!vectorDatabaseUrl) {
  throw new Error('VECTOR_DATABASE_URL or DATABASE_URL environment variable is not set');
}

export const vectorPool = new Pool({
  connectionString: vectorDatabaseUrl,
});

export const vectorDb = drizzle(vectorPool, { schema });

// The dimension (per table) this process last ensured the schema for. When a
// caller asks for a DIFFERENT dimension the tables are recreated (see
// ensureVectorDbSchema); `null` means "never ensured in this process yet".
let schemaInitializedDim: number | null = null;

/** Per-table DDL. The embedding column dimension is injected at call time. */
const VECTOR_COLUMN_UPGRADES = [
  `ALTER TABLE "job_profile_embed" ADD COLUMN IF NOT EXISTS "embed_template" text`,
  `ALTER TABLE "job_profile_embed" ADD COLUMN IF NOT EXISTS "embed_source" varchar(40)`,
  `ALTER TABLE "job_profile_embed" ADD COLUMN IF NOT EXISTS "embed_dimensions" integer`,
  `ALTER TABLE "job_profile_embed" ADD COLUMN IF NOT EXISTS "extracted_hash" varchar(64)`,
];

const TABLE_DDL: Record<string, (dim: number) => string> = {
  job_profile_embed: (dim) => `
    CREATE TABLE IF NOT EXISTS "job_profile_embed" (
      "id" serial PRIMARY KEY NOT NULL,
      "job_profile_id" integer NOT NULL,
      "position_name" varchar(300),
      "division_department" varchar(300),
      "document" text NOT NULL,
      "embedding" vector(${dim}),
      "embedding_model" varchar(120),
      "content_hash" varchar(64),
      "embed_template" text,
      "embed_source" varchar(40),
      "embed_dimensions" integer,
      "extracted_hash" varchar(64),
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_profile_embed_job_profile" ON "job_profile_embed" ("job_profile_id");
    CREATE INDEX IF NOT EXISTS "idx_job_profile_embed_position" ON "job_profile_embed" ("position_name");
  `,
  kamus_kompetensi_embed: (dim) => `
    CREATE TABLE IF NOT EXISTS "kamus_kompetensi_embed" (
      "id" serial PRIMARY KEY NOT NULL,
      "code" varchar(20) NOT NULL,
      "name" varchar(300),
      "document" text NOT NULL,
      "embedding" vector(${dim}),
      "embedding_model" varchar(120),
      "content_hash" varchar(64),
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_kamus_kompetensi_embed_code" ON "kamus_kompetensi_embed" ("code");
    CREATE INDEX IF NOT EXISTS "idx_kamus_kompetensi_embed_name" ON "kamus_kompetensi_embed" ("name");
  `,
  kamus_kompetensi_level_embed: (dim) => `
    CREATE TABLE IF NOT EXISTS "kamus_kompetensi_level_embed" (
      "id" serial PRIMARY KEY NOT NULL,
      "code" varchar(20) NOT NULL,
      "name" varchar(300),
      "level" integer NOT NULL,
      "document" text NOT NULL,
      "embedding" vector(${dim}),
      "embedding_model" varchar(120),
      "content_hash" varchar(64),
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_kamus_kompetensi_level_embed_code_level" ON "kamus_kompetensi_level_embed" ("code", "level");
    CREATE INDEX IF NOT EXISTS "idx_kamus_kompetensi_level_embed_code" ON "kamus_kompetensi_level_embed" ("code");
  `,
};

/** Minimal structural type for a pg client — `pg` ships no types in this repo. */
type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
};

async function tableExists(client: Queryable, table: string): Promise<boolean> {
  const res = await client.query('SELECT to_regclass($1) AS r', [`public.${table}`]);
  return res.rows[0]?.r != null;
}

/**
 * The declared dimension of a table's `embedding` column, or:
 *   • 0      — the column exists but is unconstrained (`vector`, any dimension)
 *   • null   — the table/column doesn't exist
 * `vector(768)` parses to 768; a bare `vector` column returns 0.
 */
async function columnDimension(client: Queryable, table: string): Promise<number | null> {
  const res = await client.query(
    `SELECT format_type(a.atttypid, a.atttypmod) AS ftype
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = $1 AND a.attname = 'embedding' AND NOT a.attisdropped`,
    [table],
  );
  const ftype = res.rows[0]?.ftype as string | undefined;
  if (!ftype) return null;
  const m = /^vector\((\d+)\)$/i.exec(ftype);
  if (m) return Number(m[1]);
  return /^vector$/i.test(ftype) ? 0 : null;
}

/**
 * Sanitize a configured dimension to a safe positive integer.
 * A bogus value (0/NaN/negative) must never drive a destructive recreate.
 */
function sanitizeDimensions(dimensions: number | undefined): number | undefined {
  if (dimensions === undefined) return undefined;
  const d = Math.floor(Number(dimensions));
  return Number.isFinite(d) && d > 0 ? d : undefined;
}

export type VectorSchemaResult = {
  /** True when at least one existing table was DROPPED and recreated (data wiped). */
  recreated: boolean;
  /** The dimension the tables now hold. */
  dimensions: number;
};

/**
 * Ensures the pgvector extension and vector tables exist in the vector DB at
 * the requested dimension.
 *
 *   • ensureVectorDbSchema()             — read paths: ensure existence only;
 *     existing tables are never touched, new ones are created at
 *     DEFAULT_VECTOR_DIMENSIONS.
 *   • ensureVectorDbSchema(dimensions)   — write/re-embed paths: if an existing
 *     table's `embedding` column has a different declared dimension it is
 *     DROPPED and recreated at `dimensions`. DROP+CREATE wipes the rows, so
 *     callers that pass a dimension are always re-embedding the whole corpus
 *     right afterwards.
 *
 * This is what lets the Job Family Configuration's "Dimensi Vektor" be changed
 * freely: a re-embed rebuilds the collection at the new dimension instead of
 * failing because the pgvector column was born as vector(768).
 *
 * Errors are logged and swallowed (matching the previous behaviour) — the
 * follow-up query that actually touches a table surfaces the missing-relation /
 * pgvector error, which callers classify with isSchemaMissing.
 */
export async function ensureVectorDbSchema(dimensions?: number): Promise<VectorSchemaResult> {
  const target = sanitizeDimensions(dimensions);
  if (schemaInitializedDim !== null && (target === undefined || target === schemaInitializedDim)) {
    return { recreated: false, dimensions: schemaInitializedDim };
  }
  try {
    const client = await vectorPool.connect();
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

      let recreated = false;
      for (const table of Object.keys(TABLE_DDL)) {
        const exists = await tableExists(client, table);
        if (exists) {
          const dim = await columnDimension(client, table);
          if (target !== undefined && dim !== null && dim !== target) {
            await client.query(`DROP TABLE IF EXISTS "public"."${table}" CASCADE`);
            await client.query(TABLE_DDL[table]!(target));
            recreated = true;
          }
        } else {
          await client.query(TABLE_DDL[table]!(target ?? DEFAULT_VECTOR_DIMENSIONS));
        }
      }

      // Columns added after the table first shipped (drizzle/0094 — the vector's
      // provenance). The vector database may be a separate instance the SQL
      // migrations never reach, so they are added here, idempotently, before
      // any write: Drizzle names every schema column in an INSERT.
      for (const ddl of VECTOR_COLUMN_UPGRADES) await client.query(ddl);

      const effective =
        target ??
        (await columnDimension(client, 'job_profile_embed')) ??
        DEFAULT_VECTOR_DIMENSIONS;
      schemaInitializedDim = effective;
      return { recreated, dimensions: effective };
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[VectorDB] Schema initialization warning:', err);
    return { recreated: false, dimensions: target ?? DEFAULT_VECTOR_DIMENSIONS };
  }
}

/**
 * Read-only dimension probe for callers that must NOT recreate the collection —
 * e.g. a single-profile embed, where rebuilding the whole corpus just to write
 * one row would wipe everyone else's vectors. Returns 0 for an unconstrained
 * `vector` column and null when the table/column is absent.
 */
export async function getVectorColumnDimension(
  table: string,
): Promise<number | null> {
  try {
    const client = await vectorPool.connect();
    try {
      return await columnDimension(client, table);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[VectorDB] Dimension probe warning:', err);
    return null;
  }
}
