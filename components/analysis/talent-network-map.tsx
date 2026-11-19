'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { Orbit, ZoomIn, ZoomOut, RotateCcw, Move } from 'lucide-react';
import type { PositionSummary } from '@/lib/talent-data';
import { type AnalysisCandidate, getInitials } from '@/lib/analysis-utils';

interface TalentNetworkMapProps {
  rankedCandidates: AnalysisCandidate[];
  selectedCandidate: AnalysisCandidate | null;
  compareCandidate: AnalysisCandidate | null;
  selectedPosition: PositionSummary;
  onSelectCandidate: (id: string) => void;
}

const CENTER = { x: 50, y: 50 };
const MAX_NODES = 10;

// Pixel budget the orbit layout has to respect. The old percentage-only scale
// ignored these, so the innermost band landed *inside* the centre hub (a
// "Ready Now" node was drawn underneath the target-position badge) and the
// outer band ran under the stats bar.
const HUB_RADIUS = 48; // centre hub is size-24 (96px)
const NODE_RADIUS = 24; // avatar is size-12 (48px)
const LABEL_SPACE = 34; // name/score chip sits below each avatar
const EDGE_PAD = 10;
/** Clear space between the hub edge and the innermost orbit. */
const HUB_CLEARANCE = 14;
/** How much wider than tall the orbits may stretch before they look squashed. */
const MAX_ECCENTRICITY = 1.75;

// Readiness palette — kept in sync with the Diagnostic Dossier theme so the
// same readiness reads the same colour across the analysis views.
// Short = emerald · Medium = amber · Long = sky · Not Ready = rose.
const readinessHex: Record<string, string> = {
  Short: '#10b981',
  Medium: '#f59e0b',
  Long: '#0ea5e9',
  'Not Ready': '#f43f5e',
};

const readinessDot: Record<string, string> = {
  Short: 'bg-emerald-400',
  Medium: 'bg-amber-400',
  Long: 'bg-sky-400',
  'Not Ready': 'bg-rose-400',
};

/**
 * Readiness orbit bands. Distance from the target position encodes
 * succession readiness: the closer the orbit, the more ready the candidate.
 * Within a band, a higher weighted score pulls the node toward the center.
 * Score ranges mirror the default readiness thresholds (80/65/50).
 */
const ZONES = [
  { key: 'Short', label: 'Ready Now', inner: 11, outer: 18, min: 80, max: 100 },
  { key: 'Medium', label: '1–2 Tahun', inner: 20.5, outer: 27, min: 65, max: 80 },
  { key: 'Long', label: '3–5 Tahun', inner: 29.5, outer: 35, min: 50, max: 65 },
  { key: 'Not Ready', label: 'Not Ready', inner: 37.5, outer: 42, min: 0, max: 50 },
] as const;

/** Ring radii separating the orbit bands (drawn as boundary ellipses). */
const RING_BOUNDARIES = [19.25, 28.25, 36.25, 43.5];

/** Zone tint fills, painted outermost-first so inner circles overlay.
 *  Hues match the readiness palette: Not Ready rose → Long sky → Medium amber
 *  → Short emerald (innermost). */
const ZONE_FILLS = [
  { r: 43.5, fill: 'rgba(244,63,94,0.035)' },
  { r: 36.25, fill: 'rgba(14,165,233,0.045)' },
  { r: 28.25, fill: 'rgba(245,158,11,0.05)' },
  { r: 19.25, fill: 'rgba(16,185,129,0.06)' },
];

/** Domain of the hand-tuned zone radii above, mapped onto real pixels below. */
const ZONE_R_MIN = ZONES[0].inner;
const ZONE_R_MAX = 43.5;

// Score-arc geometry for the avatar ring (56px node, r=26 → C≈163.4)
const NODE_RING_C = 2 * Math.PI * 26;

/** Resolution of the arc-length table used to place nodes evenly. */
const ARC_SAMPLES = 1440;

/**
 * Evenly spaced angles around an ellipse `a`×`b`, measured by ARC LENGTH.
 *
 * Stepping the parametric angle uniformly does not space points uniformly on an
 * ellipse: the point travels slowest near the ends of the major axis, so nodes
 * bunch up on the left and right of a wide orbit (measured at 1.5× tighter
 * there) while the top and bottom sit empty. Walking equal arc-length steps
 * instead puts each candidate where it visually belongs.
 *
 * Starts at the top so the vertical axis stays free for the zone labels.
 */
function arcEvenAngles(count: number, a: number, b: number): number[] {
  const start = -Math.PI / 2;
  const step = (Math.PI * 2) / ARC_SAMPLES;
  const cum = new Float64Array(ARC_SAMPLES + 1);
  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const t = start + (i - 0.5) * step;
    // |dP/dt| — how fast the point moves along the ellipse at this angle.
    cum[i] = cum[i - 1]! + Math.hypot(a * Math.sin(t), b * Math.cos(t));
  }
  const total = cum[ARC_SAMPLES]!;
  if (!(total > 0)) {
    return Array.from({ length: count }, (_, i) => start + ((i + 0.5) / count) * Math.PI * 2);
  }
  return Array.from({ length: count }, (_, i) => {
    const target = ((i + 0.5) / count) * total;
    let lo = 1;
    let hi = ARC_SAMPLES;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return start + lo * step;
  });
}

export function TalentNetworkMap({
  rankedCandidates,
  selectedCandidate,
  compareCandidate,
  selectedPosition,
  onSelectCandidate,
}: TalentNetworkMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);
  const transformState = useRef({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastOffset = useRef({ x: 0, y: 0 });

  const [hasMoved, setHasMoved] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Real pixel size of the plot area. Orbits are laid out in pixels and only
  // converted to percentages at render time, so a circle stays circular and —
  // more importantly — the innermost band always clears the centre hub.
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.height === 0 || rect.width === 0) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      setSize((prev) => (Math.abs(prev.w - w) > 1 || Math.abs(prev.h - h) > 1 ? { w, h } : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * Map a zone radius (the hand-tuned 11–43.5 domain) to a pixel radius that
   * fits the container: never closer than hub+node clearance, never past the
   * edge once the avatar and its label are accounted for.
   */
  const geom = useMemo(() => {
    const { w, h } = size;
    if (!w || !h) return null;
    const availX = w / 2 - NODE_RADIUS - EDGE_PAD;
    // Labels hang below the node, so the vertical budget is the tighter one.
    const availY = h / 2 - NODE_RADIUS - LABEL_SPACE - EDGE_PAD;

    // The card is much wider than it is tall, so a strict circle would leave
    // ~140px of dead space on each side and cram every node into the middle
    // band. Let the orbits widen into ellipses that use the horizontal room,
    // capped so they never look squashed.
    const outerY = Math.max(40, availY);
    const outerX = Math.max(40, Math.min(availX, outerY * MAX_ECCENTRICITY));

    const baseInner = HUB_RADIUS + NODE_RADIUS + HUB_CLEARANCE;
    // Below roughly 380px of plot height there is no arrangement that fits four
    // bands plus 48px nodes; keep the bands ordered and legible rather than
    // inverted. The card's min-h keeps normal layouts well clear of this.
    const innerY = outerY <= baseInner + 24 ? Math.max(24, outerY * 0.42) : baseInner;
    const innerX = outerX <= baseInner + 24 ? Math.max(24, outerX * 0.42) : baseInner;

    const mapper = (inner: number, outer: number) => {
      const span = Math.max(1, outer - inner);
      return (z: number) => inner + ((z - ZONE_R_MIN) / (ZONE_R_MAX - ZONE_R_MIN)) * span;
    };
    // Shrink the hub when the innermost orbit can't clear it, so a "Ready Now"
    // node is never drawn on top of the target-position badge.
    const hubDiameter = Math.round(
      Math.max(56, Math.min(HUB_RADIUS * 2, (Math.min(innerX, innerY) - NODE_RADIUS - 8) * 2)),
    );
    return { toPxX: mapper(innerX, outerX), toPxY: mapper(innerY, outerY), hubDiameter };
  }, [size]);

  /** Pixel radius → percentage of width / height (the SVG viewBox is stretched). */
  const rx = useCallback(
    (z: number) => (geom && size.w ? (geom.toPxX(z) / size.w) * 100 : 0),
    [geom, size.w],
  );
  const ry = useCallback(
    (z: number) => (geom && size.h ? (geom.toPxY(z) / size.h) * 100 : 0),
    [geom, size.h],
  );

  const applyTransform = useCallback(() => {
    const el = transformRef.current;
    if (!el) return;
    const { x, y, scale } = transformState.current;
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }, []);

  // ── Orbit layout: radius from readiness band + score, angle by rank ────
  const nodes = useMemo(() => {
    const list = rankedCandidates.slice(0, MAX_NODES);
    const count = Math.max(list.length, 1);
    // Space the ranks evenly along the orbit's arc, using the outermost ellipse
    // as the reference shape, so a wide orbit spreads candidates out instead of
    // crowding them against its left and right edges.
    const angles = arcEvenAngles(
      count,
      geom ? geom.toPxX(ZONE_R_MAX) : 1,
      geom ? geom.toPxY(ZONE_R_MAX) : 1,
    );
    return list.map((candidate, i) => {
      const zone = ZONES.find((z) => z.key === candidate.readiness) ?? ZONES[3];
      const span = Math.max(1, zone.max - zone.min);
      const t = Math.max(0, Math.min(1, (candidate.weightedScore - zone.min) / span));
      const r = zone.outer - t * (zone.outer - zone.inner);
      const angle = angles[i]!;
      return {
        candidate,
        x: CENTER.x + Math.cos(angle) * rx(r),
        y: CENTER.y + Math.sin(angle) * ry(r),
      };
    });
  }, [rankedCandidates, rx, ry, geom]);

  // ── Pan (direct DOM manipulation — no React re-renders) ────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    lastOffset.current = { ...transformState.current };
    transformRef.current?.classList.remove('transition-transform', 'duration-200');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    transformState.current = {
      ...transformState.current,
      x: lastOffset.current.x + dx,
      y: lastOffset.current.y + dy,
    };
    applyTransform();
    if (!hasMoved) setHasMoved(true);
  }, [applyTransform, hasMoved]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = false;
    transformRef.current?.classList.add('transition-transform', 'duration-200');
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  // ── Wheel zoom (native listener for passive: false) ────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = -e.deltaY * 0.0015;
      transformState.current = {
        ...transformState.current,
        scale: Math.min(2.5, Math.max(0.5, transformState.current.scale + delta)),
      };
      applyTransform();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [applyTransform]);

  // ── Zoom controls ──────────────────────────────────────────────────────
  const zoomIn = useCallback(() => {
    transformState.current = { ...transformState.current, scale: Math.min(2.5, transformState.current.scale + 0.25) };
    applyTransform();
  }, [applyTransform]);

  const zoomOut = useCallback(() => {
    transformState.current = { ...transformState.current, scale: Math.max(0.5, transformState.current.scale - 0.25) };
    applyTransform();
  }, [applyTransform]);

  const resetView = useCallback(() => {
    transformState.current = { x: 0, y: 0, scale: 1 };
    applyTransform();
    setHasMoved(false);
  }, [applyTransform]);

  // Active = hovered (priority) or selected
  const activeId = hoveredId ?? selectedCandidate?.id ?? null;

  // Mean of the final score. This replaced "Avg Quality", the mean of a figure
  // that was itself the final score shifted by ~2 points.
  const avgScore = rankedCandidates.length
    ? Math.round(rankedCandidates.reduce((sum, c) => sum + c.weightedScore, 0) / rankedCandidates.length)
    : 0;

  return (
    <Card className="overflow-hidden border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-[0_28px_70px_-38px_rgba(15,23,42,0.82)] relative flex min-h-[34rem] lg:min-h-0 h-full flex-col">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800/80 bg-linear-to-r from-slate-50 via-white to-amber-50/50 dark:from-slate-900 dark:via-slate-950 dark:to-amber-950/20 px-5 py-3.5 z-20 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-slate-50 font-bold tracking-wide">
              <Orbit className="h-4 w-4 text-amber-500 dark:text-amber-400" />
              Peta Orbit Suksesi (Talent Map)
              <InfoHint title="Peta Orbit Suksesi">
                Semakin dekat ke pusat, semakin siap kandidat. Klik kandidat untuk fokus · Drag untuk geser · Scroll untuk zoom.
              </InfoHint>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {ZONES.map((zone) => (
                <span key={zone.key} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  <span className={`size-2 rounded-full ${readinessDot[zone.key]}`} />
                  {zone.label}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <button type="button" onClick={zoomIn} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors" title="Zoom in">
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={zoomOut} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors" title="Zoom out">
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={resetView} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors border-l border-slate-200 dark:border-slate-800" title="Reset view">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 select-none flex-1 min-h-0 overflow-hidden">
        <style>{`@keyframes nodeAppear { from { opacity: 0; } to { opacity: 1; } }`}</style>
        <div
          ref={containerRef}
          className="relative size-full overflow-hidden bg-linear-to-br from-slate-100 via-slate-50 to-white dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* Transform layer — transform applied via ref, NOT React state */}
          <div
            ref={transformRef}
            className="absolute inset-0 transition-transform duration-200 ease-out"
            style={{ transformOrigin: 'center center', willChange: 'transform' }}
          >
            {/* Soft glow at the gravitational center */}
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.14),transparent_68%)]"
              style={{ animation: 'graphPulse 6s ease-in-out infinite' }}
            />

            {/* SVG: orbit rings + gravity lines */}
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              {/* Zone tint fills (outermost first) */}
              {ZONE_FILLS.map((zone, i) => (
                <ellipse
                  key={`fill-${i}`}
                  cx={CENTER.x}
                  cy={CENTER.y}
                  rx={rx(zone.r)}
                  ry={ry(zone.r)}
                  fill={zone.fill}
                />
              ))}

              {/* Orbit boundary rings */}
              {RING_BOUNDARIES.map((r, i) => (
                <ellipse
                  key={`ring-${i}`}
                  cx={CENTER.x}
                  cy={CENTER.y}
                  rx={rx(r)}
                  ry={ry(r)}
                  fill="none"
                  stroke="rgba(148,163,184,0.32)"
                  strokeWidth={i === RING_BOUNDARIES.length - 1 ? 0.2 : 0.14}
                  strokeDasharray={i === RING_BOUNDARIES.length - 1 ? undefined : '1 1.4'}
                />
              ))}

              {/* Gravity lines: candidate → target position */}
              {nodes.map(({ candidate, x, y }) => {
                const isActive = candidate.id === activeId;
                const isDimmed = activeId !== null && !isActive;
                const color = readinessHex[candidate.readiness] ?? '#94a3b8';
                return (
                  <g key={`edge-${candidate.id}`}>
                    <line
                      x1={x}
                      y1={y}
                      x2={CENTER.x}
                      y2={CENTER.y}
                      stroke={color}
                      strokeWidth={isActive ? 0.5 : 0.28}
                      strokeOpacity={isDimmed ? 0.05 : isActive ? 0.35 : 0.16}
                    />
                    <line
                      x1={x}
                      y1={y}
                      x2={CENTER.x}
                      y2={CENTER.y}
                      stroke={color}
                      strokeWidth={isActive ? 0.34 : 0.18}
                      strokeOpacity={isDimmed ? 0.07 : isActive ? 0.9 : 0.4}
                      strokeDasharray="2.5 4.5"
                      style={{ animation: `signalFlow ${isActive ? '1.5s' : '3s'} linear infinite` }}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Zone labels along the free top axis */}
            {ZONES.map((zone) => (
              <span
                key={`label-${zone.key}`}
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200/70 dark:border-slate-800/70 bg-white/70 dark:bg-slate-950/70 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 backdrop-blur-sm"
                style={{ left: '50%', top: `${CENTER.y - ry((zone.inner + zone.outer) / 2)}%` }}
              >
                {zone.label}
              </span>
            ))}

            {/* Center hub: the target position */}
            <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
              {/* Diameter comes from the layout (HUB_RADIUS*2 normally, smaller
                  on cramped containers) so the hub can never overlap the
                  innermost orbit. */}
              <div
                className="relative flex flex-col items-center justify-center rounded-full border-2 border-amber-500/40 bg-white/96 dark:bg-slate-900/96 p-2 text-center shadow-[0_24px_60px_-28px_rgba(245,158,11,0.9)] backdrop-blur-md"
                style={{ width: geom?.hubDiameter ?? 96, height: geom?.hubDiameter ?? 96 }}
              >
                <span className="text-[7px] uppercase font-extrabold tracking-[0.2em] text-amber-600 dark:text-amber-400">
                  Posisi Target
                </span>
                <p className="mt-0.5 text-[10px] font-bold leading-tight text-slate-900 dark:text-white line-clamp-2">
                  {selectedPosition.title}
                </p>
                <span className="mt-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-px text-[8px] font-bold text-emerald-600 dark:text-emerald-400">
                  {selectedPosition.readyNow} Ready
                </span>
              </div>
            </div>

            {/* Candidate nodes: avatar + score arc, orbiting the position */}
            {nodes.map(({ candidate, x, y }, index) => {
              const isSelected = candidate.id === selectedCandidate?.id;
              const isCompare = candidate.id === compareCandidate?.id;
              const isHovered = candidate.id === hoveredId;
              const isDimmed = activeId !== null && candidate.id !== activeId;
              const color = readinessHex[candidate.readiness] ?? '#94a3b8';
              const arc = (Math.max(0, Math.min(100, candidate.weightedScore)) / 100) * NODE_RING_C;

              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onSelectCandidate(candidate.id)}
                  onMouseEnter={() => setHoveredId(candidate.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  aria-label={`${candidate.name}, skor ${candidate.weightedScore}, readiness ${candidate.readiness}`}
                  className={`absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-all duration-200 cursor-pointer ${
                    isDimmed ? 'opacity-30' : ''
                  } ${isHovered ? 'scale-110 z-30' : ''}`}
                  style={{ left: `${x}%`, top: `${y}%`, animation: `nodeAppear 0.5s ease-out ${index * 0.06}s backwards` }}
                >
                  <div
                    className={`relative size-12 rounded-full transition-shadow ${
                      isSelected
                        ? 'ring-2 ring-amber-400/70 ring-offset-2 ring-offset-transparent shadow-[0_0_18px_rgba(245,158,11,0.4)]'
                        : isCompare
                          ? 'ring-2 ring-sky-400/70 ring-offset-2 ring-offset-transparent shadow-[0_0_14px_rgba(14,165,233,0.3)]'
                          : ''
                    }`}
                  >
                    {/* Score arc around the avatar */}
                    <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
                      <circle cx="28" cy="28" r="26" fill="none" stroke={color} strokeOpacity="0.18" strokeWidth="2.5" />
                      <circle
                        cx="28"
                        cy="28"
                        r="26"
                        fill="none"
                        stroke={color}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray={`${arc} ${NODE_RING_C}`}
                      />
                    </svg>
                    <Avatar className="absolute inset-1 size-10 border border-slate-200 dark:border-slate-800/80">
                      <AvatarImage className="object-cover" src={candidate.profile?.photoUrl ?? ''} alt={candidate.name} />
                      <AvatarFallback className="bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {getInitials(candidate.name)}
                      </AvatarFallback>
                    </Avatar>
                    {/* Rank badge */}
                    <span className="absolute -top-1 -left-1 flex size-4.5 items-center justify-center rounded-full bg-slate-900 dark:bg-white text-[8px] font-extrabold text-white dark:text-slate-900 border border-white dark:border-slate-950 shadow-sm">
                      {index + 1}
                    </span>
                    {/* Readiness dot */}
                    <span className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white dark:border-slate-950 ${readinessDot[candidate.readiness] ?? 'bg-slate-400'}`} />
                    {isSelected && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-md bg-amber-500 px-1.5 py-px text-[7px] uppercase tracking-wider font-extrabold text-slate-950 shadow-sm whitespace-nowrap">
                        AKTIF
                      </span>
                    )}
                  </div>

                  {/* Label */}
                  <div className="mt-1.5 flex flex-col items-center rounded-lg bg-white/85 dark:bg-slate-950/85 px-2 py-0.5 backdrop-blur-sm border border-slate-200/60 dark:border-slate-800/60 shadow-sm">
                    <span className="max-w-28 truncate text-[10px] font-bold text-slate-900 dark:text-white leading-tight">
                      {candidate.name}
                    </span>
                    <span className="text-[9px] font-bold tabular-nums" style={{ color }}>
                      {candidate.weightedScore}%
                    </span>
                    {(isHovered || isSelected) && candidate.currentPosition && (
                      <span className="max-w-32 truncate text-[8px] text-slate-400 dark:text-slate-500">
                        {candidate.currentPosition}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Drag hint — shows until first interaction */}
          {!hasMoved && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 px-2.5 py-1 rounded-full backdrop-blur-sm pointer-events-none opacity-60 transition-opacity">
              <Move className="h-3 w-3 text-slate-500" />
              <span className="text-[10px] font-medium text-slate-500">Drag untuk menggeser · Scroll untuk zoom</span>
            </div>
          )}
        </div>
      </CardContent>

      {/* Stats — a real footer row, not an overlay. As an absolutely-positioned
          bar it sat on top of the outermost orbit (and swallowed it entirely on
          short cards); giving it its own row hands that space back to the map. */}
      <div className="shrink-0 grid gap-3 border-t border-slate-100 dark:border-slate-800/80 bg-white/95 dark:bg-slate-950/95 px-5 py-3 sm:grid-cols-3">
        <div className="sm:border-r border-slate-200 dark:border-slate-800/80 sm:pr-3">
          <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-slate-400 dark:text-slate-500">Shortlist Pool</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white tracking-wide">{rankedCandidates.length} Kandidat</p>
        </div>
        <div className="sm:border-r border-slate-200 dark:border-slate-800/80 sm:px-3">
          <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-slate-400 dark:text-slate-500 font-mono">Avg Score</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white tracking-wide">{avgScore}%</p>
        </div>
        <div className="sm:pl-3">
          <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-slate-400 dark:text-slate-500">Top Candidate</p>
          <p className="mt-0.5 text-sm font-bold text-amber-600 dark:text-amber-400 truncate">{rankedCandidates[0]?.name ?? '-'}</p>
        </div>
      </div>
    </Card>
  );
}
