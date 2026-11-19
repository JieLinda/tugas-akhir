'use server';

import { revalidatePath } from 'next/cache';
import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth';
import { requirePermission, loadRoles } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { ensureLocalUser } from '@/lib/pulse-data';
import { getCurrentTenantId } from '@/lib/tenant';

export type ManagedUser = {
  id: string;
  email: string;
  name: string | null;
  roleId: string | null;
  roleName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  isCurrentUser: boolean;
};

export type RoleOption = { id: string; key: string; name: string };

/** Roles available for assignment (id/name), for the picker. */
export async function getAssignableRoles(): Promise<RoleOption[]> {
  await requirePermission('users.manage');
  const roles = await loadRoles();
  return roles.map((r) => ({ id: r.id, key: r.key, name: r.name }));
}

/** All users known to the app (seen at SSO login or pre-provisioned). */
export async function listManagedUsers(): Promise<ManagedUser[]> {
  await requirePermission('users.manage');
  const current = await getCurrentUser();
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      roleId: schema.users.roleId,
      roleName: schema.appRoles.name,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .leftJoin(schema.appRoles, eq(schema.users.roleId, schema.appRoles.id))
    .orderBy(desc(schema.users.lastLoginAt), schema.users.email);

  return rows
    .filter((r) => r.email !== 'system@pulse.local')
    .map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      roleId: r.roleId,
      roleName: r.roleName,
      lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      isCurrentUser: Boolean(current?.email && current.email === r.email),
    }));
}

/** Count of users assigned to each role id. */
export async function countUsersByRole(): Promise<Record<string, number>> {
  const rows = await db
    .select({ roleId: schema.users.roleId, count: sql<number>`count(*)` })
    .from(schema.users)
    .where(isNotNull(schema.users.roleId))
    .groupBy(schema.users.roleId);
  const out: Record<string, number> = {};
  for (const r of rows) if (r.roleId) out[r.roleId] = Number(r.count);
  return out;
}

/** Assign a role to a user by email (creates the row if they haven't logged in
 *  yet — pre-provisioning). */
export async function assignUserRoleAction(email: string, roleId: string): Promise<void> {
  await requirePermission('users.manage');
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.includes('@')) throw new Error('Email tidak valid.');

  const [role] = await db
    .select({ id: schema.appRoles.id, name: schema.appRoles.name })
    .from(schema.appRoles)
    .where(eq(schema.appRoles.id, roleId))
    .limit(1);
  if (!role) throw new Error('Peran tidak ditemukan.');

  await db
    .insert(schema.users)
    .values({ email: cleanEmail, roleId: role.id })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { roleId: role.id, updatedAt: new Date() },
    });

  await audit(cleanEmail, `Peran "${role.name}" diberikan.`);
  revalidatePath('/settings/users');
}

/** Remove the assignment — the user falls back to the default role. */
export async function clearUserRoleAction(email: string): Promise<void> {
  await requirePermission('users.manage');
  const cleanEmail = email.trim().toLowerCase();
  await db
    .update(schema.users)
    .set({ roleId: null, updatedAt: new Date() })
    .where(eq(schema.users.email, cleanEmail));
  await audit(cleanEmail, 'Peran dihapus — pengguna kehilangan akses sampai diberi peran baru.');
  revalidatePath('/settings/users');
}

async function audit(email: string, summary: string) {
  try {
    const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
    await logAudit({
      tenantId,
      actorId,
      entityType: 'user',
      entityId: email,
      action: 'update',
      summary: `Manajemen pengguna — ${email}: ${summary}`,
    });
  } catch {
    // best-effort
  }
}
