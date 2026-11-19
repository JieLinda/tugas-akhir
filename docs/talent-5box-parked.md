# Talent Matrix 5-Box (`/talent`) — parked on a branch

`/talent` was a throwaway prototype. It is **deleted from `main`** and preserved
on the branch **`parked/talent-5box`** (pushed to `origin`).

```bash
git show parked/talent-5box:lib/talent-actions.ts     # read one file
git checkout parked/talent-5box                        # get the whole feature back
```

That branch holds the feature in its *parked* state — every file annotated with a
header explaining what it was and how it fit — branched from `main` immediately
before the deletion, so it is a complete working tree, not a patch.

What it computed is documented separately in
[`docs/talent-5box-data-sources.md`](talent-5box-data-sources.md), which stays on
`main` because the numbers it describes are still sitting in the database.

## What it was, and why it had to stop

A digitisation of Talent Management System Stage 1 (data preparation) and Stage 2
(talent data validation): three EDP/SDP source syncs plus a staging build merged
every input per employee into `talent_data_staging`, a rule engine scored
Performance and Potential and placed each person in one of five boxes, and a
Talent Matrix page let HC and division heads override that placement with a
mandatory justification, audited in `talent_audit_logs`.

It was not merely an unvisited page. Four sync jobs ran on the **Monday 01:00
cron** (`sync-service/src/scheduler.ts` → `runFullSync`), writing six tables
weekly and spending four MSSQL round trips on EDP/SDP sources this deployment may
not even have; and `GET /api/talent/alternates` was a live read path open to
anyone with `candidates.view`.

## What was deleted from `main`

| Path | What |
|---|---|
| `app/(dashboard)/talent/` | the route |
| `app/api/talent/` | Feature C alternate-talent read API |
| `components/talent/` | matrix UI, override modal, quick view, threshold config (7 files) |
| `lib/talent-actions.ts` | server actions |
| `lib/talent-alternates.ts` | alternate-talent ranking |
| `sync-service/src/services/talent-sync.ts` | the three source syncs + staging build |
| `sync-service/src/services/talent-box-engine.ts` | the pure rule engine |

Plus the wiring that called them: four `POST /sync/talent/*` endpoints and the
four `runFullSync` calls (`sync-service/src/routes/sync.ts`), four CLI commands
(`cli.ts`), and four `SyncAllResult` keys (`types.ts`). Each removal site keeps a
short comment naming this document.

Two behavioural notes on that wiring:

- The four CLI names now fall through to `default` and **exit 1** as unknown
  commands. Deliberate: an operator running `npm run cli -- talent-staging` must
  be told the job is gone, not handed a silent success.
- The `SyncAllResult` keys were **dropped**, not left reporting a permanent
  `0/0`. A zero there reads as *"the EDP source was empty this week"*, which is a
  different fact from *"we stopped asking"*.

## What survived on `main`, and why

- **`lib/hav-box-meta.ts` — moved, not deleted.** `BOX_META` (the five box names,
  colours and blurbs) was at `components/talent/box-meta.ts`, but the dashboard's
  HAV 16-quadrant → 5-Box rollup on Beranda reads it. That rollup is a different
  reading that happens to share five names and a palette: it is derived by
  `lib/hav-quadrant-derive.ts` (`talentBoxFromQuadrant`) from PA × behavioural
  competency and never touched `talent_data_staging`, so only the "see more" link
  was downstream of the deleted feature. `boxForLevels()` from the same file went
  with the branch — it mapped *numeric* perf/potential levels to a box and was
  Talent-Matrix-only.
- **The six tables and their Drizzle definitions.** Nothing was dropped and no
  migration was written. The definitions stay in `lib/db/schema.ts` on purpose:
  removing a table from the schema does not drop it, but `drizzle-kit push`
  compares schema against database, so an unmodelled table becomes a DROP
  proposal against real data — and `talent_audit_logs` holds decisions people
  actually made. `drizzle/0055_talent_succession.sql` also stays; deleting an
  applied migration breaks history for anyone rebuilding.
- **`lib/talent-data.ts` — unrelated, despite the name.** Prototype data for
  `PositionSummary` etc., used by `components/analysis/talent-network-map.tsx` and
  `components/dashboard-page-client.tsx`. It predates this feature and shares
  nothing with it but the word "talent". It is also the bulk of the web app's
  ~58 baseline `tsc` errors — don't conflate the two.
- **`lib/agent/registry/{tools,handlers}/talent.ts` was also unrelated** — the
  agent registry's *positions and candidates* domain. It went with
  `parked/agent-studio`, not with this feature.
- **`/talent-pool` is a different, live feature** (`lib/talent-pool-data.ts`,
  `components/talent-pool-page-client.tsx`). It evaluates program filter rules
  over candidates and has no relationship to the 5-Box.
- **`/talent-pool/mapping` (Talent Mapping) is also different — and it made
  `talent_audit_logs` live again.** It places Talent Pool candidates on the HAV
  16-box by PA × behavioural assessment (`lib/hav-quadrant-derive.ts`) and lets a
  reviewer move them, never reading `talent_data_staging`. Its moves are audited
  in `talent_audit_logs` as `mapping_kind = 'hav16'` rows (drizzle/0078), which
  leave `old_box`/`new_box` NULL and seal the quadrants and the justification;
  this prototype's rows are `mapping_kind = 'five_box'`. See
  [`docs/talent-mapping.md`](talent-mapping.md).

## Reviving it

1. `git checkout parked/talent-5box` for the whole thing, or cherry-pick the
   paths in the table above onto a branch off current `main`.
2. Expect **three merge conflicts** against later `main`: `components/sidebar-nav.tsx`
   (nav entry removed), `components/dashboard-page-client.tsx` (link removed, and
   `BOX_META` now imported from `@/lib/hav-box-meta`), and the three sync-service
   wiring files. Take main's side and re-add the entries.
3. `BOX_META` moved. Either import it from `@/lib/hav-box-meta` in
   `five-box-matrix.tsx` / `employee-card.tsx`, or restore
   `components/talent/box-meta.ts` and repoint the dashboard back — **not both**,
   or the dashboard and the matrix will drift.
4. `npx tsc --noEmit` in `sync-service/` must come back at **zero**; that is the
   baseline that deployable holds.
4a. **`talent_audit_logs` is shared now** (Talent Mapping, drizzle/0078).
   `getTalentAuditLogsAction` must filter on `mapping_kind = 'five_box'`, or the
   prototype's trail lists the 16-box moves too — with NULL boxes and sealed
   justifications it cannot read. `new_box` is nullable since that migration, so
   the prototype's `TalentAuditEntry.newBox: string` needs `| null`.
   `setTalentBoxAction`'s insert is fine as is: `mapping_kind` defaults to
   `'five_box'`.
5. Run `npm run cli -- talent-staging` before opening the page. The matrix reads
   `talent_data_staging`, and whatever is in there is as old as the last build
   before parking.
