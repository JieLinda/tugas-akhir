import type { PoolClient } from "pg";
import { config } from "../config.js";
import { sealValue, tryOpen, type WriteMode } from "./crypto.js";
import { canonicalQuadrant } from "./hav-effective.js";
import {
  automaticHav,
  havUploadEvent,
  type AutomaticHav,
  type AutomaticSource,
  type AutomaticTier,
  type HavInputs,
} from "./hav-order.js";

export { automaticHav, type AutomaticHav, type HavInputs } from "./hav-order.js";

/**
 * The ORDER of sync and manual HAV events (docs/talent-mapping.md § "Urutan
 * waktu: sync vs manual").
 *
 * The HAV in force is a Talent Mapping placement when one stands, else the
 * AUTOMATIC answer: the HAV upload, else the formula (PA × behavioural
 * assessment). HR's rule for time is "whichever happened LAST wins":
 *
 *   - a placement made after a sync stands;
 *   - a sync that CHANGES somebody's automatic HAV after their placement
 *     replaces it — and that sync is not only the HAV Excel (uploaded on
 *     Sinkronisasi any day of the week, or HAV.xlsx in the shared folder): PA
 *     and BA arrive from the MSSQL syncs, and the candidate sync that carries
 *     them into the candidate row moves the formula too;
 *   - somebody a sync does not change keeps whatever they had.
 *
 * Precedence alone cannot say "last one wins", so both sides carry a clock:
 * `talent_mapping_placements.updated_at` and `candidates.hav_auto_changed_at`
 * (drizzle/0080), written here, inside the caller's transaction, together with
 * the data change that moved it. A placement is in force only while it is
 * NEWER than the clock — readers compare the two (web lib/hav-placements.ts,
 * scoring-service hav-placements.ts) — and this module also deletes the older
 * placement and logs it, so the state table holds only placements in force and
 * the trail holds every event, sync and manual, in order.
 *
 * Every timestamp is the DATABASE's `now()` (this transaction's start), never a
 * process clock, because placements are stamped by the database too and the
 * two are compared.
 *
 * Since drizzle/0098 an event also says WHICH automatic tier it put in force
 * (`candidates.hav_auto_tier`): a PA/BA change pins the formula over an older
 * upload, a differing HAV upload pins the upload back (hav-order.ts).
 */

/** The sync-side origins; the web app adds 'candidate_edit' and 'hav_formula'. */
export type HavAutoChangeOrigin = "hav_upload" | "hav_folder" | "candidate_sync" | "pa_ba_upload";

export type AutomaticHavChange = {
  candidateId: string;
  tenantId: string;
  employeeId: string;
  cause: "upload" | "formula";
  before: AutomaticHav;
  after: AutomaticHav;
  /** The automatic tier this event puts in force. */
  tier: AutomaticTier;
};

export type HavChangeRecordResult = {
  /** Candidate rows whose `hav_auto_changed_at` moved. */
  stamped: number;
  /** Hand placements that were older than the change and stopped applying. */
  superseded: number;
};

const ORIGIN_ACTOR: Record<HavAutoChangeOrigin, string> = {
  hav_upload: "sync:hav-upload",
  hav_folder: "sync:hav-folder",
  candidate_sync: "sync:candidates",
  pa_ba_upload: "sync:pa-ba-upload",
};

const ORIGIN_LABEL: Record<HavAutoChangeOrigin, string> = {
  hav_upload: "Upload HAV",
  hav_folder: "Sync HAV (HAV.xlsx folder bersama)",
  candidate_sync: "Sync Kandidat",
  pa_ba_upload: "Upload PA/BA",
};

const SOURCE_LABEL: Record<AutomaticSource, string> = {
  upload: "upload HAV",
  formula: "rumus PA × BA",
  none: "belum ada",
};

function describeAutomatic(hav: AutomaticHav): string {
  return hav.quadrant != null ? `Q${hav.quadrant} (${SOURCE_LABEL[hav.source]})` : "belum ada";
}

/** The sentence stored (sealed) as the trail row's reason. */
function describeChange(origin: HavAutoChangeOrigin, change: AutomaticHavChange, displaced: string | null): string {
  const what =
    change.cause === "upload"
      ? "nilai upload HAV kandidat ini"
      : origin === "pa_ba_upload"
        ? "PA/BA kandidat ini (dari upload Excel), sehingga rumus PA × BA berlaku"
        : "PA/BA kandidat ini (dari sync), sehingga rumus PA × BA berlaku";
  const head =
    `${ORIGIN_LABEL[origin]} mengubah ${what}: HAV otomatis ` +
    `${describeAutomatic(change.before)} → ${describeAutomatic(change.after)}.`;
  if (displaced == null) return `${head} Tidak ada penempatan manual yang tergantikan.`;
  return (
    `${head} Perubahan ini terjadi SETELAH penempatan manual ${displaced}, dan menurut aturan ` +
    `urutan waktu yang terbaru yang berlaku — penempatan manual itu digantikan.`
  );
}

let warnedNoClock = false;
let warnedNoTier = false;

/** Which of the HAV-order schema pieces exist — every writer degrades without them. */
export async function havSchemaShape(
  client: PoolClient,
): Promise<{ placements: boolean; clock: boolean; tier: boolean }> {
  const shape = await client.query<{ placements: boolean; clock: boolean; tier: boolean }>(
    `SELECT to_regclass('public.talent_mapping_placements') IS NOT NULL AS placements,
            EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'candidates'
                 AND column_name = 'hav_auto_changed_at'
            ) AS clock,
            EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'candidates'
                 AND column_name = 'hav_auto_tier'
            ) AS tier`,
  );
  return shape.rows[0] ?? { placements: false, clock: false, tier: false };
}

/**
 * Stamp, supersede and log the given automatic-HAV changes — in the caller's
 * transaction, so they commit or roll back with the write that caused them.
 *
 * Degrades when the schema is behind the code: without drizzle/0080 there is no
 * clock to stamp (readers then cannot compare either, and fall back to
 * precedence), and without drizzle/0078 there is no placement to supersede.
 */
export async function recordAutomaticHavChanges(
  client: PoolClient,
  changes: AutomaticHavChange[],
  writeMode: WriteMode,
  origin: HavAutoChangeOrigin,
): Promise<HavChangeRecordResult> {
  if (changes.length === 0) return { stamped: 0, superseded: 0 };
  const ids = changes.map((c) => c.candidateId);

  const { placements: hasPlacements, clock: hasClock, tier: hasTier } = await havSchemaShape(client);

  let stamped = 0;
  if (hasClock) {
    const res = await client.query(
      `UPDATE candidates
          SET hav_auto_changed_at = now(), hav_auto_change_source = $2
        WHERE id = ANY($1::uuid[])`,
      [ids, origin],
    );
    stamped = res.rowCount ?? 0;
    if (hasTier) {
      await client.query(
        `UPDATE candidates AS c SET hav_auto_tier = v.tier
           FROM UNNEST($1::uuid[], $2::text[]) AS v(id, tier)
          WHERE c.id = v.id`,
        [ids, changes.map((c) => c.tier)],
      );
    } else if (!warnedNoTier) {
      console.warn("[HAV] candidates.hav_auto_tier missing (drizzle/0098 not applied); a PA/BA change cannot outrank an upload");
      warnedNoTier = true;
    }
  } else if (!warnedNoClock) {
    console.warn("[HAV] candidates.hav_auto_changed_at missing (drizzle/0080 not applied); sync events are not timestamped");
    warnedNoClock = true;
  }

  // Every placement of these candidates that is NOT newer than this
  // transaction. `<=` is the exact complement of the readers' strict `>`: a
  // placement that is not newer than the clock is not in force, so it goes.
  const displacedBy = new Map<string, string>();
  if (hasPlacements) {
    const removed = await client.query<{ candidateId: string; quadrant: string }>(
      `DELETE FROM talent_mapping_placements
        WHERE candidate_id = ANY($1::uuid[]) AND updated_at <= now()
        RETURNING candidate_id AS "candidateId", quadrant`,
      [ids],
    );
    for (const row of removed.rows) displacedBy.set(row.candidateId, row.quadrant);
  }

  // One trail row per change, superseding or not, so the trail shows every sync
  // event between the manual ones. Sealed like the rest of the 'hav16' rows; the
  // displaced placement's quadrant is copied as stored, never opened.
  const cols = {
    tenant: [] as string[],
    employee: [] as string[],
    candidate: [] as string[],
    action: [] as string[],
    oldQ: [] as (string | null)[],
    newQ: [] as (string | null)[],
    baselineSource: [] as string[],
    why: [] as (string | null)[],
  };
  for (const change of changes) {
    const displacedSealed = displacedBy.get(change.candidateId) ?? null;
    // A PA/BA re-read that moved nothing visible (same square, same source, no
    // placement displaced) is stamped but not logged: the trail is for events a
    // reader can see on the map, and a new PA semester in the same band is not.
    if (
      displacedSealed == null &&
      change.before.quadrant === change.after.quadrant &&
      change.before.source === change.after.source
    ) {
      continue;
    }
    const displacedOpen = displacedSealed != null ? canonicalQuadrant(tryOpen(displacedSealed)) : null;
    const displacedLabel = displacedSealed == null ? null : displacedOpen != null ? `Q${displacedOpen}` : "(tidak terbaca)";
    cols.tenant.push(change.tenantId);
    cols.employee.push((change.employeeId ?? "").slice(0, 20));
    cols.candidate.push(change.candidateId);
    cols.action.push(
      displacedSealed == null
        ? "automatic_changed"
        : origin === "candidate_sync" || origin === "pa_ba_upload"
          ? "superseded_by_sync"
          : "superseded_by_upload",
    );
    cols.oldQ.push(
      displacedSealed ?? sealValue(writeMode, change.before.quadrant != null ? String(change.before.quadrant) : null),
    );
    cols.newQ.push(sealValue(writeMode, change.after.quadrant != null ? String(change.after.quadrant) : null));
    cols.baselineSource.push(change.after.source);
    cols.why.push(sealValue(writeMode, describeChange(origin, change, displacedLabel)));
  }

  if (cols.candidate.length === 0) return { stamped, superseded: displacedBy.size };
  await client.query(
    `INSERT INTO talent_audit_logs
       (tenant_id, employee_id, candidate_id, mapping_kind, action,
        old_quadrant, new_quadrant, baseline_quadrant, baseline_source,
        justification_reason, changed_by_user_id, changed_by_username)
     SELECT v.tenant_id, v.employee_id, v.candidate_id, 'hav16', v.action,
            v.old_q, v.new_q, v.new_q, v.baseline_source,
            v.why, $9::uuid, $10
       FROM UNNEST($1::uuid[], $2::text[], $3::uuid[], $4::text[], $5::text[],
                   $6::text[], $7::text[], $8::text[])
         AS v(tenant_id, employee_id, candidate_id, action, old_q, new_q, baseline_source, why)`,
    [
      cols.tenant,
      cols.employee,
      cols.candidate,
      cols.action,
      cols.oldQ,
      cols.newQ,
      cols.baselineSource,
      cols.why,
      config.syncSystemUserId || null,
      ORIGIN_ACTOR[origin],
    ],
  );

  return { stamped, superseded: displacedBy.size };
}

/**
 * The HAV inputs of these employees' candidate rows in one tenant, decrypted
 * and LOCKED (`FOR UPDATE`) until the caller's transaction ends — read before a
 * write overwrites them, which is the only moment "what did this change" can be
 * answered. Tombstoned rows are included: a bulk-cleared candidate can still
 * hold a placement, and the sync is what brings them back.
 */
export async function loadPriorHavInputs(
  client: PoolClient,
  tenantId: string,
  employeeIds: string[],
): Promise<Map<string, { candidateId: string; inputs: HavInputs }>> {
  const out = new Map<string, { candidateId: string; inputs: HavInputs }>();
  if (employeeIds.length === 0) return out;
  // Checked, not caught: an undefined-column error would abort the caller's
  // transaction along with this read.
  const { tier: hasTier } = await havSchemaShape(client);
  const rows = await client.query<{
    id: string;
    employee_id: string;
    hav_quadrant: string | null;
    performance_grade: string | null;
    behavior_recommendation: string | null;
    hav_auto_tier: string | null;
  }>(
    `SELECT id, employee_id, hav_quadrant, performance_grade, behavior_recommendation,
            ${hasTier ? "hav_auto_tier" : "NULL::text AS hav_auto_tier"}
       FROM candidates
      WHERE tenant_id = $1 AND employee_id = ANY($2::text[])
      ORDER BY id
        FOR UPDATE`,
    [tenantId, employeeIds],
  );
  for (const row of rows.rows) {
    out.set(row.employee_id, {
      candidateId: row.id,
      inputs: {
        upload: canonicalHavQuadrant(tryOpen(row.hav_quadrant)),
        performanceGrade: tryOpen(row.performance_grade),
        behaviorRecommendation: tryOpen(row.behavior_recommendation),
        tier: asTier(row.hav_auto_tier),
      },
    });
  }
  return out;
}

function asTier(raw: string | null | undefined): AutomaticTier | null {
  return raw === "formula" || raw === "upload" ? raw : null;
}

/**
 * Manual placements IN FORCE for these candidates (newer than their clock),
 * opened. The same predicate as the readers (web lib/hav-placements.ts,
 * scoring-service hav-placements.ts). Needed by a HAV upload made in the app,
 * which counts as an event when it differs from the HAV in force.
 */
async function loadPlacementsInForce(
  client: PoolClient,
  candidateIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (candidateIds.length === 0) return out;
  const { placements: hasPlacements, clock: hasClock } = await havSchemaShape(client);
  if (!hasPlacements) return out;
  const rows = await client.query<{ candidateId: string; quadrant: string }>(
    `SELECT p.candidate_id AS "candidateId", p.quadrant
       FROM talent_mapping_placements p
       JOIN candidates c ON c.id = p.candidate_id
      WHERE p.candidate_id = ANY($1::uuid[])
        ${hasClock ? "AND (c.hav_auto_changed_at IS NULL OR p.updated_at > c.hav_auto_changed_at)" : ""}`,
    [candidateIds],
  );
  for (const row of rows.rows) {
    const q = canonicalQuadrant(tryOpen(row.quadrant));
    if (q != null) out.set(row.candidateId, q);
  }
  return out;
}

// ── HAV Excel (upload or shared HAV.xlsx) ───────────────────────────────────

export type HavUploadChange = { npk: string; previous: string | null; next: string };

export type HavUploadApplyResult = {
  /** Candidate rows whose HAV upload value was written. */
  candidatesUpdated: number;
  /** Candidate rows whose HAV event was recorded (clock + tier). */
  stamped: number;
  placementsSuperseded: number;
};

/** Canonical "1".."16" from any stored form ("6", "Kuadran #6"), else null. */
export function canonicalHavQuadrant(raw: string | null | undefined): string | null {
  const n = canonicalQuadrant(raw ?? null);
  return n != null ? String(n) : null;
}

/**
 * The rows of an incoming workbook to consider, given what sync_hav holds now.
 * Last row wins for a repeated NPK, as the upsert would.
 *
 * By default only the rows whose quadrant CHANGED against sync_hav: the
 * shared-folder HAV.xlsx is re-imported unchanged every week, and treating
 * every row in it as an update would void every hand placement and every PA/BA
 * edit on each run. `includeUnchanged` (an upload made in the app) returns every
 * row, because there a value equal to the old sheet still counts when it
 * differs from the candidate's HAV in force (hav-order.ts havUploadEvent).
 */
export async function detectHavUploadChanges(
  client: PoolClient,
  incoming: { npk: string; quadrant: string | null }[],
  opts: { includeUnchanged?: boolean } = {},
): Promise<HavUploadChange[]> {
  const latest = new Map<string, string>();
  for (const row of incoming) {
    const q = canonicalHavQuadrant(row.quadrant);
    if (row.npk && q) latest.set(row.npk, q);
  }
  if (latest.size === 0) return [];
  const prior = await client.query<{ npk: string; quadrant: string | null }>(
    `SELECT npk, quadrant FROM sync_hav WHERE npk = ANY($1::text[])`,
    [Array.from(latest.keys())],
  );
  const before = new Map(prior.rows.map((r) => [r.npk, canonicalHavQuadrant(r.quadrant)]));
  const changes: HavUploadChange[] = [];
  for (const [npk, next] of latest) {
    const previous = before.get(npk) ?? null;
    if (opts.includeUnchanged || previous !== next) changes.push({ npk, previous, next });
  }
  return changes;
}

/**
 * Apply a HAV workbook to the candidate rows RIGHT AWAY — any day, not only on
 * the Monday cron: candidates.hav_quadrant is otherwise copied only by
 * candidate-populate, and an upload that takes a week to show is an upload
 * nobody believes happened. Then stamp, pin the upload tier, supersede and log
 * through `recordAutomaticHavChanges`.
 *
 * Which rows are events is havUploadEvent's rule: the candidate's stored upload
 * changed, or — for an upload made in the app (`hav_upload`) — the value differs
 * from the candidate's HAV in force (a placement or a formula pinned by a PA/BA
 * change included). A candidate for whom neither holds is left alone.
 *
 * Matching is `candidates.employee_id = npk` across every business unit,
 * exactly the join candidate-populate uses, so the two writers can never
 * disagree about who a row belongs to.
 */
export async function applyHavUploadChanges(
  client: PoolClient,
  changes: HavUploadChange[],
  writeMode: WriteMode,
  origin: Extract<HavAutoChangeOrigin, "hav_upload" | "hav_folder">,
): Promise<HavUploadApplyResult> {
  if (changes.length === 0) return { candidatesUpdated: 0, stamped: 0, placementsSuperseded: 0 };

  const { tier: hasTier } = await havSchemaShape(client);
  const nextByNpk = new Map(changes.map((c) => [c.npk, c.next]));
  const rows = await client.query<{
    id: string;
    tenant_id: string;
    employee_id: string;
    hav_quadrant: string | null;
    performance_grade: string | null;
    behavior_recommendation: string | null;
    hav_auto_tier: string | null;
  }>(
    `SELECT id, tenant_id, employee_id, hav_quadrant, performance_grade, behavior_recommendation,
            ${hasTier ? "hav_auto_tier" : "NULL::text AS hav_auto_tier"}
       FROM candidates
      WHERE employee_id = ANY($1::text[])
      ORDER BY id
        FOR UPDATE`,
    [Array.from(nextByNpk.keys())],
  );
  const manual = await loadPlacementsInForce(client, rows.rows.map((r) => r.id));

  const events: AutomaticHavChange[] = [];
  const toWrite: { id: string; next: string }[] = [];
  for (const row of rows.rows) {
    const next = nextByNpk.get(row.employee_id);
    if (!next) continue;
    const before: HavInputs = {
      upload: canonicalHavQuadrant(tryOpen(row.hav_quadrant)),
      performanceGrade: tryOpen(row.performance_grade),
      behaviorRecommendation: tryOpen(row.behavior_recommendation),
      tier: asTier(row.hav_auto_tier),
    };
    const inForce = manual.get(row.id) ?? automaticHav(before).quadrant;
    const event = havUploadEvent(before, next, { inForce, againstInForce: origin === "hav_upload" });
    if (before.upload !== next) toWrite.push({ id: row.id, next });
    if (!event.changed) continue;
    events.push({
      candidateId: row.id,
      tenantId: row.tenant_id,
      employeeId: row.employee_id,
      cause: event.cause,
      // What a reader saw before: the placement when one stood.
      before: manual.has(row.id) ? { quadrant: manual.get(row.id)!, source: event.before.source } : event.before,
      after: event.after,
      tier: event.tier,
    });
  }

  let candidatesUpdated = 0;
  if (toWrite.length > 0) {
    // One seal per row. sealValue throws while locked — the caller's
    // transaction then rolls the whole upload back rather than applying half.
    const updated = await client.query(
      `UPDATE candidates AS c
          SET hav_quadrant = v.q, updated_at = now()
         FROM UNNEST($1::uuid[], $2::text[]) AS v(id, q)
        WHERE c.id = v.id`,
      [toWrite.map((w) => w.id), toWrite.map((w) => sealValue(writeMode, w.next))],
    );
    candidatesUpdated = updated.rowCount ?? 0;
  }

  const recorded = await recordAutomaticHavChanges(client, events, writeMode, origin);
  return {
    candidatesUpdated,
    stamped: recorded.stamped,
    placementsSuperseded: recorded.superseded,
  };
}
