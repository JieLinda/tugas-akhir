/**
 * Verifies Talent Mapping and the HAV in force against the real database
 * (docs/talent-mapping.md, lib/hav-effective.ts).
 *
 *   npx tsx scripts/verify-talent-mapping.ts           # read-only checks, every tenant
 *   npx tsx scripts/verify-talent-mapping.ts --write   # + move round trip and HAV-upload supersession on Mulia
 *
 * READ (always), per business unit:
 *   • ONE HAV everywhere: the map's "Lolos Talent Pool" set is exactly the Talent
 *     Pool page's qualified list, and both show the same quadrant per person;
 *   • the map's population is EXACTLY the live candidates passing the Talent
 *     Pool's discipline rule (independently recomputed), it contains the whole
 *     pool, the counts partition it, and every square follows
 *     manual > upload > formula;
 *   • no placement older than its candidate's sync clock is in force.
 *
 * WRITE (--write) drives the server action through the review loop on one real
 * candidate and checks every reader of the HAV in force: the placement row, the
 * audit trail (naming the actor), the Talent Pool list, the scoring
 * eligibility loader, and scoring-service's own resolver. It then checks the
 * sync side INSIDE ROLLED-BACK TRANSACTIONS (sync-service hav-supersede.ts): an
 * upload that changes the quadrant timestamps the candidate, supersedes the
 * older placement and logs it; one that does not change it leaves it alone; a
 * candidate-sync change (PA/BA from MSSQL) does the same as 'superseded_by_sync'.
 * The TIME rule is checked committed-then-restored: a placement older than the
 * sync clock is ignored by the web AND scoring-service loaders even while its
 * row exists, and one made after it wins. Finally it deletes ONLY the rows it
 * wrote and restores the clock, so the trail holds no test events.
 *
 * The action is gated behind Keycloak + RBAC, so — as in
 * scripts/bench-job-profile-match.ts — `requirePermission`, the tenant cookie
 * and next/cache are stubbed in the require cache before anything imports them.
 * The acting user is the built-in System User, so no users row is minted.
 */
import 'dotenv/config';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const TENANTS = [
  ['mulia', '10000000-0000-0000-0000-000000000001'],
  ['mso', '10000000-0000-0000-0000-000000000002'],
  ['erro', '10000000-0000-0000-0000-000000000003'],
] as const;
let currentTenant: string = TENANTS[0][1];
const WRITE = process.argv.includes('--write');
const SYSTEM = { email: 'system@pulse.local', name: 'System User' };

function stub(spec: string, exports: Record<string, unknown>) {
  const resolved = req.resolve(spec);
  const real = (() => {
    try {
      return req(resolved);
    } catch {
      return {};
    }
  })();
  req.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { ...real, ...exports } } as never;
}

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
}

async function main() {
  try {
    req.cache[req.resolve('server-only')] = { exports: {} } as never;
  } catch {
    /* not installed */
  }
  stub('../lib/rbac.ts', {
    requirePermission: async () => {},
    requirePagePermission: async () => {},
    hasPermission: async () => true,
    getCurrentUserAccess: async () => ({ isAdmin: true, permissions: new Set(), isPending: false }),
  });
  stub('../lib/tenant.ts', {
    getCurrentTenantId: async () => currentTenant,
    getCurrentTenant: async () => ({ id: currentTenant, slug: 'verify', name: 'verify' }),
  });
  stub('../lib/auth.ts', { getCurrentUser: async () => SYSTEM });
  stub('next/cache', { revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f });

  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');
  const { getTalentPoolData } = await import('../lib/talent-pool-data');
  const { getTalentMappingData } = await import('../lib/talent-mapping-data');
  const { applyProgramFilters, listProgramTemplates, loadFilterableCandidates, loadFilterableCandidatesByIds } =
    await import('../lib/programs');
  const { talentMappingGateTree } = await import('../lib/filter-rules');
  const { loadManualHavQuadrants } = await import('../lib/hav-placements');
  const { TALENT_MAPPING_BA_HISTORY_DEPTH } = await import('../lib/talent-mapping');
  const actions = await import('../lib/talent-mapping-actions');
  const rows = async <T,>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;

  // ── READ ─────────────────────────────────────────────────────────────
  for (const [slug, id] of TENANTS) {
    currentTenant = id;
    const [pool, map] = await Promise.all([getTalentPoolData(), getTalentMappingData()]);
    const k = map.counts;
    console.log(`\n[${slug}] pool=${pool.qualified.length}`, k);
    const poolIds = new Set(pool.qualified.map((c) => c.id));
    const mapById = new Map(map.candidates.map((c) => [c.id, c]));
    const inPoolOnMap = new Set(map.candidates.filter((c) => c.inTalentPool).map((c) => c.id));
    check(
      inPoolOnMap.size === poolIds.size && [...poolIds].every((x) => inPoolOnMap.has(x)),
      'ONE HAV: the map\'s "Lolos Talent Pool" set is exactly the Talent Pool list',
      { map: inPoolOnMap.size, pool: poolIds.size },
    );
    check([...poolIds].every((x) => mapById.has(x)), 'the map population contains the whole pool');
    // Recomputed from scratch: the live candidates, the stored Talent Pool tree,
    // the discipline gate — not the loader under test.
    const talent = (await listProgramTemplates(id)).find((t) => t.code === 'talent');
    if (talent) {
      const live = await loadFilterableCandidates(id);
      const gateIds = new Set(
        applyProgramFilters({ filterTree: talentMappingGateTree(talent.filterTree) }, live)
          .filter((d) => d.qualified)
          .map((d) => d.candidateId),
      );
      check(
        gateIds.size === mapById.size && [...gateIds].every((x) => mapById.has(x)),
        'the map population is exactly the live candidates passing the discipline rule',
        { gate: gateIds.size, map: mapById.size },
      );
      check(
        map.gate.excluded + k.population === map.gate.evaluated && map.gate.evaluated === live.length,
        'gate: excluded + population = live candidates',
        map.gate,
      );
    }
    const olderThanClock = await rows<{ candidate_id: string }>(
      sql`SELECT p.candidate_id FROM talent_mapping_placements p JOIN candidates c ON c.id = p.candidate_id
           WHERE p.tenant_id = ${id} AND c.hav_auto_changed_at IS NOT NULL AND p.updated_at <= c.hav_auto_changed_at`,
    );
    check(
      olderThanClock.every((r) => mapById.get(r.candidate_id)?.source !== 'manual'),
      'no placement older than its sync clock is in force',
      olderThanClock,
    );
    const quadrantMismatch = pool.qualified.filter((c) => (mapById.get(c.id)?.quadrant ?? null) !== (c.havQuadrant ? Number(c.havQuadrant) : null));
    check(quadrantMismatch.length === 0, 'the pool list and the map show the same quadrant per person', quadrantMismatch.map((c) => c.id));
    check(k.manual + k.upload + k.formula + k.unplaced === k.population, 'manual + upload + formula + unplaced = population', k);
    check(k.placed === k.manual + k.upload + k.formula, 'placed = manual + upload + formula', k);
    const wrongPrecedence = map.candidates.filter((c) => {
      const expected = c.placement?.quadrant ?? c.uploadedHavQuadrant ?? (c.formula.ok ? c.formula.quadrant : null);
      return c.quadrant !== expected;
    });
    check(wrongPrecedence.length === 0, 'every square follows manual > upload > formula', wrongPrecedence.map((c) => c.id));

    // The work queue's evidence (drizzle/0081 history ∪ current BA; PA outside the window).
    check(
      map.candidates.every((c) => c.behaviorHistory.length <= TALENT_MAPPING_BA_HISTORY_DEPTH),
      `BA history: at most ${TALENT_MAPPING_BA_HISTORY_DEPTH} entries per candidate`,
    );
    const unsorted = map.candidates.filter((c) => {
      const dates = c.behaviorHistory.map((e) => e.date).filter((d): d is string => d != null);
      return dates.some((d, i) => i > 0 && d > dates[i - 1]!);
    });
    check(unsorted.length === 0, 'BA history: newest first', unsorted.map((c) => c.employeeId).slice(0, 5));
    const ref = map.paReferenceYear;
    const inWindow = map.candidates.filter(
      (c) => c.paOutsideWindow && c.paOutsideWindow.year >= ref - 3 && c.paOutsideWindow.year <= ref - 1,
    );
    check(inWindow.length === 0, `"PA outside the window" never names a year inside ${ref - 3}–${ref - 1}`, inWindow.length);
    const disagree = map.candidates.filter(
      (c) => c.behaviorHistory[0]?.label && c.behaviorRecommendation && c.behaviorHistory[0].label !== c.behaviorRecommendation.trim(),
    ).length;
    console.log(
      `  info  newest BA on record differs from the formula's BA for ${disagree} candidate(s) ` +
        `(candidate row older than the sync table, or edited outside the sync)`,
    );
  }

  if (!WRITE) {
    console.log(failures ? `\nFAIL (${failures})` : '\nPASS (read-only; pass --write for the move round trip)');
    process.exit(failures ? 1 : 0);
  }

  // ── WRITE round trip (Mulia) ─────────────────────────────────────────
  currentTenant = TENANTS[0][1];
  const startedAt = new Date(Date.now() - 1000);
  const map = await getTalentMappingData();
  const c =
    map.candidates.find((x) => x.source === 'upload') ?? map.candidates.find((x) => x.source === 'formula');
  const touched: string[] = [];
  const why = 'Verifikasi otomatis Talent Mapping — baris ini dihapus oleh skrip.';
  try {
    if (!c) {
      check(false, 'needs at least one upload- or formula-placed candidate on the Mulia map');
      throw new Error('no candidate');
    }
    touched.push(c.id);
    const from = c.quadrant!;
    const auto = c.automatic;
    const to = [1, 2, 3].find((q) => q !== from)!;
    console.log(`\n[write] candidate ${c.employeeId} (${c.source}): Q${from} → Q${to} → … → back to automatic`);

    const short = await actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: to, justification: 'ok', expectedQuadrant: from });
    check(!short.ok, 'a justification under the minimum is refused', short.message);

    const stale = await actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: to, justification: why, expectedQuadrant: from === 9 ? 10 : 9 });
    check(!stale.ok && stale.data != null, 'a stale view is refused and handed the fresh map', stale.message);

    const moved = await actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: to, justification: why, expectedQuadrant: from });
    const after = moved.data?.candidates.find((x) => x.id === c.id);
    check(moved.ok, 'manual move succeeds', moved.message);
    check(after?.source === 'manual' && after.quadrant === to, 'the map now shows the manual square', after?.quadrant);
    check(
      after?.placement?.baselineQuadrant === auto.quadrant && after?.placement?.baselineSource === auto.source,
      'the placement records the automatic answer it overrode (quadrant AND source)',
      after?.placement,
    );
    check(after?.baselineDrifted === false, 'no drift right after placing');
    check(after?.inTalentPool === c.poolQuadrants.includes(to), 'pool membership follows the new square');

    // Every OTHER reader of the HAV in force.
    const poolNow = await getTalentPoolData();
    const inPoolRow = [...poolNow.qualified, ...poolNow.notQualified].find((x) => x.id === c.id);
    check(inPoolRow?.havQuadrant === String(to) && inPoolRow?.havSource === 'manual', 'Talent Pool reads the manual quadrant');
    check(poolNow.qualified.some((x) => x.id === c.id) === c.poolQuadrants.includes(to), 'Talent Pool membership matches the map');
    const [filterRow] = await loadFilterableCandidatesByIds([c.id]);
    check(filterRow?.havQuadrant === String(to), 'the scoring eligibility loader reads the manual quadrant', filterRow?.havQuadrant);
    const svc = await import('../scoring-service/src/hav-placements');
    const [svcRow] = await svc.withEffectiveHav([
      { id: c.id, havQuadrant: c.uploadedHavQuadrant != null ? String(c.uploadedHavQuadrant) : null, performanceGrade: c.performanceSlots.map((s) => s ?? '').join(','), behaviorRecommendation: c.behaviorRecommendation },
    ]);
    check(svcRow?.havQuadrant === String(to) && svcRow?.havSource === 'manual', 'scoring-service resolves the same quadrant', svcRow);

    const [placement] = await rows<{ quadrant: string; justification: string; placed_by_username: string; baseline_source: string }>(
      sql`SELECT quadrant, justification, placed_by_username, baseline_source FROM talent_mapping_placements WHERE candidate_id = ${c.id}`,
    );
    check(Boolean(placement), 'placement row written');
    check(placement?.placed_by_username === SYSTEM.email, 'placement names the actor', placement?.placed_by_username);
    check(placement?.baseline_source === auto.source, 'baseline_source stored', placement?.baseline_source);

    const noop = await actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: to, justification: why, expectedQuadrant: to });
    check(!noop.ok, 'moving onto the square it already holds is refused', noop.message);

    // Manual → another manual square: the UPDATE path of the conditional write.
    const to2 = [5, 6, 8].find((q) => q !== from && q !== to && q !== auto.quadrant)!;
    const replaced = await actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: to2, justification: why, expectedQuadrant: to });
    const again = replaced.data?.candidates.find((x) => x.id === c.id);
    check(replaced.ok && again?.source === 'manual' && again.quadrant === to2, 'a manual placement can be moved again', replaced.message);

    const reverted = await actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: 'auto', justification: why, expectedQuadrant: to2 });
    const back = reverted.data?.candidates.find((x) => x.id === c.id);
    check(reverted.ok, 'revert to automatic succeeds', reverted.message);
    check(back?.source === auto.source && back.quadrant === auto.quadrant, 'the candidate is back on the automatic square', back);
    const left = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM talent_mapping_placements WHERE candidate_id = ${c.id}`);
    check(left[0]?.n === 0, 'revert DELETES the placement rather than storing one equal to the automatic answer');

    const audit = await rows<{ mapping_kind: string; action: string; justification_reason: string | null; changed_by_username: string | null; new_box: string | null; baseline_source: string | null }>(
      sql`SELECT mapping_kind, action, justification_reason, changed_by_username, new_box, baseline_source
          FROM talent_audit_logs WHERE candidate_id = ${c.id} AND "timestamp" >= ${startedAt.toISOString()}::timestamptz
          ORDER BY "timestamp"`,
    );
    check(audit.length === 3, 'exactly one audit row per saved move (refusals write nothing)', audit.length);
    check(
      audit.every((a) => a.mapping_kind === 'hav16' && a.changed_by_username === SYSTEM.email && a.new_box === null && a.baseline_source === auto.source),
      "rows are 'hav16', name the actor, record the baseline source, leave the 5-Box columns empty",
    );
    check(
      audit[0]?.action === 'manual_place' && audit[1]?.action === 'manual_place' && audit[2]?.action === 'revert_to_automatic',
      'actions are recorded in order',
      audit.map((a) => a.action),
    );

    const history = (await actions.getTalentMappingCandidateHistoryAction(c.id)).filter((h) => new Date(h.timestamp) >= startedAt);
    check(
      history.length === 3 && history[0]?.action === 'revert_to_automatic' && history[0].toQuadrant === auto.quadrant &&
        history[2]?.fromQuadrant === from && history[2].toQuadrant === to && history[2].baselineQuadrant === auto.quadrant &&
        history[2].justification === why,
      'history reads back newest first, with the automatic answer at the time',
      history.map((h) => [h.action, h.fromQuadrant, h.toQuadrant, h.baselineQuadrant]),
    );

    // Two reviewers submitting from the same view at the same moment: the
    // pre-check alone could pass for both, so the conditional write decides.
    const racers = [from === 4 ? 5 : 4, from === 6 ? 8 : 6].filter((q) => q !== auto.quadrant);
    const race = await Promise.all(
      racers.map((t) => actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: t, justification: why, expectedQuadrant: auto.quadrant })),
    );
    check(race.filter((r) => r.ok).length === 1, 'two racing moves from the same view: exactly one wins', race.map((r) => r.message));
    const won = race.find((r) => r.ok)?.data?.candidates.find((x) => x.id === c.id)?.quadrant ?? null;

    // ── HAV upload supersession, inside a transaction that is rolled back ──
    if (won != null) {
      // The app's own pool (lib/db): a dedicated client so BEGIN/ROLLBACK wrap only this block.
      const { pool } = await import('../lib/db');
      const sync = await import('../sync-service/src/services/hav-supersede');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the root project has no @types/pg
      const client: any = await pool.connect();
      try {
        const employeeId = (await client.query(`SELECT employee_id AS e FROM candidates WHERE id = $1`, [c.id])).rows[0]!.e;

        await client.query('BEGIN');
        // Give the NPK a sync_hav row equal to today's upload when it has none
        // (this deployment's test data often does not) — inside the transaction,
        // so it is rolled back with everything else.
        const prior = await client.query(`SELECT quadrant FROM sync_hav WHERE npk = $1`, [employeeId]);
        let currentUpload = prior.rows[0]?.quadrant ?? null;
        if (!currentUpload) {
          currentUpload = String(c.uploadedHavQuadrant ?? 7);
          await client.query(`INSERT INTO sync_hav (npk, nama, quadrant) VALUES ($1, 'verify', $2)`, [employeeId, currentUpload]);
        }
        // Unchanged: re-importing the quadrant sync_hav already holds must not
        // touch the placement — the shared-folder HAV.xlsx is re-read unchanged.
        const same = await sync.detectHavUploadChanges(client, [{ npk: employeeId, quadrant: currentUpload }]);
        check(same.length === 0, 're-importing an unchanged quadrant is not a change', same);
        const next = String([11, 12, 15].find((q) => String(q) !== sync.canonicalHavQuadrant(currentUpload))!);
        const changes = await sync.detectHavUploadChanges(client, [{ npk: employeeId, quadrant: next }]);
        check(changes.length === 1 && changes[0]!.next === next, 'a different quadrant is detected as a change', changes);
        // The sync side reads the candidate row the same way the web does.
        const priorHav = await sync.loadPriorHavInputs(client, currentTenant, [employeeId]);
        const priorAuto = priorHav.get(employeeId) ? sync.automaticHav(priorHav.get(employeeId)!.inputs) : null;
        check(
          priorAuto?.quadrant === c.automatic.quadrant && priorAuto?.source === c.automatic.source,
          'sync-service reads the same automatic HAV the map shows',
          { sync: priorAuto, map: c.automatic },
        );
        const applied = await sync.applyHavUploadChanges(client, changes, 'hav_upload');
        check(applied.placementsSuperseded === 1, 'the changed upload supersedes the older manual placement', applied);
        check(applied.candidatesUpdated >= 1, 'and writes the candidate\'s HAV immediately', applied);
        check(applied.stamped >= 1, 'and timestamps the change', applied);
        const clock = await client.query(
          `SELECT hav_auto_changed_at IS NOT NULL AS stamped, hav_auto_change_source AS origin FROM candidates WHERE id = $1`,
          [c.id],
        );
        check(clock.rows[0]?.stamped === true && clock.rows[0]?.origin === 'hav_upload', 'clock + origin written', clock.rows[0]);
        const tierRow = await client.query(`SELECT hav_auto_tier AS tier FROM candidates WHERE id = $1`, [c.id]).catch(() => null);
        if (tierRow) check(tierRow.rows[0]?.tier === 'upload', 'a HAV upload pins the upload tier (drizzle/0098)', tierRow.rows[0]);
        const inTxn = await client.query(`SELECT count(*)::int AS n FROM talent_mapping_placements WHERE candidate_id = $1`, [c.id]);
        check(inTxn.rows[0]?.n === 0, 'placement deleted inside the transaction');
        const logged = await client.query(
          `SELECT action, changed_by_username, baseline_source FROM talent_audit_logs WHERE candidate_id = $1 ORDER BY "timestamp" DESC LIMIT 1`,
          [c.id],
        );
        check(
          logged.rows[0]?.action === 'superseded_by_upload' &&
            logged.rows[0]?.baseline_source === 'upload' &&
            logged.rows[0]?.changed_by_username === 'sync:hav-upload',
          "logged as 'superseded_by_upload' by the sync",
          logged.rows[0],
        );
        await client.query('ROLLBACK');

        // The candidate sync (PA/BA from MSSQL) supersedes the same way.
        await client.query('BEGIN');
        const viaSync = await sync.recordAutomaticHavChanges(
          client,
          [
            {
              candidateId: c.id,
              tenantId: currentTenant,
              employeeId,
              cause: 'formula',
              before: { quadrant: 6, source: 'formula' },
              after: { quadrant: 3, source: 'formula' },
              tier: 'formula',
            },
          ],
          'candidate_sync',
        );
        check(viaSync.superseded === 1 && viaSync.stamped === 1, 'a candidate-sync change supersedes the older placement', viaSync);
        const tierSync = await client.query(`SELECT hav_auto_tier AS tier FROM candidates WHERE id = $1`, [c.id]).catch(() => null);
        if (tierSync) check(tierSync.rows[0]?.tier === 'formula', 'a PA/BA change pins the formula tier (drizzle/0098)', tierSync.rows[0]);
        const loggedSync = await client.query(
          `SELECT action, changed_by_username FROM talent_audit_logs WHERE candidate_id = $1 ORDER BY "timestamp" DESC LIMIT 1`,
          [c.id],
        );
        check(
          loggedSync.rows[0]?.action === 'superseded_by_sync' && loggedSync.rows[0]?.changed_by_username === 'sync:candidates',
          "logged as 'superseded_by_sync' by the candidate sync",
          loggedSync.rows[0],
        );
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
      const survived = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM talent_mapping_placements WHERE candidate_id = ${c.id}`);
      check(survived[0]?.n === 1, 'the rollback left the placement as it was');

      const undoRace = await actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: 'auto', justification: why, expectedQuadrant: won });
      check(undoRace.ok, 'the race winner reverts cleanly', undoRace.message);
    }

    // ── BA history merge, against real joins (inserted, then deleted) ──
    // The SQL path joins candidates → sync_company_tenant_map → the history table
    // through LPAD(employee_id, 5, '0'); only real rows prove that join.
    {
      const withBa = map.candidates.find((x) => x.behaviorHistory[0]?.date);
      if (withBa) {
        const [key] = await rows<{ company_id: string; npk: string }>(
          sql`SELECT m.company_id, LPAD(c.employee_id, 5, '0') AS npk FROM candidates c
                JOIN sync_company_tenant_map m ON m.tenant_id = c.tenant_id AND m.is_active = true
               WHERE c.id = ${withBa.id} LIMIT 1`,
        );
        const current = withBa.behaviorHistory[0]!;
        const inserted: number[] = [];
        try {
          for (const [rank, date, label] of [
            [1, current.date!, 'VERIFY-SAME-DATE'],
            [2, '2001-02-03', 'VERIFY-OLDER-1'],
            [3, '2000-01-02', 'VERIFY-OLDER-2'],
          ] as const) {
            const [r] = await rows<{ id: number }>(
              sql`INSERT INTO sync_behavior_competency_history (company_id, employee_id, rank, tgl_pelaksanaan, rekomendasi_name)
                  VALUES (${key!.company_id}, ${key!.npk}, ${rank}, ${`${date}T00:00:00Z`}::timestamptz, ${label}) RETURNING id`,
            );
            inserted.push(r!.id);
          }
          const merged = (await getTalentMappingData()).candidates.find((x) => x.id === withBa.id)?.behaviorHistory ?? [];
          check(
            merged.length === 3 &&
              merged[0]!.label === current.label &&
              merged[1]!.label === 'VERIFY-OLDER-1' &&
              merged[2]!.label === 'VERIFY-OLDER-2',
            'history rows join through company + padded NPK; the current BA wins its own date; newest first',
            merged.map((e) => [e.label, e.date]),
          );
        } finally {
          if (inserted.length) {
            await db.execute(
              sql`DELETE FROM sync_behavior_competency_history WHERE id IN (${sql.join(inserted.map((i) => sql`${i}`), sql`, `)})`,
            );
          }
        }
      } else {
        console.log('  skip  no Mulia candidate with a dated BA — history merge not exercised');
      }
    }

    // ── TIME order, committed and then restored ──
    // A placement OLDER than the candidate's sync clock is not in force for any
    // reader, even while its row still exists; a placement made after it is.
    const [clock0] = await rows<{ at: Date | string | null; src: string | null }>(
      sql`SELECT hav_auto_changed_at AS at, hav_auto_change_source AS src FROM candidates WHERE id = ${c.id}`,
    );
    try {
      const old = await actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: to, justification: why, expectedQuadrant: auto.quadrant });
      check(old.ok, 'placement before the sync', old.message);
      // A sync "happens" after it: the clock only — the row is deliberately left,
      // which is the race the read-time comparison exists for.
      await db.execute(
        sql`UPDATE candidates SET hav_auto_changed_at = clock_timestamp(), hav_auto_change_source = 'candidate_sync' WHERE id = ${c.id}`,
      );
      const webManual = await loadManualHavQuadrants([c.id]);
      check(!webManual.has(c.id), 'web: a placement older than the last sync change is not in force');
      const svcLoader = await import('../scoring-service/src/hav-placements');
      const svcManual = await svcLoader.loadManualHavQuadrants([c.id]);
      check(!svcManual.has(c.id), 'scoring-service: a placement older than the last sync change is not in force');
      const shown = (await getTalentMappingData()).candidates.find((x) => x.id === c.id);
      check(
        shown?.source === auto.source && shown.quadrant === auto.quadrant && shown.automaticChangedAt != null,
        'the map shows the automatic HAV and the sync clock',
        shown && { source: shown.source, quadrant: shown.quadrant, at: shown.automaticChangedAt },
      );
      const fresh = await actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: to, justification: why, expectedQuadrant: auto.quadrant });
      const freshRow = fresh.data?.candidates.find((x) => x.id === c.id);
      check(fresh.ok && freshRow?.source === 'manual' && freshRow.quadrant === to, 'a placement made AFTER the sync is in force', fresh.message);
      check((await loadManualHavQuadrants([c.id])).get(c.id) === to, 'web loader agrees');
      check((await svcLoader.loadManualHavQuadrants([c.id])).get(c.id) === to, 'scoring-service loader agrees');
      const undoTime = await actions.moveTalentMappingCandidateAction({ candidateId: c.id, target: 'auto', justification: why, expectedQuadrant: to });
      check(undoTime.ok, 'revert after the time check', undoTime.message);
    } finally {
      await db.execute(
        sql`UPDATE candidates SET hav_auto_changed_at = ${clock0?.at ?? null}::timestamptz, hav_auto_change_source = ${clock0?.src ?? null}
             WHERE id = ${c.id}`,
      );
    }

    // A candidate nothing places can still be placed by hand, and reverting
    // sends them back to "Belum terpetakan".
    const unplaced = map.candidates.find((x) => x.source === 'none');
    if (unplaced) {
      touched.push(unplaced.id);
      const placed = await actions.moveTalentMappingCandidateAction({ candidateId: unplaced.id, target: 9, justification: why, expectedQuadrant: null });
      check(placed.ok && placed.data?.candidates.find((x) => x.id === unplaced.id)?.quadrant === 9, 'an unplaced candidate can be placed by hand', placed.message);
      const undo = await actions.moveTalentMappingCandidateAction({ candidateId: unplaced.id, target: 'auto', justification: why, expectedQuadrant: 9 });
      const u = undo.data?.candidates.find((x) => x.id === unplaced.id);
      check(undo.ok && u?.source === 'none' && u.quadrant === null, 'reverting them returns them to "Belum terpetakan"', undo.message);
    }
  } finally {
    // Remove only what this run wrote. Placements are already gone after the
    // reverts; deleting them again covers a run that failed halfway.
    if (touched.length) {
      const ids = sql.join(touched.map((t) => sql`${t}::uuid`), sql`, `);
      await db.execute(
        sql`DELETE FROM talent_mapping_placements WHERE candidate_id IN (${ids}) AND placed_by_username = ${SYSTEM.email}
              AND updated_at >= ${startedAt.toISOString()}::timestamptz`,
      );
      const del = await rows<{ id: string }>(
        sql`DELETE FROM talent_audit_logs WHERE candidate_id IN (${ids}) AND mapping_kind = 'hav16'
              AND changed_by_username = ${SYSTEM.email} AND "timestamp" >= ${startedAt.toISOString()}::timestamptz RETURNING id`,
      );
      // audit_log.created_at is a naive WIB timestamp; compare in that zone.
      await db.execute(
        sql`DELETE FROM audit_log WHERE entity_type = 'talent_mapping' AND entity_id IN (${sql.join(
          touched.map((t) => sql`${t}`),
          sql`, `,
        )}) AND created_at >= (${startedAt.toISOString()}::timestamptz AT TIME ZONE 'Asia/Jakarta')`,
      );
      console.log(`\n[cleanup] removed ${del.length} test audit row(s) and their audit_log entries`);
    }
  }

  console.log(failures ? `\nFAIL (${failures})` : '\nPASS');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
