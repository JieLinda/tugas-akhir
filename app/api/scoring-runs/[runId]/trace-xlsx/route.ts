import { NextRequest } from 'next/server';
import { hasPermission } from '@/lib/rbac';
import { getCurrentTenantId } from '@/lib/tenant';
import { ensureLocalUser } from '@/lib/pulse-data';
import { logAudit } from '@/lib/audit';
import { loadRunTraceBundle } from '@/lib/run-trace/load';
import { buildTraceWorkbook } from '@/lib/run-trace/workbook';
import { renderTraceWorkbook } from '@/lib/run-trace/xlsx';

// "Unduh trace perhitungan (XLSX)" — the Konfigurasi Run tab's workbook of every
// number between a candidate's raw data and the final rank, with live Excel
// formulas. A route rather than a server action because the file can run to
// several megabytes of binary (census sheets), which a server action would have
// to ship as a base64 string inside its RSC payload.
//
// Same gate as the tab it is offered on (positions.view), tenant-scoped by the
// loader, and audited: the workbook carries candidate data out of the app.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  if (!(await hasPermission('positions.view'))) {
    return new Response('Anda tidak memiliki akses untuk melihat posisi.', { status: 403 });
  }
  const { runId } = await params;
  if (!UUID.test(runId ?? '')) return new Response('Run tidak valid.', { status: 400 });

  const tenantId = await getCurrentTenantId();
  const bundle = await loadRunTraceBundle(runId, tenantId);
  if (!bundle) return new Response('Run tidak ditemukan di Company ini.', { status: 404 });
  if (bundle.run.method !== 'AHP_TOPSIS') {
    return new Response('Trace perhitungan hanya tersedia untuk run AHP + TOPSIS.', { status: 409 });
  }

  let file: Buffer;
  try {
    file = renderTraceWorkbook(buildTraceWorkbook(bundle));
  } catch (err) {
    console.error('[run-trace] workbook build failed', err);
    return new Response('Workbook trace gagal dibuat.', { status: 500 });
  }

  const actorId = await ensureLocalUser().catch(() => null);
  await logAudit({
    demoScoped: true,
    tenantId,
    actorId,
    entityType: 'scoring_run',
    entityId: runId,
    action: 'export',
    summary: `Unduh trace perhitungan (XLSX) run ${runId.slice(0, 8)} — ${bundle.run.positionTitle ?? 'posisi'}`,
    diff: {
      engineTrace: bundle.engineTraceStatus.readable,
      poolTrace: bundle.poolTraceStatus.readable,
      bytes: file.length,
    },
  });

  return new Response(new Uint8Array(file), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="trace-perhitungan-run-${runId.slice(0, 8)}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
