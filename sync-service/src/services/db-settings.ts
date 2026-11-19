import { query as pgQuery } from "../db/postgres.js";
import { config } from "../config.js";
import { ensureUnlocked, tryOpen } from "./crypto.js";

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
 * Two things depend on it:
 *   • An existing deployment that never opens the new settings page must behave
 *     exactly as it does today.
 *   • The password is stored encrypted, and this process may be LOCKED (it holds
 *     the data key only in memory, pushed by the web app after an operator
 *     unlocks). A weekly cron sync running at 01:00 on a service that restarted
 *     at 23:00 would otherwise fail with no human awake. When the password
 *     cannot be decrypted, the env password is used and the degradation is
 *     logged rather than silent.
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
  /** True when a stored password existed but could not be decrypted. */
  passwordFellBackToEnv: boolean;
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
    passwordFellBackToEnv: false,
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

  // Load the key from disk before decrypting anything. Without this the first
  // sync after a restart would silently fall back to the env password even
  // though a perfectly good key file is sitting right there.
  if (rows.some((r) => r.password_encrypted)) await ensureUnlocked();

  for (const row of rows) {
    const env = envFor(row.source_key);
    const decrypted = tryOpen(row.password_encrypted);
    const passwordFellBackToEnv = row.password_encrypted != null && decrypted == null;

    if (passwordFellBackToEnv) {
      console.warn(
        `[DB-SETTINGS] ${row.source_key}: stored password could not be decrypted ` +
          `(encryption locked?). Falling back to the DB_${row.source_key}_PASSWORD env var.`,
      );
    }

    resolved.set(row.source_key, {
      server: row.server,
      port: row.port,
      user: row.username,
      password: decrypted ?? env.password,
      database: row.database_name,
      encrypt: row.encrypt,
      trustServerCertificate: row.trust_server_certificate,
      origin: "database",
      passwordFellBackToEnv,
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
