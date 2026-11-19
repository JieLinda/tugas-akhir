'use client';

import { useState, type ComponentProps } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserManagementClient } from '@/components/settings/user-management-client';
import { RoleManagementClient } from '@/components/settings/role-management-client';

type Tab = 'users' | 'roles';

/**
 * Pengguna and Peran & Akses used to be two routes that gated on the same
 * permission, read the same roles table and revalidated each other in both
 * directions — one surface split across two URLs. They are now two tabs of
 * /settings/users; both inner clients are reused unchanged.
 */
export function UsersRolesTabs({
  initialTab,
  users,
  roles,
}: {
  initialTab: Tab;
  users: ComponentProps<typeof UserManagementClient>;
  roles: ComponentProps<typeof RoleManagementClient>;
}) {
  const [tab, setTab] = useState<string>(initialTab);

  // Keep `?tab=` in the URL so a reload (and the /settings/roles redirect)
  // lands on the tab the user was looking at. Derived from the live location
  // rather than a hard-coded path so it stays correct under a basePath.
  function handleChange(next: string) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'users') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url);
    } catch {
      // URL handling is a convenience; the tab already switched.
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Tabs value={tab} onValueChange={handleChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="users">Pengguna</TabsTrigger>
          <TabsTrigger value="roles">Peran &amp; Akses</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-0">
          <UserManagementClient {...users} />
        </TabsContent>
        <TabsContent value="roles" className="mt-0">
          <RoleManagementClient {...roles} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
