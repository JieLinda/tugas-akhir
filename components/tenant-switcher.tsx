'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Loader2 } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';

const TENANTS = [
  { slug: 'mulia', name: 'Mulia' },
  { slug: 'mso', name: 'MSO' },
  { slug: 'erro', name: 'ERRO' },
] as const;

export function TenantSwitcher({ currentSlug }: { currentSlug: string }) {
  const router = useRouter();
  const [switching, startTransition] = useTransition();

  async function handleChange(slug: string) {
    if (slug === currentSlug) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set('slug', slug);
      const { switchTenantAction } = await import('@/lib/tenant-actions');
      await switchTenantAction(formData);
      // A tenant switch invalidates any tenant-specific id in the current URL
      // (detail `[id]` routes, the scoring wizard's positionId/sessionId), which
      // would 404 under the new tenant. Always land on the dashboard instead.
      router.replace('/');
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 items-center gap-2 px-1">
      {switching ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <Combobox
        value={currentSlug}
        onValueChange={handleChange}
        disabled={switching}
        options={TENANTS.map((tenant) => ({ value: tenant.slug, label: tenant.name }))}
        placeholder="Select Company"
        searchPlaceholder="Search Company..."
        emptyText="Company not found."
        triggerClassName="h-8 min-w-0 flex-1 border-sidebar-border/70 bg-sidebar-accent/50 px-2 text-xs font-medium"
      />
    </div>
  );
}
