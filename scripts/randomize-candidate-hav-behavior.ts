import 'dotenv/config';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { decryptCandidateValue } from '../lib/candidate-crypto';
import { encryptIfEnabled, ensureUnlocked, isInitialized } from '../lib/crypto/key-store';
import { db, pool } from '../lib/db';
import * as schema from '../lib/db/schema';

/**
 * Randomize every candidate's HAV quadrant and behavior recommendation.
 *
 * WHY THIS EXISTS: in this deployment most candidates have NULL in both columns
 * (at the time of writing: 13 of 822 rows carry a HAV quadrant and 115 a
 * behavior recommendation), because the upstream HAV Excel and behavior
 * assessment cover only a fraction of the population. Every program's filter
 * rules gate on exactly those two fields, so almost nobody clears them and the
 * Talent Pool, the scoring pools and the readiness bands all render as empty or
 * uniform — which makes the product impossible to demo or eyeball-test.
 *
 * THIS IS TEST DATA. It overwrites real assessment results with invented ones.
 * Two consequences worth knowing before running it:
 *
 *  • **Filter outcomes change.** `havQuadrant` and `behaviorRecommendation` are
 *    hard disqualifiers in every program template, so who is eligible — and
 *    therefore who gets scored and ranked — changes wholesale. Finished runs are
 *    untouched (their results are stored), but the next run is a different run.
 *  • **The next candidate sync overwrites most of it — not all.** `candidate-populate`
 *    derives both columns from `sync_hav` and `sync_behavior_competencies`. The
 *    behaviour column is assigned unconditionally, so the Monday 01:00 cron — or
 *    any manual "Kandidat" sync — restores the sparse real values. The HAV column
 *    is COALESCEd since drizzle/0080 (no sync_hav row = no statement, so a clean
 *    sync cannot blank real HAVs): a randomized HAV on a candidate that HAS a
 *    sync_hav row is restored, one on a candidate WITHOUT a sync_hav row
 *    SURVIVES the sync. Clear those by hand if you need the sparse values back.
 *    Either way the restore is not a "sync event" for Talent Mapping: re-copying
 *    an older sync_hav value displaces no hand placement (hav-order.ts).
 *    Re-run this afterwards if you still want the randomized spread.
 *
 * Values are drawn from the REAL domains, not invented strings: the sixteen HAV
 * quadrants, and the fifteen `rekomendasi_name` values that actually occur in
 * `sync_behavior_competencies`. That matters because the criterion names in
 * governance filter rules are matched exactly — a made-up label like "GOOD"
 * would fail every rule and look like a bug rather than a low score.
 *
 * Writes go through `encryptIfEnabled`, the same three-state path the app uses:
 * plaintext when encryption was never initialised, ciphertext when it is
 * unlocked, and a hard error when it is initialised but locked. It never writes
 * plaintext into a column the operator believes is sealed.
 *
 * Usage:
 *   pnpm tsx scripts/randomize-candidate-hav-behavior.ts                 # dry run
 *   pnpm tsx scripts/randomize-candidate-hav-behavior.ts --apply
 *   pnpm tsx scripts/randomize-candidate-hav-behavior.ts --apply --only=hav
 *   pnpm tsx scripts/randomize-candidate-hav-behavior.ts --apply --seed=42
 *   pnpm tsx scripts/randomize-candidate-hav-behavior.ts --apply --uniform
 *   pnpm tsx scripts/randomize-candidate-hav-behavior.ts --apply --tenant=mulia
 *   pnpm tsx scripts/randomize-candidate-hav-behavior.ts --apply --only-empty
 */

// ── Value domains ──────────────────────────────────────────────────
//
// HAV: candidates store the canonical quadrant NUMBER as text ("1".."16") —
// `candidate-populate` strips the descriptive form ("Kuadran #6") down to the
// digits, and the filter engine compares against that. Weights lean toward the
// middle of the grid so a randomized population produces a believable mix of
// eligible and ineligible rather than a coin flip.
const HAV_WEIGHTS: { value: string; weight: number }[] = [
  { value: '1', weight: 4 }, // STAR
  { value: '2', weight: 6 }, // FUTURE STAR
  { value: '3', weight: 7 }, // POTENTIAL CANDIDATE
  { value: '4', weight: 7 }, // FUTURE STAR
  { value: '5', weight: 9 }, // CANDIDATE
  { value: '6', weight: 9 }, // RAW DIAMOND
  { value: '7', weight: 8 }, // TOP PERFORMER
  { value: '8', weight: 8 }, // STRONG PERFORMER
  { value: '9', weight: 7 }, // CAREER PERSON
  { value: '10', weight: 4 }, // MOST UNFIT EMPLOYEE
  { value: '11', weight: 4 }, // UNFIT EMPLOYEE
  { value: '12', weight: 4 }, // PROBLEM EMPLOYEE
  { value: '13', weight: 5 }, // (BORDER/SOLID band)
  { value: '14', weight: 5 },
  { value: '15', weight: 3 },
  { value: '16', weight: 2 }, // excluded outright by most programs
];

// Behavior: every distinct `rekomendasi_name` present in
// sync_behavior_competencies. Copy them byte-for-byte — the filter rules match
// exactly, and "NEED DEVELOPMENT (9 MONTHS – 2 YEARS)" carries an EN DASH that a
// retyped hyphen would silently break.
const BEHAVIOR_WEIGHTS: { value: string; weight: number }[] = [
  { value: 'READY', weight: 31 },
  { value: 'MIDDLE HIGH', weight: 29 },
  { value: 'READY WITH DEVELOPMENT', weight: 26 },
  { value: 'MIDDLE LOW', weight: 22 },
  { value: 'LOW', weight: 16 },
  { value: 'HIGH', weight: 11 },
  { value: 'VERY HIGH', weight: 7 },
  { value: 'BELUM ADA POTENSI', weight: 6 },
  { value: 'VERY LOW', weight: 4 },
  { value: 'FOCUS ON OPTIMIZATION IN CURRENT POSITION', weight: 3 },
  { value: 'POTENSI', weight: 3 },
  { value: 'STRENGTH', weight: 2 },
  { value: 'PENGEMBANGAN JANGKA PENDEK', weight: 2 },
  { value: 'NOT READY', weight: 2 },
  { value: 'NEED DEVELOPMENT (9 MONTHS – 2 YEARS)', weight: 1 },
];

/** Short note that matches the recommendation, so the two never contradict. */
const BEHAVIOR_NOTES: Record<string, string> = {
  READY: 'Siap menjalankan peran berikutnya tanpa pendampingan khusus.',
  'MIDDLE HIGH': 'Kompetensi perilaku di atas rata-rata; perlu pematangan pada beberapa area.',
  'READY WITH DEVELOPMENT': 'Siap dengan pengembangan terarah pada area yang masih di bawah standar.',
  'MIDDLE LOW': 'Beberapa kompetensi kunci masih di bawah standar jabatan.',
  LOW: 'Sebagian besar kompetensi perilaku masih di bawah standar.',
  HIGH: 'Kompetensi perilaku kuat pada hampir seluruh area yang dinilai.',
  'VERY HIGH': 'Kompetensi perilaku sangat kuat dan konsisten di seluruh area.',
  'BELUM ADA POTENSI': 'Belum menunjukkan indikasi kesiapan untuk peran yang lebih luas.',
  'VERY LOW': 'Kompetensi perilaku jauh di bawah standar jabatan.',
  'FOCUS ON OPTIMIZATION IN CURRENT POSITION':
    'Diarahkan mengoptimalkan kinerja pada jabatan saat ini.',
  POTENSI: 'Menunjukkan potensi yang perlu diuji lewat penugasan bertahap.',
  STRENGTH: 'Kekuatan perilaku menonjol dan dapat diandalkan sebagai contoh.',
  'PENGEMBANGAN JANGKA PENDEK': 'Perlu program pengembangan jangka pendek sebelum promosi.',
  'NOT READY': 'Belum siap untuk peran yang lebih tinggi pada periode ini.',
  'NEED DEVELOPMENT (9 MONTHS – 2 YEARS)':
    'Perlu pengembangan 9 bulan sampai 2 tahun sebelum dipertimbangkan.',
};

// ── Deterministic RNG (mulberry32) ─────────────────────────────────
// Seeded so a run can be reproduced: "the demo data changed under me" is a
// tedious thing to debug, and `--seed` makes the spread repeatable.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick<T extends { value: string; weight: number }>(
  table: T[],
  rng: () => number,
  uniform: boolean,
): string {
  if (uniform) return table[Math.floor(rng() * table.length)]!.value;
  const total = table.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const item of table) {
    roll -= item.weight;
    if (roll <= 0) return item.value;
  }
  return table[table.length - 1]!.value;
}

// ── Args ───────────────────────────────────────────────────────────

type Options = {
  apply: boolean;
  only: 'both' | 'hav' | 'behavior';
  uniform: boolean;
  seed: number;
  tenant: string | null;
  onlyEmpty: boolean;
  includeDeleted: boolean;
};

function parseArgs(argv: string[]): Options {
  const get = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const onlyRaw = (get('only') ?? 'both').toLowerCase();
  if (!['both', 'hav', 'behavior'].includes(onlyRaw)) {
    throw new Error(`--only must be one of: both, hav, behavior (got "${onlyRaw}")`);
  }
  const seedRaw = get('seed');
  return {
    apply: argv.includes('--apply'),
    only: onlyRaw as Options['only'],
    uniform: argv.includes('--uniform'),
    seed: seedRaw != null && seedRaw !== '' ? Number(seedRaw) : 20260813,
    tenant: get('tenant'),
    onlyEmpty: argv.includes('--only-empty'),
    includeDeleted: argv.includes('--include-deleted'),
  };
}

function histogram(values: (string | null)[]): { value: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v == null || v === '' ? '(kosong)' : v;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, n]) => ({ value, n }))
    .sort((a, b) => b.n - a.n);
}

function printHistogram(title: string, rows: { value: string; n: number }[], total: number) {
  console.log(`\n${title}`);
  for (const row of rows) {
    const pct = total > 0 ? Math.round((row.n / total) * 100) : 0;
    const bar = '█'.repeat(Math.max(0, Math.round(pct / 2)));
    console.log(`  ${row.value.padEnd(42)} ${String(row.n).padStart(4)}  ${String(pct).padStart(3)}%  ${bar}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Same gate as scripts/encrypt-candidates.ts: refuse to write rather than
  // silently drop plaintext into a column the operator believes is sealed.
  const unlocked = await ensureUnlocked();
  const initialised = await isInitialized();
  if (initialised && !unlocked) {
    console.error(
      'Enkripsi sudah diinisialisasi tetapi master key tidak terbaca. ' +
        'Set PULSE_MASTER_KEY_FILE (atau PULSE_MASTER_KEY) lalu jalankan ulang — ' +
        'menulis plaintext ke kolom yang seharusnya tersegel bukan pilihan.',
    );
    process.exit(1);
  }
  const willEncrypt = initialised && unlocked;

  // Tenant scope: accept a slug or a uuid, because both are things a person has
  // at hand (the slug is in the URL cookie, the uuid in lib/tenant.ts).
  let tenantId: string | null = null;
  let tenantLabel = 'semua business unit';
  if (opts.tenant) {
    const tenants = await db
      .select({ id: schema.tenants.id, slug: schema.tenants.slug, name: schema.tenants.name })
      .from(schema.tenants);
    const match = tenants.find(
      (t) =>
        t.id === opts.tenant ||
        t.slug?.toLowerCase() === opts.tenant!.toLowerCase() ||
        t.name.toLowerCase() === opts.tenant!.toLowerCase(),
    );
    if (!match) {
      console.error(
        `Business unit "${opts.tenant}" tidak ditemukan. Pilihan: ` +
          tenants.map((t) => `${t.slug ?? t.id} (${t.name})`).join(', '),
      );
      process.exit(1);
    }
    tenantId = match.id;
    tenantLabel = `${match.name}`;
  }

  const where = [
    ...(tenantId ? [eq(schema.candidates.tenantId, tenantId)] : []),
    // Tombstoned candidates are excluded by default: they are invisible in every
    // pool and list, so rewriting their assessment data is work nothing reads.
    ...(opts.includeDeleted ? [] : [isNull(schema.candidates.deletedAt)]),
  ];

  const rows = await db
    .select({
      id: schema.candidates.id,
      employeeId: schema.candidates.employeeId,
      havQuadrant: schema.candidates.havQuadrant,
      behaviorRecommendation: schema.candidates.behaviorRecommendation,
    })
    .from(schema.candidates)
    .where(where.length > 0 ? and(...where) : undefined);

  // Values are encrypted at rest; decrypt to report the BEFORE picture.
  const before = rows.map((r) => ({
    id: r.id,
    hav: decryptCandidateValue(r.havQuadrant),
    behavior: decryptCandidateValue(r.behaviorRecommendation),
  }));

  const targets = opts.onlyEmpty
    ? before.filter(
        (r) =>
          (opts.only !== 'behavior' && (r.hav == null || r.hav === '')) ||
          (opts.only !== 'hav' && (r.behavior == null || r.behavior === '')),
      )
    : before;

  console.log('─'.repeat(78));
  console.log('Randomisasi HAV & Behavior kandidat');
  console.log('─'.repeat(78));
  console.log(`Business unit    : ${tenantLabel}`);
  console.log(`Kandidat terbaca : ${rows.length}${opts.includeDeleted ? ' (termasuk yang dihapus)' : ' (aktif saja)'}`);
  console.log(`Akan diubah      : ${targets.length}${opts.onlyEmpty ? ' (hanya yang masih kosong)' : ''}`);
  console.log(`Kolom            : ${opts.only === 'both' ? 'hav_quadrant + behavior_recommendation (+ behavior_notes)' : opts.only}`);
  console.log(`Sebaran          : ${opts.uniform ? 'uniform (rata)' : 'realistic (berbobot)'}`);
  console.log(`Seed             : ${opts.seed}`);
  console.log(
    `Enkripsi         : ${
      willEncrypt ? 'AKTIF — nilai ditulis sebagai ciphertext v1:' : 'tidak diinisialisasi — nilai ditulis plaintext'
    }`,
  );
  console.log(`Mode             : ${opts.apply ? 'APPLY (menulis ke database)' : 'DRY RUN (tidak menulis)'}`);

  printHistogram(
    'SEBELUM — HAV quadrant',
    histogram(before.map((r) => r.hav)),
    before.length,
  );
  printHistogram(
    'SEBELUM — Behavior recommendation',
    histogram(before.map((r) => r.behavior)),
    before.length,
  );

  // Draw the new values (deterministic given --seed), then report and/or write.
  const rng = makeRng(opts.seed);
  const targetIds = new Set(targets.map((t) => t.id));
  const plan = before
    .filter((r) => targetIds.has(r.id))
    .map((r) => ({
      id: r.id,
      hav: opts.only === 'behavior' ? r.hav : weightedPick(HAV_WEIGHTS, rng, opts.uniform),
      behavior:
        opts.only === 'hav' ? r.behavior : weightedPick(BEHAVIOR_WEIGHTS, rng, opts.uniform),
    }));

  printHistogram('SESUDAH — HAV quadrant', histogram(plan.map((r) => r.hav)), plan.length);
  printHistogram(
    'SESUDAH — Behavior recommendation',
    histogram(plan.map((r) => r.behavior)),
    plan.length,
  );

  // A rough eligibility projection, from the HAV/behavior rules only. It is not
  // the filter engine — discipline, MCU, PA and grade rules still apply — but it
  // answers the question this script exists for: will anybody clear the bar now?
  const templates = await db
    .select({ name: schema.programTemplates.name, filterRules: schema.programTemplates.filterRules })
    .from(schema.programTemplates)
    .where(tenantId ? eq(schema.programTemplates.tenantId, tenantId) : undefined as never);

  const seenProgram = new Set<string>();
  const projections: string[] = [];
  for (const template of templates) {
    if (seenProgram.has(template.name)) continue;
    seenProgram.add(template.name);
    const havIn = new Set<string>();
    const behaviorAllowed = new Set<string>();
    const behaviorBlocked = new Set<string>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      const n = node as Record<string, unknown>;
      const values = Array.isArray(n.value) ? n.value.map((v) => String(v)) : [];
      if (n.field === 'havQuadrant' && n.operator === 'in') values.forEach((v) => havIn.add(v));
      if (n.field === 'behaviorRecommendation' && n.operator === 'in')
        values.forEach((v) => behaviorAllowed.add(v));
      if (n.field === 'behaviorRecommendation' && n.operator === 'notIn')
        values.forEach((v) => behaviorBlocked.add(v));
      Object.values(n).forEach(walk);
    };
    walk(template.filterRules);

    const passing = plan.filter((r) => {
      const havOk = havIn.size === 0 || (r.hav != null && havIn.has(r.hav));
      const behaviorOk =
        r.behavior == null
          ? false
          : (behaviorAllowed.size === 0 || behaviorAllowed.has(r.behavior)) &&
            !behaviorBlocked.has(r.behavior);
      return havOk && behaviorOk;
    }).length;
    const pct = plan.length > 0 ? Math.round((passing / plan.length) * 100) : 0;
    projections.push(`  ${template.name.padEnd(22)} ${String(passing).padStart(4)} / ${plan.length}  (${pct}%)`);
  }
  if (projections.length > 0) {
    console.log('\nPROYEKSI lolos aturan HAV & behavior saja (aturan lain tetap berlaku):');
    projections.forEach((line) => console.log(line));
  }

  if (!opts.apply) {
    console.log('\nDRY RUN — tidak ada yang ditulis. Tambahkan --apply untuk menyimpan.');
    await pool.end();
    return;
  }

  console.log(`\nMenulis ${plan.length} baris...`);
  let written = 0;
  const BATCH = 200;
  for (let i = 0; i < plan.length; i += BATCH) {
    const batch = plan.slice(i, i + BATCH);
    await db.transaction(async (tx) => {
      for (const row of batch) {
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (opts.only !== 'behavior') {
          patch.havQuadrant = await encryptIfEnabled(row.hav);
        }
        if (opts.only !== 'hav') {
          patch.behaviorRecommendation = await encryptIfEnabled(row.behavior);
          patch.behaviorNotes = await encryptIfEnabled(
            row.behavior ? (BEHAVIOR_NOTES[row.behavior] ?? null) : null,
          );
        }
        await tx.update(schema.candidates).set(patch).where(eq(schema.candidates.id, row.id));
        written++;
      }
    });
    console.log(`  ${Math.min(i + BATCH, plan.length)}/${plan.length}`);
  }

  // Read back a couple of rows so the operator sees the storage form, not just a
  // success message — "encrypted like current behaviour" is the requirement, and
  // this is the only place it is observable.
  const sample = await db
    .select({
      id: schema.candidates.id,
      havQuadrant: schema.candidates.havQuadrant,
      behaviorRecommendation: schema.candidates.behaviorRecommendation,
    })
    .from(schema.candidates)
    .where(inArray(schema.candidates.id, plan.slice(0, 2).map((r) => r.id)));

  console.log(`\nSelesai — ${written} baris diperbarui.`);
  for (const row of sample) {
    console.log(
      `  ${row.id.slice(0, 8)}  hav=${String(row.havQuadrant).slice(0, 28)}${
        String(row.havQuadrant).length > 28 ? '…' : ''
      }  →  "${decryptCandidateValue(row.havQuadrant)}"`,
    );
    console.log(
      `            behavior=${String(row.behaviorRecommendation).slice(0, 28)}${
        String(row.behaviorRecommendation).length > 28 ? '…' : ''
      }  →  "${decryptCandidateValue(row.behaviorRecommendation)}"`,
    );
  }
  console.log(
    '\nCATATAN: sinkronisasi "Kandidat" berikutnya (termasuk cron Senin 01:00) menulis ulang\n' +
      'kedua kolom ini dari sync_hav / sync_behavior_competencies. Jalankan skrip ini lagi\n' +
      'sesudahnya bila sebaran acak masih dibutuhkan.',
  );

  await pool.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  try {
    await pool.end();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
