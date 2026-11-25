'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import type { SyncSourceKey } from '@/lib/db/schema';
import { requirePermission } from '@/lib/rbac';
import { ensureLocalUser } from '@/lib/pulse-data';
import { getCurrentTenantId } from '@/lib/tenant';
import { logAudit } from '@/lib/audit';

/**
 * MSSQL source-database settings, edited from the Sinkronisasi page.
 *
 * Writes go straight to Postgres from HERE rather than through an endpoint on
 * sync-service, because sync-service has no authentication at all. The web app
 * owns the schema and already enforces `sync.manage`; adding a write endpoint on
 * the service would let anyone who can reach the container repoint the sync at a
 * database they control. sync-service only ever gets a parameterless "reload"
 * ping, exactly like the readiness-config / scoring-prompts pattern.
 *
 * The password is never sent to the browser in either direction of a round trip:
 * the read path reports only `hasPassword`, and an empty password field on save
 * means "keep the existing one" rather than "clear it".
 */

const SOURCE_KEYS: SyncSourceKey[] = ['MPMDS', 'MPMHRGA'];

export type SourceConnectionView = {
  sourceKey: SyncSourceKey;
  server: string;
  port: number;
  username: string;
  databaseName: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  isActive: boolean;
  hasPassword: boolean;
  /** True when no row exists yet, i.e. the service is running on env vars. */
  usingEnvFallback: boolean;
  updatedAt: string | null;
};

export type SourceConnectionsState = {
  connections: SourceConnectionView[];
  /** What the sync service reports it actually resolved, or null when unreachable. */
  effective: Record<SyncSourceKey, EffectiveConnection> | null;
};

/** Mirrors describeConnections() in sync-service/src/services/db-settings.ts. */
type EffectiveConnection = {
  server: string;
  port: number;
  database: string;
  origin: string;
  hasPassword: boolean;
};

const syncServiceUrl = () => process.env.SYNC_SERVICE_URL ?? 'http://localhost:8000';

async function pingSyncService(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${syncServiceUrl().replace(/\/$/, '')}${path}`, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
      ...init,
    });
  } catch {
    return null;
  }
}

export async function getSourceConnectionsAction(): Promise<SourceConnectionsState> {
  await requirePermission('sync.manage');

  const rows = await db.select().from(schema.syncSourceConnections);
  const byKey = new Map(rows.map((r) => [r.sourceKey as SyncSourceKey, r]));

  const connections: SourceConnectionView[] = SOURCE_KEYS.map((key) => {
    const row = byKey.get(key);
    if (!row) {
      return {
        sourceKey: key,
        server: '',
        port: 1433,
        username: '',
        databaseName: '',
        encrypt: true,
        trustServerCertificate: true,
        isActive: true,
        hasPassword: false,
        usingEnvFallback: true,
        updatedAt: null,
      };
    }
    return {
      sourceKey: key,
      server: row.server,
      port: row.port,
      username: row.username,
      databaseName: row.databaseName,
      encrypt: row.encrypt,
      trustServerCertificate: row.trustServerCertificate,
      isActive: row.isActive,
      hasPassword: Boolean(row.passwordEncrypted),
      usingEnvFallback: !row.isActive,
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  // Ask the service what it actually resolved: the stored row alone would not
  // show whether the service picked it up or is still running on env vars.
  let effective: SourceConnectionsState['effective'] = null;
  const res = await pingSyncService('/api/sync/_db-settings');
  if (res?.ok) {
    const body = (await res.json().catch(() => null)) as {
      connections?: Partial<Record<SyncSourceKey, Partial<EffectiveConnection>>>;
    } | null;
    if (body?.connections) {
      const read = (key: SyncSourceKey): EffectiveConnection => ({
        server: body.connections?.[key]?.server ?? '',
        port: body.connections?.[key]?.port ?? 1433,
        database: body.connections?.[key]?.database ?? '',
        origin: body.connections?.[key]?.origin ?? 'env',
        hasPassword: body.connections?.[key]?.hasPassword ?? false,
      });
      effective = { MPMDS: read('MPMDS'), MPMHRGA: read('MPMHRGA') };
    }
  }

  return { connections, effective };
}

export type SaveSourceConnectionInput = {
  sourceKey: SyncSourceKey;
  server: string;
  port: number;
  username: string;
  /** Empty string means "leave the stored password alone". */
  password: string;
  databaseName: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  isActive: boolean;
};

export async function saveSourceConnectionAction(
  input: SaveSourceConnectionInput,
): Promise<{ success: boolean; message: string }> {
  try {
    await requirePermission('sync.manage');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    if (!SOURCE_KEYS.includes(input.sourceKey)) {
      return { success: false, message: 'Sumber database tidak dikenal.' };
    }
    if (!input.server.trim() || !input.databaseName.trim() || !input.username.trim()) {
      return { success: false, message: 'Server, database, dan username wajib diisi.' };
    }
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      return { success: false, message: 'Port harus antara 1 dan 65535.' };
    }

    const [existing] = await db
      .select()
      .from(schema.syncSourceConnections)
      .where(eq(schema.syncSourceConnections.sourceKey, input.sourceKey))
      .limit(1);

    // An empty password field means "keep the stored one". The column keeps its
    // historical name; the value is stored as entered.
    const passwordEncrypted = input.password || existing?.passwordEncrypted || null;

    const values = {
      sourceKey: input.sourceKey,
      server: input.server.trim(),
      port: input.port,
      username: input.username.trim(),
      passwordEncrypted,
      databaseName: input.databaseName.trim(),
      encrypt: input.encrypt,
      trustServerCertificate: input.trustServerCertificate,
      isActive: input.isActive,
      updatedBy: actorId,
      updatedAt: new Date(),
    };

    await db
      .insert(schema.syncSourceConnections)
      .values(values)
      .onConflictDoUpdate({ target: schema.syncSourceConnections.sourceKey, set: values });

    // The service caches resolved settings and holds live pools built from them,
    // so without this ping the save appears to work and the service keeps using
    // the old server indefinitely. Best-effort: the row is already committed and
    // a restart would pick it up anyway.
    const reloaded = await pingSyncService('/api/sync/_reload-db-config', { method: 'POST' });

    await logAudit({
      tenantId,
      actorId,
      entityType: 'sync_source_connection',
      entityId: input.sourceKey,
      action: 'update',
      // Never the password, and never a masked stand-in for it.
      summary: `Koneksi ${input.sourceKey} disimpan (${values.server}:${values.port}/${values.databaseName}).`,
    });

    revalidatePath('/settings/sync');

    const base = reloaded?.ok
      ? `Koneksi ${input.sourceKey} disimpan dan diterapkan.`
      : `Koneksi ${input.sourceKey} disimpan, tetapi layanan sinkronisasi tidak dapat dihubungi — perubahan berlaku saat layanan berikutnya start.`;

    return { success: true, message: base };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Gagal menyimpan koneksi.',
    };
  }
}

/**
 * Test the SAVED settings.
 *
 * Deliberately not "test what is currently typed in the form": that would mean
 * POSTing a password to a service with no authentication. Save, then test.
 */
export async function testSourceConnectionAction(
  sourceKey: SyncSourceKey,
): Promise<{ success: boolean; message: string }> {
  try {
    await requirePermission('sync.manage');
    const res = await pingSyncService(`/api/sync/_test-connection?source=${sourceKey}`, {
      method: 'POST',
    });
    if (!res) {
      return { success: false, message: 'Layanan sinkronisasi tidak dapat dihubungi.' };
    }
    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; message?: string }
      | null;
    return {
      success: body?.success === true,
      message: body?.message ?? `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Gagal menguji koneksi.',
    };
  }
}
