'use client';

import { BOX_META } from '@/lib/hav-box-meta';
import {
  PERFORMANCE_LOW_LOOKBACK_SLOTS,
  isBelowCGrade,
  talentBoxFromQuadrant,
  type HavBand,
  type PerformanceReading,
  type TalentBox,
} from '@/lib/hav-quadrant-derive';
import type { HavAutoChangeOrigin, TalentMappingAuditAction } from '@/lib/db/schema';
import {
  HAV_CHANGE_ORIGIN_LABEL,
  paSlotLabel,
  quadrantLabel,
  quadrantName,
  type TalentMappingAuditEntry,
  type TalentMappingSource,
} from '@/lib/talent-mapping';
import { cn } from '@/lib/utils';

// One spelling of a square for the whole feature, server messages included.
export { quadrantLabel, quadrantName };

/** Private MIME type of a dragged candidate, shared by the grid and the work queue so a drop from anywhere else is ignored. */
export const TALENT_DRAG_MIME = 'application/x-pulse-talent-candidate';

export function quadrantBox(quadrant: number | null | undefined): TalentBox | null {
  return quadrant == null ? null : talentBoxFromQuadrant(quadrant);
}

/** Redacted placeholder, same as the Talent Pool page's. */
export function Mask({ w = 4 }: { w?: number }) {
  return (
    <span
      className="select-none align-middle tracking-[0.2em] text-muted-foreground/60"
      title="Data disamarkan — klik Tampilkan data"
      aria-label="Data disamarkan"
    >
      {'•'.repeat(w)}
    </span>
  );
}

export function BoxChip({ box, className }: { box: TalentBox | null; className?: string }) {
  const meta = BOX_META[box ?? 'NONE'];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap',
        meta.chip,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

/** Quadrant chip coloured by the 5-Box it rolls up to. */
export function QuadrantChip({
  quadrant,
  withName = true,
  className,
}: {
  quadrant: number | null;
  withName?: boolean;
  className?: string;
}) {
  if (quadrant == null) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-md border border-dashed px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap',
          className,
        )}
      >
        Belum terpetakan
      </span>
    );
  }
  const meta = BOX_META[quadrantBox(quadrant) ?? 'NONE'];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        meta.chip,
        className,
      )}
      title={quadrantLabel(quadrant)}
    >
      Q{quadrant}
      {withName && <span className="font-medium opacity-80">· {quadrantName(quadrant)}</span>}
    </span>
  );
}

const SOURCE_META: Record<TalentMappingSource, { label: string; className: string }> = {
  manual: {
    label: 'Manual',
    className: 'border-violet-500/30 bg-violet-500/12 text-violet-700 dark:text-violet-300',
  },
  upload: {
    label: 'Upload HAV',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  formula: {
    label: 'Rumus',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  none: {
    label: 'Belum terpetakan',
    className: 'border-border bg-muted text-muted-foreground',
  },
};

/** "Upload HAV" / "Rumus" / "—" for an automatic answer's source. */
export function automaticSourceLabel(source: 'upload' | 'formula' | 'none'): string {
  return source === 'upload' ? 'Upload HAV' : source === 'formula' ? 'Rumus PA × BA' : 'tidak ada';
}

/**
 * The badge for each kind of trail row. Manual placements carry none (they are
 * the default reading of a row); every SYNC row does, because the order of
 * sync and manual events is what decides which one is in force.
 */
export const AUDIT_ACTION_BADGE: Partial<Record<TalentMappingAuditAction, { label: string; className: string }>> = {
  revert_to_automatic: {
    label: 'kembali ke otomatis',
    className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  superseded_by_upload: {
    label: 'manual digantikan upload HAV',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  superseded_by_sync: {
    label: 'manual digantikan Sync Kandidat',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  automatic_changed: {
    label: 'HAV otomatis berubah (sync)',
    className: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  },
  formula_applied: {
    label: 'rumus diberlakukan (PA/BA)',
    className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  superseded_by_formula: {
    label: 'manual digantikan rumus (PA/BA)',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
};

/** The trail's `changed_by_username` for each sync, in the page's words. */
const SYNC_ACTOR_LABEL: Record<string, string> = {
  'sync:hav-upload': HAV_CHANGE_ORIGIN_LABEL.hav_upload,
  'sync:hav-folder': HAV_CHANGE_ORIGIN_LABEL.hav_folder,
  'sync:candidates': HAV_CHANGE_ORIGIN_LABEL.candidate_sync,
  'sync:pa-ba-upload': HAV_CHANGE_ORIGIN_LABEL.pa_ba_upload,
};

/** Who a trail row names: the reviewer, or the sync that wrote it. */
export function auditActorLabel(entry: Pick<TalentMappingAuditEntry, 'changedByName' | 'changedByUsername'>): {
  name: string;
  username: string | null;
  isSync: boolean;
} {
  const username = entry.changedByUsername ?? null;
  if (username?.startsWith('sync:')) {
    return { name: SYNC_ACTOR_LABEL[username] ?? 'Sync', username: null, isSync: true };
  }
  return {
    name: entry.changedByName ?? username ?? 'Pengguna tidak diketahui',
    username: entry.changedByName && username ? username : null,
    isSync: false,
  };
}

/** "Sync Kandidat (PA/BA dari MSSQL)" etc., or a neutral fallback for a row without an origin. */
export function syncOriginLabel(origin: HavAutoChangeOrigin | null): string {
  return origin ? HAV_CHANGE_ORIGIN_LABEL[origin] : 'Sync';
}

export function SourceBadge({ source, className }: { source: TalentMappingSource; className?: string }) {
  const meta = SOURCE_META[source];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap',
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

const BAND_CLASS: Record<HavBand, string> = {
  High: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'Mid High': 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  'Mid Low': 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  Low: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

export function BandChip({ band, className }: { band: HavBand | null; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        band ? BAND_CLASS[band] : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {band ?? '—'}
    </span>
  );
}

function gradeTone(grade: string): string {
  if (isBelowCGrade(grade)) return 'bg-rose-500/15 text-rose-700 dark:text-rose-300';
  if (grade === 'C') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
}

/**
 * The six PA semester slots, newest first, with the evidence marked: the
 * periods the band was read from are ringed, and a below-C grade that forced
 * Low is ringed in red — including when it sits outside those periods, which is
 * the two-year lookback the newest pair alone would hide. The first four slots
 * (the lookback window) are grouped so that boundary is visible too.
 */
export function PaSlots({
  slots,
  reading,
  referenceYear,
  showLabels = false,
}: {
  slots: (string | null)[];
  reading: PerformanceReading | null;
  referenceYear: number;
  showLabels?: boolean;
}) {
  const used = new Set(reading?.periodSlots ?? []);
  const trigger = reading?.lowTrigger?.slot ?? null;
  return (
    <span className="inline-flex items-end gap-1.5">
      {[slots.slice(0, PERFORMANCE_LOW_LOOKBACK_SLOTS), slots.slice(PERFORMANCE_LOW_LOOKBACK_SLOTS)].map(
        (group, gi) => (
          <span
            key={gi}
            className={cn(
              'inline-flex items-end gap-0.5',
              gi === 0 && 'rounded-md border border-dashed border-border/80 px-0.5 py-0.5',
            )}
            title={gi === 0 ? 'Jendela 2 tahun terakhir — D, E, atau C- di sini menjadikan PA Low' : 'Tahun ke-3'}
          >
            {group.map((grade, i) => {
              const slot = gi === 0 ? i : i + PERFORMANCE_LOW_LOOKBACK_SLOTS;
              return (
                <span key={slot} className="flex flex-col items-center gap-0.5">
                  <span
                    title={`${paSlotLabel(slot, referenceYear)}: ${grade ?? 'kosong'}`}
                    className={cn(
                      'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-semibold tabular-nums',
                      grade ? gradeTone(grade) : 'bg-muted/60 text-muted-foreground/60',
                      used.has(slot) && 'ring-2 ring-primary/60',
                      trigger === slot && 'ring-2 ring-rose-500',
                    )}
                  >
                    {grade ?? '–'}
                  </span>
                  {showLabels && (
                    <span className="text-[9px] leading-none text-muted-foreground tabular-nums">
                      {paSlotLabel(slot, referenceYear).replace(' ', ' ')}
                    </span>
                  )}
                </span>
              );
            })}
          </span>
        ),
      )}
    </span>
  );
}

/** The six slots back into the CSV form `readPerformance` reads. */
export function slotsCsv(slots: (string | null)[]): string {
  return slots.map((s) => s ?? '').join(',');
}

/** One sentence on how the PA band was read, for the detail dialog and tooltips. */
export function describePerformance(reading: PerformanceReading | null, referenceYear: number): string {
  if (!reading) return 'Tidak ada PA bernilai dalam 3 tahun terakhir.';
  if (reading.lowTrigger) {
    const t = reading.lowTrigger;
    const inPair = reading.periodSlots.includes(t.slot);
    return inPair
      ? `Low — ada nilai ${t.grade} pada ${paSlotLabel(t.slot, referenceYear)}.`
      : `Low — ada nilai ${t.grade} pada ${paSlotLabel(t.slot, referenceYear)}, masih dalam 2 tahun terakhir (2 periode terbaru saja akan terbaca lebih tinggi).`;
  }
  const periods = reading.periodSlots.map((s) => paSlotLabel(s, referenceYear));
  const pair = reading.grades.join('');
  return reading.periodSlots.length === 1
    ? `${reading.band} — hanya satu periode bernilai (${periods[0]}: ${reading.grades[0]}), dibaca sebagai ${pair}.`
    : `${reading.band} — 2 periode terakhir: ${periods.join(' & ')} (${pair}).`;
}
