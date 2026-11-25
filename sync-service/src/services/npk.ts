/**
 * One NPK identity for HAV matching — the repo's `LPAD(employee_id, 5, '0')`
 * convention, made safe.
 *
 * NPKs are stored in two shapes: `candidates` / `sync_employees` hold them as
 * written by the source (4 digits here, "5123"), while sync_employee_positions,
 * sync_performance_appraisals and friends pad them to 5 ("05123"), which is why
 * candidate-populate and the web join through `LPAD(…, 5, '0')`. HAV used to
 * match by exact string, so a HAV workbook that wrote "05123" — or "5123" when
 * the candidate row held "05123" — silently updated nobody.
 *
 * Numeric ids shorter than 5 are left-padded to 5; anything else is only
 * trimmed. Two deliberate differences from a bare LPAD, both matching
 * `npkIdentity` in lib/pulse-crud-actions.ts:
 *   • non-numeric ids are NOT padded ("MUL-2024-001" stays itself), and
 *   • a numeric id LONGER than 5 is NOT truncated — Postgres LPAD cuts a string
 *     past its length, which would fold "123456" and "123457" into "12345".
 * For every 1–5 digit NPK this is exactly LPAD(x, 5, '0').
 */
export function npkKey(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").toString().trim();
  return /^\d+$/.test(trimmed) && trimmed.length < 5 ? trimmed.padStart(5, "0") : trimmed;
}

/** The same rule as `npkKey`, as a SQL expression over a column or expression. */
export function npkKeySql(expr: string): string {
  const t = `btrim((${expr})::text)`;
  return `(CASE WHEN ${t} ~ '^[0-9]+$' AND length(${t}) < 5 THEN lpad(${t}, 5, '0') ELSE ${t} END)`;
}
