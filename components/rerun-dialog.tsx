'use client';

// ── "Tambah Kandidat Pembanding" (L-2, FR-RR-02..05) ──────────────────────
//
// The only way to derive a run from a finished one: the parent is FROZEN and
// only the candidate set grows ("Re-run scoring — aturan desain", CLAUDE.md).
// The dialog's job is to explain that one decision before it is made:
//
//  • search by name or NPK across the parent's business units — not limited to
//    the target division — with unit, position, grade and job family per row;
//  • every picked person shows the status the server WILL give them, computed by
//    the same function the submit runs (FR-RR-03): scored new, already in the
//    parent's pool (not re-scored), refused with the reason and the failed rules
//    (Rejected), or needing a per-person confirmation because their grade is
//    outside the range (Excluded, FR-RR-05);
//  • "Alasan / permintaan forum" is required, here and on the server (FR-RR-04);
//  • "Yang dipakai dari run induk" and "Yang dinilai baru" say, before submit,
//    what is frozen and who alone gets scored.
// Submit stays disabled until there is a reason and at least one person the
// server will accept. The action and its notification share one name.

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Ban, Loader2, Search, Snowflake, Sparkles, UserPlus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useIsDemoMode } from '@/components/app-mode-provider';
import { formatDateTime } from '@/lib/datetime';
import { CRITERION_LABEL, type CriterionKey } from '@/lib/run-compare';
import { RERUN_REASON_MAX_LENGTH } from '@/lib/rerun-freeze';
import {
  getRerunCandidateStatusesAction,
  searchRerunCandidatesAction,
  type RerunCandidateStatus,
  type RerunPreview,
  type RerunSearchHit,
  type StartRerunResult,
} from '@/lib/scoring-engine';

const RESULT_LIMIT = 40;

type Eligible = Extract<RerunPreview, { eligible: true }>;

const SKIP_LABEL: Record<Extract<RerunCandidateStatus, { status: 'skipped' }>['reason'], string> = {
  parent_finalist: 'Ditolak · finalis run induk',
  not_found: 'Ditolak · tidak ditemukan',
  soft_deleted: 'Ditolak · data dihapus',
  incumbent: 'Ditolak · kini pemegang jabatan target',
  rejected_rules: 'Ditolak · gagal aturan filter',
  outside_scope: 'Ditolak · di luar business unit run induk',
  needs_confirmation: 'Perlu konfirmasi · di luar rentang grade',
};

/** The status the server will give this person — its own words. */
function StatusBadge({ status }: { status: RerunCandidateStatus | null | undefined }) {
  const base = 'inline-flex shrink-0 items-center rounded border px-1 py-px text-[9px] font-semibold';
  if (!status) return <span className={cn(base, 'border-slate-300 text-muted-foreground')}>memeriksa…</span>;
  if (status.status === 'accepted') {
    if (status.classification === 'existing_pool') {
      return (
        <span className={cn(base, 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200')}>
          Sudah ada di pool induk{status.poolRank ? ` · peringkat ${status.poolRank}` : ''} · tidak dinilai ulang
        </span>
      );
    }
    return (
      <span className={cn(base, 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200')}>
        Akan dinilai baru{status.outOfRange ? ' · di luar rentang grade (dikonfirmasi)' : ''}
      </span>
    );
  }
  const tone =
    status.reason === 'needs_confirmation'
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200'
      : 'border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200';
  return <span className={cn(base, tone)}>{SKIP_LABEL[status.reason]}</span>;
}

const isBlocked = (s: RerunCandidateStatus | null | undefined) =>
  Boolean(s && s.status === 'skipped' && s.reason !== 'needs_confirmation');

export type RerunDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  baseRunId: string;
  /** From getRerunPreviewAction — the dialog is only opened for an eligible run. */
  preview: Eligible;
  /** Business units, to name the search scope. */
  tenants: { id: string; name: string }[];
  onSubmit: (input: {
    addedCandidateIds: string[];
    confirmedOutOfRangeIds: string[];
    reason: string;
  }) => Promise<StartRerunResult>;
};

export function RerunDialog(props: RerunDialogProps) {
  const { open, onOpenChange, baseRunId, preview, tenants, onSubmit } = props;
  // Demo mode searches by name only (no NPK leaves the server).
  const demo = useIsDemoMode();

  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RerunSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  // Full rows, so a picked person survives the result list changing.
  const [picked, setPicked] = useState<RerunSearchHit[]>([]);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, RerunCandidateStatus>>({});
  const [checking, setChecking] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) return;
    setQuery('');
    setHits([]);
    setPicked([]);
    setConfirmed(new Set());
    setStatuses({});
    setReason('');
  }, [open]);

  // Search: server-side, debounced, inside the parent's business units.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(
      () => {
        searchRerunCandidatesAction({ baseRunId, query, limit: RESULT_LIMIT })
          .then((r) => !cancelled && setHits(r.hits))
          .catch(() => !cancelled && setHits([]))
          .finally(() => !cancelled && setSearching(false));
      },
      query ? 300 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, baseRunId]);

  // The picked people's statuses, re-asked whenever the picks or the
  // confirmations change — the same classifier the submit applies.
  const pickedKey = picked.map((p) => p.id).join(',');
  const confirmedKey = [...confirmed].sort().join(',');
  useEffect(() => {
    if (!open || picked.length === 0) {
      setStatuses({});
      return;
    }
    let cancelled = false;
    setChecking(true);
    const handle = setTimeout(() => {
      getRerunCandidateStatusesAction({
        baseRunId,
        candidateIds: picked.map((p) => p.id),
        confirmedOutOfRangeIds: [...confirmed],
      })
        .then((s) => !cancelled && setStatuses(s))
        .catch(() => !cancelled && setStatuses({}))
        .finally(() => !cancelled && setChecking(false));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // pickedKey / confirmedKey stand for the arrays.
  }, [open, baseRunId, pickedKey, confirmedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  const toggle = (h: RerunSearchHit) => {
    setPicked((prev) => (prev.some((x) => x.id === h.id) ? prev.filter((x) => x.id !== h.id) : [...prev, h]));
    setConfirmed((prev) => {
      if (!prev.has(h.id)) return prev;
      const next = new Set(prev);
      next.delete(h.id);
      return next;
    });
  };
  const toggleConfirm = (id: string) =>
    setConfirmed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const statusOf = (id: string): RerunCandidateStatus | undefined => statuses[id];
  const accepted = picked.filter((p) => statusOf(p.id)?.status === 'accepted');
  const scoredNew = accepted.filter((p) => {
    const s = statusOf(p.id);
    return s?.status === 'accepted' && s.classification === 'new';
  });
  const fromPool = accepted.filter((p) => {
    const s = statusOf(p.id);
    return s?.status === 'accepted' && s.classification === 'existing_pool';
  });
  const refused = picked.filter((p) => isBlocked(statusOf(p.id)));
  const awaitingConfirm = picked.filter((p) => {
    const s = statusOf(p.id);
    return s?.status === 'skipped' && s.reason === 'needs_confirmation';
  });

  const reasonText = reason.trim();
  const reasonTooLong = reasonText.length > RERUN_REASON_MAX_LENGTH;
  const statusesFresh = !checking && picked.every((p) => p.id in statuses);
  const canSubmit = !pending && statusesFresh && accepted.length > 0 && reasonText.length > 0 && !reasonTooLong;
  const disabledWhy = pending
    ? null
    : accepted.length === 0
      ? 'Pilih sedikitnya satu kandidat yang akan diterima.'
      : !reasonText
        ? 'Isi alasan / permintaan forum.'
        : reasonTooLong
          ? `Alasan paling panjang ${RERUN_REASON_MAX_LENGTH.toLocaleString('id-ID')} karakter.`
          : !statusesFresh
            ? 'Memeriksa status kandidat…'
            : null;

  function handleConfirm() {
    if (!canSubmit) return;
    startTransition(async () => {
      try {
        // Everyone picked goes to the server, refused people included: the child
        // records them with their reasons, which is itself an answer for the
        // forum ("X ditolak karena …", FR-RR-05, FR-RR-10).
        const res = await onSubmit({
          addedCandidateIds: picked.map((p) => p.id),
          confirmedOutOfRangeIds: [...confirmed].filter((id) => pickedIds.has(id)),
          reason: reasonText,
        });
        const added = res.added.filter((a) => a.classification === 'new').length;
        const pool = res.added.filter((a) => a.classification === 'existing_pool').length;
        const summary =
          `Kandidat pembanding ditambahkan: ${added} dinilai baru` +
          (pool > 0 ? `, ${pool} sudah ada di pool induk dan tidak dinilai ulang` : '') +
          '. Run induk tetap utuh.';
        if (res.reused) {
          toast.info('Permintaan yang sama baru saja dikirim; run pembanding yang sudah dibuat dibuka kembali.');
        } else if (res.dispatch.status === 'queued') {
          toast.warning(
            `${summary} Penilaian menunggu layanan scoring: ${res.dispatch.message ?? 'layanan scoring tidak merespons.'} Sesinya sudah tersimpan, jangan jalankan ulang.`,
            { duration: 15000 },
          );
        } else {
          toast.success(summary, { duration: 8000 });
        }
        if (res.skipped.length > 0) {
          toast.info(
            `${res.skipped.length} kandidat tidak ditambahkan: ` +
              res.skipped.map((s) => `${s.name ?? 'Kandidat'} (${s.message})`).join('; ') +
              '. Daftarnya tersimpan di kepala run turunan.',
            { duration: 15000 },
          );
        }
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Kandidat pembanding tidak dapat ditambahkan.');
      }
    });
  }

  const unitNames = preview.scopeTenantIds
    .map((id) => tenants.find((t) => t.id === id)?.name ?? null)
    .filter(Boolean)
    .join(', ');
  const levelRange =
    preview.minGradeId || preview.maxGradeId
      ? `rentang grade ${preview.minGradeId ?? '…'}–${preview.maxGradeId ?? '…'}`
      : 'tanpa batas grade';
  const weights = preview.effectiveWeights
    .map((w) => `${CRITERION_LABEL[w.key as CriterionKey] ?? w.key} ${w.percent.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`)
    .join(', ');

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            Tambah Kandidat Pembanding
          </DialogTitle>
          <DialogDescription className="text-xs">
            Membuat run turunan dari run ini. Semua konfigurasi dan nilai kandidat lama dibekukan dari run induk; yang
            berubah hanya himpunan kandidat, sehingga setiap pergeseran peringkat dapat ditelusuri ke kandidat yang
            ditambahkan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-[11px] dark:bg-muted/15">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Run induk</span>
          <span className="min-w-0 flex-1 truncate font-medium" title={preview.parentLabel ?? baseRunId}>
            {preview.parentLabel ?? baseRunId}
          </span>
          <span className="text-muted-foreground">
            Pool <strong className="text-foreground">{preview.poolSize}</strong> · Finalis{' '}
            <strong className="text-foreground">{preview.finalistCount}</strong>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-0.5">
          <fieldset disabled={pending} className="space-y-3 disabled:opacity-60">
            <div className="space-y-1">
              <Label htmlFor="rerun-search" className="text-xs">
                {demo ? 'Cari karyawan (nama)' : 'Cari karyawan (nama atau NPK)'}
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="rerun-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Contoh: Sari, atau 01234"
                  className="h-9 pl-8 pr-8 text-sm"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="Hapus pencarian"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Mencakup seluruh divisi pada business unit run induk{unitNames ? ` (${unitNames})` : ''}, tidak terbatas
                pada divisi posisi target.
              </p>
            </div>

            <div className="overflow-hidden rounded-lg border bg-background">
              <div className="border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground dark:bg-muted/15">
                {searching ? 'Mencari…' : `${hits.length}${hits.length >= RESULT_LIMIT ? '+' : ''} karyawan — status terhadap run induk`}
              </div>
              <div className="max-h-60 overflow-y-auto">
                {searching && hits.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mencari karyawan…
                  </div>
                ) : hits.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    {demo
                      ? 'Tidak ada karyawan yang cocok. Coba nama lain.'
                      : 'Tidak ada karyawan yang cocok. Coba nama lain atau NPK lengkap.'}
                  </div>
                ) : (
                  <ul className="divide-y">
                    {hits.map((h) => {
                      const blocked = isBlocked(h.status);
                      return (
                        <li key={h.id}>
                          <label
                            className={cn(
                              'flex cursor-pointer items-start gap-2.5 px-3 py-2 transition-colors hover:bg-muted/40',
                              blocked && 'text-muted-foreground',
                            )}
                            title={
                              blocked && h.status?.status === 'skipped'
                                ? `${h.status.message} Tetap dapat dipilih agar penolakannya tercatat pada run turunan.`
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 h-3.5 w-3.5 accent-primary"
                              checked={pickedIds.has(h.id)}
                              onChange={() => toggle(h)}
                              aria-label={`Pilih ${h.name}`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                                <span>{h.name}</span>
                                {h.employeeId && <span className="font-mono text-[10px] text-muted-foreground">{h.employeeId}</span>}
                                {h.businessUnit && (
                                  <span className="rounded bg-primary/10 px-1 py-px text-[9px] font-semibold text-primary">{h.businessUnit}</span>
                                )}
                                <StatusBadge status={h.status} />
                                {blocked && <Ban className="h-3 w-3 text-muted-foreground" aria-hidden />}
                              </span>
                              <span className="block text-[10px] text-muted-foreground">
                                {h.currentPosition ?? 'Jabatan tidak tercatat'}
                                {h.department ? ` · ${h.department}` : ''}
                                {h.grade ? ` · grade ${h.grade}` : ''}
                                {h.jobFamily ? ` · rumpun ${h.jobFamily}` : ''}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {picked.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-2 text-xs font-semibold">
                  Kandidat terpilih ({picked.length})
                  {checking && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Memeriksa status" />}
                </p>
                <ul className="space-y-1">
                  {picked.map((p) => {
                    const st = statusOf(p.id);
                    // A refusal's message already names its rules; only an accepted
                    // person's range or advisory rules need their own line.
                    const rules = st?.status === 'accepted' ? [...st.excludedRules, ...st.advisory] : [];
                    const needsConfirm =
                      (st?.status === 'skipped' && st.reason === 'needs_confirmation') ||
                      (st?.status === 'accepted' && st.outOfRange);
                    return (
                      <li key={p.id} className="rounded-md border px-2 py-1.5 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{p.name}</span>
                          <StatusBadge status={st} />
                          <button
                            type="button"
                            onClick={() => toggle(p)}
                            className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
                            aria-label={`Hapus ${p.name} dari pilihan`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {st?.status === 'skipped' && st.reason !== 'needs_confirmation' && (
                          <p className="mt-0.5 text-[10px] text-rose-700 dark:text-rose-300">{st.message}</p>
                        )}
                        {rules.length > 0 && <p className="mt-0.5 text-[10px] text-muted-foreground">Aturan: {rules.join('; ')}</p>}
                        {needsConfirm && (
                          <label className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-900 dark:text-amber-100">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-3.5 w-3.5 accent-primary"
                              checked={confirmed.has(p.id)}
                              onChange={() => toggleConfirm(p.id)}
                            />
                            <span>
                              Tetap tambahkan walaupun grade-nya di luar rentang posisi target. Dicatat sebagai “di luar
                              rentang grade” pada run turunan.
                            </span>
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="rerun-reason" className="text-xs">
                Alasan / permintaan forum <span className="text-rose-600">*</span>
              </Label>
              <Textarea
                id="rerun-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={RERUN_REASON_MAX_LENGTH}
                placeholder="Contoh: Forum talenta 28 Okt meminta Budi S. dibandingkan dengan finalis yang ada."
                className="min-h-16 text-xs"
                aria-required
              />
              <p className="text-right text-[10px] text-muted-foreground">
                {reasonText.length.toLocaleString('id-ID')} / {RERUN_REASON_MAX_LENGTH.toLocaleString('id-ID')} karakter
              </p>
            </div>

            <div className="space-y-2 rounded-lg border border-sky-300/60 bg-sky-50/50 p-3 text-[11px] leading-relaxed dark:border-sky-900/50 dark:bg-sky-950/20">
              <p className="flex items-center gap-1.5 font-semibold">
                <Snowflake className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden />
                Yang dipakai dari run induk
              </p>
              <p className="text-muted-foreground">
                Bobot efektif {weights || 'tidak tercatat pada run induk (dibaca dari nilai hari ini)'}
                {preview.droppedCriteria.length > 0
                  ? `; kriteria yang dibuang tetap dibuang (${preview.droppedCriteria
                      .map((d) => CRITERION_LABEL[d.key as CriterionKey] ?? d.key)
                      .join(', ')})`
                  : '; seluruh enam kriteria aktif'}
                . Aturan filter program {preview.programName ?? 'run induk'} ({preview.ruleCount} aturan
                {preview.rulesFrom === 'live' ? ', dibaca dari program karena run induk tidak menyimpan salinannya' : ''}) dan{' '}
                {levelRange}. Jangkar kalibrasi{' '}
                {preview.anchorsSource === 'parent' ? 'milik run induk' : 'dari nilai hari ini (run induk tidak menyimpannya)'}.
                Tanggal acuan penilaian {formatDateTime(preview.referenceDate)}
                {preview.referenceDateSource === 'parent_completed_at' ? ' (didekati dengan waktu run induk selesai)' : ''}.
                Basis posisi{' '}
                {preview.positionBasisSource === 'parent'
                  ? `milik run induk${preview.positionBasisJobProfile ? ` (job profile ${preview.positionBasisJobProfile})` : ''}`
                  : 'dari kondisi hari ini, karena run induk tidak menyimpannya'}
                . Enam nilai aspek {preview.poolSize} kandidat lama tidak dihitung ulang, dan skala
                TOPSIS-nya (pembagi serta titik ideal) juga milik run induk — urutan kandidat lama tidak
                berubah; kandidat pembanding hanya disisipkan di antaranya.
                {preview.parentExclusionCount > 0 &&
                  ` ${preview.parentExclusionCount} tanda "dikecualikan" pada run induk ikut diwariskan.`}
              </p>
              <p className="flex items-center gap-1.5 font-semibold">
                <Sparkles className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                Yang dinilai baru
              </p>
              <p className="text-muted-foreground">
                {scoredNew.length > 0
                  ? `Hanya ${scoredNew.length} kandidat yang belum ada di pool induk: ${scoredNew.map((c) => c.name).join(', ')}.`
                  : 'Belum ada. Hanya kandidat yang belum ada di pool induk yang dinilai.'}
                {fromPool.length > 0 &&
                  ` ${fromPool.map((c) => c.name).join(', ')} sudah ada di pool induk, jadi ditampilkan dengan nilai induk tanpa dinilai ulang.`}
              </p>
              {(refused.length > 0 || awaitingConfirm.length > 0) && (
                <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                  <span>
                    {refused.length > 0 &&
                      `${refused.length} kandidat tidak akan ditambahkan; penolakan dan alasannya dicatat pada run turunan. `}
                    {awaitingConfirm.length > 0 &&
                      `${awaitingConfirm.length} kandidat di luar rentang grade menunggu konfirmasi.`}
                  </span>
                </p>
              )}
            </div>
          </fieldset>
        </div>

        <DialogFooter className="shrink-0 items-center gap-2">
          {disabledWhy && <span className="mr-auto text-[11px] font-semibold text-amber-700 dark:text-amber-300">{disabledWhy}</span>}
          <Badge variant="outline" className="text-[10px]">
            {accepted.length} akan diterima
          </Badge>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Batal
          </Button>
          <Button onClick={handleConfirm} disabled={!canSubmit}>
            {pending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Menambahkan…
              </>
            ) : (
              <>
                <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                Tambah Kandidat Pembanding
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
