'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Loader2, Lock, Plus, ShieldCheck, Star, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
import {
  createRoleAction,
  deleteRoleAction,
  setDefaultRoleAction,
  toggleRolePermissionAction,
  type RoleWithMeta,
} from '@/lib/role-management-actions';

const LOCKED_ADMIN_PERMISSIONS = ['users.manage'];

interface Props {
  roles: RoleWithMeta[];
  permissionGroups: { label: string; permissions: string[] }[];
  permissionLabels: Record<string, string>;
}

export function RoleManagementClient({ roles, permissionGroups, permissionLabels }: Props) {
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPerms, setNewPerms] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<RoleWithMeta | null>(null);

  function run(key: string, fn: () => Promise<void>, successMsg?: string) {
    setBusyKey(key);
    startTransition(async () => {
      try {
        await fn();
        if (successMsg) toast.success(successMsg);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Terjadi kesalahan.');
      } finally {
        setBusyKey(null);
      }
    });
  }

  function togglePerm(role: RoleWithMeta, permission: string, allowed: boolean) {
    run(`${role.id}|${permission}`, () => toggleRolePermissionAction(role.id, permission, allowed));
  }

  function createRole() {
    if (!newName.trim()) {
      toast.error('Nama peran wajib diisi.');
      return;
    }
    run(
      'create',
      async () => {
        await createRoleAction({ name: newName.trim(), description: newDesc.trim(), permissions: Array.from(newPerms) });
        setCreating(false);
        setNewName('');
        setNewDesc('');
        setNewPerms(new Set());
      },
      'Peran baru dibuat.',
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-4">
        <div className="text-sm text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" /> Peran dikelola penuh di aplikasi
          </p>
          <p className="mt-1 text-xs">
            Buat peran sesuai kebutuhan dan tentukan permission-nya. Keycloak hanya untuk login (SSO).
            Pengguna tanpa peran <strong>tidak dapat mengakses</strong> aplikasi — mereka diarahkan ke halaman tunggu sampai diberi peran.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'outline' : 'default'}>
          {creating ? <X className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}
          {creating ? 'Batal' : 'Peran Baru'}
        </Button>
      </div>

      {/* Create role form */}
      {creating && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Buat Peran Baru</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Nama peran (mis. Kepala Divisi)" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Input placeholder="Deskripsi singkat (opsional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </div>
            <PermissionPicker
              groups={permissionGroups}
              labels={permissionLabels}
              selected={newPerms}
              onToggle={(perm, on) => {
                setNewPerms((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(perm);
                  else next.delete(perm);
                  return next;
                });
              }}
            />
            <div className="flex justify-end">
              <Button onClick={createRole} disabled={isPending && busyKey === 'create'}>
                {isPending && busyKey === 'create' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Simpan Peran
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Role cards */}
      <div className="grid gap-5 lg:grid-cols-2">
        {roles.map((role) => {
          const allowed = new Set<string>(role.permissions);
          return (
            <Card key={role.id} className="overflow-hidden">
              <CardHeader className="border-b bg-muted/30">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className="truncate">{role.name}</span>
                      {role.isDefault && (
                        <Badge variant="secondary" className="gap-1 text-[9px]">
                          <Star className="h-2.5 w-2.5" /> Default
                        </Badge>
                      )}
                      {role.isSystem && <Badge variant="outline" className="text-[9px]">Built-in</Badge>}
                    </CardTitle>
                    {role.description && (
                      <CardDescription className="mt-0.5 text-xs">{role.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="secondary" className="text-[10px] tabular-nums">{role.userCount} pengguna</Badge>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {!role.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => run(`default:${role.id}`, () => setDefaultRoleAction(role.id), 'Peran default diperbarui.')}
                      disabled={isPending}
                    >
                      {busyKey === `default:${role.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className="h-3 w-3" />}
                      Jadikan default
                    </Button>
                  )}
                  {!role.isSystem && !role.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px] text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(role)}
                      disabled={isPending}
                    >
                      <Trash2 className="h-3 w-3" /> Hapus
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                {permissionGroups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                    <div className="space-y-1">
                      {group.permissions.map((permission) => {
                        const locked = role.isAdmin && LOCKED_ADMIN_PERMISSIONS.includes(permission);
                        const cellKey = `${role.id}|${permission}`;
                        return (
                          <div key={permission} className="flex items-center justify-between gap-2 rounded-md px-1 py-1">
                            <span className="truncate text-[13px]">{permissionLabels[permission] ?? permission}</span>
                            <div className="flex items-center gap-2">
                              {busyKey === cellKey && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                              {locked ? (
                                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <Lock className="h-3 w-3" /> terkunci
                                </span>
                              ) : (
                                <Switch
                                  checked={allowed.has(permission)}
                                  onCheckedChange={(v) => togglePerm(role, permission, v)}
                                  disabled={isPending}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus peran &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.userCount
                ? `${deleteTarget.userCount} pengguna dengan peran ini akan kehilangan akses sampai diberi peran lain.`
                : 'Peran ini akan dihapus permanen.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target) run(`delete:${target.id}`, () => deleteRoleAction(target.id), 'Peran dihapus.');
              }}
            >
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PermissionPicker({
  groups,
  labels,
  selected,
  onToggle,
}: {
  groups: { label: string; permissions: string[] }[];
  labels: Record<string, string>;
  selected: Set<string>;
  onToggle: (permission: string, on: boolean) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((group) => (
        <div key={group.label} className="rounded-lg border p-3">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{group.label}</p>
          <div className="space-y-1.5">
            {group.permissions.map((permission) => (
              <label key={permission} className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
                <span className="truncate">{labels[permission] ?? permission}</span>
                <Switch checked={selected.has(permission)} onCheckedChange={(v) => onToggle(permission, v)} />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
