import pg from "pg";
import { config } from "../config.js";
import { assertBusinessTimezone, installPgTimeParsers } from "./pg-time.js";

// Before the first query. Most of what this service writes is `timestamptz`,
// but it reads zone-less columns (candidates, positions) that the web app owns,
// and the whole point of pinning is that all three deployables agree.
installPgTimeParsers();
assertBusinessTimezone();

const pool = new pg.Pool({
  connectionString: config.postgresUrl,
  max: 10,
});

pool.on("error", (err) => {
  console.error("[PG] Unexpected pool error:", err);
});

export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
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
