import 'server-only';

import { cookies } from 'next/headers';

export type TenantInfo = {
  id: string;
  slug: string;
  name: string;
};

/** Hard-coded tenant list — matches DB seed values */
export const TENANTS: TenantInfo[] = [
  { id: '10000000-0000-0000-0000-000000000001', slug: 'mulia', name: 'Mulia' },
  { id: '10000000-0000-0000-0000-000000000002', slug: 'mso', name: 'MSO' },
  { id: '10000000-0000-0000-0000-000000000003', slug: 'erro', name: 'ERRO' },
];

const TENANT_COOKIE = 'pulse_tenant';

/** Get current tenant from cookie. Falls back to first tenant. */
export async function getCurrentTenant(): Promise<TenantInfo> {
  const cookieStore = await cookies();
  const slug = cookieStore.get(TENANT_COOKIE)?.value;
  return TENANTS.find((t) => t.slug === slug) ?? TENANTS[0]!;
}

/** Get current tenant ID (shorthand) */
export async function getCurrentTenantId(): Promise<string> {
  const tenant = await getCurrentTenant();
  return tenant.id;
}
