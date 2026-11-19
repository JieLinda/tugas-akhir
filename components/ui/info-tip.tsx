'use client';

import { InfoHint } from '@/components/ui/info-hint';

interface InfoTipProps {
  content: string;
  className?: string;
  /** Kept for existing call sites; the hint draws its own circled "?". */
  iconClassName?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * The older one-line tooltip, now the same circled "?" as every other
 * explanation in the app (components/ui/info-hint.tsx): it opens on hover, and
 * also on tap and keyboard — a plain tooltip never opened on a touch screen.
 */
export function InfoTip({ content, className, side = 'top' }: InfoTipProps) {
  return (
    <InfoHint side={side} align="center" className={className}>
      {content}
    </InfoHint>
  );
}
