import { redirect } from 'next/navigation';
import { requirePagePermission } from '@/lib/rbac';
import { RUN_COMPARE_TAB, compareHref } from '@/lib/run-history';

// The comparison of two runs used to be this page. It is now the "Perbandingan
// Run" tab of the position page, together with the forum's decisions, so this
// route only keeps old links working: same pair, same position (FR-CMP-11).
export default async function CompareRunsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ a?: string; b?: string }>;
}) {
  await requirePagePermission('positions.view');
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  if (sp.a && sp.b) redirect(compareHref(id, sp.a, sp.b));
  const q = new URLSearchParams({ tab: RUN_COMPARE_TAB });
  if (sp.b) q.set('runId', sp.b);
  redirect(`/positions/${id}?${q.toString()}`);
}
