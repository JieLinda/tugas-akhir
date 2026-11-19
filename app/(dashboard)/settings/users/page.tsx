import { DashboardHeader } from '@/components/dashboard-header';
import { requirePagePermission, PERMISSION_GROUPS, PERMISSION_LABELS } from '@/lib/rbac';
import { listManagedUsers, countUsersByRole, getAssignableRoles } from '@/lib/user-management-actions';
import { getRolesWithMeta } from '@/lib/role-management-actions';
import { UsersRolesTabs } from '@/components/settings/users-roles-tabs';

export const dynamic = 'force-dynamic';

// Pengguna & Akses: user↔role assignment and the role/permission matrix on one
// page. /settings/roles redirects here with ?tab=roles (next.config.mjs).
export default async function UsersPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  await requirePagePermission('users.manage');
  const { tab } = (await searchParams) ?? {};
  const [users, roleCounts, roles, rolesWithMeta] = await Promise.all([
    listManagedUsers(),
    countUsersByRole(),
    getAssignableRoles(),
    getRolesWithMeta(),
  ]);

  return (
    <>
      <DashboardHeader
        title="Pengguna & Akses"
        info="Tetapkan peran untuk tiap pengguna dan atur permission tiap peran. Semuanya dikelola di aplikasi ini — Keycloak hanya untuk login (SSO)."
      />
      <div className="flex-1 overflow-auto p-6">
        <UsersRolesTabs
          initialTab={tab === 'roles' ? 'roles' : 'users'}
          users={{ users, roles, roleCounts }}
          roles={{
            roles: rolesWithMeta,
            permissionGroups: PERMISSION_GROUPS,
            permissionLabels: PERMISSION_LABELS,
          }}
        />
      </div>
    </>
  );
}
