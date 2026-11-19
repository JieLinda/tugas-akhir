import mssql from "mssql";
import {
  getConnectionSettings,
  invalidateDbSettings,
  type ResolvedConnection,
  type SourceKey,
} from "../services/db-settings.js";

/**
 * MSSQL pools for the two source databases.
 *
 * The pool CONFIG used to be two module-level `const` literals built from
 * `config.dbMPMDS` / `config.dbMPMHRGA` at import time. That made the settings
 * impossible to change at runtime in a way that looked like it worked: the
 * settings row would update, the API would answer 200, and the service would go
 * on connecting to the old server — including after a reconnect, since
 * getPool*() rebuilt from the same frozen literal.
 *
 * Now the config is resolved per connect from services/db-settings.ts (Postgres
 * row, falling back to env), and reloadMssqlSettings() drops both the settings
 * cache and the live pools so the next query picks up the new values.
 *
 * Nothing downstream changed: queryDbMPMDS / queryDbMPMHRGA already called
 * getPool*() per query and no service module holds a pool reference, so a
 * runtime swap propagates everywhere with no other edits.
 */

function poolConfigFrom(settings: ResolvedConnection): mssql.config {
  return {
    server: settings.server,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.database,
    options: {
      encrypt: settings.encrypt,
      trustServerCertificate: settings.trustServerCertificate,
      connectTimeout: 15_000,
      requestTimeout: 30_000,
    },
  };
}

let poolMPMDS: mssql.ConnectionPool | null = null;
let poolMPMHRGA: mssql.ConnectionPool | null = null;

async function connect(key: SourceKey): Promise<mssql.ConnectionPool> {
  const settings = await getConnectionSettings(key);
  const pool = new mssql.ConnectionPool(poolConfigFrom(settings));
  await pool.connect();
  console.log(
    `[MSSQL] Connected to DB ${key} (${settings.server}:${settings.port}/${settings.database}, ` +
      `settings from ${settings.origin})`,
  );
  return pool;
}

export async function getPoolMPMDS(): Promise<mssql.ConnectionPool> {
  if (!poolMPMDS || !poolMPMDS.connected) {
    poolMPMDS = await connect("MPMDS");
  }
  return poolMPMDS;
}

export async function getPoolMPMHRGA(): Promise<mssql.ConnectionPool> {
  if (!poolMPMHRGA || !poolMPMHRGA.connected) {
    poolMPMHRGA = await connect("MPMHRGA");
  }
  return poolMPMHRGA;
}

export async function queryDbMPMDS<T extends Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = await getPoolMPMDS();
  const request = pool.request();
  if (params && params.length > 0) {
    params.forEach((value, i) => {
      request.input(`p${i + 1}`, value as unknown as any);
    });
  }
  const result = await request.query<T>(sql);
  return result.recordset;
}

export async function queryDbMPMHRGA<T extends Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = await getPoolMPMHRGA();
  const request = pool.request();
  if (params && params.length > 0) {
    params.forEach((value, i) => {
      request.input(`p${i + 1}`, value as unknown as any);
    });
  }
  const result = await request.query<T>(sql);
  return result.recordset;
}

export async function closePools() {
  if (poolMPMDS) await poolMPMDS.close().catch(() => { });
  if (poolMPMHRGA) await poolMPMHRGA.close().catch(() => { });
  poolMPMDS = null;
  poolMPMHRGA = null;
}

/**
 * Pick up changed connection settings without restarting the service.
 *
 * Both halves matter. Dropping only the settings cache would leave the existing
 * pools connected to the old server, and dropping only the pools would rebuild
 * them from the cached (stale) settings.
 */
export async function reloadMssqlSettings(): Promise<void> {
  invalidateDbSettings();
  await closePools();
  console.log("[MSSQL] Connection settings reloaded; pools will reconnect on next query.");
}

/**
 * Connect with the CURRENTLY SAVED settings and run a trivial query.
 *
 * Uses a throwaway pool rather than getPool*(): those return the cached
 * singleton, which would happily report "OK" against the previous credentials
 * while the operator is testing new ones — the one answer a test button must
 * never give.
 *
 * It tests what is SAVED rather than accepting a candidate config in the request
 * body, because this service has no authentication: an endpoint that took a
 * password would let anyone who can reach the container point it at a server
 * they control. Saving first is a smaller cost than that hole.
 */
export async function testConnection(
  key: SourceKey,
): Promise<{ ok: boolean; message: string; server: string; database: string; origin: string }> {
  const settings = await getConnectionSettings(key);
  const describe = `${settings.server}:${settings.port}/${settings.database}`;

  if (!settings.server || !settings.database) {
    return {
      ok: false,
      message: `Konfigurasi ${key} belum lengkap (server/database kosong).`,
      server: settings.server,
      database: settings.database,
      origin: settings.origin,
    };
  }

  let pool: mssql.ConnectionPool | null = null;
  try {
    pool = new mssql.ConnectionPool(poolConfigFrom(settings));
    await pool.connect();
    await pool.request().query("SELECT 1 AS ok");
    return {
      ok: true,
      message:
        `Berhasil terhubung ke ${describe}` +
        (settings.passwordFellBackToEnv
          ? " (memakai password dari environment karena enkripsi terkunci)"
          : ""),
      server: settings.server,
      database: settings.database,
      origin: settings.origin,
    };
  } catch (err) {
    return {
      ok: false,
      // The driver's message can contain the server and user but never the
      // password, so it is safe to surface and is the only useful diagnostic.
      message: `Gagal terhubung ke ${describe}: ${err instanceof Error ? err.message : String(err)}`,
      server: settings.server,
      database: settings.database,
      origin: settings.origin,
    };
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
}
