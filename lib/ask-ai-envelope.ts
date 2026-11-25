/**
 * The envelope that turns a pasted data dump into a chip in the chat.
 *
 * A question sent from a derivation panel carries a few hundred lines of numbers.
 * Rendering that verbatim as the user's message buries the conversation — so the
 * message is prefixed with a machine-readable header naming what was asked about
 * and where it came from. The chat renders the header as a labelled button and
 * hides the payload; clicking it returns the reader to the exact tab and section
 * they asked from.
 *
 * WHY IN THE MESSAGE TEXT rather than a new column. `chat_messages` stores a
 * `content` string and nothing else, and history is replayed from it.
 * A sidecar column would have to be threaded through the save path, the read
 * path and the streaming route; an envelope inside the
 * text travels for free and degrades gracefully — an older client, or a message
 * whose header is malformed, simply shows the text as it always did.
 *
 * An HTML comment is the carrier because `react-markdown` does not render it, so
 * even a client that knows nothing about envelopes shows the payload cleanly
 * rather than leaking the metadata.
 */

export type AskOrigin = {
  /** Tab to return to, e.g. "readiness" | "candidates". */
  tab: string;
  /** DOM id to scroll to once that tab is showing. */
  anchor: string;
};

/**
  * Which derivation panel to reopen when the reader returns.
  *
  * `key` identifies the row for panels that have several — the array index of the
  * competency pair or the history stint. An index is stable as long as the same
  * run and candidate are being rendered, which is exactly the situation a return
  * navigation lands in; it is not stable across a re-score, so a stale chip simply
  * reopens nothing rather than the wrong row (the kind check still has to pass).
  */
export type AskPanel = {
  kind: 'career-axis' | 'career-stint' | 'technical-pair' | 'performance' | 'education';
  key?: string | number;
};

export type AskRef = {
  /** Chip label — the kind of data, e.g. "Performance Appraisal". */
  label: string;
  /** Whose numbers these are. */
  candidate: string;
  /** Optional finer detail, e.g. "kedalaman durasi" or a competency name. */
  detail?: string;
  /** Panel to reopen on return. Absent for a whole-criterion summary. */
  panel?: AskPanel;
  origin: AskOrigin;
};

const MARK = 'pulse-ask';
const RE = new RegExp(`^<!--\\s*${MARK}\\s+([\\s\\S]*?)-->\\s*\\n?`);

/** Prefix a payload with its reference header. */
export function encodeAskMessage(ref: AskRef, payload: string): string {
  // Single line, so the regex above can stay anchored and cheap. JSON.stringify
  // escapes any `-->` that could otherwise close the comment early.
  return `<!-- ${MARK} ${JSON.stringify(ref)} -->\n${payload}`;
}

/**
 * Read the header off a stored message. Returns null when there is none, or when
 * it does not parse — a corrupt header must fall back to plain rendering, never
 * throw inside the message list.
 */
export function decodeAskMessage(
  content: string,
): { ref: AskRef; payload: string } | null {
  if (!content) return null;
  const m = RE.exec(content);
  if (!m) return null;
  try {
    const ref = JSON.parse(m[1]!.trim()) as AskRef;
    if (!ref?.label || !ref?.origin?.tab) return null;
    return { ref, payload: content.slice(m[0].length) };
  } catch {
    return null;
  }
}

/**
 * Drop the header before the text reaches the model. The chip metadata is for
 * the UI; feeding it to the LLM invites it to comment on tab names.
 */
export function stripAskEnvelope(content: string): string {
  const decoded = decodeAskMessage(content);
  return decoded ? decoded.payload : content;
}

/** Stable DOM id for one candidate's criterion section — the return target. */
export function criterionAnchorId(criterion: string, candidateId: string): string {
  return `crit-${criterion}-${candidateId}`;
}

/**
 * Read the candidate (and criterion) back out of a return anchor.
 *
 * A return navigation has to OPEN something before the anchor exists at all: on
 * Readiness the criterion section sits inside a collapsed accordion card, and on
 * Kandidat inside a criterion dialog that is closed — Radix unmounts both, so
 * `getElementById` finds nothing and the panel that should reopen never mounts.
 * Those containers are keyed by CANDIDATE ID, not by DOM id.
 *
 * They parse the anchor rather than the envelope carrying the id twice: two
 * fields that must agree are a chance for them to disagree. Parsing is
 * unambiguous because every criterion key is a single lowercase word, so only
 * the trailing segment — a uuid, which contains dashes — is greedy.
 */
export function parseAskAnchor(
  anchor: string,
): { candidateId: string; criterion?: string } | null {
  const crit = /^crit-([a-z]+)-(.+)$/.exec(anchor);
  if (crit) return { criterion: crit[1]!, candidateId: crit[2]! };
  // A whole-criteria summary anchors on the card itself.
  const card = /^cand-(.+)$/.exec(anchor);
  if (card) return { candidateId: card[1]! };
  return null;
}
