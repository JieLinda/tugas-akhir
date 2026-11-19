// Demo-mode FILES of a run — the calculation-trace workbook and the snapshot
// JSON. The screen masks NPKs and codes with one fixed mark (lib/app-mode-shared.ts);
// a file cannot, because the workbook's formulas join and compare on exactly
// these values (VLOOKUP by the career fallback key, identity by kamus code, the
// IDF table by competency key), and a single shared mark would make every code
// equal every other and every formula after it wrong. So each distinct value is
// given a stable pseudonym instead — NPK-0001, KODE-001 — which keeps every
// equality a formula tests and names nothing real.
//
// Pure and client-safe. Identifiers are found by the field that holds them,
// then replaced wherever that exact value appears — as a whole string, or as a
// part of a composite key ("<code>##<company>##<npk>|<npk>") — so a value
// repeated under another key (a stint titled by its code) is replaced too.
// Free text is not scanned: a demo run's engine-written prose already names no
// identifier (scoring-service/src/demo-overlay.ts).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fields (or arrays of them) holding an employee number. */
const NPK_KEYS = new Set([
  'employeeId',
  'employee_id',
  'employeeIds',
  'holderEmployeeId',
  'holder_employee_id',
  'holderEmployeeIds',
  'fallbackEmployeeIds',
  'excludeEmployeeIds',
  'excluded',
  'npk',
]);

/** Fields holding a position, competency (kamus) or document code. */
const CODE_KEYS = new Set([
  'positionId',
  'position_id',
  'positionCode',
  'position_code',
  'targetPositionCode',
  'matchedCode',
  'fileCode',
  'jdNumber',
  'code',
  'bestCode',
  'technicalId',
  'technical_id',
  'kamusCode',
]);

/** Separators of the composite keys the engine builds (fallback keys, NPK lists). */
const COMPOSITE = /(##|\|)/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
}

export type PseudonymizeResult<T> = { value: T; npks: number; codes: number };

/**
 * `value` with every NPK and code replaced by a stable pseudonym. A code must
 * contain a digit to count (program codes such as "successor" are not
 * identifiers of a person or a seat); uuids are internal ids and stay.
 */
export function pseudonymizeIdentifiers<T>(value: T): PseudonymizeResult<T> {
  const table = new Map<string, string>();
  let npks = 0;
  let codes = 0;
  const add = (raw: string, kind: 'npk' | 'code') => {
    const v = raw.trim();
    if (!v || UUID.test(v) || table.has(v)) return;
    if (kind === 'code' && !/\d/.test(v)) return;
    const alias =
      kind === 'npk' ? `NPK-${String(++npks).padStart(4, '0')}` : `KODE-${String(++codes).padStart(3, '0')}`;
    table.set(v, alias);
    // The engine normalises codes to upper case inside its keys.
    const upper = v.toUpperCase();
    if (!table.has(upper)) table.set(upper, alias);
  };

  const collect = (node: unknown, key: string | null): void => {
    if (typeof node === 'string') {
      if (key && NPK_KEYS.has(key)) add(node, 'npk');
      else if (key && CODE_KEYS.has(key)) add(node, 'code');
      return;
    }
    // An array inherits its field: `fallbackEmployeeIds: string[]`.
    if (Array.isArray(node)) {
      for (const item of node) collect(item, key);
      return;
    }
    if (isPlainObject(node)) for (const [k, v] of Object.entries(node)) collect(v, k);
  };
  collect(value, null);
  if (table.size === 0) return { value, npks: 0, codes: 0 };

  const replace = (s: string): string => {
    const whole = table.get(s) ?? table.get(s.trim());
    if (whole) return whole;
    // The career fallback's IDF keys: "C:<kamus code>" (a name is "N:<name>").
    if (s.startsWith('C:')) {
      const coded = table.get(s.slice(2));
      if (coded) return `C:${coded}`;
    }
    if (!COMPOSITE.test(s)) return s;
    return s
      .split(COMPOSITE)
      .map((part) => (part === '##' || part === '|' ? part : table.get(part) ?? table.get(part.trim()) ?? part))
      .join('');
  };
  const rewrite = (node: unknown): unknown => {
    if (typeof node === 'string') return replace(node);
    if (Array.isArray(node)) return node.map(rewrite);
    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[replace(k)] = rewrite(v);
      return out;
    }
    return node;
  };
  return { value: rewrite(value) as T, npks, codes };
}
