'use client';

// Job Family map for one scoring run — the Family Tree page's 2-D (UMAP)
// projection, re-used here with the run's finalists overlaid as profile photos.
// Each finalist sits on the job profile their CURRENT position is paired with
// (job_family_matches); the scored position's own job profile is the TARGET
// marker. Hovering a photo reports that candidate's distance to the target.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Crosshair,
  ExternalLink,
  Loader2,
  Network,
  ScatterChart,
  Tags,
  UserX,
  Users,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getInitials } from '@/lib/analysis-utils';
import { ZoomablePlot, type PlotMode } from '@/components/zoomable-plot';
import type { FamilyMapPoint } from '@/lib/position-family-map-actions';
import {
  getPositionFamilyMapAction,
  type PositionFamilyMap,
  type FamilyMapCandidate,
} from '@/lib/position-family-map-actions';

// Same categorical, colorblind-safe palette as the Family Tree scatter, so a
// family keeps its colour across both views. Noise/outlier = slate.
const PALETTE = [
  '#2563eb', '#f97316', '#16a34a', '#db2777', '#7c3aed', '#0891b2',
  '#ca8a04', '#dc2626', '#4f46e5', '#059669', '#d946ef', '#0d9488',
];
const NOISE_COLOR = '#94a3b8';

const W = 760;
const H = 440;
const PAD = 30;

export type FamilyMapFinalist = {
  id: string;
  name: string;
  photoUrl: string | null;
  currentPosition: string | null;
  weightedScore: number;
  readiness: string | null;
};

function shortLabel(label: string | null, tid: number): string {
  const base = (label ?? `T${tid}`).split(',')[0]!.trim();
  return base.length > 18 ? `${base.slice(0, 18)}…` : base;
}

/** Fan overlapping finalists (same job profile → identical coords) into a ring. */
function fanOffsets(count: number): { dx: number; dy: number }[] {
  if (count <= 1) return [{ dx: 0, dy: 0 }];
  const radius = count <= 4 ? 20 : 26;
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
  });
}

export function JobFamilyPositionMap({
  positionId,
  positionTitle,
  finalists,
}: {
  positionId: string;
  positionTitle: string;
  /** The run's top finalists, already in rank order (best first). */
  finalists: FamilyMapFinalist[];
}) {
  const [data, setData] = useState<PositionFamilyMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  /**
   * Finalist picked from the distance list. A click PINS what a hover only
   * previews: the map keeps the marker highlighted and its card open while the
   * same read-out is shown next to the row, so the list can be read without
   * scrolling back up to the map to hover each photo.
   */
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<PlotMode>('pan');
  /** Job-profile dot under the cursor — pointer mode only. */
  const [hoveredPoint, setHoveredPoint] = useState<FamilyMapPoint | null>(null);

  const candidateIds = useMemo(() => finalists.map((f) => f.id), [finalists]);
  const idsKey = candidateIds.join(',');

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    setSelected(null);
    getPositionFamilyMapAction(positionId, idsKey ? idsKey.split(',') : [])
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        console.error('getPositionFamilyMap failed', err);
        if (active) setError('Gagal memuat peta job family. Coba lagi.');
      });
    return () => {
      active = false;
    };
  }, [positionId, idsKey, reloadKey]);

  const finalistById = useMemo(
    () => new Map(finalists.map((f) => [f.id, f])),
    [finalists],
  );

  // Topic colours follow the same order rule as the Family Tree legend
  // (topics sorted by size, noise last).
  const colorFor = useMemo(() => {
    const order = new Map<number, number>();
    (data?.topics ?? []).filter((t) => t.topicId !== -1).forEach((t, i) => order.set(t.topicId, i));
    return (tid: number) =>
      tid === -1 ? NOISE_COLOR : PALETTE[(order.get(tid) ?? 0) % PALETTE.length]!;
  }, [data?.topics]);

  // ── Projection: data coords → SVG coords ──
  const projection = useMemo(() => {
    const pts = data?.points ?? [];
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // Include the target so it can never fall outside the drawn frame.
    if (data?.target?.x != null && data.target.y != null) {
      xs.push(data.target.x);
      ys.push(data.target.y);
    }
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    return {
      sx: (x: number) => PAD + ((x - minX) / spanX) * (W - 2 * PAD),
      sy: (y: number) => PAD + (1 - (y - minY) / spanY) * (H - 2 * PAD), // invert y
    };
  }, [data?.points, data?.target]);

  // ── Finalist markers, fanned out where they share a job profile ──
  const markers = useMemo(() => {
    if (!data || !projection) return [];
    const byProfile = new Map<number, FamilyMapCandidate[]>();
    for (const c of data.candidates) {
      const list = byProfile.get(c.jobProfileId) ?? [];
      list.push(c);
      byProfile.set(c.jobProfileId, list);
    }
    const out: {
      candidate: FamilyMapCandidate;
      finalist: FamilyMapFinalist;
      rank: number;
      cx: number;
      cy: number;
      anchorX: number;
      anchorY: number;
    }[] = [];
    for (const [, group] of byProfile) {
      const offsets = fanOffsets(group.length);
      group.forEach((c, i) => {
        const finalist = finalistById.get(c.candidateId);
        if (!finalist) return;
        const anchorX = projection.sx(c.x);
        const anchorY = projection.sy(c.y);
        out.push({
          candidate: c,
          finalist,
          rank: candidateIds.indexOf(c.candidateId) + 1,
          cx: anchorX + offsets[i]!.dx,
          cy: anchorY + offsets[i]!.dy,
          anchorX,
          anchorY,
        });
      });
    }
    return out.sort((a, b) => a.rank - b.rank);
  }, [data, projection, finalistById, candidateIds]);

  const targetPos = useMemo(() => {
    if (!data?.target || data.target.x == null || data.target.y == null || !projection) return null;
    return { cx: projection.sx(data.target.x), cy: projection.sy(data.target.y) };
  }, [data?.target, projection]);

  // ── States ──
  if (error) {
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
        <AlertTriangle className="h-5 w-5 text-rose-500" />
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Coba lagi
        </Button>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat peta job family…
      </Card>
    );
  }

  if (data.status !== 'ok' || data.points.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center text-sm text-muted-foreground">
        <Network className="h-6 w-6 text-muted-foreground/60" />
        <p className="max-w-md leading-relaxed">
          {data.message ??
            'Peta job family belum tersedia — hasil topic modelling tidak memuat titik yang dapat digambar.'}
        </p>
      </Card>
    );
  }

  const realTopics = data.topics.filter((t) => t.topicId !== -1);
  const noise = data.topics.find((t) => t.topicId === -1) ?? null;
  // Hover wins over the pinned selection, so pointing at another photo still
  // previews it without first having to clear the list selection.
  const activeId = hovered ?? selected;
  const hoveredMarker = markers.find((m) => m.candidate.candidateId === activeId) ?? null;
  const unmatched = data.unplaced.filter((u) => u.reason === 'no-match');
  const otherUnplaced = data.unplaced.filter((u) => u.reason !== 'no-match');
  const nearest = data.candidates.find((c) => c.distanceRank === 1) ?? null;

  return (
    <div className="space-y-4">
      {/* ── Statistik ── */}
      <div className="flex flex-wrap gap-2.5">
        <StatChip icon={Network} label="Job Family" value={realTopics.length} hint="klaster" />
        <StatChip icon={ScatterChart} label="Job Profile" value={data.points.length} hint="titik di peta" />
        <StatChip icon={Users} label="Finalis Terpetakan" value={data.candidates.length} hint={`dari ${finalists.length}`} />
        <StatChip
          icon={Crosshair}
          label="Job Family Target"
          value={data.target?.topicLabel ? shortLabel(data.target.topicLabel, data.target.topicId ?? 0) : '—'}
          hint={data.target?.positionName ?? 'profil target belum terpasang'}
        />
      </div>

      {!data.target && (
        <Banner tone="amber">
          Posisi target <strong>{positionTitle}</strong> belum berpasangan dengan satu job profile,
          sehingga titik acuan tidak dapat digambar. Pasangkan lewat{' '}
          <strong>Job qualification &amp; aturan posisi → Pilih dari Job Profile</strong>, atau
          jalankan Job Family Sync untuk pejabat saat ini.
        </Banner>
      )}
      {data.target && !targetPos && (
        <Banner tone="amber">
          Job profile target (<strong>{data.target.positionName ?? `#${data.target.jobProfileId}`}</strong>)
          belum ikut dalam run topic modelling terakhir, jadi jarak kandidat tidak dapat dihitung.
          Jalankan ulang <strong>langkah 3 (Bangun Ulang)</strong> di halaman Peta Job Family setelah profil tersebut di-embed.
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
        {/* ── Peta ── */}
        <div className="rounded-xl border bg-muted/10 p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ScatterChart className="h-3.5 w-3.5" /> Proyeksi 2D (UMAP) — ukuran titik ∝ jumlah incumbent
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                {mode === 'pan'
                  ? '· drag untuk geser · scroll untuk zoom'
                  : '· arahkan ke titik untuk detail · scroll untuk zoom'}
              </span>
            </div>
            {nearest && (
              <span className="text-[11px] text-muted-foreground">
                Terdekat:{' '}
                <strong className="text-foreground">
                  {finalistById.get(nearest.candidateId)?.name ?? '—'}
                </strong>{' '}
                · {nearest.distance!.toFixed(2)} unit
              </span>
            )}
          </div>

          <div className="relative">
          <ZoomablePlot
            className="rounded-lg"
            mode={mode}
            onModeChange={(m) => {
              setMode(m);
              setHoveredPoint(null);
            }}
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-auto w-full"
              role="img"
              aria-label={`Sebaran job family dan posisi kandidat finalis terhadap ${positionTitle}`}
            >
              {/* Job profiles — same encoding as the Family Tree scatter */}
              {data.points.map((p) => {
                const inTargetFamily =
                  data.target?.topicId != null && p.topicId === data.target.topicId;
                const isHovered =
                  mode === 'point' && hoveredPoint?.jobProfileId === p.jobProfileId;
                return (
                  <circle
                    key={p.jobProfileId}
                    cx={projection!.sx(p.x)}
                    cy={projection!.sy(p.y)}
                    r={3.5 + Math.min(6, p.incumbentCount * 1.3) + (isHovered ? 2 : 0)}
                    fill={colorFor(p.topicId)}
                    fillOpacity={p.topicId === -1 ? 0.3 : inTargetFamily ? 0.85 : 0.5}
                    stroke={isHovered || inTargetFamily ? '#0f172a' : 'none'}
                    strokeOpacity={isHovered ? 0.85 : 0.18}
                    strokeWidth={isHovered ? 1.5 : 0.75}
                    className={mode === 'point' ? 'cursor-crosshair transition-all' : undefined}
                    onMouseEnter={() => mode === 'point' && setHoveredPoint(p)}
                    onMouseLeave={() => setHoveredPoint(null)}
                  >
                    <title>
                      {`${p.positionName ?? '#' + p.jobProfileId}${
                        p.divisionDepartment ? '\n' + p.divisionDepartment : ''
                      }\n${p.incumbentCount} incumbent`}
                    </title>
                  </circle>
                );
              })}

              {/* Family centroid labels */}
              {data.topics
                .filter((t) => t.topicId !== -1 && t.x != null && t.y != null)
                .map((t) => (
                  <text
                    key={t.topicId}
                    x={projection!.sx(t.x!)}
                    y={projection!.sy(t.y!)}
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                    fontSize="9"
                    fontWeight="700"
                    fill={colorFor(t.topicId)}
                    fillOpacity={0.9}
                    stroke="white"
                    strokeWidth="0.4"
                    paintOrder="stroke"
                  >
                    {shortLabel(t.generalTitle ?? t.label, t.topicId)}
                  </text>
                ))}

              {/* Connector: each finalist → the target position */}
              {targetPos &&
                markers.map((m) => {
                  const active = activeId === m.candidate.candidateId;
                  return (
                    <line
                      key={`l-${m.candidate.candidateId}`}
                      x1={m.cx}
                      y1={m.cy}
                      x2={targetPos.cx}
                      y2={targetPos.cy}
                      stroke={active ? '#ea580c' : '#94a3b8'}
                      strokeOpacity={activeId ? (active ? 0.95 : 0.12) : 0.28}
                      strokeWidth={active ? 1.8 : 0.9}
                      strokeDasharray={active ? undefined : '3 3'}
                      className="pointer-events-none transition-all"
                    />
                  );
                })}

              {/* Target marker */}
              {targetPos && (
                <g className="pointer-events-none">
                  <circle
                    cx={targetPos.cx}
                    cy={targetPos.cy}
                    r={17}
                    fill="none"
                    stroke="#ea580c"
                    strokeOpacity={0.35}
                    strokeWidth={1.2}
                  />
                  <circle cx={targetPos.cx} cy={targetPos.cy} r={6} fill="#ea580c" />
                  <line
                    x1={targetPos.cx - 23}
                    y1={targetPos.cy}
                    x2={targetPos.cx - 11}
                    y2={targetPos.cy}
                    stroke="#ea580c"
                    strokeWidth={1.4}
                  />
                  <line
                    x1={targetPos.cx + 11}
                    y1={targetPos.cy}
                    x2={targetPos.cx + 23}
                    y2={targetPos.cy}
                    stroke="#ea580c"
                    strokeWidth={1.4}
                  />
                  <text
                    x={targetPos.cx}
                    y={targetPos.cy - 23}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="800"
                    fill="#ea580c"
                    stroke="white"
                    strokeWidth="0.5"
                    paintOrder="stroke"
                  >
                    TARGET · {shortLabel(data.target?.positionName ?? positionTitle, 0)}
                  </text>
                </g>
              )}
            </svg>

            {/* Finalist photos — HTML overlay so avatars stay crisp and hoverable */}
            <div className="pointer-events-none absolute inset-0">
              {markers.map((m) => {
                const active = activeId === m.candidate.candidateId;
                const leftPct = (m.cx / W) * 100;
                const topPct = (m.cy / H) * 100;
                return (
                  <div
                    key={m.candidate.candidateId}
                    className="pointer-events-auto absolute"
                    style={{ left: `${leftPct}%`, top: `${topPct}%`, transform: 'translate(-50%, -50%)' }}
                    onMouseEnter={() => setHovered(m.candidate.candidateId)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(m.candidate.candidateId)}
                    onBlur={() => setHovered(null)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${m.finalist.name} — ${
                      m.candidate.distance != null
                        ? `jarak ${m.candidate.distance.toFixed(2)} unit dari posisi target`
                        : 'jarak tidak tersedia'
                    }`}
                  >
                    <div
                      className={`relative rounded-full ring-2 transition-all ${
                        active
                          ? 'z-20 scale-110 ring-orange-500 shadow-lg'
                          : activeId
                            ? 'opacity-45 ring-white dark:ring-slate-900'
                            : 'ring-white dark:ring-slate-900'
                      }`}
                      style={{ boxShadow: active ? undefined : '0 1px 4px rgba(15,23,42,0.25)' }}
                    >
                      {m.finalist.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.finalist.photoUrl}
                          alt={m.finalist.name}
                          className="h-9 w-9 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="flex h-9 w-9 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ backgroundColor: colorFor(m.candidate.topicId ?? -1) }}
                        >
                          {getInitials(m.finalist.name)}
                        </div>
                      )}
                      <span className="absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900 px-1 text-[9px] font-bold text-white dark:bg-slate-100 dark:text-slate-900">
                        {m.rank}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Hover detail — jarak kandidat terhadap posisi target */}
              {hoveredMarker && (
                <HoverInfo
                  leftPct={(hoveredMarker.cx / W) * 100}
                  topPct={(hoveredMarker.cy / H) * 100}
                  finalist={hoveredMarker.finalist}
                  rank={hoveredMarker.rank}
                  candidate={hoveredMarker.candidate}
                  targetLabel={data.target?.positionName ?? positionTitle}
                  targetFamily={data.target?.topicLabel ?? null}
                  color={colorFor(hoveredMarker.candidate.topicId ?? -1)}
                />
              )}
            </div>
          </ZoomablePlot>

          {/* Pointer-mode readout for the job-profile dots. Sits outside
              <ZoomablePlot> so it stays at 1:1 regardless of zoom. */}
          {mode === 'point' && (
            <div className="pointer-events-none absolute bottom-2 left-2 z-20 max-w-72 rounded-lg border bg-popover/95 p-2.5 shadow-lg backdrop-blur">
              {hoveredPoint ? (
                <>
                  <p className="flex items-start gap-1.5 text-xs font-semibold leading-tight">
                    <span
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorFor(hoveredPoint.topicId) }}
                    />
                    <span className="min-w-0">
                      {hoveredPoint.positionName ?? `Job Profile #${hoveredPoint.jobProfileId}`}
                    </span>
                  </p>
                  {hoveredPoint.divisionDepartment && (
                    <p className="mt-0.5 pl-4 text-[10px] text-muted-foreground">
                      {hoveredPoint.divisionDepartment}
                    </p>
                  )}
                  <dl className="mt-1.5 space-y-0.5 pl-4 text-[10px]">
                    <div className="flex gap-1.5">
                      <dt className="w-20 shrink-0 text-muted-foreground">Job family</dt>
                      <dd className="min-w-0 flex-1 font-medium">
                        {data.topics.find((t) => t.topicId === hoveredPoint.topicId)?.generalTitle ??
                          data.topics.find((t) => t.topicId === hoveredPoint.topicId)?.label ??
                          `Topic ${hoveredPoint.topicId}`}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="w-20 shrink-0 text-muted-foreground">Incumbent</dt>
                      <dd className="min-w-0 flex-1 font-medium tabular-nums">
                        {hoveredPoint.incumbentCount}
                      </dd>
                    </div>
                    {data.target?.topicId != null && (
                      <div className="flex gap-1.5">
                        <dt className="w-20 shrink-0 text-muted-foreground">Vs target</dt>
                        <dd className="min-w-0 flex-1 font-medium">
                          {hoveredPoint.topicId === data.target.topicId
                            ? 'Se-job family'
                            : 'Beda job family'}
                        </dd>
                      </div>
                    )}
                  </dl>
                </>
              ) : (
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Arahkan kursor ke salah satu titik untuk melihat detail job profile-nya.
                </p>
              )}
            </div>
          )}
          </div>

          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Titik = job profile (ukuran ∝ jumlah incumbent), warna = job family. Foto = kandidat
            finalis, diletakkan pada job profile yang berpasangan dengan posisi mereka saat ini.
            Tanda oranye = posisi target run scoring ini. Arahkan kursor ke foto untuk melihat jarak.
          </p>
        </div>

        {/* ── Legenda job family ── */}
        <div className="rounded-xl border bg-muted/10 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Tags className="h-3.5 w-3.5" /> Daftar Job Family
          </div>
          <div className="max-h-132 overflow-y-auto pr-1">
            <div className="space-y-1">
              {realTopics.map((t) => {
                const isTarget = data.target?.topicId === t.topicId;
                return (
                  <div
                    key={t.topicId}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
                      isTarget ? 'bg-orange-500/10 ring-1 ring-orange-500/40' : ''
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorFor(t.topicId) }}
                    />
                    <span
                      className="min-w-0 flex-1 truncate font-medium"
                      title={t.generalTitle ?? t.label ?? ''}
                    >
                      {t.generalTitle ?? t.label ?? `Topic ${t.topicId}`}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{t.size}</span>
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-300">
                      <Users className="h-3 w-3" />
                      {t.incumbentCount}
                    </span>
                  </div>
                );
              })}
              {noise && (
                <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs opacity-70">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: NOISE_COLOR }}
                  />
                  <span className="min-w-0 flex-1 truncate">Outlier (noise)</span>
                  <span className="text-[10px] text-muted-foreground">{noise.size}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Ringkasan jarak per finalis ──
          Every row is selectable: clicking one opens the same card the map
          shows on hover, anchored to the row. */}
      {data.candidates.length > 0 && (
        <div className="rounded-xl border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Jarak finalis terhadap posisi target
            </div>
            <span className="text-[10px] text-muted-foreground/80">
              klik baris untuk detail kandidat
            </span>
          </div>
          <div className="divide-y">
            {[...data.candidates]
              .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
              .map((c) => {
                const f = finalistById.get(c.candidateId);
                if (!f) return null;
                const isOpen = selected === c.candidateId;
                return (
                  <Popover
                    key={c.candidateId}
                    open={isOpen}
                    onOpenChange={(open) => setSelected(open ? c.candidateId : null)}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-orange-500/50 ${
                          activeId === c.candidateId ? 'bg-orange-500/8' : ''
                        } ${isOpen ? 'bg-orange-500/10 shadow-[inset_3px_0_0_0_#f97316]' : ''}`}
                        onMouseEnter={() => setHovered(c.candidateId)}
                        onMouseLeave={() => setHovered(null)}
                        aria-expanded={isOpen}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colorFor(c.topicId ?? -1) }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{f.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {c.candidatePosition ?? f.currentPosition ?? '—'}
                            {c.jobProfileName ? ` · profil: ${c.jobProfileName}` : ''}
                          </p>
                        </div>
                        <span className="hidden shrink-0 truncate text-[11px] text-muted-foreground sm:block sm:max-w-40">
                          {c.topicLabel ?? '—'}
                        </span>
                        {c.sameFamily != null && (
                          <Badge
                            variant="secondary"
                            className={`shrink-0 text-[10px] ${
                              c.sameFamily
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {c.sameFamily ? 'Se-family' : 'Beda family'}
                          </Badge>
                        )}
                        <span className="w-24 shrink-0 text-right font-mono tabular-nums">
                          {c.distance != null ? `${c.distance.toFixed(2)} unit` : '—'}
                        </span>
                        <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-muted-foreground">
                          {c.proximity != null ? `${c.proximity.toFixed(0)}%` : '—'}
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 p-3" collisionPadding={12}>
                      <FinalistDetail
                        finalist={f}
                        rank={candidateIds.indexOf(c.candidateId) + 1}
                        candidate={c}
                        targetLabel={data.target?.positionName ?? positionTitle}
                        targetFamily={data.target?.topicLabel ?? null}
                        color={colorFor(c.topicId ?? -1)}
                      />
                    </PopoverContent>
                  </Popover>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Kandidat tanpa pasangan job profile ── */}
      {(unmatched.length > 0 || otherUnplaced.length > 0) && (
        <div className="rounded-xl border border-amber-300/70 bg-amber-500/5 p-4 dark:border-amber-900/50">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
            <UserX className="h-3.5 w-3.5" />
            Kandidat tanpa job profile teridentifikasi ({unmatched.length + otherUnplaced.length})
          </div>

          {unmatched.length > 0 && (
            <div className="mb-2">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90">
                  Tidak memiliki pasangan pada hasil job profile match — tidak dapat diletakkan di peta:
                </p>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 border-amber-300/70 bg-white/70 text-[11px] text-amber-900 hover:bg-amber-500/10 dark:border-amber-900/50 dark:bg-slate-950/40 dark:text-amber-200"
                >
                  <Link href="/job-profiles/match">
                    <ExternalLink className="mr-1 h-3 w-3" />
                    Buka Job Profile Match
                  </Link>
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {unmatched.map((u) => {
                  const f = finalistById.get(u.candidateId);
                  return (
                    <span
                      key={u.candidateId}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300/60 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-900/50 dark:bg-slate-950/40 dark:text-amber-200"
                      title={f?.currentPosition ?? undefined}
                    >
                      {f?.name ?? u.candidateId}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {otherUnplaced.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] text-amber-700/90 dark:text-amber-300/90">
                Berpasangan dengan job profile, tetapi profil tersebut belum masuk peta run terakhir:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {otherUnplaced.map((u) => {
                  const f = finalistById.get(u.candidateId);
                  return (
                    <span
                      key={u.candidateId}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300/60 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-900/50 dark:bg-slate-950/40 dark:text-amber-200"
                      title={u.jobProfileName ?? undefined}
                    >
                      {f?.name ?? u.candidateId}
                      {u.jobProfileName && (
                        <span className="font-normal opacity-70">· {u.jobProfileName}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

/** Hover card anchored to a finalist's photo, flipped when near the right edge. */
function HoverInfo({
  leftPct,
  topPct,
  ...detail
}: {
  leftPct: number;
  topPct: number;
} & FinalistDetailProps) {
  const flipX = leftPct > 58;
  const flipY = topPct > 62;
  return (
    <div
      className="pointer-events-none absolute z-30 w-64 rounded-xl border bg-popover/98 p-3 text-popover-foreground shadow-xl backdrop-blur"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: `translate(${flipX ? 'calc(-100% - 26px)' : '26px'}, ${
          flipY ? 'calc(-100% + 18px)' : '-18px'
        })`,
      }}
    >
      <FinalistDetail {...detail} />
    </div>
  );
}

type FinalistDetailProps = {
  finalist: FamilyMapFinalist;
  rank: number;
  candidate: FamilyMapCandidate;
  targetLabel: string;
  targetFamily: string | null;
  color: string;
};

/**
 * The finalist read-out itself — identity, job family/profile, and distance to
 * the target. Shared verbatim by the map's hover card and the popover opened
 * from a row of the distance list, so selecting a finalist anywhere shows the
 * same thing rather than a second, subtly different summary.
 */
function FinalistDetail({
  finalist,
  rank,
  candidate,
  targetLabel,
  targetFamily,
  color,
}: FinalistDetailProps) {
  return (
    <>
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-tight">
            #{rank} {finalist.name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {candidate.candidatePosition ?? finalist.currentPosition ?? '—'}
          </p>
        </div>
      </div>

      <dl className="space-y-1 text-[11px]">
        <Row label="Job family" value={candidate.topicLabel ?? 'Outlier'} />
        <Row label="Job profile" value={candidate.jobProfileName ?? '—'} />
        {candidate.divisionDepartment && (
          <Row label="Divisi/Dept" value={candidate.divisionDepartment} />
        )}
      </dl>

      <div className="mt-2 rounded-lg border border-orange-300/60 bg-orange-500/8 p-2 dark:border-orange-900/50">
        <p className="mb-1 truncate text-[10px] font-semibold uppercase tracking-wider text-orange-700 dark:text-orange-300">
          Jarak ke target
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {targetLabel}
          {targetFamily ? ` · ${targetFamily}` : ''}
        </p>
        {candidate.distance != null ? (
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="font-mono text-lg font-bold leading-none tabular-nums">
              {candidate.distance.toFixed(2)}
            </span>
            <span className="text-[10px] text-muted-foreground">unit UMAP</span>
            {candidate.proximity != null && (
              <span className="ml-auto text-[11px] font-semibold">
                {candidate.proximity.toFixed(0)}% dekat
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Titik target belum tersedia — jarak tidak dapat dihitung.
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {candidate.sameFamily != null && (
            <Badge
              variant="secondary"
              className={`text-[10px] ${
                candidate.sameFamily ? 'text-emerald-700 dark:text-emerald-300' : ''
              }`}
            >
              {candidate.sameFamily ? 'Se-job family' : 'Beda job family'}
            </Badge>
          )}
          {candidate.distanceRank != null && (
            <Badge variant="secondary" className="text-[10px]">
              Terdekat ke-{candidate.distanceRank}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            match: {candidate.matchType}
            {candidate.matchSimilarity != null
              ? ` ${(candidate.matchSimilarity * 100).toFixed(0)}%`
              : ''}
          </Badge>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

/** Compact single-line stat chip — mirrors the Family Tree page's strip. */
function StatChip({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="flex min-w-44 flex-1 items-center gap-2.5 rounded-xl border bg-card px-3.5 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="flex items-baseline gap-1.5 truncate text-base font-bold leading-tight tabular-nums">
          {value}
          {hint && <span className="truncate text-[10px] font-normal text-muted-foreground">{hint}</span>}
        </p>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'amber'; children: React.ReactNode }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3 ${
        tone === 'amber' ? 'border-amber-300/70 bg-amber-500/5 dark:border-amber-900/50' : ''
      }`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">{children}</p>
    </div>
  );
}
