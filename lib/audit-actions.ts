'use server';

import { getCurrentTenantId } from '@/lib/tenant';
import { listAuditLogPage, type AuditLogPageParams } from '@/lib/audit';
import { requirePermission } from '@/lib/rbac';
import { demoScrub } from '@/lib/demo/names';

// Demo mode: names inside the summaries leave the server as initials.
export async function listAuditLogAction(
  ...args: Parameters<typeof listAuditLogActionImpl>
): ReturnType<typeof listAuditLogActionImpl> {
  return demoScrub(await listAuditLogActionImpl(...args));
}

async function listAuditLogActionImpl(formData: FormData) {
  // Same permission as the Governance page that renders this log — otherwise the
  // page guard is bypassable by calling the action directly.
  await requirePermission('governance.manage');
  const tenantId = await getCurrentTenantId();
  const params: AuditLogPageParams = {
    page: Number(formData.get('page')) || 1,
    pageSize: Number(formData.get('pageSize')) || 50,
    entityType: (formData.get('entityType') as string) || undefined,
    action: (formData.get('action') as string) || undefined,
    fromDate: (formData.get('fromDate') as string) || undefined,
    toDate: (formData.get('toDate') as string) || undefined,
    search: (formData.get('search') as string) || undefined,
  };
  return listAuditLogPage(tenantId, params);
}
