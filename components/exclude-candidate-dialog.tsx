'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Ban, Info, Loader2, Undo2 } from 'lucide-react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  setRunExclusionAction,
  type RunExclusionEntry,
  type RunExclusionReason,
} from '@/lib/scoring-engine';

export const EXCLUSION_REASON_OPTIONS: { value: RunExclusionReason; label: string }[] = [
  { value: 'retired', label: 'Pensiun' },
  { value: 'resigned', label: 'Resign' },
  { value: 'promoted', label: 'Sudah dipromosikan' },
  { value: 'conflict_of_interest', label: 'Konflik kepentingan' },
  { value: 'other', label: 'Lainnya' },
];

export function exclusionReasonLabel(reason: RunExclusionReason): string {
  return EXCLUSION_REASON_OPTIONS.find((o) => o.value === reason)?.label ?? 'Lainnya';
}

/**
 * Reason dialog for marking a candidate "tidak dipertimbangkan" on a finished
 * run — and for undoing it.
 *
 * This is the soft half of the feature on purpose: the run's ranking is the
 * record of an assessment on a date, so excluding someone annotates it instead
 * of rewriting it. Scores and ranks stay exactly as computed; the row is struck
 * through and skipped by the derived counts.
 *
 * There is no "re-rank without this person" any more. Re-running a run is one
 * operation — adding comparison candidates to a frozen parent ("Re-run scoring —
 * aturan desain", CLAUDE.md) — and a ranking without somebody is answered by
 * this mark, on the run that was actually assessed.
 */
export function ExcludeCandidateDialog({
  open,
  onOpenChange,
  runId,
  candidate,
  existing,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  candidate: { id: string; name: string } | null;
  /** Present when the candidate is already excluded — the dialog then undoes it. */
  existing: RunExclusionEntry | null;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<RunExclusionReason>('resigned');
  const [note, setNote] = useState('');
  const [undoNote, setUndoNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Fresh form per candidate — otherwise the previous person's reason and note
  // carry over into the next exclusion, which then gets audited as fact.
  useEffect(() => {
    setReason(existing?.reason ?? 'resigned');
    setNote(existing?.note ?? '');
    setUndoNote('');
  }, [candidate?.id, existing?.reason, existing?.note]);

  const isUndo = Boolean(existing);

  async function submit(excluded: boolean) {
    if (!candidate) return;
    if (excluded && reason === 'other' && !note.trim()) {
      toast.error("Alasan 'Lainnya' wajib disertai keterangan.");
      return;
    }
    if (!excluded && !undoNote.trim()) {
      toast.error('Alasan pembatalan tanda wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set('runId', runId);
      fd.set('candidateId', candidate.id);
      fd.set('excluded', String(excluded));
      fd.set('reason', reason);
      fd.set('note', excluded ? note.trim() : undoNote.trim());
      await setRunExclusionAction(fd);
      toast.success(
        excluded
          ? `${candidate.name} ditandai dikecualikan. Skor dan peringkat run tidak berubah.`
          : `Tanda dikecualikan pada ${candidate.name} dibatalkan.`,
      );

      onOpenChange(false);
      setNote('');
      setReason('resigned');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {isUndo ? <Undo2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
            {isUndo ? 'Batalkan tanda dikecualikan' : 'Tandai dikecualikan (tidak memengaruhi angka)'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isUndo ? (
              <>
                <strong>{candidate?.name}</strong> saat ini ditandai dikecualikan (
                {exclusionReasonLabel(existing!.reason)}
                {existing!.note ? `: ${existing!.note}` : ''}). Membatalkannya hanya
                menghapus tanda itu, dan pembatalan dicatat beserta pelaku dan waktunya — skor
                dan peringkat run tidak pernah berubah.
              </>
            ) : (
              <>
                <strong>{candidate?.name}</strong> akan ditandai dikecualikan pada run ini.
                Ini penandaan forum, bukan kategori filter &ldquo;di luar rentang grade&rdquo;:
                skor, peringkat, dan snapshot run tidak berubah, dan tidak ada run baru yang
                dibuat. Barisnya dicoret dan tidak ikut dihitung sebagai kandidat siap; alasan,
                pelaku, dan waktunya dicatat.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {isUndo && (
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="exclusion-undo-note">
              Alasan pembatalan <span className="text-rose-600">*</span>
            </Label>
            <Textarea
              id="exclusion-undo-note"
              value={undoNote}
              onChange={(e) => setUndoNote(e.target.value)}
              placeholder="Contoh: rencana pensiun dibatalkan (memo HRD/2026/131)."
              className="min-h-16 text-sm"
              aria-required
            />
          </div>
        )}

        {!isUndo && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Alasan</Label>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as RunExclusionReason)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXCLUSION_REASON_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Keterangan {reason === 'other' && <span className="text-rose-600">*</span>}
              </Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Contoh: efektif pensiun 1 Sep 2026 (memo HRD/2026/114)."
                className="min-h-16 text-sm"
              />
            </div>

            <p className="flex items-start gap-1.5 rounded-lg border border-dashed p-2.5 text-[10px] leading-relaxed text-muted-foreground">
              <Info className="mt-px h-3 w-3 shrink-0" />
              Penandaan ini tidak membuat run baru dan tidak menggeser peringkat siapa pun. Untuk
              melihat bagaimana peringkat berubah bila ada kandidat lain yang ikut dibandingkan,
              gunakan &ldquo;Tambah Kandidat Pembanding&rdquo; pada run ini.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Batal
          </Button>
          <Button
            size="sm"
            variant={isUndo ? 'default' : 'destructive'}
            onClick={() => submit(!isUndo)}
            disabled={saving || (isUndo && !undoNote.trim())}
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Menyimpan…
              </>
            ) : isUndo ? (
              'Batalkan tanda'
            ) : (
              'Tandai dikecualikan'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Banner above the candidate list summarising this run's exclusions.
 *
 * Marks only: excluding somebody changes nobody's number, and there is no
 * re-rank behind this banner — see ExcludeCandidateDialog.
 */
export function ExclusionSummaryBar({
  exclusions,
  candidateNames,
  onUndo,
}: {
  exclusions: RunExclusionEntry[];
  candidateNames: Record<string, string>;
  onUndo: (candidateId: string) => void;
}) {
  if (exclusions.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-300/50 bg-amber-50/60 dark:border-amber-800/50 dark:bg-amber-950/20 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
          <Ban className="h-3.5 w-3.5" />
          {exclusions.length} kandidat ditandai dikecualikan (tidak memengaruhi angka)
        </span>
        <span className="text-[10px] text-muted-foreground">
          Hanya penandaan forum — skor, peringkat, dan snapshot run ini tidak berubah.
        </span>
        {exclusions.some((e) => e.inheritedFromRunId) && (
          <span className="text-[10px] text-muted-foreground">
            {exclusions.filter((e) => e.inheritedFromRunId).length} tanda diwarisi dari run induk saat
            run ini dibuat; membatalkannya di sini tidak mengubah run induk.
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {exclusions.map((e) => (
          <span
            key={e.candidateId}
            className="inline-flex items-center gap-1 rounded border border-amber-300/60 bg-background px-1.5 py-0.5 text-[10px]"
          >
            <span className="font-medium line-through decoration-amber-600/70">
              {candidateNames[e.candidateId] ?? e.candidateId.slice(0, 8)}
            </span>
            <span className="text-muted-foreground">
              · {exclusionReasonLabel(e.reason)}
              {e.note ? `: ${e.note}` : ''}
            </span>
            {e.inheritedFromRunId && (
              <span
                className="rounded bg-amber-500/10 px-1 text-[9px] font-semibold text-amber-800 dark:text-amber-300"
                title={`Ditandai di run ${e.inheritedFromRunLabel ?? e.inheritedFromRunId.slice(0, 8)} lalu diwarisi run ini.`}
              >
                diwarisi
              </span>
            )}
            <button
              type="button"
              onClick={() => onUndo(e.candidateId)}
              className="ml-0.5 text-muted-foreground hover:text-foreground"
              title="Batalkan tanda dikecualikan"
              aria-label={`Batalkan tanda dikecualikan pada ${candidateNames[e.candidateId] ?? 'kandidat'}`}
            >
              <Undo2 className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
