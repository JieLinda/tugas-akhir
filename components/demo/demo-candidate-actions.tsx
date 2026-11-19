'use client';

// The candidate actions while demo mode is on — Edit, Turnoff, Reload — in
// place of real mode's Edit and Delete. Nothing here writes the `candidates`
// table: see lib/demo/candidate-demo-actions.ts for what each one stores.

import { useState } from 'react';
import { Loader2, Pencil, PowerOff, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CandidateFormDialog } from '@/components/candidate-form-dialog';
import {
  reloadDemoCandidatesAction,
  saveDemoCandidateAction,
  turnOffDemoCandidatesAction,
} from '@/lib/demo/candidate-demo-actions';
import type { CandidateProfile } from '@/lib/talent-data';
import { cn } from '@/lib/utils';

export function DemoStateBadge({ demo, className }: { demo: CandidateProfile['demo']; className?: string }) {
  if (!demo) return null;
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Badge
        variant="outline"
        className={cn(
          'h-5 px-1.5 text-[10px] font-semibold',
          demo.on
            ? 'border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'border-slate-300/70 text-muted-foreground',
        )}
      >
        {demo.on ? 'On' : 'Off'}
      </Badge>
      {demo.edited && (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium text-muted-foreground">
          Diedit
        </Badge>
      )}
    </span>
  );
}

type FormLookups = {
  departments: string[];
  divisions: string[];
  positions: string[];
  masterCompetencies: { technicalId: string; technicalName: string }[];
};

export function DemoCandidateActions({
  candidate,
  lookups,
  onChanged,
}: {
  candidate: CandidateProfile;
  lookups: FormLookups;
  /** Refetch whatever list or page shows the candidate. */
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<'off' | 'reload' | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const on = candidate.demo?.on ?? false;

  async function run(kind: 'off' | 'reload') {
    setBusy(kind);
    try {
      if (kind === 'off') {
        await turnOffDemoCandidatesAction([candidate.id]);
        toast.success('Kandidat dinonaktifkan.');
      } else {
        await reloadDemoCandidatesAction([candidate.id]);
        toast.success('Kandidat dimuat ulang.');
      }
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Aksi gagal.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <CandidateFormDialog
        title="Ubah karyawan"
        description="Perbarui data karyawan."
        submitLabel="Simpan perubahan"
        action={async (fd) => {
          try {
            await saveDemoCandidateAction(fd);
            toast.success('Kandidat berhasil diperbarui.');
            await onChanged();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Gagal memperbarui kandidat.');
            throw err;
          }
        }}
        candidate={candidate}
        departments={lookups.departments}
        divisions={lookups.divisions}
        positions={lookups.positions}
        masterCompetencies={lookups.masterCompetencies}
        trigger={
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" aria-label="Edit">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="Turnoff"
        aria-label="Turnoff"
        disabled={!on || busy !== null}
        onClick={() => run('off')}
      >
        {busy === 'off' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="Reload"
        aria-label="Reload"
        disabled={busy !== null}
        // Reload discards the edited copy, so only then is it worth a question.
        onClick={() => (candidate.demo?.edited ? setConfirmReload(true) : run('reload'))}
      >
        {busy === 'reload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
      </Button>
      <AlertDialog open={confirmReload} onOpenChange={setConfirmReload}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reload {candidate.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Perubahan yang pernah disimpan untuk kandidat ini dibuang dan datanya kembali seperti semula. Kandidat
              juga diaktifkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReload(false);
                void run('reload');
              }}
            >
              Reload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Bulk Reload / Turnoff for a selection — every candidate starts OFF, so one at a time does not scale. */
export function DemoBulkBar({
  selectedIds,
  pageIds,
  onSelectionChange,
  onChanged,
}: {
  selectedIds: Set<string>;
  pageIds: string[];
  onSelectionChange: (next: Set<string>) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<'off' | 'reload' | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  async function run(kind: 'off' | 'reload') {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBusy(kind);
    try {
      const { changed } =
        kind === 'off' ? await turnOffDemoCandidatesAction(ids) : await reloadDemoCandidatesAction(ids);
      toast.success(kind === 'off' ? `${changed} kandidat dinonaktifkan.` : `${changed} kandidat dimuat ulang.`);
      onSelectionChange(new Set());
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Aksi gagal.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => {
          const next = new Set(selectedIds);
          for (const id of pageIds) {
            if (allOnPage) next.delete(id);
            else next.add(id);
          }
          onSelectionChange(next);
        }}
      >
        {allOnPage ? 'Batalkan pilihan halaman ini' : 'Pilih semua di halaman ini'}
      </Button>
      <span className="text-muted-foreground">{selectedIds.size} dipilih</span>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" className="h-7 gap-1 text-xs" disabled={selectedIds.size === 0 || busy !== null} onClick={() => setConfirmReload(true)}>
          {busy === 'reload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Reload
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={selectedIds.size === 0 || busy !== null}
          onClick={() => run('off')}
        >
          {busy === 'off' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PowerOff className="h-3.5 w-3.5" />}
          Turnoff
        </Button>
        {selectedIds.size > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onSelectionChange(new Set())}>
            Batal
          </Button>
        )}
      </div>
      {/* The selection can span pages, so the bar cannot tell which of them carry
          edits — Reload always asks, because it discards every one of them. */}
      <AlertDialog open={confirmReload} onOpenChange={setConfirmReload}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reload {selectedIds.size} kandidat?</AlertDialogTitle>
            <AlertDialogDescription>
              Perubahan yang pernah disimpan untuk kandidat terpilih dibuang dan datanya kembali seperti semula. Semua
              kandidat terpilih diaktifkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReload(false);
                void run('reload');
              }}
            >
              Reload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
