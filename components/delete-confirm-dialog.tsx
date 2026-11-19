'use client';

import { type ReactNode, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface DeleteConfirmDialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  action: (formData: FormData) => Promise<void>;
  itemId: string;
}

function SubmitButton({ confirmLabel }: { confirmLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <AlertDialogAction asChild>
      <Button type="submit" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            Menghapus...
          </>
        ) : (
          confirmLabel
        )}
      </Button>
    </AlertDialogAction>
  );
}

export function DeleteConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Hapus',
  action,
  itemId,
}: DeleteConfirmDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            try {
              await action(formData);
              setOpen(false);
            } catch {
              // Dialog stays open on error
            }
          }}
        >
          <input type="hidden" name="id" value={itemId} />
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">Batal</Button>
            </AlertDialogCancel>
            <SubmitButton confirmLabel={confirmLabel} />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}