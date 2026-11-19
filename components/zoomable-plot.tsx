'use client';

// Pan + zoom wrapper for static plots (SVG scatters and any absolutely
// positioned overlay on top of them). Same interaction model as the Peta Orbit
// talent map: drag to pan, scroll to zoom, plus in/out/reset buttons.
//
// The transform is written straight to the DOM through a ref — never React
// state — so dragging a scatter with hundreds of nodes doesn't re-render the
// whole child tree on every pointer move.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Hand, MousePointer2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 *  • 'pan'   — hand grip: dragging moves the plot around.
 *  • 'point' — dragging is off, so the cursor is free to inspect data points.
 * Zoom (wheel + buttons) works in both.
 */
export type PlotMode = 'pan' | 'point';

/** Pointer travel (px) before a press counts as a pan instead of a click, so
 *  clicking a data point still selects it. */
const DRAG_THRESHOLD = 4;

export function ZoomablePlot({
  children,
  className,
  minScale = 0.5,
  maxScale = 4,
  step = 0.25,
  mode: controlledMode,
  onModeChange,
}: {
  children: React.ReactNode;
  /** Extra classes for the clipping viewport (height comes from the child). */
  className?: string;
  minScale?: number;
  maxScale?: number;
  step?: number;
  /** Controlled mode — pass with onModeChange when the parent renders its own
   *  hover readout outside the (scaled) transform layer. */
  mode?: PlotMode;
  onModeChange?: (mode: PlotMode) => void;
}) {
  const [uncontrolledMode, setUncontrolledMode] = useState<PlotMode>('pan');
  const mode = controlledMode ?? uncontrolledMode;
  const setMode = useCallback(
    (next: PlotMode) => {
      if (controlledMode === undefined) setUncontrolledMode(next);
      onModeChange?.(next);
    },
    [controlledMode, onModeChange],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);
  const state = useRef({ x: 0, y: 0, scale: 1 });

  const pressed = useRef(false);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastOffset = useRef({ x: 0, y: 0 });

  const apply = useCallback(() => {
    const el = transformRef.current;
    if (!el) return;
    const { x, y, scale } = state.current;
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }, []);

  const setScale = useCallback(
    (next: number) => {
      state.current = {
        ...state.current,
        scale: Math.min(maxScale, Math.max(minScale, next)),
      };
      apply();
    },
    [apply, maxScale, minScale],
  );

  // Wheel zoom needs a native listener: React's synthetic wheel handler is
  // passive, so preventDefault() there is a no-op.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setScale(state.current.scale - e.deltaY * 0.0015);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [setScale]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (mode !== 'pan') return; // pointer mode: leave the cursor to the data
      if ((e.target as HTMLElement).closest('button')) return;
      pressed.current = true;
      dragging.current = false;
      dragStart.current = { x: e.clientX, y: e.clientY };
      lastOffset.current = { x: state.current.x, y: state.current.y };
    },
    [mode],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pressed.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;

      // Promote to a drag only past the threshold — and only then capture the
      // pointer, so a plain click still reaches the data point underneath.
      if (!dragging.current) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging.current = true;
        transformRef.current?.classList.remove('transition-transform', 'duration-200');
        e.currentTarget.setPointerCapture(e.pointerId);
      }

      state.current = { ...state.current, x: lastOffset.current.x + dx, y: lastOffset.current.y + dy };
      apply();
    },
    [apply],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) {
      transformRef.current?.classList.add('transition-transform', 'duration-200');
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
    pressed.current = false;
    dragging.current = false;
  }, []);

  const reset = useCallback(() => {
    state.current = { x: 0, y: 0, scale: 1 };
    apply();
  }, [apply]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className={cn(
          'relative touch-none overflow-hidden',
          mode === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair',
          className,
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={transformRef}
          className="relative transition-transform duration-200 ease-out"
          style={{ transformOrigin: 'center center', willChange: 'transform' }}
        >
          {children}
        </div>
      </div>

      <div className="absolute right-2 top-2 z-30 flex items-center gap-1.5">
        {/* Mode: hand grip (pan) vs pointer (inspect) */}
        <div className="flex items-center overflow-hidden rounded-lg border bg-background/90 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => setMode('pan')}
            title="Mode geser (hand grip) — tarik peta untuk berpindah"
            aria-label="Mode geser"
            aria-pressed={mode === 'pan'}
            className={cn(
              'p-1.5 transition-colors',
              mode === 'pan'
                ? 'bg-primary/12 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Hand className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMode('point')}
            title="Mode penunjuk — arahkan ke titik untuk melihat detail job profile"
            aria-label="Mode penunjuk"
            aria-pressed={mode === 'point'}
            className={cn(
              'border-l p-1.5 transition-colors',
              mode === 'point'
                ? 'bg-primary/12 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <MousePointer2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center overflow-hidden rounded-lg border bg-background/90 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => setScale(state.current.scale + step)}
          title="Perbesar"
          aria-label="Perbesar"
          className="p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setScale(state.current.scale - step)}
          title="Perkecil"
          aria-label="Perkecil"
          className="p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={reset}
          title="Atur ulang tampilan"
          aria-label="Atur ulang tampilan"
          className="border-l p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        </div>
      </div>
    </div>
  );
}
