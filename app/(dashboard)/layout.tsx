import { redirect } from 'next/navigation';
import { SidebarNav } from '@/components/sidebar-nav';
import { ActivityThreadProvider } from '@/components/activity-thread';
import { getCurrentTenant, listTenants } from '@/lib/tenant';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentUserAccess, recordUserLogin } from '@/lib/rbac';
import { getAppMode } from '@/lib/app-mode';
import { AppModeProvider } from '@/components/app-mode-provider';

// Every page in this shell is per-user and per-tenant and reads the database,
// so none of them may be prerendered at build time. Without this, a page that
// happens not to touch cookies()/headers() before its first query (e.g.
// /candidates when Keycloak is off) is treated as static: `next build` then
// connects to Postgres from inside the Docker builder, where there is no
// database, and fails with ECONNREFUSED — and where there IS one, it would
// bake one tenant's data into HTML served to everybody. Set once here, it
// applies to every child route, so a new page cannot reintroduce the bug by
// forgetting its own export.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth gate: with Keycloak configured, unauthenticated visitors go to the
  // sign-in page. Without Keycloak this returns the local System User (admin).
  const user = await getCurrentUser();
  if (!user) {
    redirect('/auth/signin');
  }
  // Record the sign-in so the user shows up in User Management + stamp last-seen.
  await recordUserLogin(user);

  const access = await getCurrentUserAccess();
  // No role assigned yet — park them on /pending instead of letting them into
  // the shell. This is the single choke point for the whole dashboard group.
  if (!access || access.isPending) {
    redirect('/pending');
  }
  const permissions = Array.from(access.permissions);

  const [tenant, tenants] = await Promise.all([getCurrentTenant(), listTenants()]);
  // Demo vs real ("asli"): switched only by the ?mode= keyword (proxy.ts) and
  // never shown — the provider renders nothing, it only lets components mask.
  const mode = await getAppMode();

  return (
    <AppModeProvider mode={mode}>
    <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.08),transparent_34%),linear-gradient(135deg,rgba(248,250,252,0.96),rgba(241,245,249,0.72))] dark:bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.12),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.9))]">
      <SidebarNav
        tenantSlug={tenant.slug}
        tenants={tenants.map((t) => ({ id: t.id, slug: t.slug, name: t.name, isBuiltin: t.isBuiltin }))}
        permissions={permissions}
      />
      {/* Keyed by tenant so switching business units tears the thread state down
          rather than carrying another tenant's entity labels across. */}
      <ActivityThreadProvider key={tenant.slug} tenantSlug={tenant.slug}>
        <main className="relative flex-1 flex flex-col overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.035)_1px,transparent_1px)] bg-[size:40px_40px] opacity-40 dark:opacity-15" />
          <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
          </div>
        </main>
      </ActivityThreadProvider>
    </div>
    </AppModeProvider>
  );
}
