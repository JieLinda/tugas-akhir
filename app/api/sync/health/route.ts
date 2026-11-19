import { NextResponse } from 'next/server';

const syncServiceUrl = process.env.SYNC_SERVICE_URL ?? 'http://localhost:8000';

export async function GET() {
  try {
    const res = await fetch(`${syncServiceUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json().catch(() => ({ status: res.ok ? 'ok' : 'error' }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ status: 'error', message: 'Sync service unreachable' }, { status: 503 });
  }
}
