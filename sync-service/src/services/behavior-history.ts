/**
 * Behavioural-assessment history — the pure half (drizzle/0081). The query and
 * the writer live in behavior-sync.ts; this decides WHICH rows become history,
 * so tests/talent-mapping/behavior-history.test.ts can pin it without a database.
 */

/** How many assessments per employee are kept — the Talent Mapping work queue shows up to three. */
export const BEHAVIOR_HISTORY_DEPTH = 3;

export type BehaviorHistorySourceRow = {
  COMPANY_ID: string;
  EMPLOYEE_ID: string;
  REKOMENDASI_NAME: string | null;
  KETERANGAN: string | null;
  TGL_PELAKSANAAN: Date | null;
};

export type BehaviorHistoryRow = {
  companyId: string;
  employeeId: string;
  /** 1 = newest. */
  rank: number;
  tglPelaksanaan: Date;
  rekomendasiName: string | null;
  keterangan: string | null;
};

/**
 * The newest `depth` assessment DATES per (company, employee), newest first.
 *
 * Keyed by date, not by row: the source's detail table can carry more than one
 * row for one assessment, and two rows on one date are one event, not two
 * history entries. The first row seen for a date wins, and among rows for the
 * same date one that carries a recommendation beats one that does not — a
 * labelled duplicate is strictly more information. Rows without a date are
 * dropped: an undated result cannot be placed in a history.
 */
export function buildBehaviorHistory(
  rows: BehaviorHistorySourceRow[],
  depth: number = BEHAVIOR_HISTORY_DEPTH,
): BehaviorHistoryRow[] {
  const byEmployee = new Map<string, Map<number, BehaviorHistorySourceRow>>();
  for (const row of rows) {
    const at = row.TGL_PELAKSANAAN;
    if (!row.COMPANY_ID || !row.EMPLOYEE_ID || !(at instanceof Date) || Number.isNaN(at.getTime())) continue;
    const key = `${row.COMPANY_ID}|${row.EMPLOYEE_ID}`;
    const dates = byEmployee.get(key) ?? new Map<number, BehaviorHistorySourceRow>();
    const seen = dates.get(at.getTime());
    if (!seen || (!seen.REKOMENDASI_NAME && row.REKOMENDASI_NAME)) dates.set(at.getTime(), row);
    byEmployee.set(key, dates);
  }

  const out: BehaviorHistoryRow[] = [];
  for (const dates of byEmployee.values()) {
    const newestFirst = Array.from(dates.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, Math.max(0, depth));
    newestFirst.forEach(([, row], i) => {
      out.push({
        companyId: row.COMPANY_ID,
        employeeId: row.EMPLOYEE_ID,
        rank: i + 1,
        tglPelaksanaan: row.TGL_PELAKSANAAN as Date,
        rekomendasiName: row.REKOMENDASI_NAME?.trim() || null,
        keterangan: row.KETERANGAN?.trim() || null,
      });
    });
  }
  return out;
}
