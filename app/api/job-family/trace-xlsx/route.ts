import { NextRequest } from 'next/server';
import { hasPermission } from '@/lib/rbac';
import { getCurrentTenant } from '@/lib/tenant';
import { ensureLocalUser } from '@/lib/pulse-data';
import { logAudit } from '@/lib/audit';
import { isDemoMode } from '@/lib/app-mode';
import { maskJobProfileFileName } from '@/lib/demo/mask';
import { getJobFamilyConfig } from '@/lib/job-family-actions';
import { latestCompletedRunId, loadJobFamilyTraceBundle } from '@/lib/job-family-trace/load';
import { buildJobFamilyTraceWorkbook } from '@/lib/job-family-trace/workbook';
import { renderTraceWorkbook } from '@/lib/run-trace/xlsx';

// "Unduh trace perhitungan (XLSX)" on Pengaturan Job Family — the workbook of
// every number between a job profile's extracted data and its family: the
// document, the vectors, UMAP (kNN, σ, fuzzy graph), HDBSCAN (core distances,
// spanning tree, condensed tree, EOM, soft membership), BERTopic's topic ids,
// outlier re-homing and c-TF-IDF, each as live Excel formulas beside what the
// library recorded and what the map persisted. A route rather than a server
// action because the file runs to tens of megabytes for a full corpus.
//
// ?runId= picks a run; without it, the run the map shows (newest completed,
// global or this unit's own). Same gate as the page (job_profiles.view),
// readable only where the map itself is, and audited: the workbook carries job
// profile content out of the app. In demo mode the file names — which carry
// position codes and JD numbers — are masked; nothing else in the workbook is
// an identifier (documents are built from names and texts, never codes).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  if (!(await hasPermission('job_profiles.view'))) {
    return new Response('Anda tidak memiliki akses untuk melihat Job Family.', { status: 403 });
  }
  const requested = req.nextUrl.searchParams.get('runId');
  if (requested && !UUID.test(requested)) return new Response('Run tidak valid.', { status: 400 });

  const tenant = await getCurrentTenant();
  const runId = requested ?? (await latestCompletedRunId(tenant.id));
  if (!runId) return new Response('Belum ada peta job family yang selesai dibangun.', { status: 404 });

  const config = await getJobFamilyConfig();
  const bundle = await loadJobFamilyTraceBundle(runId, tenant.id, config, tenant.name);
  if (!bundle) return new Response('Peta job family tidak ditemukan untuk Company ini.', { status: 404 });
  if (bundle.run.status !== 'completed') {
    return new Response('Peta ini belum selesai dibangun; trace hanya tersedia untuk run yang selesai.', { status: 409 });
  }
  if (await isDemoMode()) {
    for (const p of bundle.profiles.values()) p.fileName = maskJobProfileFileName(p.fileName);
  }

  let file: Buffer;
  try {
    file = renderTraceWorkbook(buildJobFamilyTraceWorkbook(bundle));
  } catch (err) {
    console.error('[job-family-trace] workbook build failed', err);
    return new Response('Workbook trace gagal dibuat.', { status: 500 });
  }

  const actorId = await ensureLocalUser().catch(() => null);
  await logAudit({
    tenantId: tenant.id,
    actorId,
    entityType: 'job_family_topic_runs',
    entityId: runId,
    action: 'export',
    summary: `Unduh trace perhitungan peta job family (XLSX) run ${runId.slice(0, 8)}${bundle.trace ? '' : ' — tanpa jejak'}`,
    diff: {
      trace: bundle.traceStatus.stored,
      documents: bundle.trace?.corpus.meta.length ?? bundle.assignments.length,
      bytes: file.length,
    },
  });

  return new Response(new Uint8Array(file), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="trace-peta-job-family-${runId.slice(0, 8)}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
