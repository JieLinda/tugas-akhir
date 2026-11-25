'use client';

import { ArrowRight, Hand, RefreshCw, TriangleAlert } from 'lucide-react';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { behaviorLabel } from '@/lib/candidate-labels';
import { formatDateTime } from '@/lib/datetime';
import { competencyBand, readPerformance } from '@/lib/hav-quadrant-derive';
import { HAV_GAP_LABEL, type TalentMappingAuditEntry, type TalentMappingCandidate } from '@/lib/talent-mapping';
import { cn } from '@/lib/utils';

import {
  AUDIT_ACTION_BADGE,
  BandChip,
  BoxChip,
  Mask,
  PaSlots,
  QuadrantChip,
  SourceBadge,
  auditActorLabel,
  automaticSourceLabel,
  quadrantBox,
  slotsCsv,
  syncOriginLabel,
} from './shared';

const HEAD = 'sticky top-0 z-20 bg-card whitespace-nowrap';

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</div>;
}

/**
 * The map as rows — the same candidates and the same squares the grid shows,
 * plus every source of each square side by side (upload, formula, manual),
 * which is what a grid cell has no room for, and the LAST event that decided
 * it: a hand placement or a sync, with its time, because whichever came last is
 * the one in force. Masked, it keeps who is on the map (name, position,
 * department, as the Talent Pool page does) and hides where they sit and why.
 */
export function MappingTable({
  rows,
  masked,
  referenceYear,
  onOpenCandidate,
}: {
  rows: TalentMappingCandidate[];
  masked: boolean;
  referenceYear: number;
  onOpenCandidate: (candidateId: string) => void;
}) {
  if (rows.length === 0) {
    return <Empty>Tidak ada kandidat yang cocok dengan saringan saat ini.</Empty>;
  }
  return (
    // Same scroll-container arrangement as the Talent Pool table, so the
    // sticky header resolves against THIS element.
    <div className="max-h-[65vh] overflow-auto [&>[data-slot=table-container]]:overflow-visible">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD}>Nama</TableHead>
            <TableHead className={HEAD}>Posisi · Departemen</TableHead>
            <TableHead className={HEAD}>HAV berlaku</TableHead>
            <TableHead className={HEAD}>Sumber</TableHead>
            <TableHead className={HEAD}>Talent Pool</TableHead>
            <TableHead className={HEAD}>Upload HAV</TableHead>
            <TableHead className={HEAD}>Hasil rumus</TableHead>
            <TableHead className={HEAD}>PA (terbaru → lama)</TableHead>
            <TableHead className={HEAD}>Pita PA</TableHead>
            <TableHead className={HEAD}>Behavioral Assessment</TableHead>
            <TableHead className={HEAD}>Pita BA</TableHead>
            <TableHead className={HEAD} title="Penempatan manual atau sync yang terakhir mengubah HAV kandidat — yang terbaru yang berlaku">
              Perubahan terakhir
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => {
            const formula = c.formula;
            return (
              <TableRow key={c.id}>
                <TableCell className="py-2">
                  <button
                    type="button"
                    onClick={() => onOpenCandidate(c.id)}
                    className="text-left font-medium transition-colors hover:text-primary"
                  >
                    {c.name || '—'}
                  </button>
                  <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">
                    {masked ? <Mask w={4} /> : c.employeeId}
                  </span>
                </TableCell>
                <TableCell
                  className="max-w-64 truncate py-2 text-muted-foreground"
                  title={[c.currentPosition, c.department].filter(Boolean).join(' · ')}
                >
                  {[c.currentPosition, c.department].filter(Boolean).join(' · ') || '—'}
                </TableCell>
                <TableCell className="py-2">
                  {masked ? (
                    <Mask w={5} />
                  ) : (
                    <span className="flex items-center gap-1">
                      <QuadrantChip quadrant={c.quadrant} />
                      {c.quadrant != null && <BoxChip box={quadrantBox(c.quadrant)} />}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  {masked ? (
                    <Mask w={4} />
                  ) : (
                    <span className="flex items-center gap-1">
                      <SourceBadge source={c.source} />
                      {c.baselineDrifted && (
                        <TriangleAlert
                          className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400"
                          aria-label="HAV otomatis berubah sejak penempatan"
                        />
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  {masked ? (
                    <Mask w={3} />
                  ) : (
                    <span
                      className={cn(
                        'inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap',
                        c.inTalentPool
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                      )}
                      title={
                        c.inTalentPool
                          ? 'Lolos seluruh aturan Talent Pool dengan HAV yang berlaku (keterangan, bukan saringan peta)'
                          : `Tidak lolos Talent Pool: ${c.poolFailedRules.map((r) => r.message || r.label).join('; ') || 'aturan HAV'} — tetap dipetakan`
                      }
                    >
                      {c.inTalentPool ? 'Lolos' : 'Tidak lolos'}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  {masked ? (
                    <Mask w={3} />
                  ) : c.uploadedHavQuadrant != null ? (
                    <QuadrantChip quadrant={c.uploadedHavQuadrant} withName={false} />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  {masked ? (
                    <Mask w={4} />
                  ) : formula.ok ? (
                    <QuadrantChip quadrant={formula.quadrant} withName={false} />
                  ) : (
                    <span
                      className="text-[11px] text-amber-700 dark:text-amber-300"
                      title={formula.gaps.map((g) => HAV_GAP_LABEL[g]).join('; ')}
                    >
                      {HAV_GAP_LABEL[formula.gaps[0]!]}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  {masked ? (
                    <Mask w={6} />
                  ) : (
                    <PaSlots
                      slots={c.performanceSlots}
                      reading={readPerformance(slotsCsv(c.performanceSlots))}
                      referenceYear={referenceYear}
                    />
                  )}
                </TableCell>
                <TableCell className="py-2">
                  {masked ? <Mask w={3} /> : <BandChip band={readPerformance(slotsCsv(c.performanceSlots))?.band ?? null} />}
                </TableCell>
                <TableCell className="max-w-48 truncate py-2 text-muted-foreground">
                  {masked ? <Mask w={5} /> : behaviorLabel(c.behaviorRecommendation)}
                </TableCell>
                <TableCell className="py-2">
                  {masked ? <Mask w={3} /> : <BandChip band={competencyBand(c.behaviorRecommendation)} />}
                </TableCell>
                <TableCell className="py-2 text-[11px] text-muted-foreground">
                  {masked ? (
                    <Mask w={4} />
                  ) : c.placement ? (
                    // A placement in force is, by the time rule, newer than any
                    // sync change — so it IS the last event.
                    <span className="flex flex-col">
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Hand className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                        {c.placement.placedByName ?? c.placement.placedByUsername ?? '—'}
                      </span>
                      <span className="tabular-nums">{formatDateTime(c.placement.placedAt)}</span>
                    </span>
                  ) : c.automaticChangedAt ? (
                    <span className="flex flex-col">
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <RefreshCw className="h-3 w-3 text-slate-500" />
                        {syncOriginLabel(c.automaticChangeOrigin)}
                      </span>
                      <span className="tabular-nums">{formatDateTime(c.automaticChangedAt)}</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The trail: every manual move in this business unit AND every sync that
 * changed somebody's automatic HAV — including the ones that replaced an older
 * hand placement — newest first, with who (or which sync) did it, when, and
 * why. Read top to bottom it is the order of events, which is what decides the
 * HAV in force. Rows naming a candidate who has since left the map (or been
 * deleted) are kept: an event that happened stays on the record.
 */
export function AuditTable({
  entries,
  total,
  masked,
  mapIds,
  onOpenCandidate,
}: {
  entries: TalentMappingAuditEntry[];
  total: number;
  masked: boolean;
  /** Candidates currently on the map — only those open the detail dialog. */
  mapIds: Set<string>;
  onOpenCandidate: (candidateId: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <Empty>
        Belum ada perubahan HAV yang tercatat — belum ada perpindahan manual, dan belum ada sync yang mengubah HAV
        otomatis sejak pencatatan waktu dimulai.
      </Empty>
    );
  }
  return (
    <div className="space-y-2">
      {total > entries.length && (
        <p className="px-3 pt-3 text-[11px] text-muted-foreground">
          Menampilkan {entries.length} perubahan terbaru dari {total}. Riwayat lengkap tiap kandidat ada di dialog
          kandidatnya.
        </p>
      )}
      <div className="max-h-[65vh] overflow-auto [&>[data-slot=table-container]]:overflow-visible">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>Waktu</TableHead>
              <TableHead className={HEAD}>Kandidat</TableHead>
              <TableHead className={HEAD}>Perubahan</TableHead>
              <TableHead className={HEAD}>HAV otomatis saat itu</TableHead>
              <TableHead className={HEAD}>Oleh (username / sync)</TableHead>
              <TableHead className={HEAD}>Alasan / keterangan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => {
              const openable = e.candidateId != null && mapIds.has(e.candidateId);
              const badge = e.action ? AUDIT_ACTION_BADGE[e.action] : undefined;
              const actor = auditActorLabel(e);
              return (
                <TableRow key={e.id} className="align-top">
                  <TableCell className="py-2 text-xs tabular-nums whitespace-nowrap text-muted-foreground">
                    {formatDateTime(e.timestamp)}
                  </TableCell>
                  <TableCell className="py-2">
                    {openable ? (
                      <button
                        type="button"
                        onClick={() => onOpenCandidate(e.candidateId!)}
                        className="text-left font-medium transition-colors hover:text-primary"
                      >
                        {e.candidateName ?? '—'}
                      </button>
                    ) : (
                      <span className="font-medium" title="Tidak ada di peta saat ini, atau sudah dihapus">
                        {e.candidateName ?? '—'}
                      </span>
                    )}
                    <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">
                      {masked ? <Mask w={4} /> : e.employeeId}
                    </span>
                    {!openable && (
                      <span className="block text-[10px] text-muted-foreground">tidak di peta saat ini</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2">
                    {masked ? (
                      <Mask w={8} />
                    ) : (
                      <span className="flex flex-wrap items-center gap-1">
                        <QuadrantChip quadrant={e.fromQuadrant} withName={false} />
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <QuadrantChip quadrant={e.toQuadrant} withName={false} />
                        {badge && (
                          <span className={cn('rounded px-1 text-[10px] font-semibold', badge.className)}>
                            {badge.label}
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-2">
                    {masked ? (
                      <Mask w={3} />
                    ) : e.baselineQuadrant != null ? (
                      <span className="flex items-center gap-1">
                        <QuadrantChip quadrant={e.baselineQuadrant} withName={false} />
                        {e.baselineSource && (
                          <span className="text-[10px] text-muted-foreground">{automaticSourceLabel(e.baselineSource)}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">tidak ada</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-xs">
                    <span className="flex items-center gap-1 font-medium">
                      {actor.isSync && <RefreshCw className="h-3 w-3 text-slate-500" />}
                      {actor.name}
                    </span>
                    {actor.username && (
                      <span className="block text-[11px] text-muted-foreground">{actor.username}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-md py-2 text-xs whitespace-pre-wrap text-muted-foreground">
                    {masked ? <Mask w={10} /> : (e.justification ?? '—')}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
