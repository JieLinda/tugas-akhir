'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import {
  type Permission,
  ALL_PERMISSIONS,
  LOCKED_ADMIN_PERMISSIONS,
  SYSTEM_ADMIN_KEY,
  isPermission,
  loadRoles,
  invalidateRolesCache,
  requirePermission,
} from '@/lib/rbac';

export type RoleWithMeta = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isDefault: boolean;
  isAdmin: boolean; // the protected built-in admin role
  userCount: number;
  permissions: Permission[];
};

/** All roles with permissions + user counts, for the Role Management page. */
export async function getRolesWithMeta(): Promise<RoleWithMeta[]> {
  await requirePermission('users.manage');
  const roles = await loadRoles();
  const counts = await db
    .select({ roleId: schema.users.roleId, count: sql<number>`count(*)` })
    .from(schema.users)
    .groupBy(schema.users.roleId);
  const countMap = new Map<string, number>();
  for (const c of counts) if (c.roleId) countMap.set(c.roleId, Number(c.count));

  return roles.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    isDefault: r.isDefault,
    isAdmin: r.key === SYSTEM_ADMIN_KEY,
    userCount: countMap.get(r.id) ?? 0,
    permissions: r.permissions,
  }));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'role';
}

function sanitizePermissions(input: string[]): Permission[] {
  return Array.from(new Set(input.filter(isPermission))) as Permission[];
}

/** Create a new custom role. */
export async function createRoleAction(input: {
  name: string;
  description?: string;
  permissions: string[];
}): Promise<{ id: string }> {
  await requirePermission('users.manage');
  const name = input.name.trim();
  if (!name) throw new Error('Nama peran wajib diisi.');

  // Unique key from name (append -2, -3… on collision).
  const base = slugify(name);
  let key = base;
  for (let i = 2; ; i++) {
    const [dup] = await db.select({ id: schema.appRoles.id }).from(schema.appRoles).where(eq(schema.appRoles.key, key)).limit(1);
    if (!dup) break;
    key = `${base}-${i}`;
  }

  const [role] = await db
    .insert(schema.appRoles)
    .values({ key, name, description: input.description?.trim() || null, isSystem: false, isDefault: false, sortOrder: 100 })
    .returning({ id: schema.appRoles.id });

  const perms = sanitizePermissions(input.permissions);
  if (perms.length > 0) {
    await db.insert(schema.appRolePermissions).values(perms.map((permission) => ({ roleId: role!.id, permission })));
  }

  invalidateRolesCache();
  revalidatePath('/settings/users');
  return { id: role!.id };
}

/** Rename / re-describe a role. */
export async function updateRoleAction(input: {
  roleId: string;
  name: string;
  description?: string;
}): Promise<void> {
  await requirePermission('users.manage');
  const name = input.name.trim();
  if (!name) throw new Error('Nama peran wajib diisi.');
  await db
    .update(schema.appRoles)
    .set({ name, description: input.description?.trim() || null, updatedAt: new Date() })
    .where(eq(schema.appRoles.id, input.roleId));
  invalidateRolesCache();
  revalidatePath('/settings/users');
}

/** Replace a role's permission set. */
export async function setRolePermissionsAction(roleId: string, permissions: string[]): Promise<void> {
  await requirePermission('users.manage');
  const [role] = await db
    .select({ id: schema.appRoles.id, key: schema.appRoles.key })
    .from(schema.appRoles)
    .where(eq(schema.appRoles.id, roleId))
    .limit(1);
  if (!role) throw new Error('Peran tidak ditemukan.');

  const perms = new Set(sanitizePermissions(permissions));
  // Anti-lockout: the built-in admin role always keeps its locked permissions.
  if (role.key === SYSTEM_ADMIN_KEY) for (const p of LOCKED_ADMIN_PERMISSIONS) perms.add(p);

  await db.delete(schema.appRolePermissions).where(eq(schema.appRolePermissions.roleId, roleId));
  if (perms.size > 0) {
    await db
      .insert(schema.appRolePermissions)
      .values(Array.from(perms).map((permission) => ({ roleId, permission })));
  }

  invalidateRolesCache();
  revalidatePath('/settings/users');
}

/** Toggle one permission on/off for a role (used by the switch UI). */
export async function toggleRolePermissionAction(
  roleId: string,
  permission: string,
  allowed: boolean,
): Promise<void> {
  await requirePermission('users.manage');
  if (!isPermission(permission)) throw new Error('Permission tidak valid.');
  const [role] = await db
    .select({ key: schema.appRoles.key })
    .from(schema.appRoles)
    .where(eq(schema.appRoles.id, roleId))
    .limit(1);
  if (!role) throw new Error('Peran tidak ditemukan.');

  if (role.key === SYSTEM_ADMIN_KEY && LOCKED_ADMIN_PERMISSIONS.includes(permission) && !allowed) {
    throw new Error('Permission inti admin tidak dapat dinonaktifkan (mencegah lockout).');
  }

  if (allowed) {
    await db.insert(schema.appRolePermissions).values({ roleId, permission }).onConflictDoNothing();
  } else {
    await db
      .delete(schema.appRolePermissions)
      .where(and(eq(schema.appRolePermissions.roleId, roleId), eq(schema.appRolePermissions.permission, permission)));
  }
  invalidateRolesCache();
  revalidatePath('/settings/users');
}

/** Make a role the default for unassigned users. */
export async function setDefaultRoleAction(roleId: string): Promise<void> {
  await requirePermission('users.manage');
  await db.update(schema.appRoles).set({ isDefault: false }).where(ne(schema.appRoles.id, roleId));
  await db.update(schema.appRoles).set({ isDefault: true, updatedAt: new Date() }).where(eq(schema.appRoles.id, roleId));
  invalidateRolesCache();
  revalidatePath('/settings/users');
}

/** Delete a custom role. System/default roles cannot be deleted. Users of the
 *  role are unassigned (FK set null → default role). */
export async function deleteRoleAction(roleId: string): Promise<void> {
  await requirePermission('users.manage');
  const [role] = await db
    .select({ isSystem: schema.appRoles.isSystem, isDefault: schema.appRoles.isDefault })
    .from(schema.appRoles)
    .where(eq(schema.appRoles.id, roleId))
    .limit(1);
  if (!role) throw new Error('Peran tidak ditemukan.');
  if (role.isSystem) throw new Error('Peran Built-in tidak dapat dihapus.');
  if (role.isDefault) throw new Error('Peran default tidak dapat dihapus. Tetapkan default lain dulu.');

  await db.delete(schema.appRoles).where(eq(schema.appRoles.id, roleId));
  invalidateRolesCache();
  revalidatePath('/settings/users');
}
