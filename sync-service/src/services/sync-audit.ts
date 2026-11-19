import { pool } from "../db/postgres.js";

/**
 * Records every sync execution into `sync_runs`.
 *
 * Deliberately not per-service: the HTTP layer is the single choke point every
 * UI/API trigger passes through, so one middleware covers all ~20 modules and
 * cannot drift as services are added. The CLI and scheduler call
 * startRun/finishRun directly since they bypass Express.
 *
 * Every write is best-effort — audit bookkeeping must never fail a sync.
 */

export type TriggerSource = "ui" | "api" | "cron" | "cli";

export type StartRunInput = {
  jobKey: string;
  triggerSource: TriggerSource;
  mode?: string | null;
  tenantIds?: string[] | null;
  companyIds?: string[] | null;
  actor?: string | null;
};

export type FinishRunInput = {
  status: "success" | "failed";
  synced?: number | null;
  total?: number | null;
  message?: string | null;
  error?: string | null;
};

export async function startRun(input: StartRunInput): Promise<string | null> {
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO sync_runs
         (job_key, status, trigger_source, mode, tenant_ids, company_ids, actor, started_at)
       VALUES ($1, 'running', $2, $3, $4, $5, $6, now())
       RETURNING id`,
      [
        input.jobKey,
        input.triggerSource,
        input.mode ?? null,
        input.tenantIds?.length ? input.tenantIds : null,
        input.companyIds?.length ? input.companyIds : null,
        input.actor ?? null,
      ],
    );
    return r.rows[0]?.id ?? null;
  } catch (err) {
    // Table missing (migration not applied yet) or DB hiccup — never block.
    console.warn("[SYNC-AUDIT] startRun failed:", String(err));
    return null;
  }
}

export async function finishRun(id: string | null, input: FinishRunInput): Promise<void> {
  if (!id) return;
  try {
    await pool.query(
      `UPDATE sync_runs SET
         status = $2,
         synced = $3,
         total = $4,
         message = $5,
         error = $6,
         finished_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int)
       WHERE id = $1`,
      [
        id,
        input.status,
        input.synced ?? null,
        input.total ?? null,
        input.message ? input.message.slice(0, 4000) : null,
        input.error ? input.error.slice(0, 4000) : null,
      ],
    );
  } catch (err) {
    console.warn("[SYNC-AUDIT] finishRun failed:", String(err));
  }
}

/**
 * A process crash or container restart leaves 'running' rows behind with no
 * writer. Called once on boot so the UI never shows a phantom in-progress sync.
 */
export async function markInterruptedRuns(): Promise<void> {
  try {
    const r = await pool.query(
      `UPDATE sync_runs
          SET status = 'failed',
              error = COALESCE(error, 'Terputus: layanan sinkronisasi restart saat sync berjalan'),
              finished_at = now(),
              duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int)
        WHERE status = 'running'`,
    );
    if (r.rowCount) {
      console.log(`[SYNC-AUDIT] Marked ${r.rowCount} interrupted run(s) as failed`);
    }
  } catch (err) {
    console.warn("[SYNC-AUDIT] markInterruptedRuns failed:", String(err));
  }
}

/** Convenience wrapper for non-HTTP callers (CLI, scheduler). */
export async function withSyncRun<T extends { success?: boolean; synced?: number; total?: number; message?: string }>(
  input: StartRunInput,
  fn: () => Promise<T>,
): Promise<T> {
  const id = await startRun(input);
  try {
    const result = await fn();
    await finishRun(id, {
      status: result?.success === false ? "failed" : "success",
      synced: result?.synced ?? null,
      total: result?.total ?? null,
      message: result?.message ?? null,
      error: result?.success === false ? result?.message ?? null : null,
    });
    return result;
  } catch (err) {
    await finishRun(id, { status: "failed", error: String(err) });
    throw err;
  }
}
