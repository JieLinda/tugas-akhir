import pg from "pg";
import { config } from "../config.js";
import { assertBusinessTimezone, installPgTimeParsers } from "./pg-time.js";

// Before the first query: `pg`'s type parsers are module-global, so this one
// call also covers the vector pool below.
installPgTimeParsers();
assertBusinessTimezone();

const pool = new pg.Pool({
  connectionString: config.postgresUrl,
  max: 10,
});

pool.on("error", (err) => {
  console.error("[PG] Unexpected pool error:", err);
});

const vectorPool = new pg.Pool({
  connectionString: config.vectorPostgresUrl,
  max: 10,
});

vectorPool.on("error", (err) => {
  console.error("[PG Vector] Unexpected pool error:", err);
});

/**
 * Which database this service is connected to, WITHOUT credentials: host,
 * port, database name and the env variable it came from. Reported at boot, on
 * /health and in the start route's "Session not found" reply, so a web app and
 * a scoring service pointed at different databases can be told apart from the
 * one symptom they produce.
 */
export function describeDatabaseTarget(): {
  source: string;
  host: string | null;
  port: string | null;
  database: string | null;
} {
  try {
    const u = new URL(config.postgresUrl);
    return {
      source: config.postgresUrlSource,
      host: u.hostname || null,
      port: u.port || "5432",
      database: decodeURIComponent(u.pathname.replace(/^\//, "")) || null,
    };
  } catch {
    return { source: config.postgresUrlSource, host: null, port: null, database: null };
  }
}

export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

export async function vectorQuery<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await vectorPool.query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params?: unknown[]
): Promise<number> {
  const result = await pool.query(sql, params);
  return result.rowCount ?? 0;
}

export async function closePool() {
  await pool.end();
}

export { pool };
