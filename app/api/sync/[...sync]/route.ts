import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/rbac';
import { getCurrentUser } from '@/lib/auth';
import { isDemoMode } from '@/lib/app-mode';

const syncServiceUrl = process.env.SYNC_SERVICE_URL ?? 'http://localhost:8000';

/**
 * Every path through this proxy triggers a sync or overwrites a source file on
 * the shared folder, so it all requires sync.manage. Without this the guard on
 * the Sinkronisasi page is decorative — anyone signed in could POST here
 * directly and replace HAV.xlsx.
 */
async function denyUnlessAllowed(): Promise<NextResponse | null> {
  if (await hasPermission('sync.manage')) return null;
  return NextResponse.json(
    { success: false, message: 'Anda tidak memiliki akses untuk kelola sinkronisasi.' },
    { status: 403 },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sync: string[] }> },
) {
  const denied = await denyUnlessAllowed();
  if (denied) return denied;
  const { sync } = await params;
  const target = new URL(`/api/sync/${sync.join('/')}${req.nextUrl.search}`, syncServiceUrl);
  return proxyFetch(target, req);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sync: string[] }> },
) {
  const denied = await denyUnlessAllowed();
  if (denied) return denied;
  // Demo mode never writes real data: every sync trigger and upload (HAV,
  // MCU, Excel overrides) would. Refused with the neutral message the rest of
  // demo mode uses — nothing on screen may name the mode.
  if (await isDemoMode()) {
    return NextResponse.json({ success: false, message: 'Aksi ini tidak tersedia.' }, { status: 403 });
  }
  const { sync } = await params;
  const target = new URL(`/api/sync/${sync.join('/')}${req.nextUrl.search}`, syncServiceUrl);
  return proxyFetch(target, req);
}

async function proxyFetch(target: URL, req: NextRequest): Promise<NextResponse> {
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.blob().catch(() => undefined);

  // Tell the sync service WHO triggered this so it lands in the sync_runs audit
  // trail. The service can't know otherwise — it has no session.
  const user = await getCurrentUser().catch(() => null);

  const res = await fetch(target, {
    method: req.method,
    headers: {
      'content-type': req.headers.get('content-type') ?? 'application/json',
      accept: req.headers.get('accept') ?? 'application/json',
      ...(user?.email ? { 'x-pulse-actor': user.email } : {}),
    },
    body,
  });

  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of res.headers) {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
      responseHeaders[key] = value;
    }
  }

  return new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  });
}
