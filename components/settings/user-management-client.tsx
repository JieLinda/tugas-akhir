'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/datetime';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  assignUserRoleAction,
  clearUserRoleAction,
  type ManagedUser,
  type RoleOption,
} from '@/lib/user-management-actions';

interface Props {
  users: ManagedUser[];
  roles: RoleOption[];
  /** roleId -> user count */
  roleCounts: Record<string, number>;
}

export function UserManagementClient({ users, roles, roleCounts }: Props) {
  const [search, setSearch] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>(roles[0]?.id ?? '');

  const roleOptions = useMemo(() => roles.map((r) => ({ value: r.id, label: r.name })), [roles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.email.toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q),
    );
  }, [users, search]);

  const assignedCount = users.filter((u) => u.roleId).length;

  function runAssign(email: string, roleId: string) {
    if (!roleId) return;
    setPendingEmail(email);
    startTransition(async () => {
      try {
        await assignUserRoleAction(email, roleId);
        const roleName = roles.find((r) => r.id === roleId)?.name ?? 'peran';
        toast.success(`Peran ${roleName} diberikan ke ${email}.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal menetapkan peran.');
      } finally {
        setPendingEmail(null);
      }
    });
  }

  function runClear(email: string) {
    setPendingEmail(email);
    startTransition(async () => {
      try {
        await clearUserRoleAction(email);
        toast.success(`Peran ${email} dihapus — pengguna kehilangan akses sampai diberi peran baru.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal menghapus peran.');
      } finally {
        setPendingEmail(null);
      }
    });
  }

  function runInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email.includes('@')) {
      toast.error('Masukkan email yang valid.');
      return;
    }
    runAssign(email, inviteRole);
    setInviteEmail('');
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" /> Ringkasan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total pengguna</span>
              <span className="font-semibold tabular-nums">{users.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Sudah punya peran</span>
              <span className="font-semibold tabular-nums">{assignedCount}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {roles.map((r) => (
                <Badge key={r.id} variant="outline" className="text-[10px]">
                  {r.name}: {roleCounts[r.id] ?? 0}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <UserPlus className="h-4 w-4 text-primary" /> Tetapkan peran ke email
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Beri peran sebelum pengguna login. Saat mereka masuk via SSO, peran ini yang berlaku.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                placeholder="email@mpm-motor.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runInvite()}
                className="flex-1"
              />
              <Combobox
                value={inviteRole}
                onValueChange={setInviteRole}
                options={roleOptions}
                placeholder="Peran"
                triggerClassName="sm:w-44"
              />
              <Button onClick={runInvite} disabled={isPending || !inviteRole}>
                {isPending && pendingEmail === inviteEmail.trim().toLowerCase() ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Tetapkan'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Daftar Pengguna</CardTitle>
          <div className="relative w-64 max-w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau email…"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pengguna</TableHead>
                <TableHead>Peran Saat Ini</TableHead>
                <TableHead>Login Terakhir</TableHead>
                <TableHead className="w-64 text-right">Ubah Peran</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    Belum ada pengguna yang cocok.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((u) => {
                  const busy = isPending && pendingEmail === u.email;
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {u.name || u.email.split('@')[0]}
                            {u.isCurrentUser && (
                              <Badge variant="secondary" className="ml-2 text-[9px]">Anda</Badge>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.roleName ? (
                          <Badge variant="outline" className="text-[10px]">{u.roleName}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Default</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {u.lastLoginAt
                          ? formatDate(u.lastLoginAt)
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Combobox
                            value={u.roleId ?? ''}
                            onValueChange={(v) => runAssign(u.email, v)}
                            options={roleOptions}
                            placeholder="Pilih peran…"
                            triggerClassName="w-40"
                            disabled={busy}
                          />
                          {u.roleId && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              title="Hapus peran (pengguna kehilangan akses)"
                              onClick={() => runClear(u.email)}
                              disabled={busy}
                            >
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
