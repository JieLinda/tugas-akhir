// Persistence of a run's calculation trace and of the census distributions the
// anchors were measured from (drizzle/0092). The SHAPE lives in
// run-trace-types.ts, shared with the web app's XLSX export.
//
// Two rules, both inherited from how this service treats every other record:
//
//  • A trace NEVER fails a run. Every write here is best-effort and logged — the
//    ranking is the record, the trace only explains it. A database without the
//    0092 tables therefore keeps scoring exactly as before; the export then says
//    "tidak tercatat" instead of showing numbers.
//
//  • A trace is candidate data, so it is SEALED with the app data key under the
//    same three-state rule as every sealed candidate column: plaintext only on
//    an install that never enabled encryption, ciphertext when unlocked, and NOT
//    WRITTEN AT ALL when the key is locked. Census rows hold no candidate
//    identity and are stored as plain jsonb.

import { createHash } from "node:crypto";
import { execute, query, queryOne } from "./db/postgres.js";
import { decryptField, ensureUnlocked, isSealed, resolveWriteMode, sealValue } from "./services/crypto.js";
import { log } from "./llm.js";
import type { CensusKind, CensusPayloadByKind, CensusRef, EngineTrace } from "./run-trace-types.js";

/** md5 hex of a JSON-serialisable value — the fingerprint of a census measured in-process. */
export function contentFingerprint(value: unknown): string {
  return createHash("md5").update(JSON.stringify(value)).digest("hex");
}

/**
 * Whether a census with this fingerprint is already stored. `null` when the
 * store cannot be read (0092 not applied, a transient error): the caller then
 * neither measures — it could not store the result, and re-measuring on every
 * run would be the drizzle/0067 trap — nor writes a reference to it.
 */
export async function censusSnapshotExists(kind: CensusKind, fingerprint: string): Promise<boolean | null> {
  try {
    const row = await queryOne<{ ok: number }>(
      `SELECT 1 AS ok FROM scoring_census_snapshots WHERE kind = $1 AND fingerprint = $2 LIMIT 1`,
      [kind, fingerprint.slice(0, 200)]
    );
    return row != null;
  } catch (err) {
    log("runTrace.censusExistsFailed", { kind, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Store what a census measured. Insert-if-absent: a fingerprint names the
 * inputs, so a second measurement of the same fingerprint is the same numbers
 * and the first row stands. `null` when the write failed, so a trace never
 * names a census that is not there (the export would otherwise report it as
 * referenced-but-missing — honest, but avoidable).
 */
export async function storeCensusSnapshot<K extends CensusKind>(
  kind: K,
  fingerprint: string,
  payload: CensusPayloadByKind[K],
  sampleCount: number
): Promise<CensusRef | null> {
  const ref: CensusRef = { kind, fingerprint: fingerprint.slice(0, 200) };
  try {
    await execute(
      `INSERT INTO scoring_census_snapshots (kind, fingerprint, payload, sample_count)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (kind, fingerprint) DO NOTHING`,
      [kind, ref.fingerprint, JSON.stringify(payload), Math.max(0, Math.round(sampleCount))]
    );
    return ref;
  } catch (err) {
    log("runTrace.censusStoreFailed", { kind, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export type TracePersistOutcome = {
  recorded: boolean;
  stage: "engine";
  version: number;
  sealed: boolean;
  bytes: number;
  reason: string | null;
};

/**
 * Write the engine stage of a run's trace. Called BEFORE the run is marked
 * completed — the 0092 trigger refuses any write to a completed run's trace
 * (I-1) — and upserted, because an interrupted attempt of an in-progress run
 * may already have written one.
 */
export async function persistEngineTrace(trace: EngineTrace, tenantId: string): Promise<TracePersistOutcome> {
  const base = { stage: "engine" as const, version: trace.version };
  let json: string;
  try {
    json = JSON.stringify(trace);
  } catch (err) {
    return { ...base, recorded: false, sealed: false, bytes: 0, reason: `Jejak tidak dapat diserialisasi: ${String(err)}` };
  }
  const mode = await resolveWriteMode().catch(() => "locked" as const);
  if (mode === "locked") {
    return {
      ...base,
      recorded: false,
      sealed: false,
      bytes: json.length,
      reason:
        "Enkripsi aktif tetapi kunci data tidak tersedia di scoring-service, jadi jejak (berisi data kandidat) tidak ditulis — tidak pernah sebagai teks biasa.",
    };
  }
  let payload: string;
  try {
    // `locked` was handled above, so sealValue either returns the plaintext
    // (never-initialised install) or the ciphertext; its refusal branch — whose
    // wording is about medical notes — cannot be reached from here.
    const sealed = sealValue(mode, json);
    if (!sealed) throw new Error("hasil penyegelan kosong");
    payload = sealed;
  } catch (err) {
    return { ...base, recorded: false, sealed: false, bytes: json.length, reason: `Jejak gagal disegel: ${String(err)}` };
  }
  try {
    await execute(
      `INSERT INTO scoring_run_traces (run_id, tenant_id, stage, version, payload, sealed, byte_size)
       VALUES ($1, $2, 'engine', $3, $4, $5, $6)
       ON CONFLICT (run_id, stage) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         version = EXCLUDED.version,
         payload = EXCLUDED.payload,
         sealed = EXCLUDED.sealed,
         byte_size = EXCLUDED.byte_size,
         created_at = now()`,
      [trace.runId, tenantId, trace.version, payload, mode === "encrypt", Buffer.byteLength(json, "utf8")]
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log("runTrace.persistFailed", { runId: trace.runId, error: reason });
    return { ...base, recorded: false, sealed: false, bytes: json.length, reason: `Jejak gagal disimpan: ${reason}` };
  }
  return { ...base, recorded: true, sealed: mode === "encrypt", bytes: Buffer.byteLength(json, "utf8"), reason: null };
}

/**
 * A parent's engine trace, decrypted — a child copies the per-candidate entries
 * of the candidates it carries, so its own trace stays self-contained even if the
 * parent is deleted later. Null when the parent has none or it cannot be read.
 */
export async function loadEngineTrace(runId: string): Promise<EngineTrace | null> {
  try {
    const row = await queryOne<{ payload: string; sealed: boolean }>(
      `SELECT payload, sealed FROM scoring_run_traces WHERE run_id = $1 AND stage = 'engine' LIMIT 1`,
      [runId]
    );
    if (!row?.payload) return null;
    let text: string | null = row.payload;
    if (isSealed(row.payload)) {
      await ensureUnlocked();
      const opened = decryptField(row.payload);
      text = opened == null ? null : String(opened);
    }
    if (!text) return null;
    const parsed = JSON.parse(text);
    return parsed && parsed.stage === "engine" ? (parsed as EngineTrace) : null;
  } catch (err) {
    log("runTrace.loadFailed", { runId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Every census ref a run's trace points at, for a child to inherit with its anchors. */
export function censusRefsOf(trace: EngineTrace | null): CensusRef[] {
  if (!trace) return [];
  return [
    ...(trace.technical.census ? [trace.technical.census] : []),
    ...trace.career.census,
    ...(trace.career.depth.census ? [trace.career.depth.census] : []),
    ...(trace.career.idf?.census ? [trace.career.idf.census] : []),
  ];
}

/** Rows in the census table — diagnostics only (verification scripts). */
export async function countCensusRows(): Promise<number> {
  const rows = await query<{ n: string }>(`SELECT count(*) AS n FROM scoring_census_snapshots`).catch(() => []);
  return Number(rows[0]?.n ?? 0);
}
