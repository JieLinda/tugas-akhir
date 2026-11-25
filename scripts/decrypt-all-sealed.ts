/**
 * One-time: turn every value sealed with the app's data key (`v1:<iv>:<tag>:<ct>`)
 * back into plaintext, so application-level encryption can be removed.
 *
 *   npx tsx scripts/decrypt-all-sealed.ts                 # dry-run: count only, writes nothing
 *   npx tsx scripts/decrypt-all-sealed.ts --write         # decrypt and commit (one transaction)
 *   npx tsx scripts/decrypt-all-sealed.ts --key-file PATH # master key file (default: PULSE_MASTER_KEY_FILE, then secrets/master.key)
 *
 * The master key may also come from PULSE_MASTER_KEY (inline base64).
 *
 * Deliberately SELF-CONTAINED (pg + node:crypto, nothing from lib/crypto): it has
 * to keep working after the encryption code is deleted from the repo, on every
 * database that still holds sealed values.
 *
 * It does not trust a list of "encrypted columns". It scans every text/varchar
 * and json/jsonb column of every user table:
 *   - a text value that IS a sealed envelope is opened (repeatedly, if the
 *     plaintext was itself sealed);
 *   - a text value that is JSON and CONTAINS sealed strings (run traces, ...) and
 *     every json/jsonb value has its sealed string leaves opened in place.
 * `app_encryption_keys` is skipped: its wrapped DEK is sealed under the MASTER
 * key, not the data key, and the table is dropped by drizzle/0099 afterwards.
 *
 * A value that cannot be opened ABORTS the whole run (nothing is written): a
 * half-decrypted database whose key is about to be deleted is the one outcome
 * that cannot be recovered from.
 *
 * Completed runs are immutable (drizzle/0087, 0092 triggers). Opening their
 * sealed values changes no number, only the storage form, so the four guard
 * triggers are disabled INSIDE this transaction and re-enabled before COMMIT;
 * any failure rolls the DISABLE back with everything else. This takes an
 * exclusive lock on those tables for the duration — run it with the web app,
 * sync-service and scoring-service stopped.
 */
import { createDecipheriv, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Client } from 'pg';
import 'dotenv/config';

const WRITE = process.argv.includes('--write');
const keyFileArg = (() => {
  const i = process.argv.indexOf('--key-file');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

const SEALED_RE = /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/;
const VERIFIER_PLAINTEXT = 'pulse-encryption-verifier-v1';
const SKIP_TABLES = new Set(['app_encryption_keys']);
const GUARD_TRIGGERS: Array<[string, string]> = [
  ['scoring_runs', 'trg_scoring_runs_completed_immutable'],
  ['analysis_results', 'trg_analysis_results_completed_immutable'],
  ['scoring_run_pool_aspects', 'trg_scoring_run_pool_aspects_completed_immutable'],
  ['scoring_run_traces', 'trg_scoring_run_traces_completed_immutable'],
];

function openEnvelope(key: Buffer, value: string): string {
  const [, iv, tag, ct] = value.split(':');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv!, 'base64'));
  d.setAuthTag(Buffer.from(tag!, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct!, 'base64')), d.final()]).toString('utf8');
}

function readMasterKey(): string {
  const inline = process.env.PULSE_MASTER_KEY?.trim();
  const configured = keyFileArg || process.env.PULSE_MASTER_KEY_FILE?.trim() || 'secrets/master.key';
  const candidates = isAbsolute(configured)
    ? [configured]
    : [resolve(process.cwd(), configured), resolve(process.cwd(), '..', configured)];
  for (const p of candidates) {
    if (existsSync(p)) {
      console.log(`Master key: ${p}`);
      return readFileSync(p, 'utf8').trim();
    }
  }
  if (inline) {
    console.log('Master key: PULSE_MASTER_KEY');
    return inline;
  }
  throw new Error(`Master key tidak ditemukan (dicari: ${candidates.join(', ')}; PULSE_MASTER_KEY kosong).`);
}

/** Recursively open sealed string leaves. Returns the same reference when nothing changed. */
function openDeep(key: Buffer, v: unknown, stats: { leaves: number }): unknown {
  if (typeof v === 'string') return openText(key, v, stats);
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => {
      const y = openDeep(key, x, stats);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? out : v;
  }
  if (v && typeof v === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const y = openDeep(key, x, stats);
      if (y !== x) changed = true;
      out[k] = y;
    }
    return changed ? out : v;
  }
  return v;
}

/** Open a text value: a whole envelope, or JSON text with sealed leaves inside. */
function openText(key: Buffer, s: string, stats: { leaves: number }): string {
  let cur = s;
  for (let depth = 0; depth < 4 && SEALED_RE.test(cur); depth++) {
    cur = openEnvelope(key, cur); // throws on a wrong key / corrupt value
    stats.leaves++;
  }
  if (cur.includes('"v1:')) {
    const t = cur.trimStart();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const parsed = JSON.parse(cur);
        const opened = openDeep(key, parsed, stats);
        if (opened !== parsed) cur = JSON.stringify(opened);
      } catch {
        /* not JSON: leave the text as it is */
      }
    }
  }
  return cur;
}

const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL / POSTGRES_URL belum diatur.');
  const db = new Client({ connectionString: url });
  await db.connect();
  const u = new URL(url);
  console.log(`Database: ${u.hostname}:${u.port || 5432}${u.pathname}  mode: ${WRITE ? 'WRITE' : 'dry-run'}`);

  const keyRows = await db
    .query<{ wrapped_dek: string; verifier: string }>(
      `SELECT wrapped_dek, verifier FROM app_encryption_keys WHERE is_active LIMIT 1`,
    )
    .catch(() => ({ rows: [] as Array<{ wrapped_dek: string; verifier: string }> }));

  let dataKey: Buffer | null = null;
  if (keyRows.rows[0]) {
    const master = Buffer.from(readMasterKey(), 'base64');
    if (master.length !== 32) throw new Error('Master key bukan 32 byte base64.');
    dataKey = Buffer.from(openEnvelope(master, keyRows.rows[0].wrapped_dek), 'base64');
    const check = Buffer.from(openEnvelope(dataKey, keyRows.rows[0].verifier), 'utf8');
    const want = Buffer.from(VERIFIER_PLAINTEXT, 'utf8');
    if (check.length !== want.length || !timingSafeEqual(check, want)) {
      throw new Error('Master key tidak cocok dengan app_encryption_keys.');
    }
    console.log('Data key terbuka dan terverifikasi.');
  } else {
    console.log('Tidak ada baris aktif di app_encryption_keys (enkripsi tidak pernah diinisialisasi).');
  }

  const cols = await db.query<{ schema: string; table: string; column: string; type: string }>(`
    SELECT c.table_schema AS schema, c.table_name AS table, c.column_name AS column, c.data_type AS type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
       AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
     ORDER BY 1, 2, 3`);

  const byTable = new Map<string, typeof cols.rows>();
  for (const c of cols.rows) {
    if (SKIP_TABLES.has(c.table)) continue;
    const k = `${qi(c.schema)}.${qi(c.table)}`;
    if (!byTable.has(k)) byTable.set(k, []);
    byTable.get(k)!.push(c);
  }

  await db.query('BEGIN');
  try {
    if (WRITE) {
      for (const [table, trigger] of GUARD_TRIGGERS) {
        const exists = await db.query(
          `SELECT 1 FROM pg_trigger WHERE tgname = $1 AND tgrelid = to_regclass($2)`,
          [trigger, table],
        );
        if (exists.rowCount) await db.query(`ALTER TABLE ${qi(table)} DISABLE TRIGGER ${qi(trigger)}`);
      }
    }

    let totalRows = 0;
    let totalValues = 0;
    const summary: string[] = [];
    for (const [table, tcols] of byTable) {
      const pred = tcols
        .map((c) => `${qi(c.column)}::text LIKE ${c.type.startsWith('json') ? `'%"v1:%'` : `'%v1:%'`}`)
        .join(' OR ');
      const sel = tcols.map((c) => qi(c.column)).join(', ');
      const res = await db.query(`SELECT ctid::text AS __ctid, ${sel} FROM ${table} WHERE ${pred}`);
      if (!res.rowCount) continue;

      const perCol = new Map<string, number>();
      let rowsChanged = 0;
      for (const row of res.rows) {
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const c of tcols) {
          const v = row[c.column];
          if (v == null) continue;
          const stats = { leaves: 0 };
          let next: unknown;
          try {
            if (!dataKey) {
              // Nothing can be opened without a key; just detect envelopes.
              const s = typeof v === 'string' ? v : JSON.stringify(v);
              if (/(^|")v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:/.test(s)) {
                throw new Error('nilai tersegel ditemukan, tetapi tidak ada kunci data');
              }
              continue;
            }
            next = typeof v === 'string' ? openText(dataKey, v, stats) : openDeep(dataKey, v, stats);
          } catch (err) {
            throw new Error(
              `Gagal membuka ${table}.${c.column} (ctid ${row.__ctid}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          if (stats.leaves === 0) continue;
          perCol.set(c.column, (perCol.get(c.column) ?? 0) + stats.leaves);
          totalValues += stats.leaves;
          params.push(c.type === 'jsonb' || c.type === 'json' ? JSON.stringify(next) : next);
          sets.push(`${qi(c.column)} = $${params.length}${c.type === 'jsonb' ? '::jsonb' : c.type === 'json' ? '::json' : ''}`);
        }
        if (!sets.length) continue;
        rowsChanged++;
        if (WRITE) {
          params.push(row.__ctid);
          await db.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE ctid = $${params.length}::tid`, params);
        }
      }
      if (rowsChanged) {
        totalRows += rowsChanged;
        summary.push(
          `  ${table}: ${rowsChanged} baris — ${[...perCol].map(([c, n]) => `${c} ${n}`).join(', ')}`,
        );
      }
    }

    console.log(summary.length ? summary.join('\n') : '  (tidak ada nilai tersegel)');
    console.log(`Total: ${totalValues} nilai dalam ${totalRows} baris.`);

    if (WRITE) {
      for (const [table, trigger] of GUARD_TRIGGERS) {
        const exists = await db.query(
          `SELECT 1 FROM pg_trigger WHERE tgname = $1 AND tgrelid = to_regclass($2)`,
          [trigger, table],
        );
        if (exists.rowCount) await db.query(`ALTER TABLE ${qi(table)} ENABLE TRIGGER ${qi(trigger)}`);
      }
      await db.query('COMMIT');
      console.log('COMMIT. Jalankan lagi tanpa --write: hasilnya harus "Total: 0 nilai".');
    } else {
      await db.query('ROLLBACK');
      console.log('Dry-run: tidak ada yang ditulis. Tambahkan --write untuk menerapkan.');
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('GAGAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
