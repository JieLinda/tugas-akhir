/**
 * Turn LaTeX the assistant emits into readable plain text.
 *
 * The chat panel renders with plain `react-markdown` and no math plugin, so
 * `$$\text{Periode Efektif} = \sum sim'$$` reaches the user verbatim — dollar
 * signs, backslashes and all. The primary fix is in
 * `lib/scoring-methodology-brief.ts`, which now tells the model to write plain
 * arithmetic; this is the second layer, and it is not redundant:
 *
 *  - instructions drift, and one stray `$$` ruins the paragraph it lands in;
 *  - `chat_messages` already holds LaTeX-laden replies, and those would keep
 *    rendering badly forever. Fixing it at render time repairs the history too.
 *
 * Deliberately NOT a math renderer. Adding KaTeX would mean a new dependency, a
 * stylesheet, and CSP surface, to typeset formulas that the rest of this app
 * shows as plain monospace ASCII (the Konfigurasi tab, every derivation panel).
 * Matching that house style is the goal, not typography.
 */

/** Symbol and command substitutions, longest-first so `\leq` beats `\le`. */
const MACROS: [RegExp, string][] = [
  // Wrappers whose only job is styling — keep the content, drop the wrapper.
  [/\\(?:text|textbf|textit|mathbf|mathrm|mathit|bf|it|operatorname)\s*\{([^{}]*)\}/g, '$1'],
  // Structural macros that need their arguments rearranged.
  [/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1) ÷ ($2)'],
  [/\\sqrt\s*\{([^{}]*)\}/g, 'akar($1)'],
  // Operators and relations.
  [/\\times\b/g, '×'],
  [/\\div\b/g, '÷'],
  [/\\cdot\b/g, '·'],
  [/\\pm\b/g, '±'],
  [/\\leq\b/g, '≤'],
  [/\\geq\b/g, '≥'],
  [/\\neq\b/g, '≠'],
  [/\\le\b/g, '≤'],
  [/\\ge\b/g, '≥'],
  [/\\ne\b/g, '≠'],
  [/\\approx\b/g, '≈'],
  [/\\sum\b/g, 'Σ'],
  [/\\prod\b/g, 'Π'],
  [/\\sqrt\b/g, 'akar'],
  [/\\min\b/g, 'min'],
  [/\\max\b/g, 'max'],
  [/\\log\b/g, 'log'],
  [/\\ln\b/g, 'ln'],
  [/\\infty\b/g, '∞'],
  [/\\rightarrow\b|\\to\b/g, '→'],
  [/\\Rightarrow\b/g, '⇒'],
  [/\\alpha\b/g, 'α'],
  [/\\beta\b/g, 'β'],
  [/\\sigma\b/g, 'σ'],
  [/\\mu\b/g, 'μ'],
  // Escaped literals.
  [/\\([%$&#_{}])/g, '$1'],
  // Spacing commands.
  [/\\(?:quad|qquad|,|;|:|!)/g, ' '],
  [/\\\\/g, ' '],
];

/**
 * A `$…$` span is treated as math only when it looks like math. Without this a
 * price ("$100") or two unrelated dollar signs in a sentence would be silently
 * merged into one span and the text between them mangled.
 */
const LOOKS_LIKE_MATH = /[\\^_=]|÷|×|Σ/;

function stripMacros(text: string): string {
  let out = text;
  // Twice: a wrapper can nest one level, e.g. \mathbf{\text{x}}.
  for (let pass = 0; pass < 2; pass++) {
    for (const [re, to] of MACROS) out = out.replace(re, to);
  }
  return out;
}

/** `\[ … \]` / `\( … \)` delimiters, which carry no content of their own. */
function stripDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `\n${String(inner).trim()}\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => String(inner).trim());
}

/**
 * Convert LaTeX math in an assistant message to plain text.
 *
 * Fenced code blocks are left untouched — a message may legitimately show LaTeX
 * as an example, and rewriting inside ``` would corrupt it.
 */
export function stripLatexMath(text: string): string {
  if (!text) return text;
  // Split on fenced blocks and only transform the prose between them.
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      // Odd indices are the captured code spans/blocks.
      if (i % 2 === 1) return part;
      let out = stripDelimiters(part);
      // Display math first: $$…$$ becomes its own line so it reads as a formula.
      out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => {
        const body = stripMacros(String(inner)).replace(/\s+/g, ' ').trim();
        return `\n\n${body}\n\n`;
      });
      // Then inline math, but only where it actually looks like math.
      out = out.replace(/\$([^$\n]{1,200}?)\$/g, (m, inner) => {
        const raw = String(inner);
        if (!LOOKS_LIKE_MATH.test(raw)) return m;
        return stripMacros(raw).trim();
      });
      // Finally any macros that were written without delimiters at all.
      return stripMacros(out);
    })
    .join('');
}
