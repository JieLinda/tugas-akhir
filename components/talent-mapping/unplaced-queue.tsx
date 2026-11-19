'use client';

import { useIsDemoMode } from '@/components/app-mode-provider';
import { Fragment, useMemo, useState } from 'react';
import { GripVertical, MapPin, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { behaviorLabel } from '@/lib/candidate-labels';
import { BOX_META } from '@/lib/hav-box-meta';
import {
  HAV_GRID_COLUMNS,
  HAV_GRID_ROWS,
  HAV_QUADRANT_MATRIX,
  competencyBand,
  isBelowCGrade,
  readPerformance,
  type HavBand,
  type PerformanceReading,
} from '@/lib/hav-quadrant-derive';
import { TALENT_MAPPING_BA_HISTORY_DEPTH, type TalentMappingCandidate } from '@/lib/talent-mapping';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';

import { BandChip, TALENT_DRAG_MIME, quadrantBox, quadrantLabel, quadrantName, slotsCsv } from './shared';

/**
 * The "Belum terpetakan" WORK QUEUE: everyone on the map whom no automatic
 * source places — no HAV upload, and the formula is missing an axis — laid out
 * as the evidence a reviewer places them FROM, one row each:
 *
 *   - PA of the formula's three-year window, per year and semester, with the
 *     slots that would decide the band ringed; when the window is empty, the
 *     newest PA on record outside it (context — the formula never reads it);
 *   - up to three behavioural assessments, dated, newest first (the history
 *     sync, drizzle/0081, with the current BA merged in);
 *   - which axis IS known, which is exactly what narrows the choice.
 *
 * Placing is a click, not a long drag: "Tempatkan" opens a 4×4 picker laid out
 * like the map, with the known axis outlined and the Talent-Pool-passing squares
 * dotted, and hands the choice to the same justification dialog a drop opens.
 * The row handle still drags onto the grid for anyone who prefers it.
 *
 * Search and the evidence filters are local to the queue (the page toolbar
 * already scoped `candidates`), so finding one person here never filters the
 * grid above.
 */

type QueueFilter = 'all' | 'has-ba' | 'has-pa' | 'old-pa' | 'no-data';
type QueueSort = 'evidence' | 'name' | 'position';

const FILTER_LABEL: Record<QueueFilter, string> = {
  all: 'Semua',
  'has-ba': 'Ada BA',
  'has-pa': 'Ada PA 3 tahun',
  'old-pa': 'Hanya PA lama',
  'no-data': 'Tanpa data PA & BA',
};

const SORT_LABEL: Record<QueueSort, string> = {
  evidence: 'Urut: data terlengkap dulu',
  name: 'Urut: nama',
  position: 'Urut: posisi',
};

/** Same category, ignoring case and spacing — how the formula's band lookup compares labels. */
function sameBehaviorLabel(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) => (v ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

type Row = {
  c: TalentMappingCandidate;
  /** The formula's reading of the in-window PA, when it has one. */
  pa: PerformanceReading | null;
  paBand: HavBand | null;
  /** The formula's BA band — from the BA it actually reads. */
  baBand: HavBand | null;
  hasPaWindow: boolean;
  hasBa: boolean;
  /** Higher = more to decide from; drives the default order. */
  evidence: number;
  haystack: string;
};

function toRow(c: TalentMappingCandidate): Row {
  const pa = readPerformance(slotsCsv(c.performanceSlots));
  const baBand = competencyBand(c.behaviorRecommendation);
  const hasPaWindow = c.performanceSlots.some(Boolean);
  // The candidate row can hold a BA the sync tables do not (edited outside the
  // sync), so either counts as "a BA is on record".
  const hasBa = c.behaviorHistory.length > 0 || Boolean(c.behaviorRecommendation?.trim());
  const evidence =
    (baBand ? 4 : hasBa ? 2 : 0) + (pa?.band ? 4 : 0) + (!hasPaWindow && c.paOutsideWindow ? 1 : 0);
  return {
    c,
    pa,
    paBand: pa?.band ?? null,
    baBand,
    hasPaWindow,
    hasBa,
    evidence,
    haystack: [
      c.name,
      c.employeeId,
      c.currentPosition,
      c.department,
      c.division,
      ...c.behaviorHistory.map((e) => e.label ?? ''),
    ]
      .join(' ')
      .toLowerCase(),
  };
}

function matchesFilter(r: Row, f: QueueFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'has-ba':
      return r.hasBa;
    case 'has-pa':
      return r.hasPaWindow;
    case 'old-pa':
      return !r.hasPaWindow && r.c.paOutsideWindow != null;
    case 'no-data':
      return !r.hasBa && !r.hasPaWindow && r.c.paOutsideWindow == null;
  }
}

function gradeTone(grade: string | null): string {
  if (!grade) return 'text-muted-foreground/40';
  const v = grade.trim().toUpperCase();
  if (v === 'A' || v === 'B') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (v === 'C') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  if (isBelowCGrade(v)) return 'bg-rose-500/15 text-rose-700 dark:text-rose-300';
  return 'bg-muted text-muted-foreground';
}

function GradePill({ grade, title, decided }: { grade: string | null; title: string; decided: boolean }) {
  return (
    <span
      title={`${title}: ${grade ?? 'kosong'}${decided ? ' — dipakai pita PA' : ''}`}
      className={cn(
        'inline-flex h-5 min-w-6 items-center justify-center rounded px-1 text-[10px] font-bold tabular-nums',
        gradeTone(grade),
        decided && 'ring-1 ring-foreground/40',
      )}
    >
      {grade ?? '–'}
    </span>
  );
}

const SHORT_BAND: Record<HavBand, string> = { High: 'High', 'Mid High': 'Mid High', 'Mid Low': 'Mid Low', Low: 'Low' };

/** The map in miniature: pick a square, the page asks why. */
function QuadrantPicker({
  row,
  onPick,
}: {
  row: Row;
  onPick: (quadrant: number) => void;
}) {
  const { c, baBand, paBand } = row;
  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold">Tempatkan {c.name || 'kandidat'}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Pilih kuadran — langkah berikutnya meminta alasan justifikasi, dan baru tersimpan setelah dikonfirmasi.
        </p>
      </div>
      <div className="grid grid-cols-[3.25rem_repeat(4,minmax(0,1fr))] gap-1">
        {HAV_GRID_ROWS.map((band) => (
          <Fragment key={band}>
            <span
              className={cn(
                'flex items-center justify-end pr-1 text-right text-[9px] font-semibold leading-tight text-muted-foreground',
                band === baBand && 'text-primary',
              )}
            >
              BA {SHORT_BAND[band]}
            </span>
            {HAV_GRID_COLUMNS.map((col) => {
              const q = HAV_QUADRANT_MATRIX[band][col];
              const meta = BOX_META[quadrantBox(q) ?? 'NONE'];
              const fits = (baBand != null && band === baBand) || (paBand != null && col === paBand);
              const off = (baBand != null && band !== baBand) || (paBand != null && col !== paBand);
              const inPool = c.poolQuadrants.includes(q);
              return (
                <button
                  key={q}
                  type="button"
                  onClick={() => onPick(q)}
                  title={`${quadrantLabel(q)}${fits ? ' — sesuai data yang tercatat' : ''}${inPool ? ' · lolos Talent Pool' : ''}`}
                  className={cn(
                    'relative flex h-11 min-w-0 flex-col items-start justify-center rounded-md border px-1.5 text-left outline-none transition hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring',
                    meta.border,
                    meta.cell,
                    fits && 'border-2 border-primary',
                    off && !fits && 'opacity-55',
                  )}
                >
                  <span className="text-[11px] font-bold leading-none">Q{q}</span>
                  <span className="mt-0.5 w-full truncate text-[9px] leading-tight text-muted-foreground">
                    {quadrantName(q)}
                  </span>
                  {inPool && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
        <span />
        {HAV_GRID_COLUMNS.map((col) => (
          <span
            key={col}
            className={cn(
              'text-center text-[9px] font-semibold leading-tight text-muted-foreground',
              col === paBand && 'text-primary',
            )}
          >
            PA {SHORT_BAND[col]}
          </span>
        ))}
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Atas = BA High, kanan = PA High, seperti peta.
        {baBand || paBand ? ' Bingkai tebal = sesuai BA/PA yang tercatat; yang lain tetap boleh dipilih.' : ''}
        {' '}
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> lolos Talent Pool
        </span>
      </p>
    </div>
  );
}

function PlaceButton({ row, onPlace }: { row: Row; onPlace: (candidateId: string, quadrant: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
          <MapPin className="h-3.5 w-3.5" />
          Tempatkan
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3">
        <QuadrantPicker
          row={row}
          onPick={(q) => {
            setOpen(false);
            onPlace(row.c.id, q);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function UnplacedQueue({
  candidates,
  masked,
  canDrag,
  canManage,
  referenceYear,
  draggingId,
  onDragStart,
  onDragEnd,
  onOpenCandidate,
  onPlace,
}: {
  /** Unplaced candidates, already scoped by the page's search/division/department. */
  candidates: TalentMappingCandidate[];
  masked: boolean;
  canDrag: boolean;
  canManage: boolean;
  /** WIB year the PA window counts back from (window = year−1 … year−3). */
  referenceYear: number;
  draggingId: string | null;
  onDragStart: (candidateId: string) => void;
  onDragEnd: () => void;
  onOpenCandidate: (candidateId: string) => void;
  /** A square was picked — the page opens the justification dialog, exactly as for a drop. */
  onPlace: (candidateId: string, quadrant: number) => void;
}) {
  const demoSearch = useIsDemoMode();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [sort, setSort] = useState<QueueSort>('evidence');

  const rows = useMemo(() => candidates.map(toRow), [candidates]);
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.haystack.includes(q)) : rows;
  }, [rows, query]);
  const counts = useMemo(() => {
    const out = {} as Record<QueueFilter, number>;
    for (const f of Object.keys(FILTER_LABEL) as QueueFilter[]) out[f] = searched.filter((r) => matchesFilter(r, f)).length;
    return out;
  }, [searched]);
  const visible = useMemo(() => {
    const list = searched.filter((r) => matchesFilter(r, filter));
    const byName = (a: Row, b: Row) => a.c.name.localeCompare(b.c.name);
    return [...list].sort((a, b) =>
      sort === 'name'
        ? byName(a, b)
        : sort === 'position'
          ? a.c.currentPosition.localeCompare(b.c.currentPosition) || byName(a, b)
          : b.evidence - a.evidence || byName(a, b),
    );
  }, [searched, filter, sort]);

  if (candidates.length === 0) return null;
  const years = [referenceYear - 1, referenceYear - 2, referenceYear - 3];

  return (
    <Card className="gap-3 border-dashed">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          Belum terpetakan ({candidates.length})
          <InfoHint title="Belum terpetakan">
            <p>
              Lolos aturan Disiplin, tetapi tidak punya upload HAV dan rumus tidak dapat menghitung kuadrannya karena
              salah satu sumbu kosong — bukan hasil penilaian. Setiap baris memuat PA {years[2]}–{years[0]} (jendela
              rumus) dan riwayat BA hingga {TALENT_MAPPING_BA_HISTORY_DEPTH} asesmen terakhir sebagai bahan keputusan.
            </p>
            <p>
              {canManage
                ? 'Klik "Tempatkan" untuk memilih kuadran tanpa menyeret (wajib alasan), atau lengkapi datanya lewat sinkronisasi.'
                : 'Lengkapi datanya lewat sinkronisasi.'}
            </p>
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {masked ? (
          <p className="text-xs text-muted-foreground">
            {candidates.length} kandidat · disamarkan. Tampilkan data untuk melihat PA, BA, dan menempatkan mereka.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-64 flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={demoSearch ? 'Cari di antrean: nama, posisi, departemen, kategori BA…' : 'Cari di antrean: nama, NPK, posisi, departemen, kategori BA…'}
                  className="h-9 pl-8"
                  aria-label="Cari kandidat belum terpetakan"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="Hapus pencarian"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Select value={sort} onValueChange={(v) => setSort(v as QueueSort)}>
                <SelectTrigger size="sm" className="h-9 w-56 text-sm" aria-label="Urutkan antrean">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABEL) as QueueSort[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {SORT_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Saring menurut data yang tersedia">
              {(Object.keys(FILTER_LABEL) as QueueFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                    filter === f
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input bg-background text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  {FILTER_LABEL[f]} <span className="tabular-nums">{counts[f]}</span>
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Tidak ada kandidat yang cocok dengan pencarian atau saringan ini.
              </p>
            ) : (
              <div className="max-h-136 overflow-auto rounded-lg border [&>[data-slot=table-container]]:overflow-visible">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {canDrag && <TableHead className="sticky top-0 z-10 w-6 bg-card" aria-label="Seret" />}
                      <TableHead className="sticky top-0 z-10 bg-card">Kandidat</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-card">Posisi · Departemen</TableHead>
                      {years.map((y) => (
                        <TableHead key={y} className="sticky top-0 z-10 bg-card text-center" title={`PA ${y}: semester 2 lalu semester 1`}>
                          PA {y}
                          <span className="block text-[9px] font-normal text-muted-foreground">S2 · S1</span>
                        </TableHead>
                      ))}
                      <TableHead className="sticky top-0 z-10 bg-card">
                        Riwayat BA
                        <span className="block text-[9px] font-normal text-muted-foreground">
                          terbaru dulu, maks {TALENT_MAPPING_BA_HISTORY_DEPTH}
                        </span>
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 bg-card" title="Pita yang sudah bisa dibaca rumus dari data yang ada">
                        Sumbu diketahui
                      </TableHead>
                      {canManage && <TableHead className="sticky top-0 right-0 z-20 bg-card text-right">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((row) => {
                      const { c, pa } = row;
                      // The slots the PA band was read from, plus a below-C grade
                      // that forced Low from the two-year lookback.
                      const decided = new Set([...(pa?.periodSlots ?? []), ...(pa?.lowTrigger ? [pa.lowTrigger.slot] : [])]);
                      const outside = c.paOutsideWindow;
                      return (
                        <TableRow key={c.id} className={cn('align-top', draggingId === c.id && 'opacity-40')}>
                          {canDrag && (
                            <TableCell className="py-1.5 pr-0">
                              <div
                                role="button"
                                tabIndex={-1}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(TALENT_DRAG_MIME, c.id);
                                  e.dataTransfer.setData('text/plain', c.name);
                                  e.dataTransfer.effectAllowed = 'move';
                                  onDragStart(c.id);
                                }}
                                onDragEnd={onDragEnd}
                                title="Seret ke kuadran di peta"
                                className="cursor-grab rounded p-0.5 text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
                              >
                                <GripVertical className="h-3.5 w-3.5" aria-hidden />
                              </div>
                            </TableCell>
                          )}
                          <TableCell className="py-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenCandidate(c.id)}
                              className="text-left text-sm font-medium transition-colors hover:text-primary"
                            >
                              {c.name || '—'}
                            </button>
                            <span className="block text-[11px] tabular-nums text-muted-foreground">{c.employeeId}</span>
                          </TableCell>
                          <TableCell
                            className="max-w-56 py-1.5 text-xs whitespace-normal text-muted-foreground"
                            title={[c.currentPosition, c.department, c.division].filter(Boolean).join(' · ')}
                          >
                            <span className="line-clamp-2">
                              {[c.currentPosition, c.department].filter(Boolean).join(' · ') || '—'}
                            </span>
                          </TableCell>
                          {row.hasPaWindow ? (
                            years.map((y, i) => (
                              <TableCell key={y} className="py-1.5 text-center">
                                <span className="inline-flex gap-0.5">
                                  <GradePill grade={c.performanceSlots[2 * i] ?? null} title={`${y} S2`} decided={decided.has(2 * i)} />
                                  <GradePill grade={c.performanceSlots[2 * i + 1] ?? null} title={`${y} S1`} decided={decided.has(2 * i + 1)} />
                                </span>
                                {i === 0 && outside && outside.year > years[0] && (
                                  <span className="mt-0.5 block text-[10px] text-muted-foreground" title="Belum masuk jendela rumus">
                                    {outside.year}: {outside.s1 ?? '–'}/{outside.s2 ?? '–'}
                                  </span>
                                )}
                              </TableCell>
                            ))
                          ) : (
                            <TableCell colSpan={3} className="max-w-80 py-1.5 text-[11px] whitespace-normal text-muted-foreground">
                              <span className="font-medium text-amber-700 dark:text-amber-300">
                                PA {years[2]}–{years[0]} kosong
                              </span>
                              {outside ? (
                                <span className="block">
                                  Terakhir tercatat <strong className="text-foreground">{outside.year}</strong>: S1{' '}
                                  <strong className="text-foreground">{outside.s1 ?? '–'}</strong> · S2{' '}
                                  <strong className="text-foreground">{outside.s2 ?? '–'}</strong>{' '}
                                  <span className="italic">(di luar jendela — tidak dipakai rumus)</span>
                                </span>
                              ) : (
                                <span className="block">Tidak ada PA tercatat sama sekali.</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="min-w-48 max-w-72 py-1.5 whitespace-normal">
                            {c.behaviorHistory.length === 0 ? (
                              c.behaviorRecommendation?.trim() ? (
                                // On the candidate row but not in the sync tables:
                                // the formula reads it, so it is shown — undated.
                                <span className="text-[11px]">
                                  <span className="font-medium">{behaviorLabel(c.behaviorRecommendation)}</span>{' '}
                                  <span className="text-muted-foreground">— tanpa tanggal (hanya di data kandidat)</span>
                                </span>
                              ) : (
                                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                  Belum ada BA tercatat
                                </span>
                              )
                            ) : (
                              <ul className="space-y-0.5">
                                {c.behaviorHistory.map((e, i) => {
                                  const band = competencyBand(e.label);
                                  const bandIsName = sameBehaviorLabel(band, e.label);
                                  return (
                                    <li
                                      key={`${e.date ?? 'x'}-${i}`}
                                      className="flex flex-wrap items-center gap-1 text-[11px] leading-tight"
                                      title={e.note ?? undefined}
                                    >
                                      <span className={cn('font-medium', i === 0 ? 'text-foreground' : 'text-muted-foreground')}>
                                        {e.label ? behaviorLabel(e.label) : 'Kategori tidak tercatat'}
                                      </span>
                                      {band && !bandIsName && <BandChip band={band} />}
                                      <span className="tabular-nums text-muted-foreground">{e.date ?? 'tanpa tanggal'}</span>
                                    </li>
                                  );
                                })}
                                {c.behaviorRecommendation?.trim() &&
                                  !sameBehaviorLabel(c.behaviorRecommendation, c.behaviorHistory[0]?.label) && (
                                    // The sync table moved on (or the row was edited
                                    // outside it): say which value the axis reads.
                                    <li className="text-[10px] text-amber-700 dark:text-amber-300">
                                      Rumus memakai: {behaviorLabel(c.behaviorRecommendation)}
                                    </li>
                                  )}
                              </ul>
                            )}
                          </TableCell>
                          <TableCell className="py-1.5">
                            <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                              <span className="flex items-center gap-1">
                                BA {row.baBand ? <BandChip band={row.baBand} /> : <span>—</span>}
                              </span>
                              <span className="flex items-center gap-1">
                                PA {row.paBand ? <BandChip band={row.paBand} /> : <span>—</span>}
                              </span>
                            </div>
                          </TableCell>
                          {canManage && (
                            <TableCell className="sticky right-0 z-5 bg-card py-1.5 text-right">
                              <PlaceButton row={row} onPlace={onPlace} />
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Menampilkan <strong className="tabular-nums text-foreground">{visible.length}</strong> dari{' '}
              <strong className="tabular-nums text-foreground">{candidates.length}</strong> kandidat belum terpetakan.
              Riwayat BA lebih dari satu asesmen muncul setelah sync Behavior Competency berikutnya mengisi riwayatnya.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
