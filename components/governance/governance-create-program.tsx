'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createProgramTemplateAction } from '@/lib/program-actions';
import { Plus } from 'lucide-react';

export function CreateProgramButton({ variant = 'list' }: { variant?: 'list' | 'chip' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      try {
        await createProgramTemplateAction(formData);
        toast.success('Program baru dibuat.');
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal membuat program.');
      }
    });
  }

  return (
    <>
      {variant === 'chip' ? (
        <Button size="sm" variant="outline" className="gap-1.5 border-dashed" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Program baru
        </Button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/60"
        >
          <Plus className="h-3.5 w-3.5" />
          Buat program baru
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Program Baru</DialogTitle>
            <DialogDescription>
              Isi kode unik dan nama. Aturan filter & kriteria bisa diatur setelah program dibuat.
            </DialogDescription>
          </DialogHeader>
          <form action={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-code">Kode</Label>
              <Input id="new-code" name="code" placeholder="custom_talent" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-name">Nama</Label>
              <Input id="new-name" name="name" placeholder="Custom Talent Pool" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-target-finalists">Target Finalis (N)</Label>
              <Input id="new-target-finalists" name="targetFinalists" type="number" min={1} max={50} defaultValue={10} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-desc">Deskripsi</Label>
              <Textarea id="new-desc" name="description" rows={2} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Menyimpan...' : 'Buat Program'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
