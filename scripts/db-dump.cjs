// Dump the Pulse databases to two plain-SQL files: schema (DDL) and data (INSERTs).
//
//   node scripts/db-dump.cjs [outDir]        # default outDir: db-export/
//
// Why not pg_dump? It isn't installed on the dev machines here (and the Docker
// daemon isn't always running), so this introspects pg_catalog directly. It is
// deliberately narrow — it covers exactly what this project's schema uses:
// tables, sequences, constraints, indexes, and the `vector` extension. It does
// NOT handle views, enums, functions, triggers, partitions, or ACLs; the probe
// below fails loudly if any of those ever appear, rather than silently
// producing an incomplete dump.
//
// Both databases are emitted into the SAME pair of files, in clearly delimited
// sections: the main app DB first, then the pgvector DB. That is restorable
// either way — into one database (the services accept VECTOR_DATABASE_URL
// falling back to the main POSTGRES_URL) or into two, by splitting on the
// section banners.
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const TARGETS = [
  { label: 'MAIN', desc: 'Aplikasi Pulse (tabel utama + hasil sync)', url: process.env.DATABASE_URL || process.env.POSTGRES_URL },
  { label: 'VECTOR', desc: 'pgvector — Transformasi job profile & kamus kompetensi', url: process.env.VECTOR_DATABASE_URL || process.env.VECTOR_POSTGRES_URL },
];

const ROWS_PER_INSERT = 200;

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const banner = (t) => `\n-- ${'='.repeat(72)}\n-- ${t}\n-- ${'='.repeat(72)}\n`;

/** Fail loudly rather than emit a silently incomplete dump. */
async function assertSupported(pool, label) {
  const unsupported = await pool.query(`
    SELECT c.relkind, count(*)::int AS n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind NOT IN ('r','i','S')
    GROUP BY 1`);
  // Objects owned by an extension (pg_depend deptype 'e') are rebuilt by
  // CREATE EXTENSION — pgvector alone installs ~118 functions into public — so
  // only hand-written objects count as unsupported.
  const routines = await pool.query(`
    SELECT count(*)::int AS n FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`);
  const trig = await pool.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal`);
  const enums = await pool.query(`
    SELECT count(*)::int AS n FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')`);
  const problems = [];
  for (const r of unsupported.rows) problems.push(`relkind '${r.relkind}' × ${r.n}`);
  if (routines.rows[0].n) problems.push(`${routines.rows[0].n} function(s)`);
  if (trig.rows[0].n) problems.push(`${trig.rows[0].n} user trigger(s)`);
  if (enums.rows[0].n) problems.push(`${enums.rows[0].n} enum type(s)`);
  if (problems.length) {
    throw new Error(
      `[${label}] database contains objects this dumper does not emit: ${problems.join(', ')}. ` +
      `Extend scripts/db-dump.cjs (or use pg_dump) before relying on this output.`
    );
  }
}

async function introspect(pool) {
  const [exts, seqs, seqOwned, cols, cons, idxs, fks, tables] = await Promise.all([
    pool.query(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`),
    pool.query(`
      SELECT c.relname AS name, s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle
      FROM pg_sequence s
      JOIN pg_class c ON c.oid = s.seqrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' ORDER BY 1`),
    pool.query(`
      SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
      FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.deptype = 'a'
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      JOIN pg_namespace n ON n.oid = s.relnamespace
      WHERE s.relkind = 'S' AND n.nspname = 'public' ORDER BY 1`),
    pool.query(`
      SELECT c.relname AS tbl, a.attname AS col,
             format_type(a.atttypid, a.atttypmod) AS typ,
             a.attnotnull AS notnull,
             pg_get_expr(ad.adbin, ad.adrelid) AS def
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum`),
    pool.query(`
      SELECT c.conrelid::regclass::text AS tbl, c.conname AS name, c.contype AS type,
             pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public' AND c.contype IN ('p','u','c','f')
      ORDER BY c.conname`),
    pool.query(`
      SELECT ic.relname AS name, pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = ic.relnamespace
      WHERE n.nspname = 'public'
        AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)
      ORDER BY c.relname, ic.relname`),
    pool.query(`
      SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public' AND c.contype = 'f'`),
    pool.query(`
      SELECT c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`),
  ]);
  return {
    extensions: exts.rows, sequences: seqs.rows, seqOwned: seqOwned.rows,
    columns: cols.rows, constraints: cons.rows, indexes: idxs.rows,
    fks: fks.rows, tables: tables.rows.map((r) => r.name),
  };
}

/** Parent-before-child ordering so a data-only restore satisfies FKs. */
function topoSort(tables, fks) {
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of fks) {
    const c = child.replace(/^public\./, '').replace(/"/g, '');
    const p = parent.replace(/^public\./, '').replace(/"/g, '');
    if (c !== p && deps.has(c) && deps.has(p)) deps.get(c).add(p);
  }
  const out = [];
  const done = new Set();
  let guard = 0;
  while (out.length < tables.length && guard++ <= tables.length + 1) {
    for (const t of tables) {
      if (done.has(t)) continue;
      if ([...deps.get(t)].every((d) => done.has(d))) { out.push(t); done.add(t); }
    }
  }
  // Any residue means a dependency cycle — append it and warn.
  for (const t of tables) if (!done.has(t)) { out.push(t); console.warn(`  ! cycle involving ${t} — verify FK order manually`); }
  return out;
}

function buildSchema(x) {
  const L = [];
  for (const e of x.extensions) L.push(`CREATE EXTENSION IF NOT EXISTS ${q(e.extname)};`);
  if (x.extensions.length) L.push('');

  if (x.sequences.length) {
    L.push('-- Sequences (created before tables: column defaults reference them)');
    for (const s of x.sequences) {
      L.push(
        `CREATE SEQUENCE IF NOT EXISTS ${q(s.name)} INCREMENT BY ${s.seqincrement} ` +
        `MINVALUE ${s.seqmin} MAXVALUE ${s.seqmax} START WITH ${s.seqstart} ` +
        `CACHE ${s.seqcache}${s.seqcycle ? ' CYCLE' : ' NO CYCLE'};`
      );
    }
    L.push('');
  }

  const byTable = new Map();
  for (const c of x.columns) {
    if (!byTable.has(c.tbl)) byTable.set(c.tbl, []);
    byTable.get(c.tbl).push(c);
  }
  L.push('-- Tables');
  for (const t of x.tables) {
    const defs = (byTable.get(t) || []).map((c) => {
      let s = `  ${q(c.col)} ${c.typ}`;
      if (c.def) s += ` DEFAULT ${c.def}`;
      if (c.notnull) s += ' NOT NULL';
      return s;
    });
    L.push(`CREATE TABLE IF NOT EXISTS ${q(t)} (\n${defs.join(',\n')}\n);`);
  }
  L.push('');

  if (x.seqOwned.length) {
    L.push('-- Sequence ownership (drops the sequence when its table is dropped)');
    for (const s of x.seqOwned) L.push(`ALTER SEQUENCE ${q(s.seq)} OWNED BY ${q(s.tbl)}.${q(s.col)};`);
    L.push('');
  }

  const order = { p: 0, u: 1, c: 2, f: 3 };
  const label = { p: 'Primary keys', u: 'Unique constraints', c: 'Check constraints', f: 'Foreign keys' };
  for (const type of ['p', 'u', 'c', 'f']) {
    const list = x.constraints.filter((c) => c.type === type).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) continue;
    L.push(`-- ${label[type]}`);
    for (const c of list) {
      const tbl = c.tbl.replace(/^public\./, '').replace(/"/g, '');
      L.push(`ALTER TABLE ${q(tbl)} ADD CONSTRAINT ${q(c.name)} ${c.def};`);
    }
    L.push('');
  }
  void order;

  if (x.indexes.length) {
    L.push('-- Indexes (constraint-backed indexes are created above)');
    for (const i of x.indexes) L.push(i.def.replace(/^CREATE (UNIQUE )?INDEX /, (m) => m + 'IF NOT EXISTS ') + ';');
    L.push('');
  }
  return L.join('\n');
}

async function buildData(pool, x) {
  const L = [];
  const order = topoSort(x.tables, x.fks);
  const byTable = new Map();
  for (const c of x.columns) {
    if (!byTable.has(c.tbl)) byTable.set(c.tbl, []);
    byTable.get(c.tbl).push(c.col);
  }
  let grand = 0;

  for (const t of order) {
    const cols = byTable.get(t) || [];
    if (!cols.length) continue;
    // Cast every column to text: the canonical text form of each type is a
    // valid literal on the way back in, so jsonb / uuid / timestamps / vector
    // all round-trip without per-type special cases.
    const sel = cols.map((c) => `${q(c)}::text AS ${q(c)}`).join(', ');
    const { rows } = await pool.query(`SELECT ${sel} FROM ${q(t)}`);
    if (!rows.length) { L.push(`-- ${t}: 0 rows`); continue; }
    grand += rows.length;
    L.push(`-- ${t}: ${rows.length} rows`);
    const collist = cols.map(q).join(', ');
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const chunk = rows.slice(i, i + ROWS_PER_INSERT);
      const values = chunk
        .map((r) => '  (' + cols.map((c) => (r[c] === null ? 'NULL' : lit(r[c]))).join(', ') + ')')
        .join(',\n');
      L.push(`INSERT INTO ${q(t)} (${collist}) VALUES\n${values};`);
    }
    L.push('');
  }

  if (x.sequences.length) {
    L.push('-- Reset sequences to match the imported data');
    for (const s of x.sequences) {
      const owner = x.seqOwned.find((o) => o.seq === s.name);
      if (owner) {
        L.push(
          `SELECT setval(${lit(s.name)}, COALESCE((SELECT MAX(${q(owner.col)}) FROM ${q(owner.tbl)}), 1), ` +
          `(SELECT MAX(${q(owner.col)}) IS NOT NULL FROM ${q(owner.tbl)}));`
        );
      } else {
        const cur = await pool.query(`SELECT last_value, is_called FROM ${q(s.name)}`);
        L.push(`SELECT setval(${lit(s.name)}, ${cur.rows[0].last_value}, ${cur.rows[0].is_called});`);
      }
    }
    L.push('');
  }
  return { sql: L.join('\n'), rows: grand };
}

(async () => {
  const outDir = path.resolve(process.argv[2] || 'db-export');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const head = (kind) =>
    `-- Pulse database export — ${kind}\n` +
    `-- Generated ${stamp} by scripts/db-dump.cjs\n` +
    `-- Restore order: schema.sql first, then data.sql.\n` +
    `-- Contains BOTH databases in separate sections (see banners below).\n` +
    `SET standard_conforming_strings = on;\n` +
    `SET client_min_messages = warning;\n`;

  const schemaOut = [head('SCHEMA (DDL)')];
  const dataOut = [head('DATA (INSERT)')];
  const summary = [];

  for (const target of TARGETS) {
    if (!target.url) { console.log(`- ${target.label}: skipped (env var not set)`); continue; }
    const pool = new Pool({ connectionString: target.url, connectionTimeoutMillis: 20000 });
    try {
      const meta = await pool.query('SELECT current_database() db, version() v');
      console.log(`- ${target.label}: ${meta.rows[0].db} …`);
      await assertSupported(pool, target.label);
      const x = await introspect(pool);
      const bannerText = `DATABASE ${target.label} — ${meta.rows[0].db}\n-- ${target.desc}\n-- ${meta.rows[0].v.split(',')[0]}`;

      schemaOut.push(banner(bannerText), buildSchema(x));
      const data = await buildData(pool, x);
      dataOut.push(banner(bannerText), 'BEGIN;\n', data.sql, 'COMMIT;\n');

      summary.push(`${target.label}: ${x.tables.length} tabel, ${x.indexes.length} index, ${x.sequences.length} sequence, ${data.rows} baris`);
      console.log(`    ${x.tables.length} tables · ${data.rows} rows`);
    } finally {
      await pool.end();
    }
  }

  const schemaPath = path.join(outDir, 'schema.sql');
  const dataPath = path.join(outDir, 'data.sql');
  fs.writeFileSync(schemaPath, schemaOut.join('\n'), 'utf8');
  fs.writeFileSync(dataPath, dataOut.join('\n'), 'utf8');

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
  console.log('\n' + summary.join('\n'));
  console.log(`\nschema.sql  ${kb(schemaPath)}  ${schemaPath}`);
  console.log(`data.sql    ${kb(dataPath)}  ${dataPath}`);
})().catch((err) => {
  console.error('\nDump failed:', err.message);
  process.exit(1);
});
