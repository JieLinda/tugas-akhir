'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CaretUpDownIcon, CheckIcon } from '@phosphor-icons/react';
import { Building2, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TENANT_NAME_MAX_LENGTH, type TenantOption } from '@/lib/tenant-shared';
import type { TenantDeletionPreview } from '@/lib/tenant-actions';
import { cn } from '@/lib/utils';

/**
 * The Company dropdown in the sidebar header. Mulia / MSO / ERRO are built in;
 * users with `sync.manage` can add a company from the "+" beside the search box
 * and remove a non-built-in one from the trash icon that appears on hover.
 * Both are re-checked on the server (lib/tenant-actions.ts), which also refuses
 * to remove a company that still owns data.
 */
export function TenantSwitcher({
  currentSlug,
  tenants,
  canManage = false,
}: {
  currentSlug: string;
  tenants: TenantOption[];
  canManage?: boolean;
}) {
  const router = useRouter();
  const [switching, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<TenantOption | null>(null);

  const current = tenants.find((t) => t.slug === currentSlug);

  function handleChange(slug: string) {
    if (slug === currentSlug) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set('slug', slug);
      const { switchTenantAction } = await import('@/lib/tenant-actions');
      await switchTenantAction(formData);
      // A tenant switch invalidates any tenant-specific id in the current URL
      // (detail `[id]` routes, the scoring wizard's positionId/sessionId), which
      // would 404 under the new tenant. Always land on the dashboard instead.
      router.replace('/');
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 items-center gap-2 px-1">
      {switching ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={switching}
            className="h-8 min-w-0 flex-1 justify-between border-sidebar-border/70 bg-sidebar-accent/50 px-2 text-xs font-medium"
          >
            <span className="min-w-0 flex-1 truncate text-left" title={current?.name}>
              {current?.name ?? 'Select Company'}
            </span>
            <CaretUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" weight="bold" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command
            filter={(value, term) => (value.toLowerCase().includes(term.toLowerCase()) ? 1 : 0)}
          >
            <div className="flex items-center border-b [&_[data-slot=command-input-wrapper]]:border-b-0">
              <div className="min-w-0 flex-1">
                <CommandInput placeholder="Search Company..." value={search} onValueChange={setSearch} />
              </div>
              {canManage && (
                <button
                  type="button"
                  className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Tambah Company"
                  title="Tambah Company"
                  onClick={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            <CommandList>
              <CommandEmpty>Company not found.</CommandEmpty>
              <CommandGroup>
                {tenants.map((tenant) => {
                  const removable = canManage && !tenant.isBuiltin;
                  return (
                    <CommandItem
                      key={tenant.id}
                      value={`${tenant.name} ${tenant.id}`}
                      onSelect={() => {
                        setOpen(false);
                        handleChange(tenant.slug);
                      }}
                      className="group"
                    >
                      <CheckIcon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          tenant.slug === currentSlug ? 'opacity-100' : 'opacity-0',
                        )}
                        weight="bold"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium" title={tenant.name}>
                        {tenant.name}
                      </span>
                      {removable && (
                        <button
                          type="button"
                          className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-accent text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                          aria-label={`Hapus Company ${tenant.name}`}
                          title={`Hapus ${tenant.name}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpen(false);
                            setToDelete(tenant);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {canManage && (
        <CreateTenantDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => router.refresh()}
        />
      )}
      {canManage && (
        <DeleteTenantDialog
          tenant={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={(deleted) => {
            if (deleted.slug === currentSlug) {
              // The cookie now names a removed company and falls back to the
              // first one; leave any id in the URL behind, as a switch does.
              router.replace('/');
            }
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateTenantDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const normalized = name.replace(/\s+/g, ' ').trim();

  function close(next: boolean) {
    if (pending) return;
    onOpenChange(next);
    if (!next) {
      setName('');
      setError(null);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!normalized) return;
    setError(null);
    startTransition(async () => {
      const { createTenantAction } = await import('@/lib/tenant-actions');
      const result = await createTenantAction(normalized);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        result.restored
          ? `Company "${result.tenant.name}" dipulihkan.`
          : `Company "${result.tenant.name}" ditambahkan.`,
      );
      onOpenChange(false);
      setName('');
      onCreated();
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Tambah Company</DialogTitle>
            <DialogDescription>
              Company baru masih kosong. Data karyawan masuk setelah sebuah Company ID dipetakan ke Company
              ini di menu Tambah Data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="tenant-name">Nama</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {name.length}/{TENANT_NAME_MAX_LENGTH}
              </span>
            </div>
            <Input
              id="tenant-name"
              autoFocus
              value={name}
              maxLength={TENANT_NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. MPM Rent"
              disabled={pending}
            />
            {normalized && (
              <p className="text-xs text-muted-foreground">
                Slug: <code className="rounded bg-muted px-1 py-0.5">{normalized.toLowerCase()}</code>
              </p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
              Batal
            </Button>
            <Button type="submit" disabled={pending || !normalized}>
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTenantDialog({
  tenant,
  onClose,
  onDeleted,
}: {
  tenant: TenantOption | null;
  onClose: () => void;
  onDeleted: (tenant: TenantOption) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [preview, setPreview] = useState<TenantDeletionPreview | null>(null);

  // What would be deleted, read fresh every time the dialog opens.
  useEffect(() => {
    setTyped('');
    setError(null);
    setPreview(null);
    if (!tenant) return;
    let alive = true;
    import('@/lib/tenant-actions')
      .then(({ previewTenantDeletionAction }) => previewTenantDeletionAction(tenant.id))
      .then((p) => { if (alive) setPreview(p); })
      .catch((err) => { if (alive) setPreview({ ok: false, error: String(err) }); });
    return () => { alive = false; };
  }, [tenant]);

  const blockers = preview?.ok ? preview.blockers : [];
  const canDelete = !!tenant && preview?.ok === true && blockers.length === 0 && typed.trim() === tenant.name;

  function confirm(e: React.MouseEvent) {
    e.preventDefault();
    if (!tenant || !canDelete) return;
    setError(null);
    startTransition(async () => {
      const { deleteTenantAction } = await import('@/lib/tenant-actions');
      const result = await deleteTenantAction(tenant.id, typed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Company "${tenant.name}" dan seluruh datanya dihapus permanen.`);
      for (const note of result.notes ?? []) toast.warning(note, { duration: 15_000 });
      onDeleted(tenant);
      onClose();
    });
  }

  return (
    <AlertDialog
      open={tenant !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus permanen Company {tenant?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Company ini dan SEMUA datanya dihapus permanen dan tidak dapat dikembalikan: kandidat, posisi,
            run scoring, dokumen job profile yang hanya milik Company ini, serta data sinkron/unggahan dari
            Company ID yang dipetakan ke sini. Kamus kompetensi (berlaku untuk semua Company) tidak ikut dihapus.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!preview && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Menghitung data yang akan dihapus…
          </p>
        )}
        {preview && !preview.ok && <p className="text-sm text-destructive">{preview.error}</p>}
        {preview?.ok && (
          <div className="space-y-2 text-sm">
            {preview.counts.length > 0 ? (
              <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 tabular-nums">
                {preview.counts.map((c) => (
                  <li key={c.label}>
                    {c.n.toLocaleString('id-ID')} {c.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Company ini belum memiliki data.</p>
            )}
            {blockers.map((b) => (
              <p key={b} className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-destructive">
                {b}
              </p>
            ))}
            {blockers.length === 0 && (
              <div className="space-y-1">
                <Label htmlFor="tenant-delete-confirm" className="text-xs">
                  Ketik <span className="font-semibold">{tenant?.name}</span> untuk mengonfirmasi
                </Label>
                <Input
                  id="tenant-delete-confirm"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  disabled={pending}
                />
              </div>
            )}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Batal</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={pending || !canDelete}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Hapus permanen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
