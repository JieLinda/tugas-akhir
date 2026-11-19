'use client';

import { Fragment, useMemo, useState } from 'react';
import { Calculator, GripVertical, Hand, TriangleAlert } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BOX_META } from '@/lib/hav-box-meta';
import {
  HAV_GRID_COLUMNS,
  HAV_GRID_ROWS,
  HAV_QUADRANT_MATRIX,
  TALENT_BOXES,
  type HavBand,
} from '@/lib/hav-quadrant-derive';
import { formatDateTime } from '@/lib/datetime';
import type { TalentMappingCandidate } from '@/lib/talent-mapping';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';

import {
  BandChip,
  BoxChip,
  TALENT_DRAG_MIME as DRAG_MIME,
  automaticSourceLabel,
  quadrantBox,
  quadrantLabel,
  quadrantName,
} from './shared';
import { UnplacedQueue } from './unplaced-queue';


/** What each band means, in the methodology's own terms — the axis legends. */
const BA_BAND_HINT: Record<HavBand, { short: string; full: string }> = {
  High: { short: 'STRENGTH', full: 'STRENGTH' },
  'Mid High': {
    short: 'VERY HIGH · PJP',
    full: 'VERY HIGH, PENGEMBANGAN JANGKA PENDEK',
  },
  'Mid Low': {
    short: 'HIGH · READY · POTENSI…',
    full: 'NEED TARGETED DEVELOPMENT, HIGH, READY, POTENSI, MIDDLE HIGH, READY WITH DEVELOPMENT',
  },
  Low: {
    short: 'LOW · MIDDLE LOW…',
    full: 'LOW, MIDDLE LOW, FOCUS ON OPTIMIZATION (juga VERY LOW, NOT READY, BELUM ADA POTENSI)',
  },
};

const PA_BAND_HINT: Record<HavBand, { short: string; full: string }> = {
  High: { short: 'AA · AB · BA · BB', full: '2 periode terakhir A/B semua' },
  'Mid High': { short: 'CA · CB · AC · BC', full: '2 periode terakhir: satu C dan satu A/B' },
  'Mid Low': { short: 'CC', full: '2 periode terakhir C semua' },
  Low: { short: 'D · E · C- (2 thn)', full: 'Pernah ada D, E, atau C- dalam 2 tahun terakhir' },
};

function chipTooltip(c: TalentMappingCandidate): string {
  const lines = [c.name, [c.currentPosition, c.department].filter(Boolean).join(' · ')];
  if (c.source === 'manual' && c.placement) {
    lines.push(
      `Ditempatkan manual oleh ${c.placement.placedByName ?? c.placement.placedByUsername ?? 'pengguna'} · ${formatDateTime(c.placement.placedAt)}`,
      `HAV otomatis: ${c.automatic.quadrant != null ? `${quadrantLabel(c.automatic.quadrant)} (${automaticSourceLabel(c.automatic.source)})` : 'tidak ada'}`,
    );
    if (c.baselineDrifted) lines.push('⚠ HAV otomatis berubah sejak penempatan ini dibuat');
  } else if (c.source === 'upload') {
    lines.push('Dari upload HAV');
  } else if (c.source === 'formula') {
    lines.push('Dari rumus PA × BA (belum ada upload HAV)');
  }
  if (c.source !== 'manual' && c.automaticChangedAt) {
    lines.push(`HAV otomatis terakhir diubah sync: ${formatDateTime(c.automaticChangedAt)}`);
  }
  lines.push(c.inTalentPool ? 'Talent Pool: lolos' : 'Talent Pool: tidak lolos dengan kuadran ini (tetap di peta)');
  return lines.filter(Boolean).join('\n');
}

function CandidateChip({
  c,
  draggable,
  isDragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  c: TalentMappingCandidate;
  draggable: boolean;
  isDragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    // A div with a button role, not a <button>: Firefox does not start a drag
    // from a <button draggable>, which would make the map read-only there.
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, c.id);
        e.dataTransfer.setData('text/plain', c.name);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={chipTooltip(c)}
      className={cn(
        'flex w-full min-w-0 select-none items-center gap-1 rounded-md border border-border/70 bg-background/95 px-1.5 py-1 text-left text-[11px] shadow-xs outline-none transition hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        isDragging && 'opacity-40',
        c.source === 'manual' && 'border-violet-500/40',
        // Outside the Talent Pool with the quadrant in force: still on the map
        // (the map is where that is decided), but visibly not in the list.
        !c.inTalentPool && 'border-dashed bg-background/60 text-muted-foreground',
      )}
    >
      {draggable && <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden />}
      <span className="min-w-0 flex-1 truncate font-medium">{c.name || '—'}</span>
      {c.source === 'formula' && (
        <Calculator className="h-3 w-3 shrink-0 text-sky-600 dark:text-sky-400" aria-label="Dari rumus" />
      )}
      {c.source === 'manual' && (
        <Hand className="h-3 w-3 shrink-0 text-violet-600 dark:text-violet-400" aria-label="Ditempatkan manual" />
      )}
      {c.baselineDrifted && (
        <TriangleAlert
          className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400"
          aria-label="HAV otomatis berubah sejak penempatan"
        />
      )}
    </div>
  );
}

type GridProps = {
  /** Already filtered by the page's search/division/department controls. */
  candidates: TalentMappingCandidate[];
  masked: boolean;
  canManage: boolean;
  /** WIB year the PA window counts back from — the work queue's PA columns. */
  referenceYear: number;
  selectedQuadrant: number | null;
  onSelectQuadrant: (quadrant: number | null) => void;
  onOpenCandidate: (candidateId: string) => void;
  /** A chip was dropped on a different square — the page opens the justification dialog. */
  onDropCandidate: (candidateId: string, quadrant: number) => void;
};

/**
 * The HAV 16-box, drawn as the methodology prints it (BA High at the top, PA
 * High at the right), with every candidate on their square IN FORCE.
 *
 * Dragging is HTML5-native — no library, and nothing is written on drop: the
 * drop only ASKS the page to open the justification dialog, which is where the
 * move is confirmed and saved. Cancelling leaves the map as it was, because it
 * was never changed. While a chip is in the air every square says what landing
 * there would do — return them to their automatic HAV, or take them out of (or
 * into) the Talent Pool's "Lolos" list, because the Talent Pool's HAV rules
 * judge exactly this square. That is information: nobody leaves THIS map by
 * being moved, since the map is gated by the discipline rule alone. Keyboard
 * and touch users get the same move from the candidate dialog.
 */
export function HavSixteenBox({
  candidates,
  masked,
  canManage,
  referenceYear,
  selectedQuadrant,
  onSelectQuadrant,
  onOpenCandidate,
  onDropCandidate,
}: GridProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overQuadrant, setOverQuadrant] = useState<number | null>(null);

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const byQuadrant = useMemo(() => {
    const map = new Map<number, TalentMappingCandidate[]>();
    for (const c of candidates) {
      if (c.quadrant == null) continue;
      const list = map.get(c.quadrant) ?? [];
      list.push(c);
      map.set(c.quadrant, list);
    }
    return map;
  }, [candidates]);
  const unplaced = useMemo(() => candidates.filter((c) => c.quadrant == null), [candidates]);

  const boxCounts = useMemo(() => {
    const counts = Object.fromEntries(TALENT_BOXES.map((b) => [b, 0])) as Record<string, number>;
    for (const c of candidates) {
      const box = quadrantBox(c.quadrant);
      if (box) counts[box] = (counts[box] ?? 0) + 1;
    }
    return counts;
  }, [candidates]);

  const dragging = draggingId ? (byId.get(draggingId) ?? null) : null;
  const canDrag = canManage && !masked;
  const endDrag = () => {
    setDraggingId(null);
    setOverQuadrant(null);
  };

  const renderCell = (quadrant: number) => {
    const members = byQuadrant.get(quadrant) ?? [];
    const box = quadrantBox(quadrant);
    const meta = BOX_META[box ?? 'NONE'];
    const canDrop = canDrag && dragging != null && dragging.quadrant !== quadrant;
    const isOver = canDrop && overQuadrant === quadrant;
    const isSelected = selectedQuadrant === quadrant;
    // What landing here would do, said before letting go.
    const isAutomaticSquare = canDrop && dragging!.automatic.quadrant === quadrant;
    const wouldBeInPool = canDrop ? dragging!.poolQuadrants.includes(quadrant) : null;
    const leavesPool = canDrop && dragging!.inTalentPool && wouldBeInPool === false;
    const joinsPool = canDrop && !dragging!.inTalentPool && wouldBeInPool === true;

    return (
      <div
        key={quadrant}
        onDragOver={(e) => {
          if (!canDrop) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (overQuadrant !== quadrant) setOverQuadrant(quadrant);
        }}
        onDragLeave={(e) => {
          // dragleave also fires when the pointer moves onto a child element.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setOverQuadrant((q) => (q === quadrant ? null : q));
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData(DRAG_MIME) || draggingId;
          endDrag();
          if (id && canDrop) onDropCandidate(id, quadrant);
        }}
        className={cn(
          // `relative`: the drag hints below are overlays. Inserting them into
          // the flow grew every hinted cell the moment a drag began, which moved
          // the grid under the cursor and dropped onto the gap between cells.
          'relative flex min-h-44 min-w-0 flex-col rounded-xl border p-2 transition-colors',
          meta.border,
          meta.cell,
          canDrop && 'border-dashed',
          isAutomaticSquare && 'border-sky-500',
          leavesPool && 'border-amber-500 bg-amber-500/10',
          isOver && 'ring-2 ring-primary',
          isSelected && !isOver && 'ring-2 ring-foreground/40',
        )}
      >
        <button
          type="button"
          onClick={() => onSelectQuadrant(isSelected ? null : quadrant)}
          title={`${quadrantLabel(quadrant)} — klik untuk menyaring tabel`}
          className="flex w-full items-start justify-between gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0">
            <span className="block text-xs font-bold text-foreground">Q{quadrant}</span>
            <span className="block truncate text-[10px] font-medium leading-tight text-muted-foreground">
              {quadrantName(quadrant)}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-base font-bold leading-none tabular-nums text-foreground">{members.length}</span>
            <BoxChip box={box} />
          </span>
        </button>

        {(isAutomaticSquare || leavesPool || joinsPool) && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 space-y-1">
            {isAutomaticSquare && (
              <p className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 shadow-xs dark:bg-sky-950 dark:text-sky-200">
                HAV otomatis ({automaticSourceLabel(dragging!.automatic.source)}) — lepas di sini untuk mengembalikan
              </p>
            )}
            {leavesPool && (
              <p className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 shadow-xs dark:bg-amber-950 dark:text-amber-200">
                Kuadran ini membuat kandidat tidak lolos Talent Pool (tetap di peta)
              </p>
            )}
            {joinsPool && (
              <p className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 shadow-xs dark:bg-emerald-950 dark:text-emerald-200">
                Kuadran ini membuat kandidat lolos Talent Pool
              </p>
            )}
          </div>
        )}

        <div className="mt-2 flex max-h-48 min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-0.5">
          {masked ? (
            members.length > 0 && (
              <p className="text-[11px] text-muted-foreground">{members.length} kandidat · disamarkan</p>
            )
          ) : members.length > 0 ? (
            members.map((c) => (
              <CandidateChip
                key={c.id}
                c={c}
                draggable={canDrag}
                isDragging={draggingId === c.id}
                onOpen={() => onOpenCandidate(c.id)}
                onDragStart={() => setDraggingId(c.id)}
                onDragEnd={endDrag}
              />
            ))
          ) : (
            <p className="text-[11px] text-muted-foreground/70">{canDrop ? 'Lepas di sini' : '—'}</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="gap-3">
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-1.5 text-base">
            Peta 16-Box HAV
            <InfoHint title="Peta 16-Box HAV">
              <p>
                Setiap kandidat berada di kuadran HAV yang berlaku: penempatan manual, kalau tidak ada upload HAV, kalau
                tidak ada hasil rumus PA × BA. Nilai ini yang dipakai aturan filter dan scoring.
              </p>
              <p>
                {canDrag
                  ? 'Seret kandidat ke kuadran lain untuk memindahkannya — setiap perpindahan wajib disertai alasan dan tercatat di riwayat.'
                  : canManage
                    ? 'Tampilkan data untuk melihat dan memindahkan kandidat.'
                    : 'Anda hanya dapat melihat peta ini; memindahkan kandidat memerlukan akses Kelola kandidat.'}
              </p>
            </InfoHint>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-muted-foreground">
            {TALENT_BOXES.map((box) => (
              <span key={box} className="flex items-center gap-1" title={BOX_META[box].blurb}>
                <span className={cn('h-2 w-2 rounded-full', BOX_META[box].dot)} />
                <span className="font-semibold text-foreground">{BOX_META[box].label}</span>
                <span className="tabular-nums">{boxCounts[box] ?? 0}</span>
              </span>
            ))}
            <span className="flex items-center gap-1">
              <Hand className="h-3 w-3 text-violet-600 dark:text-violet-400" /> manual
            </span>
            <span className="flex items-center gap-1">
              <Calculator className="h-3 w-3 text-sky-600 dark:text-sky-400" /> dari rumus (tanpa upload)
            </span>
            <span className="flex items-center gap-1">
              <TriangleAlert className="h-3 w-3 text-amber-600 dark:text-amber-400" /> HAV otomatis berubah sejak penempatan
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-5 rounded border border-dashed border-muted-foreground/60" /> tidak
              lolos Talent Pool (tetap di peta)
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto pb-1">
            <div className="grid min-w-240 grid-cols-[1.75rem_6.5rem_repeat(4,minmax(0,1fr))] gap-2">
              <div className="row-span-4 flex items-center justify-center">
                <span className="rotate-180 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground [writing-mode:vertical-rl]">
                  Behavioral Assessment →
                </span>
              </div>
              {HAV_GRID_ROWS.map((row) => (
                <Fragment key={row}>
                  <div className="flex flex-col items-end justify-center gap-1 pr-1 text-right" title={BA_BAND_HINT[row].full}>
                    <BandChip band={row} />
                    <span className="text-[9.5px] leading-tight text-muted-foreground">{BA_BAND_HINT[row].short}</span>
                  </div>
                  {HAV_GRID_COLUMNS.map((col) => renderCell(HAV_QUADRANT_MATRIX[row][col]))}
                </Fragment>
              ))}
              <div />
              <div />
              {HAV_GRID_COLUMNS.map((col) => (
                <div key={col} className="flex flex-col items-center gap-1 pt-1 text-center" title={PA_BAND_HINT[col].full}>
                  <BandChip band={col} />
                  <span className="text-[9.5px] leading-tight text-muted-foreground">{PA_BAND_HINT[col].short}</span>
                </div>
              ))}
              <div className="col-span-2" />
              <div className="col-span-4 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Performance Appraisal →
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* The work queue for everyone nothing places: searchable, enriched with
          the PA window and the BA history, and placed by a click on a mini-map
          instead of a drag across the page. Shares this component's drag state,
          so its row handle still drops onto the grid with the same hints. */}
      <UnplacedQueue
        candidates={unplaced}
        masked={masked}
        canDrag={canDrag}
        canManage={canManage}
        referenceYear={referenceYear}
        draggingId={draggingId}
        onDragStart={setDraggingId}
        onDragEnd={endDrag}
        onOpenCandidate={onOpenCandidate}
        onPlace={onDropCandidate}
      />
    </div>
  );
}
