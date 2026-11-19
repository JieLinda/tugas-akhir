'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  HAV_GAP_LABEL,
  TALENT_MAPPING_JUSTIFICATION_MAX,
  TALENT_MAPPING_JUSTIFICATION_MIN,
  paSlotLabel,
  type TalentMappingCandidate,
} from '@/lib/talent-mapping';
import { cn } from '@/lib/utils';

import { QuadrantChip, SourceBadge, automaticSourceLabel, quadrantLabel } from './shared';

export type PendingMove = {
  candidateId: string;
  /** 1..16, or 'auto' for "kembalikan ke HAV otomatis". */
  target: number | 'auto';
};

/**
 * The confirm step of every move — drag-and-drop and the candidate dialog's
 * "Pindahkan ke…" both land here, so there is one form, one rule and one
 * sentence about what the move means. Nothing has been written when this opens;
 * Batal leaves the map exactly as it was.
 *
 * The move is a HAV decision for the whole app, not a note on this page: the
 * eligibility rules and both scoring engines read the quadrant it sets. The
 * dialog therefore says what it does to the candidate's Talent Pool membership
 * before it is saved, not after.
 */
export function MoveDialog({
  move,
  candidate,
  actor,
  referenceYear,
  saving,
  onCancel,
  onConfirm,
}: {
  move: PendingMove | null;
  candidate: TalentMappingCandidate | null;
  /** WIB year the PA window counts back from — labels the evidence block. */
  referenceYear: number;
  actor: { name: string | null; username: string | null };
  saving: boolean;
  onCancel: () => void;
  onConfirm: (justification: string) => void;
}) {
  const [justification, setJustification] = useState('');
  const open = move != null && candidate != null;

  // A fresh reason for every move: carrying the last one over would invite
  // saving a justification written for somebody else.
  useEffect(() => {
    if (open) setJustification('');
  }, [open, move?.candidateId, move?.target]);

  if (!move || !candidate) return null;

  const automatic = candidate.automatic;
  const revert = move.target === 'auto' || move.target === automatic.quadrant;
  const toQuadrant = revert ? automatic.quadrant : (move.target as number);
  const trimmed = justification.trim();
  const valid =
    trimmed.length >= TALENT_MAPPING_JUSTIFICATION_MIN && trimmed.length <= TALENT_MAPPING_JUSTIFICATION_MAX;
  const willBeInPool = toQuadrant != null && candidate.poolQuadrants.includes(toQuadrant);
  const poolChange =
    candidate.inTalentPool && !willBeInPool ? 'leaves' : !candidate.inTalentPool && willBeInPool ? 'joins' : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{revert ? 'Kembalikan ke HAV otomatis' : 'Pindahkan kandidat'}</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{candidate.name}</span>
            {[candidate.currentPosition, candidate.department].filter(Boolean).length > 0 && (
              <> · {[candidate.currentPosition, candidate.department].filter(Boolean).join(' · ')}</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Dari</p>
            <div className="flex items-center gap-1.5">
              <QuadrantChip quadrant={candidate.quadrant} />
              {/* Both would say "Belum terpetakan" for somebody nothing places. */}
              {candidate.quadrant != null && <SourceBadge source={candidate.source} />}
            </div>
          </div>
          <ArrowRight className="mx-1 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ke</p>
            <div className="flex items-center gap-1.5">
              <QuadrantChip quadrant={toQuadrant} />
              <SourceBadge source={revert ? automatic.source : 'manual'} />
            </div>
          </div>
        </div>

        <div
          className={cn(
            'rounded-lg border px-3 py-2 text-xs leading-relaxed',
            revert
              ? 'border-sky-500/30 bg-sky-500/8 text-sky-900 dark:text-sky-100'
              : 'border-amber-500/30 bg-amber-500/8 text-amber-900 dark:text-amber-100',
          )}
        >
          {revert ? (
            toQuadrant != null ? (
              <>
                Penempatan manual akan <strong>dihapus</strong> dan kandidat kembali ke HAV otomatis dari{' '}
                {automaticSourceLabel(automatic.source)}: <strong>{quadrantLabel(toQuadrant)}</strong>. Setelah itu ia
                ikut berpindah setiap kali sync mengubah HAV otomatisnya (upload HAV, atau PA/BA baru dari MSSQL).
              </>
            ) : (
              <>
                Penempatan manual akan <strong>dihapus</strong>. Kandidat tidak punya upload HAV dan rumus belum dapat
                menghitungnya, jadi ia kembali ke &ldquo;Belum terpetakan&rdquo; sampai datanya ada.
              </>
            )
          ) : automatic.quadrant != null ? (
            <>
              Kuadran ini <strong>menyimpang dari HAV otomatis</strong> ({automaticSourceLabel(automatic.source)}),
              yaitu {quadrantLabel(automatic.quadrant)}. Yang terbaru yang berlaku: penempatan manual ini berlaku sampai
              diubah lagi — atau sampai ada sync <strong>setelah</strong> ini yang mengubah HAV otomatis kandidat
              (upload HAV kapan pun, HAV.xlsx folder bersama, atau Sync Kandidat dengan PA/BA baru dari MSSQL). Sync yang
              tidak mengubah HAV-nya tidak menyentuh penempatan ini.
            </>
          ) : (
            <>
              Kandidat belum punya HAV otomatis —{' '}
              {!candidate.formula.ok && candidate.formula.gaps.map((g) => HAV_GAP_LABEL[g]).join('; ')}. Penempatan manual
              berlaku sampai diubah lagi, atau sampai ada sync setelah ini yang memberinya HAV otomatis (upload HAV yang
              memuat kandidat ini, atau PA/BA yang lengkap).
            </>
          )}
        </div>

        {/* Nothing automatic places this person, so the reason has to come from
            the raw evidence — put it in front of whoever is writing that reason. */}
        {automatic.quadrant == null && !revert && (
          <div className="space-y-1 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Data yang tercatat</p>
            <p>
              <span className="text-muted-foreground">BA: </span>
              {candidate.behaviorHistory.length > 0
                ? candidate.behaviorHistory
                    .map((e) => `${e.label ?? 'kategori tidak tercatat'} (${e.date ?? 'tanpa tanggal'})`)
                    .join(' · ')
                : 'belum ada asesmen tercatat'}
            </p>
            <p>
              <span className="text-muted-foreground">PA: </span>
              {candidate.performanceSlots.some(Boolean)
                ? candidate.performanceSlots
                    .map((g, i) => (g ? `${paSlotLabel(i, referenceYear)} ${g}` : null))
                    .filter(Boolean)
                    .join(' · ')
                : `jendela ${referenceYear - 3}–${referenceYear - 1} kosong`}
              {candidate.paOutsideWindow &&
                ` · di luar jendela: ${candidate.paOutsideWindow.year} S1 ${candidate.paOutsideWindow.s1 ?? '–'} / S2 ${candidate.paOutsideWindow.s2 ?? '–'}`}
            </p>
          </div>
        )}

        <div
          className={cn(
            'rounded-lg border px-3 py-2 text-xs leading-relaxed',
            poolChange === 'leaves'
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100'
              : poolChange === 'joins'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
                : 'border-border bg-muted/30 text-muted-foreground',
          )}
        >
          {poolChange === 'leaves' ? (
            <>
              Dengan kuadran ini kandidat <strong>keluar dari daftar Lolos Talent Pool</strong> (aturan HAV) — tetap
              tampil di peta ini, karena peta hanya disaring aturan Disiplin. Kuadran yang sama juga dipakai aturan filter
              program lain dan aspek HAV saat scoring.
            </>
          ) : poolChange === 'joins' ? (
            <>
              Dengan kuadran ini kandidat <strong>lolos Talent Pool</strong>. Kuadran yang sama juga dipakai aturan
              filter program lain dan aspek HAV saat scoring.
            </>
          ) : (
            <>
              Status Talent Pool tidak berubah ({willBeInPool ? 'tetap lolos' : 'tetap di luar'}). Kuadran ini dipakai
              aturan filter dan aspek HAV saat scoring berikutnya; run yang sudah selesai tidak berubah.
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="talent-move-justification">
            Alasan justifikasi <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="talent-move-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            maxLength={TALENT_MAPPING_JUSTIFICATION_MAX}
            rows={4}
            autoFocus
            disabled={saving}
            placeholder={
              revert
                ? 'Contoh: Penempatan sebelumnya keliru — hasil kalibrasi mengikuti HAV otomatis.'
                : 'Contoh: Hasil kalibrasi talent review — kinerja proyek X melampaui rating PA periode terakhir.'
            }
          />
          <p className="flex justify-between text-[11px] text-muted-foreground">
            <span>
              {trimmed.length < TALENT_MAPPING_JUSTIFICATION_MIN
                ? `Minimal ${TALENT_MAPPING_JUSTIFICATION_MIN} karakter.`
                : 'Alasan ini tersimpan permanen di riwayat HAV.'}
            </span>
            <span className="tabular-nums">
              {trimmed.length}/{TALENT_MAPPING_JUSTIFICATION_MAX}
            </span>
          </p>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Dicatat pada <code className="text-[10px]">talent_audit_logs</code> atas nama{' '}
          <strong className="text-foreground">{actor.name ?? actor.username ?? 'pengguna saat ini'}</strong>
          {actor.username && actor.name ? ` (${actor.username})` : ''}, beserta waktu (jam database — pembanding urutan
          terhadap sync), kuadran asal, kuadran tujuan, dan HAV otomatis saat ini.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Batal
          </Button>
          <Button onClick={() => onConfirm(trimmed)} disabled={!valid || saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {revert ? 'Kembalikan & simpan' : 'Simpan perpindahan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
