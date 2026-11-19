'use client';

import { DEMO_MASK } from '@/lib/demo/text-mask';

/**
 * Render a string, styling the demo-mode text placeholder inside it.
 *
 * The words themselves are withheld by the server (lib/demo/content.ts) — this
 * only makes the gap read as "withheld" rather than as stray glyphs. A string
 * without the placeholder renders as plain text, so it is safe to use in both
 * modes.
 */
export function DemoMaskedText({ text }: { text: string | null | undefined }) {
  if (!text || !text.includes(DEMO_MASK)) return <>{text}</>;
  const parts = text.split(DEMO_MASK);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <span
              className="select-none rounded-sm bg-muted px-1 not-italic tracking-tight text-muted-foreground/70"
              title="Disamarkan (mode demo)"
              aria-label="disamarkan"
            >
              {DEMO_MASK}
            </span>
          )}
        </span>
      ))}
    </>
  );
}
