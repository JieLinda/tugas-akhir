// Number formats for the run comparison — one place, so the page, the export
// and the explanation sentences cannot disagree (§6 of the requirements).
//
//  • closeness ("Kecocokan") as a percentage with one decimal: 82,4%
//  • a closeness change in percentage points: +1,3 pp
//  • weights as a percentage with two decimals: 25,00%
//  • aspects on their own scale with one decimal: 74,5
//  • rank movement with an arrow AND words, never colour alone: ▲2 (naik)
// Decimal comma (id-ID). The XLSX export stores NUMBERS, not these strings.

const nf = new Map<number, Intl.NumberFormat>();
function fmt(digits: number): Intl.NumberFormat {
  let f = nf.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    nf.set(digits, f);
  }
  return f;
}

export const fmtNumber = (x: number, digits = 1): string => fmt(digits).format(x);

/** 0..1 closeness → "82,4%". */
export const fmtCloseness = (cc: number, digits = 1): string => `${fmtNumber(cc * 100, digits)}%`;

/** Percentage points with an explicit sign: "+1,3 pp", "−0,4 pp". */
export const fmtPp = (pp: number, digits = 1): string => {
  const r = Number(pp.toFixed(digits));
  if (r === 0) return `${fmtNumber(0, digits)} pp`;
  return `${r > 0 ? '+' : '−'}${fmtNumber(Math.abs(r), digits)} pp`;
};

/** 0..1 weight → "25,00%". */
export const fmtWeight = (w: number, digits = 2): string => `${fmtNumber(w * 100, digits)}%`;

/** An aspect value on its own 0..100 scale → "74,5". */
export const fmtAspect = (x: number): string => fmtNumber(x, 1);

/** rankA − rankB → "▲2 (naik)", "▼1 (turun)", "— (tetap)". */
export const fmtRankDelta = (delta: number): string =>
  delta > 0 ? `▲${delta} (naik)` : delta < 0 ? `▼${-delta} (turun)` : '— (tetap)';

/** A signed small number for breakdowns: "+0,0042". */
export const fmtSigned = (x: number, digits = 4): string => {
  const r = Number(x.toFixed(digits));
  if (r === 0) return fmtNumber(0, digits);
  return `${r > 0 ? '+' : '−'}${fmtNumber(Math.abs(r), digits)}`;
};

/** A replay residual: "0" or "1,2 × 10⁻¹²" — never the "1.2e-12" of toExponential. */
export const fmtTiny = (x: number): string => {
  if (x === 0) return '0';
  const [mantissa, exponent] = x.toExponential(1).split('e');
  const sup = String(Number(exponent)).replace(/[-0-9]/g, (ch) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(ch)]);
  return `${mantissa.replace('.', ',')} × 10${sup}`;
};
