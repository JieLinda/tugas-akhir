/**
 * Refresh candidate_technical_competencies from sync_technical_competencies.
 *
 * The web app owns this copy (lib/pulse-data.ts:
 * syncCandidateTechnicalCompetenciesForTenant) and runs it lazily — when the
 * Kandidat pages are opened, at most once per 5 minutes per process. But
 * scoring-service reads THIS table (ahp-topsis-engine.ts), so an uploaded
 * competency workbook would not reach a scoring run started before somebody
 * happened to open the Kandidat page. Running the same refresh right after an
 * upload makes the upload take effect immediately everywhere.
 *
 * Kept byte-for-byte equivalent to the web function — change both together:
 *   • live candidates only (tombstones keep their already-scored rows);
 *   • a candidate's NPK is padded with `padStart(5, '0')` (the web's
 *     normalizeEmployeeId, which pads any id shorter than 5) and must equal
 *     sync_technical_competencies.employee_id, which the source stores padded;
 *   • only rows of the Company IDs mapped to the candidate's tenant — or every
 *     company when the tenant has no active mapping (the web's fallback);
 *   • active rows only;
 *   • the tenant's non-manual rows are deleted, then one row per
 *     (candidate, technical_id) is inserted: highest current_score, then highest
 *     score (NULL counts as -1). The web breaks an exact tie by query order; this
 *     breaks it by the newest sync row id, so it is at least deterministic;
 *   • ON CONFLICT (candidate_id, source_key) only touches updated_at, so a
 *     manual row that shares a source_key is left as the user wrote it.
 */
import type { PoolClient } from "pg";
import { pool } from "../db/postgres.js";
import type { SyncResult } from "../types.js";

const CANDIDATE_KEY = `CASE WHEN length(btrim(c.employee_id)) < 5
                            THEN lpad(btrim(c.employee_id), 5, '0')
                            ELSE btrim(c.employee_id) END`;

/**
 * @param outer  run inside the caller's transaction (tests roll it back);
 *               without it the refresh is its own transaction.
 */
export async function refreshCandidateTechnicalCompetencies(outer?: PoolClient): Promise<SyncResult> {
  const client = outer ?? (await pool.connect());
  const own = !outer;
  try {
    if (own) await client.query("BEGIN");
    const deleted = await client.query(
      `DELETE FROM candidate_technical_competencies ctc
        USING candidates c
        WHERE ctc.candidate_id = c.id
          AND c.deleted_at IS NULL
          AND ctc.is_manual = false`,
    );
    const inserted = await client.query(
      `WITH cand AS (
         SELECT c.id, c.tenant_id, ${CANDIDATE_KEY} AS npk
           FROM candidates c
          WHERE c.deleted_at IS NULL
            AND nullif(btrim(c.employee_id), '') IS NOT NULL
       ),
       mapped AS (
         SELECT tenant_id, array_agg(company_id) AS companies
           FROM sync_company_tenant_map WHERE is_active = true GROUP BY tenant_id
       ),
       src AS (
         SELECT cand.id AS candidate_id, t.*,
                row_number() OVER (
                  PARTITION BY cand.id, t.technical_id
                  ORDER BY coalesce(t.current_score, -1) DESC, coalesce(t.score, -1) DESC, t.id DESC
                ) AS rn
           FROM cand
           JOIN sync_technical_competencies t ON t.employee_id = cand.npk AND t.is_active = true
           LEFT JOIN mapped m ON m.tenant_id = cand.tenant_id
          WHERE m.companies IS NULL OR t.company_id = ANY(m.companies)
       )
       INSERT INTO candidate_technical_competencies
         (candidate_id, sync_technical_competency_id, technical_id, technical_name,
          proficiency_id, proficiency_name, score, current_proficiency_id,
          current_proficiency_name, current_score, gap, source_key, synced_at)
       SELECT candidate_id, id, technical_id, technical_name,
              proficiency_id, proficiency_name, score, current_proficiency_id,
              current_proficiency_name, current_score, gap, source_key, coalesce(synced_at, now())
         FROM src WHERE rn = 1
       ON CONFLICT (candidate_id, source_key) DO UPDATE SET updated_at = now()`,
    );
    if (own) await client.query("COMMIT");
    const n = inserted.rowCount ?? 0;
    return {
      success: true,
      synced: n,
      total: n,
      message: `Kompetensi teknis kandidat diperbarui (${n} baris diproses; ${deleted.rowCount ?? 0} baris lama non-manual diganti)`,
    };
  } catch (err) {
    if (own) await client.query("ROLLBACK");
    else throw err;
    return { success: false, synced: 0, total: 0, message: `Kompetensi teknis kandidat gagal diperbarui: ${String(err)}` };
  } finally {
    if (own) client.release();
  }
}
