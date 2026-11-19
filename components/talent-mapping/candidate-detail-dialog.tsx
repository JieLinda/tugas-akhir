'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CircleCheck, Clock, Hand, History, Loader2, RefreshCw, TriangleAlert, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { behaviorLabel, fieldLabel } from '@/lib/candidate-labels';
import { formatDateTime } from '@/lib/datetime';
import { HAV_QUADRANTS } from '@/lib/hav-quadrant';
import { competencyBand, readPerformance } from '@/lib/hav-quadrant-derive';
import { getTalentMappingCandidateHistoryAction } from '@/lib/talent-mapping-actions';
import {
  HAV_GAP_LABEL,
  TALENT_MAPPING_BA_HISTORY_DEPTH,
  type TalentMappingAuditEntry,
  type TalentMappingCandidate,
} from '@/lib/talent-mapping';
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
  describePerformance,
  quadrantBox,
  quadrantLabel,
  slotsCsv,
  syncOriginLabel,
} from './shared';

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function AuditMoveLine({ entry, masked }: { entry: TalentMappingAuditEntry; masked: boolean }) {
  const badge = entry.action ? AUDIT_ACTION_BADGE[entry.action] : undefined;
  const actor = auditActorLabel(entry);
  return (
    <div className={cn('space-y-1 rounded-md border p-2 text-xs', actor.isSync ? 'bg-slate-500/5' : 'bg-muted/20')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="tabular-nums text-muted-foreground">{formatDateTime(entry.timestamp)}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="flex items-center gap-1 font-medium">
          {actor.isSync && <RefreshCw className="h-3 w-3 text-slate-500" />}
          {actor.name}
        </span>
        {actor.username && <span className="text-muted-foreground">({actor.username})</span>}
        {badge && <span className={cn('rounded px-1 text-[10px] font-semibold', badge.className)}>{badge.label}</span>}
      </div>
      {masked ? (
        <Mask w={10} />
      ) : entry.unreadable ? (
        <p className="text-muted-foreground">Isi entri terkunci — kunci enkripsi tidak cocok.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <QuadrantChip quadrant={entry.fromQuadrant} />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <QuadrantChip quadrant={entry.toQuadrant} />
            <span className="text-[11px] text-muted-foreground">
              · HAV otomatis saat itu:{' '}
              {entry.baselineQuadrant != null
                ? `Q${entry.baselineQuadrant}${entry.baselineSource ? ` (${automaticSourceLabel(entry.baselineSource)})` : ''}`
                : 'tidak ada'}
            </span>
          </div>
          {entry.justification && (
            <p className="whitespace-pre-wrap border-l-2 border-border pl-2 text-muted-foreground">
              {entry.justification}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** One row of the "Sumber HAV" table: a source, its answer, and whether it is the one in force. */
function SourceRow({
  label,
  inForce,
  children,
}: {
  label: string;
  inForce: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid gap-2 rounded-md px-2 py-1.5 sm:grid-cols-[9rem_1fr]',
        inForce ? 'bg-primary/6 ring-1 ring-primary/25' : 'bg-muted/25',
      )}
    >
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {inForce && <CircleCheck className="h-3.5 w-3.5 text-primary" aria-label="Berlaku" />}
        {label}
      </p>
      <div className="min-w-0 space-y-1 text-xs">{children}</div>
    </div>
  );
}

/**
 * The ORDER of the two events that decide between manual and automatic — the
 * hand placement and the last sync that changed the automatic HAV — said in a
 * sentence, because "which one is newer" is the whole rule and two bare
 * timestamps make the reader do the comparison.
 */
function TimeOrder({ candidate }: { candidate: TalentMappingCandidate }) {
  const placement = candidate.placement;
  const syncAt = candidate.automaticChangedAt;
  return (
    <div className="space-y-1 rounded-md border border-dashed px-2 py-1.5 text-xs">
      <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        Urutan waktu — yang terbaru yang berlaku
      </p>
      <p className="flex flex-wrap items-center gap-1">
        <RefreshCw className="h-3 w-3 text-slate-500" />
        Sync terakhir yang mengubah HAV otomatis:{' '}
        {syncAt ? (
          <strong className="tabular-nums">
            {formatDateTime(syncAt)} · {syncOriginLabel(candidate.automaticChangeOrigin)}
          </strong>
        ) : (
          <span className="text-muted-foreground">belum ada sejak pencatatan waktu dimulai</span>
        )}
      </p>
      <p className="flex flex-wrap items-center gap-1">
        <Hand className="h-3 w-3 text-violet-600 dark:text-violet-400" />
        Penempatan manual:{' '}
        {placement ? (
          <strong className="tabular-nums">{formatDateTime(placement.placedAt)}</strong>
        ) : (
          <span className="text-muted-foreground">tidak ada yang berlaku</span>
        )}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {placement
          ? 'Penempatan manual lebih baru, jadi berlaku. Ia akan digantikan bila nanti ada upload HAV, HAV.xlsx, atau Sync Kandidat (PA/BA baru dari MSSQL) yang mengubah HAV otomatis kandidat ini.'
          : 'HAV otomatis yang berlaku. Penempatan manual baru akan berlaku sampai ada sync berikutnya yang mengubah HAV otomatis kandidat ini.'}
      </p>
    </div>
  );
}

/**
 * One candidate on the map: the HAV in force and the three sources it is
 * resolved from (manual > upload > formula, with time deciding between a hand
 * placement and a sync), their Talent Pool verdict as information, who moved
 * them or which sync changed them (and why), and the move control for anyone
 * who cannot drag. The move itself goes through the same justification dialog
 * as a drop.
 */
export function CandidateDetailDialog({
  candidate,
  referenceYear,
  masked,
  canManage,
  historyVersion,
  onOpenChange,
  onRequestMove,
}: {
  candidate: TalentMappingCandidate | null;
  referenceYear: number;
  masked: boolean;
  canManage: boolean;
  /** Bumped by the page after each saved move, so an open history refetches. */
  historyVersion: number;
  onOpenChange: (open: boolean) => void;
  onRequestMove: (target: number | 'auto') => void;
}) {
  const [history, setHistory] = useState<TalentMappingAuditEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>('');
  const candidateId = candidate?.id ?? null;

  useEffect(() => {
    setTarget('');
    if (!candidateId || masked) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    getTalentMappingCandidateHistoryAction(candidateId)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((err) => {
        if (!cancelled) setHistoryError(err instanceof Error ? err.message : 'Gagal memuat riwayat.');
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId, masked, historyVersion]);

  if (!candidate) return null;

  const formula = candidate.formula;
  const placement = candidate.placement;
  const automatic = candidate.automatic;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {candidate.name || '—'}
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {masked ? <Mask w={4} /> : candidate.employeeId}
            </span>
          </DialogTitle>
          <DialogDescription>
            {[candidate.currentPosition, candidate.department, candidate.division].filter(Boolean).join(' · ') || '—'}
          </DialogDescription>
        </DialogHeader>

        {masked ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
            HAV, nilai PA, Behavioral Assessment, dan riwayat HAV disamarkan. Klik{' '}
            <strong>Tampilkan data</strong> di kanan atas halaman untuk melihatnya.
          </div>
        ) : (
          <div className="space-y-3">
            <Section
              title="HAV yang berlaku"
              aside={
                <Link
                  href={`/candidates/${candidate.id}`}
                  className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  Buka profil kandidat
                </Link>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <QuadrantChip quadrant={candidate.quadrant} className="text-xs" />
                {candidate.quadrant != null && <BoxChip box={quadrantBox(candidate.quadrant)} />}
                <SourceBadge source={candidate.source} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Dipakai aturan filter (Talent Pool, Successor, Emergency) dan aspek HAV saat scoring.
              </p>
              <div
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs',
                  candidate.inTalentPool
                    ? 'bg-emerald-500/8 text-emerald-800 dark:text-emerald-200'
                    : 'bg-amber-500/10 text-amber-800 dark:text-amber-200',
                )}
              >
                {candidate.inTalentPool ? (
                  'Talent Pool: lolos seluruh aturan dengan kuadran ini.'
                ) : (
                  <>
                    Talent Pool: tidak lolos dengan kuadran ini —{' '}
                    {candidate.poolFailedRules.map((r) => (r.dataMissing ? `${fieldLabel(r.field)} kosong` : r.message || r.label)).join('; ') ||
                      'tidak memenuhi aturan HAV'}
                    .
                  </>
                )}
                <span className="block text-[11px] opacity-80">
                  Keterangan saja — peta memuat semua kandidat yang lolos aturan Disiplin, apa pun status Talent
                  Pool-nya.
                </span>
              </div>
              {placement && candidate.baselineDrifted && (
                <p className="flex items-start gap-1 rounded bg-amber-500/10 px-1.5 py-1 text-xs text-amber-800 dark:text-amber-200">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Penempatan manual ini dibuat saat HAV otomatisnya{' '}
                  {placement.baselineQuadrant != null
                    ? `Q${placement.baselineQuadrant} (${automaticSourceLabel(placement.baselineSource)})`
                    : 'tidak ada'}
                  ; sekarang{' '}
                  {automatic.quadrant != null
                    ? `Q${automatic.quadrant} (${automaticSourceLabel(automatic.source)})`
                    : 'tidak ada'}
                  , tanpa sync yang menggantikannya (mis. PA/BA diubah manual, atau penempatan dari sebelum
                  pencatatan waktu). Penempatan manual tetap berlaku — tinjau apakah alasannya masih relevan.
                </p>
              )}
            </Section>

            <Section title="Sumber HAV (manual › upload › rumus)">
              <TimeOrder candidate={candidate} />
              <SourceRow label="Penempatan manual" inForce={candidate.source === 'manual'}>
                {placement ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <QuadrantChip quadrant={placement.quadrant} />
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Hand className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                        oleh <strong className="text-foreground">{placement.placedByName ?? placement.placedByUsername ?? 'pengguna'}</strong>
                        {placement.placedByUsername && placement.placedByName && ` (${placement.placedByUsername})`}
                        {' · '}
                        {formatDateTime(placement.placedAt)}
                      </span>
                    </div>
                    {placement.justification && (
                      <p className="whitespace-pre-wrap border-l-2 border-violet-500/40 pl-2 text-muted-foreground">
                        {placement.justification}
                      </p>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">Tidak ada.</span>
                )}
              </SourceRow>

              <SourceRow label="Upload HAV" inForce={candidate.source === 'upload'}>
                {candidate.uploadedHavQuadrant != null ? (
                  <QuadrantChip quadrant={candidate.uploadedHavQuadrant} />
                ) : (
                  <span className="text-muted-foreground">Tidak ada di upload HAV.</span>
                )}
              </SourceRow>

              <SourceRow label="Rumus PA × BA" inForce={candidate.source === 'formula'}>
                {/* Each axis is banded on its own: one missing axis stops the
                    quadrant, not the other band — "BA: Potensi —" read as if
                    the assessment itself were unrecognised. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>BA: {behaviorLabel(candidate.behaviorRecommendation)}</span>
                  <BandChip band={competencyBand(candidate.behaviorRecommendation)} />
                  <span className="text-[10px] text-muted-foreground">— yang dibaca rumus</span>
                </div>
                {candidate.behaviorHistory.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">
                      Riwayat BA (terbaru dulu, maks {TALENT_MAPPING_BA_HISTORY_DEPTH}):
                    </p>
                    <ul className="space-y-0.5">
                      {candidate.behaviorHistory.map((e, i) => (
                        <li key={`${e.date ?? 'x'}-${i}`} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className={i === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                            {e.label ? behaviorLabel(e.label) : 'Kategori tidak tercatat'}
                          </span>
                          {competencyBand(e.label) && <BandChip band={competencyBand(e.label)} />}
                          <span className="tabular-nums text-muted-foreground">{e.date ?? 'tanpa tanggal'}</span>
                          {e.note && (
                            <span className="w-full border-l-2 border-border pl-1.5 text-muted-foreground">{e.note}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <PaSlots
                    slots={candidate.performanceSlots}
                    reading={readPerformance(slotsCsv(candidate.performanceSlots))}
                    referenceYear={referenceYear}
                    showLabels
                  />
                  <BandChip band={readPerformance(slotsCsv(candidate.performanceSlots))?.band ?? null} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {describePerformance(readPerformance(slotsCsv(candidate.performanceSlots)), referenceYear)} Bingkai
                  putus-putus = jendela 2 tahun terakhir.
                </p>
                {candidate.paOutsideWindow && (
                  <p className="text-[11px] text-muted-foreground">
                    PA di luar jendela rumus ({referenceYear - 3}–{referenceYear - 1}):{' '}
                    <strong className="text-foreground">{candidate.paOutsideWindow.year}</strong> · S1{' '}
                    {candidate.paOutsideWindow.s1 ?? '–'} · S2 {candidate.paOutsideWindow.s2 ?? '–'}
                    {candidate.paOutsideWindow.year >= referenceYear
                      ? ' — belum masuk jendela, tidak dipakai rumus.'
                      : ' — terakhir yang tercatat, tidak dipakai rumus.'}
                  </p>
                )}
                {formula.ok ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    BA <strong>{formula.competencyBand}</strong> × PA <strong>{formula.performanceBand}</strong>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <QuadrantChip quadrant={formula.quadrant} />
                  </span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-300">
                    Tidak dapat dihitung: {formula.gaps.map((g) => HAV_GAP_LABEL[g]).join('; ')}.
                  </span>
                )}
              </SourceRow>
            </Section>

            {canManage && (
              <Section title="Pindahkan">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={target} onValueChange={setTarget}>
                    <SelectTrigger className="h-9 w-76 text-sm" aria-label="Kuadran tujuan">
                      <SelectValue placeholder="Pilih kuadran tujuan…" />
                    </SelectTrigger>
                    <SelectContent>
                      {HAV_QUADRANTS.filter((q) => q.number !== candidate.quadrant).map((q) => (
                        <SelectItem key={q.number} value={String(q.number)}>
                          {quadrantLabel(q.number)}
                          {q.number === automatic.quadrant ? ' — HAV otomatis' : ''}
                          {candidate.poolQuadrants.includes(q.number) ? '' : ' · di luar Talent Pool'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!target} onClick={() => onRequestMove(Number(target))} className="gap-1.5">
                    Lanjutkan
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  {placement && (
                    <Button size="sm" variant="outline" onClick={() => onRequestMove('auto')} className="gap-1.5">
                      <Undo2 className="h-3.5 w-3.5" />
                      Kembalikan ke HAV otomatis
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Sama dengan menyeret di peta: langkah berikutnya meminta alasan justifikasi, dan baru tersimpan setelah
                  dikonfirmasi. Penempatan berlaku sampai ada sync yang mengubah HAV otomatis kandidat ini.
                </p>
              </Section>
            )}

            <Section
              title="Riwayat HAV (manual & sync)"
              aside={<History className="h-3.5 w-3.5 text-muted-foreground" />}
            >
              {historyError ? (
                <p className="text-xs text-destructive">{historyError}</p>
              ) : history == null ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat riwayat…
                </p>
              ) : history.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Belum pernah dipindah manual atau diubah sync sejak pencatatan dimulai — HAV-nya dari{' '}
                  {automaticSourceLabel(automatic.source)}.
                </p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {history.map((entry) => (
                    <AuditMoveLine key={entry.id} entry={entry} masked={false} />
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
