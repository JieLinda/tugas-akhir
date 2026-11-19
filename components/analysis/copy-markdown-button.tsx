'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAskAi } from '@/components/analysis/ask-ai-context';
import { encodeAskMessage, type AskRef } from '@/lib/ask-ai-envelope';

/**
 * Two actions on one summary.
 *
 * **Salin data** puts the DATA ONLY on the clipboard — no "Tolong jelaskan…"
 * instruction. A summary pasted into a spreadsheet, a ticket or an email should
 * not arrive carrying a prompt written for a language model.
 *
 * **Tanya AI** sends data + instruction to the assistant and moves the reader to
 * its tab. That removes the copy-switch-paste-send ritual entirely, and it is
 * also the only way the chat can know WHERE the question came from: the request
 * carries an origin so the message renders as a chip that navigates back (see
 * lib/ask-ai-envelope.ts).
 *
 * `build` is a thunk taking `ask`, not two strings: the Markdown is assembled from
 * detail objects, only one button is ever pressed, and a page can show dozens of
 * these. Building both payloads on every render would be pure waste.
 *
 * `stopPropagation` matters — several of these sit inside a clickable row, and
 * without it pressing one would also open that row's derivation.
 */
export function CopyMarkdownButton({
  build,
  askRef,
  label = 'Salin data',
  copiedLabel = 'Tersalin',
  className,
  size = 'sm',
}: {
  /** `ask: false` → data only (clipboard). `ask: true` → data + instruction (AI). */
  build: (opts: { ask: boolean }) => string;
  /**
   * What this summary is about and where it was asked from. Omit and the "Tanya
   * AI" action is hidden — a surface with no origin cannot offer a way back, and a
   * chip that navigates nowhere is worse than no chip.
   */
  askRef?: AskRef;
  label?: string;
  copiedLabel?: string;
  className?: string;
  size?: 'sm' | 'xs';
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { enabled, askAi } = useAskAi();

  // A pending timeout that fires after unmount would set state on a dead
  // component; this page mounts and unmounts these constantly as rows expand.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const text = build({ ask: false });
      try {
        await navigator.clipboard.writeText(text);
        setState('copied');
      } catch {
        // Clipboard API needs a secure context and permission; an HTTP
        // deployment or a denied prompt lands here. Fall back to the legacy
        // path rather than failing silently — with the figures now being click
        // targets, this is the only way to get the text out.
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          setState(ok ? 'copied' : 'failed');
        } catch {
          setState('failed');
        }
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2200);
    },
    [build],
  );

  const ask = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!askRef) return;
      askAi({ ref: askRef, payload: encodeAskMessage(askRef, build({ ask: true })) });
    },
    [askAi, askRef, build],
  );

  const copied = state === 'copied';
  const failed = state === 'failed';
  const text = size === 'xs' ? 'text-[9px]' : 'text-[10px]';
  const icon = size === 'xs' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  const showAsk = enabled && Boolean(askRef);

  return (
    <span className={cn('inline-flex shrink-0 items-stretch overflow-hidden rounded-md border', className)}>
      <button
        type="button"
        onClick={copy}
        title="Salin ringkasan data"
        aria-label={label}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 font-medium transition-colors',
          text,
          copied
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : failed
              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              : 'bg-primary/5 text-primary hover:bg-primary/10',
        )}
      >
        {copied ? <Check className={icon} /> : <Copy className={icon} />}
        {copied ? copiedLabel : failed ? 'Gagal menyalin' : label}
      </button>
      {showAsk && (
        <button
          type="button"
          onClick={ask}
          title="Kirim ringkasan ini ke AI Assistant"
          aria-label="Tanyakan ke AI Assistant"
          className={cn(
            'inline-flex items-center gap-1 border-l border-primary/25 bg-primary/10 px-1.5 py-0.5 font-semibold text-primary transition-colors hover:bg-primary/20',
            text,
          )}
        >
          <Sparkles className={icon} />
          Tanya AI
        </button>
      )}
    </span>
  );
}
