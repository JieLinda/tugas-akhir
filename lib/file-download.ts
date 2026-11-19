/**
 * Browser download plumbing, shared by every client-side export in this app
 * (`lib/analysis-export.ts`, `lib/chat-export.ts`).
 *
 * It is one module rather than a helper copied per export file because the
 * ordering below is load-bearing and easy to get subtly wrong: some browsers
 * ignore a click on an anchor that was never inserted into the document, and
 * revoking the object URL in the same tick as the click can cancel the download
 * before it starts. A second copy would eventually be "simplified" back into the
 * version that fails on one browser and looks fine on the developer's.
 */

import { formatDateCompact } from '@/lib/datetime';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Next tick, not this one — see the note above.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Filename-safe slug of a human label. */
export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `YYYYMMDD` in the business timezone — the date the operator sees.
 *
 * Pinned rather than host-local: a download triggered from a server action ran
 * in the container (UTC), and near midnight WIB that stamped yesterday onto a
 * file the user was told was today's.
 */
export function fileDateStamp(date = new Date()) {
  return formatDateCompact(date);
}
