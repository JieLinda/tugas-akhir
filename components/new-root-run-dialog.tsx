'use client';

// "Penilaian Baru" (FR-RH-04): a new ROOT run for this position under the data
// and the governance configuration in force today. The other way to get a new
// ranking — "Tambah Kandidat Pembanding" — freezes everything from its parent
// and only adds people; this one re-reads everything, which is exactly what a
// sensitivity analysis or a changed configuration needs. The dialog says that
// difference in one sentence, because the two are easy to confuse in a forum.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { startNewRootRunAction } from '@/lib/run-history-actions';

export function NewRootRunButton({ positionId, positionTitle }: { positionId: string; positionTitle: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const res = await startNewRootRunAction({ positionId });
      if (res.dispatch.status === 'queued') {
        toast.warning(
          `Penilaian baru tersimpan dan menunggu layanan scoring. Sesinya sudah tersimpan, jangan jalankan ulang. ${res.dispatch.message ?? ''}`.trim(),
          { duration: 10000 },
        );
      } else {
        toast.success('Penilaian baru dimulai. Setelah selesai, bandingkan hasilnya dengan run root sebelumnya.');
      }
      setOpen(false);
      // push alone: the page is dynamic, so a new runId is a fresh server render.
      // A refresh() right behind it re-renders the CURRENT url and can win the
      // race, leaving the user on the old run (seen in the browser check).
      router.push(`/positions/${positionId}?runId=${res.runId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Penilaian baru tidak dapat dimulai.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-8 gap-1.5 text-xs font-semibold"
        title="Jalankan run root baru dengan data dan konfigurasi tata kelola hari ini"
      >
        <RefreshCcw className="h-3.5 w-3.5" />
        Penilaian Baru
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Penilaian baru untuk {positionTitle}</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-foreground">
              Penilaian ini memakai data dan konfigurasi hari ini, dan hasilnya menjadi root baru.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p>
              Yang dibaca ulang: data kandidat terbaru, matriks AHP dan aturan filter program dari tata kelola, ambang
              readiness, job profile dan acuan kompetensi posisi, serta jangkar kalibrasi. Business unit sumber kandidat
              mengikuti run root terakhir posisi ini.
            </p>
            <p>
              Berbeda dengan <strong>Tambah Kandidat Pembanding</strong>, yang membekukan semuanya dari run induk dan
              hanya menambah kandidat. Run yang sudah ada tidak berubah; setelah selesai, hasil baru dapat dibandingkan
              dengan run root sebelumnya.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy} className="h-9 text-xs">
              Batal
            </Button>
            <Button onClick={start} disabled={busy} className="h-9 text-xs">
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Memulai…
                </>
              ) : (
                'Mulai penilaian baru'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
