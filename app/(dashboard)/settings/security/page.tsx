import { DashboardHeader } from '@/components/dashboard-header';
import { EncryptionKeyCard } from '@/components/governance/encryption-key-card';
import { requirePagePermission } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * Its own page rather than a Tata Kelola tab.
 *
 * The unlock control has to be reachable when the app is in its most degraded
 * state — freshly restarted, encryption locked, source-database passwords
 * unreadable. Burying it behind a tab in a page that loads program templates,
 * audit history, grade levels and filter value domains means the one screen you
 * need in order to recover is also the heaviest one in the app.
 */
export default async function SecuritySettingsPage() {
  await requirePagePermission('governance.manage');

  return (
    <>
      <DashboardHeader
        title="Keamanan & Enkripsi"
        info="Kelola kunci enkripsi yang melindungi data sensitif dan kredensial database sumber."
      />
      <div className="flex-1 overflow-auto p-6">
        <EncryptionKeyCard />
      </div>
    </>
  );
}
