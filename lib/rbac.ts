import 'server-only';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';

// ─── RBAC — fully in-app roles (Keycloak is SSO only) ───────────────────────
//
// Keycloak/portal only AUTHENTICATE the user (identity). Roles & permissions
// are defined and managed entirely inside Pulse:
//   • Roles are DB rows (app_roles) — fully customizable (create/edit/delete).
//   • Each role grants permissions from the fixed feature catalog below.
//   • A user is assigned exactly one role (users.role_id). Unassigned users get
//     NO permissions and are parked on /pending until an admin grants a role —
//     there is deliberately no implicit fallback to the "default" role.
//   • Escape hatch (no lockout): the local System User and any email in
//     RBAC_ADMIN_EMAILS always have full access, regardless of DB roles.

export type Permission =
  | 'candidates.view'
  | 'candidates.manage'
  | 'positions.view'
  | 'positions.manage'
  | 'job_profiles.view'
  | 'job_profiles.manage'
  | 'scoring.run'
  | 'analysis.manage'
  | 'governance.manage'
  | 'sync.manage'
  | 'users.manage';

export const ALL_PERMISSIONS: Permission[] = [
  'candidates.view',
  'candidates.manage',
  'positions.view',
  'positions.manage',
  'job_profiles.view',
  'job_profiles.manage',
  'scoring.run',
  'analysis.manage',
  'governance.manage',
  'sync.manage',
  'users.manage',
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'candidates.view': 'Lihat kandidat',
  'candidates.manage': 'Kelola kandidat',
  'positions.view': 'Lihat Manajemen Posisi',
  'positions.manage': 'Kelola Manajemen Posisi',
  // One package: the Dokumen menu (job profile, Job Profile Match, Kamus
  // Kompetensi) and the Posisi menu (Job Family) share it.
  'job_profiles.view': 'Lihat menu Dokumen & Posisi',
  'job_profiles.manage': 'Kelola menu Dokumen & Posisi',
  'scoring.run': 'Jalankan scoring',
  'analysis.manage': 'Kelola hasil analisis',
  'governance.manage': 'Kelola tata kelola',
  'sync.manage': 'Kelola sinkronisasi',
  'users.manage': 'Kelola pengguna & peran',
};

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: 'Kandidat', permissions: ['candidates.view', 'candidates.manage'] },
  // "Manajemen Posisi", not "Posisi": the Data Referensi menu called "Posisi"
  // (Job Family) is governed by job_profiles.* below.
  { label: 'Manajemen Posisi', permissions: ['positions.view', 'positions.manage'] },
  // Deliberately one group: the Dokumen and Posisi menus (job profile, Job
  // Profile Match, Kamus Kompetensi, Job Family) are one feature
  // package and cannot be granted separately.
  { label: 'Dokumen & Posisi (job profile, kamus kompetensi, job family)', permissions: ['job_profiles.view', 'job_profiles.manage'] },
  { label: 'Scoring & Analisis', permissions: ['scoring.run', 'analysis.manage'] },
  { label: 'Administrasi', permissions: ['governance.manage', 'sync.manage', 'users.manage'] },
];

/**
 * Stored role rows may still name a retired permission (e.g. 'scoring.feedback',
 * removed with the AI Tournament): every reader filters through this, so such a
 * row is ignored rather than granting anything.
 */
export function isPermission(v: string): v is Permission {
  return (ALL_PERMISSIONS as string[]).includes(v);
}

// ── Built-in roles (seeded once; is_system, protected from deletion) ─────────
export const SYSTEM_ADMIN_KEY = 'admin';
/** The admin role always keeps these — the UI can't strip them (anti-lockout). */
export const LOCKED_ADMIN_PERMISSIONS: Permission[] = ['users.manage'];

const BUILTIN_ROLES: {
  key: string;
  name: string;
  description: string;
  isDefault: boolean;
  sortOrder: number;
  permissions: Permission[];
}[] = [
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Akses penuh, termasuk tata kelola, sinkronisasi, dan manajemen pengguna & peran.',
    isDefault: false,
    sortOrder: 0,
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'hr',
    name: 'HR / Talent',
    description: 'Kelola data master (kandidat, posisi, job profile) dan jalankan scoring.',
    isDefault: false,
    sortOrder: 10,
    permissions: [
      'candidates.view', 'candidates.manage',
      'positions.view', 'positions.manage',
      'job_profiles.view', 'job_profiles.manage',
      'scoring.run', 'analysis.manage',
    ],
  },
  {
    key: 'analyst',
    name: 'Analyst',
    description: 'Jalankan scoring & analisis; data master hanya baca.',
    isDefault: false,
    sortOrder: 20,
    permissions: ['candidates.view', 'positions.view', 'job_profiles.view', 'scoring.run', 'analysis.manage'],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Hanya melihat data — tidak dapat mengubah apa pun.',
    isDefault: true,
    sortOrder: 30,
    permissions: ['candidates.view', 'positions.view', 'job_profiles.view'],
  },
];

export type RoleRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isDefault: boolean;
  sortOrder: number;
  permissions: Permission[];
};

// ── Seeding & loading ────────────────────────────────────────────────────────
let seeded = false;

/** Seed the built-in roles once if the roles table is empty. */
export async function ensureRolesSeeded(): Promise<void> {
  if (seeded) return;
  try {
    const existing = await db.select({ id: schema.appRoles.id }).from(schema.appRoles).limit(1);
    if (existing.length === 0) {
      for (const r of BUILTIN_ROLES) {
        const [inserted] = await db
          .insert(schema.appRoles)
          .values({
            key: r.key,
            name: r.name,
            description: r.description,
            isSystem: true,
            isDefault: r.isDefault,
            sortOrder: r.sortOrder,
          })
          .onConflictDoNothing({ target: schema.appRoles.key })
          .returning({ id: schema.appRoles.id });
        if (inserted) {
          await db
            .insert(schema.appRolePermissions)
            .values(r.permissions.map((permission) => ({ roleId: inserted.id, permission })))
            .onConflictDoNothing();
        }
      }
    }
    seeded = true;
  } catch {
    // Table missing / DB hiccup — leave unseeded; escape hatch still works.
  }
}

type RolesCache = { roles: RoleRecord[]; at: number };
let rolesCache: RolesCache | null = null;
const ROLES_TTL_MS = 15 * 1000;

export function invalidateRolesCache() {
  rolesCache = null;
}

export async function loadRoles(): Promise<RoleRecord[]> {
  if (rolesCache && Date.now() - rolesCache.at < ROLES_TTL_MS) return rolesCache.roles;
  await ensureRolesSeeded();

  const [roleRows, permRows] = await Promise.all([
    db
      .select({
        id: schema.appRoles.id,
        key: schema.appRoles.key,
        name: schema.appRoles.name,
        description: schema.appRoles.description,
        isSystem: schema.appRoles.isSystem,
        isDefault: schema.appRoles.isDefault,
        sortOrder: schema.appRoles.sortOrder,
      })
      .from(schema.appRoles)
      .orderBy(schema.appRoles.sortOrder, schema.appRoles.name),
    db
      .select({ roleId: schema.appRolePermissions.roleId, permission: schema.appRolePermissions.permission })
      .from(schema.appRolePermissions),
  ]);

  const permsByRole = new Map<string, Permission[]>();
  for (const p of permRows) {
    if (!isPermission(p.permission)) continue;
    const list = permsByRole.get(p.roleId) ?? [];
    list.push(p.permission);
    permsByRole.set(p.roleId, list);
  }

  const roles: RoleRecord[] = roleRows.map((r) => {
    const permissions = permsByRole.get(r.id) ?? [];
    // Anti-lockout: the built-in admin role always keeps its locked permissions.
    if (r.key === SYSTEM_ADMIN_KEY) {
      for (const locked of LOCKED_ADMIN_PERMISSIONS) {
        if (!permissions.includes(locked)) permissions.push(locked);
      }
    }
    return { ...r, permissions };
  });

  rolesCache = { roles, at: Date.now() };
  return roles;
}

// ── Escape hatch: always-admin emails (no Keycloak involved) ─────────────────
function bootstrapAdminEmails(): Set<string> {
  const raw = process.env.RBAC_ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isBootstrapAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return e === 'system@pulse.local' || bootstrapAdminEmails().has(e);
}

async function getUserRoleId(email: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ roleId: schema.users.roleId })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    return row?.roleId ?? null;
  } catch {
    return null;
  }
}

export type UserAccess = {
  roleId: string | null;
  roleName: string;
  permissions: Set<Permission>;
  /**
   * No role assigned yet (or the assigned role no longer exists). Such a user
   * gets ZERO permissions and is parked on /pending until an admin grants one —
   * they deliberately do NOT inherit the default role.
   */
  isPending: boolean;
};

/** Resolve the current user's effective role + permissions (fully DB-driven). */
export async function getCurrentUserAccess(): Promise<UserAccess | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  if (isBootstrapAdmin(user.email)) {
    return {
      roleId: null,
      roleName: 'Administrator (bootstrap)',
      permissions: new Set(ALL_PERMISSIONS),
      isPending: false,
    };
  }

  const roles = await loadRoles();
  const roleId = await getUserRoleId(user.email);
  const role = roleId ? roles.find((r) => r.id === roleId) : undefined;

  // Fail closed: an unassigned user (or one whose role was deleted) has no
  // access at all. Note this means the "default role" is never applied
  // implicitly — an admin must assign a role explicitly.
  if (!role) {
    return {
      roleId: null,
      roleName: 'Menunggu penetapan peran',
      permissions: new Set(),
      isPending: true,
    };
  }

  return {
    roleId: role.id,
    roleName: role.name,
    permissions: new Set(role.permissions),
    isPending: false,
  };
}

/**
 * A `.manage` grant implies its `.view` counterpart. Without this, a role holding
 * only `job_profiles.manage` would be refused by shared read helpers (e.g.
 * getJobFamilyConfig, getGlobalFilterConfig) that mutating flows depend on —
 * those helpers are reached from both view and manage entry points.
 * Implication only ever widens access, and only for the stronger permission.
 */
const IMPLIED_BY: Partial<Record<Permission, Permission>> = {
  'candidates.view': 'candidates.manage',
  'positions.view': 'positions.manage',
  'job_profiles.view': 'job_profiles.manage',
};

/**
 * Izin efektif sebuah akses — yang dipegang, DITAMBAH yang tersirat olehnya.
 *
 * `UserAccess.permissions` adalah himpunan MENTAH milik peran, sedangkan
 * `hasPermission` melebarkannya lewat `IMPLIED_BY`. Setiap pemeriksaan yang
 * membaca himpunan mentah itu langsung karena itu lebih ketat daripada
 * `hasPermission`, dan bedanya tidak terlihat: peran yang memegang
 * `job_profiles.manage` tanpa `job_profiles.view` akan LOLOS `requirePermission`
 * di dalam aksinya, tetapi DITOLAK oleh pemeriksa yang membandingkan ke
 * himpunan mentah — sehingga pekerjaannya kandas sebelum berjalan dengan pesan
 * "butuh izin job_profiles.view" kepada orang yang, menurut aturan yang sama,
 * memilikinya.
 */
export function effectivePermissions(access: UserAccess | null): Set<Permission> {
  const out = new Set<Permission>(access?.permissions as Set<Permission> | undefined);
  for (const [implied, stronger] of Object.entries(IMPLIED_BY) as [Permission, Permission][]) {
    if (out.has(stronger)) out.add(implied);
  }
  return out;
}

export async function hasPermission(permission: Permission): Promise<boolean> {
  const access = await getCurrentUserAccess();
  if (!access) return false;
  if (access.permissions.has(permission)) return true;
  const stronger = IMPLIED_BY[permission];
  return stronger ? access.permissions.has(stronger) : false;
}

/** Guard for mutating server actions — throws (surfaces as a toast). */
export async function requirePermission(permission: Permission): Promise<void> {
  if (!(await hasPermission(permission))) {
    throw new Error(`Anda tidak memiliki akses untuk ${PERMISSION_LABELS[permission].toLowerCase()}.`);
  }
}

/** Guard for server pages — redirects home when the permission is missing. */
export async function requirePagePermission(permission: Permission): Promise<void> {
  if (!(await hasPermission(permission))) {
    redirect('/');
  }
}

// ── Login bookkeeping: record who has signed in (SSO) so they appear in User
// Management, and stamp last-seen. Does NOT assign a role — that's done in-app.
export async function recordUserLogin(
  user: Pick<NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, 'email' | 'name'>,
): Promise<void> {
  if (!user.email || user.email === 'system@pulse.local') return;
  try {
    await db
      .insert(schema.users)
      .values({ email: user.email, name: user.name ?? null, lastLoginAt: new Date() })
      .onConflictDoUpdate({
        target: schema.users.email,
        set: { name: user.name ?? null, lastLoginAt: new Date(), updatedAt: new Date() },
      });
  } catch {
    // Non-fatal — login must not fail because bookkeeping did.
  }
}
