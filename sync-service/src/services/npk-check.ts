/**
 * "Which of these NPKs does Data Karyawan not know?" — the reference check for
 * the two uploads keyed by NPK alone (HAV, MCU). They carry no Company ID, so an
 * NPK is known when ANY company's sync_employees row normalises to it (npk.ts).
 * Such rows are still stored; they simply reach no candidate until the employee
 * exists. Returns a ready-to-show warning, or null.
 */
import { pool } from "../db/postgres.js";
import { npkKey } from "./npk.js";

export async function unknownNpkWarning(npks: string[], label: string): Promise<string | null> {
  const keys = [...new Set(npks.map(npkKey).filter(Boolean))];
  if (keys.length === 0) return null;
  try {
    const { rows } = await pool.query<{ employee_id: string }>(
      `SELECT employee_id FROM sync_employees WHERE employee_id IS NOT NULL`,
    );
    const known = new Set(rows.map((r) => npkKey(r.employee_id)));
    const missing = keys.filter((k) => !known.has(k));
    if (missing.length === 0) return null;
    const shown = missing.slice(0, 5).join(", ") + (missing.length > 5 ? `, … (+${missing.length - 5})` : "");
    return (
      `${missing.length} NPK di berkas ${label} tidak ada di Data Karyawan (${shown}). ` +
      `Barisnya tersimpan, tetapi baru terhubung ke kandidat setelah Data Karyawan memuat NPK tersebut.`
    );
  } catch (err) {
    // A check that cannot run must not turn a committed import into a failure.
    console.warn(`[${label}] NPK reference check failed:`, err);
    return null;
  }
}
