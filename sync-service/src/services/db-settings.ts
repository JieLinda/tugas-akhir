import { query as pgQuery } from "../db/postgres.js";
import { config } from "../config.js";

/**
 * Resolve the MSSQL source-database settings, preferring the UI-managed row in
 * Postgres and falling back to the environment variables.
 *
 * WHY THIS EXISTS AS A FUNCTION AND NOT A CONSTANT
 * db/mssql.ts used to build its two `mssql.config` objects as module-level
 * `const`s from `config.dbMPMDS` / `config.dbMPMHRGA`. Those are snapshots BY
 * VALUE, taken once at import. Making the settings editable without removing
 * that snapshot would have produced the worst kind of bug: the settings API
 * returns 200, the row updates, the UI says saved — and the service keeps
 * connecting to the old server forever, including after a reconnect, because
 * getPool*() rebuilds from the same frozen literal.
 *
 * ENV FALLBACK IS NOT A COURTESY
 * An existing deployment that never opens the new settings page must behave
 * exactly as it does today. A row with no stored password also falls back to
 * the env password.
 *
 * The password is stored as plain text in `password_encrypted` (the column
 * keeps its historical name).
 */

export type SourceKey = "MPMDS" | "MPMHRGA";

export type ResolvedConnection = {
  server: string;
  port: number;
  user: string;
  password: string;
  database: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  /** Where the values came from, for logging and the settings UI. */
  origin: "database" | "env";
};

type ConnectionRow = {
  source_key: SourceKey;
  server: string;
  port: number;
  username: string;
  password_encrypted: string | null;
  database_name: string;
  encrypt: boolean;
  trust_server_certificate: boolean;
};

/**
 * Cached so a sync doing hundreds of queries does not hit Postgres for the
 * settings each time. Invalidated by reloadDbSettings(), which the web app
 * calls after a save — the same shape as the readiness/prompt reload hooks.
 */
let cache: Map<SourceKey, ResolvedConnection> | null = null;

function envFor(key: SourceKey) {
  return key === "MPMDS" ? config.dbMPMDS : config.dbMPMHRGA;
}

function fromEnv(key: SourceKey): ResolvedConnection {
  const env = envFor(key);
  return {
    server: env.server,
    port: env.port,
    user: env.user,
    password: env.password,
    database: env.database,
    encrypt: true,
    trustServerCertificate: true,
    origin: "env",
  };
}

async function loadAll(): Promise<Map<SourceKey, ResolvedConnection>> {
  const resolved = new Map<SourceKey, ResolvedConnection>();
  resolved.set("MPMDS", fromEnv("MPMDS"));
  resolved.set("MPMHRGA", fromEnv("MPMHRGA"));

  let rows: ConnectionRow[] = [];
  try {
    rows = await pgQuery<ConnectionRow>(
      `SELECT source_key, server, port, username, password_encrypted, database_name,
              encrypt, trust_server_certificate
         FROM sync_source_connections
        WHERE is_active = true`,
    );
  } catch (err) {
    // Table missing (migration not applied yet) or Postgres briefly unavailable.
    // Env settings are already in the map, so the service keeps working.
    console.warn(
      `[DB-SETTINGS] Could not read sync_source_connections, using env settings: ${String(err)}`,
    );
    return resolved;
  }

  for (const row of rows) {
    const env = envFor(row.source_key);
    resolved.set(row.source_key, {
      server: row.server,
      port: row.port,
      user: row.username,
      password: row.password_encrypted || env.password,
      database: row.database_name,
      encrypt: row.encrypt,
      trustServerCertificate: row.trust_server_certificate,
      origin: "database",
    });
  }

  return resolved;
}

export async function getConnectionSettings(key: SourceKey): Promise<ResolvedConnection> {
  if (!cache) cache = await loadAll();
  return cache.get(key) ?? fromEnv(key);
}

/** Drop the cache so the next connect re-reads Postgres. */
export function invalidateDbSettings(): void {
  cache = null;
}

/** Both resolved connections, for the settings page's status display. */
export async function describeConnections(): Promise<
  Record<SourceKey, Omit<ResolvedConnection, "password"> & { hasPassword: boolean }>
> {
  const mpmds = await getConnectionSettings("MPMDS");
  const mpmhrga = await getConnectionSettings("MPMHRGA");
  // The password is deliberately dropped rather than masked: this value crosses
  // the proxy to a browser, and a mask is one refactor away from being the real
  // thing.
  const strip = (c: ResolvedConnection) => {
    const { password, ...rest } = c;
    return { ...rest, hasPassword: password !== "" };
  };
  return { MPMDS: strip(mpmds), MPMHRGA: strip(mpmhrga) };
}
