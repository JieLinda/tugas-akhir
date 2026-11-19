'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { TENANTS } from '@/lib/tenant';

export async function switchTenantAction(formData: FormData) {
  const slug = formData.get('slug');
  if (typeof slug !== 'string') return;

  const tenant = TENANTS.find((t) => t.slug === slug);
  if (!tenant) return;

  const cookieStore = await cookies();
  cookieStore.set('pulse_tenant', tenant.slug, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  revalidatePath('/', 'layout');
}
