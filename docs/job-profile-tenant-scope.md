# Job Profile Documents: Tenant Scoping

How a job-profile PDF becomes the property of a business unit, what that
ownership does and does not affect, and the runbook for a new document folder or
a new tenant.

## The rule in one line

**Ownership scopes what is DISPLAYED. It never scopes scoring.**

The Job Profiles page, Job Family, and job-profile match results show only the
documents belonging to the tenant currently selected in the switcher. The scoring
engine (AHP + TOPSIS, the only one since the LLM "AI Tournament" was removed)
reads the whole corpus regardless, because a scoring run may pull candidates
from other business units and they must be scored on the same basis.

## Where ownership comes from

Nothing is inferred from the folder NAME. That guesswork existed once and was
wrong — the share folder called `mulia` holds positions from every business unit,
which is why the old name-based filtering was removed. Ownership is assigned
directly, per document:

- **Chosen at upload time** — the Sinkronisasi → Job Profile upload has an
  optional tenant checklist. It travels with the file as a `<path>.tenants.json`
  sidecar and is applied the moment the sync ingests the document (see
  `applyPendingTenantSidecar` in `sync-service/src/services/job-profile-sync.ts`).
- **Set or changed on the Job Profiles page** — every document card, table row,
  and the detail dialog carry a tenant-assignment control (`setJobProfileTenantsAction`,
  `lib/job-profile-tenant-actions.ts`). This is the ONLY path for documents
  ingested from the shared network folder, which has no upload-time moment at
  all — they start unassigned and get assigned here, whenever someone gets to it.

There used to be an intermediate step here: an admin-editable `(folder,
tenant_id)` mapping table (`job_profile_folder_map`), reconciled into ownership
by a sync-time job. It was removed in `drizzle/0055_drop_job_profile_folder_map.sql`
once it became clear that, in practice, every real share folder mapped 1:1 to a
tenant of the same name — the mapping added a "go register this folder in Tata
Kelola first" step for an answer that was already known the moment the document
existed. If you're reading an old commit or a stale mental model that still
mentions "Pemetaan Folder", that's what it refers to.

| Table | Role |
|---|---|
| `sync_job_profiles.source_folder` | The subfolder a PDF was found in, recorded verbatim by the sync. Display metadata only — carries no tenant meaning. |
| `job_profile_tenants` | `(job_profile_id, tenant_id, source)` — resolved per-document ownership, written directly by the two paths above. `source` no longer varies in practice (always `'manual'`); it is kept for schema stability. |

Schema lives in `lib/db/schema.ts`.

### Visibility rule

Implemented in `lib/job-profile-tenant-scope.ts` (and mirrored in Python at
`topic-service/app/db.py: visible_job_profile_ids`):

```
visible(profile, tenant) =
     the profile has a row for this tenant      -- assigned to us
  OR the profile has no rows at all             -- not assigned yet
```

The second clause is deliberate: a document nobody has assigned yet keeps
showing to everyone, exactly as before this feature existed, rather than making
it vanish. Those documents are flagged — a "belum dipetakan" badge next to the
tenant-assignment control on the Job Profiles page — so the gap is visible
instead of silent.

Once a document IS assigned, it's scoped and other units stop seeing it.
Assigning is therefore the moment visibility narrows, not the sync.

## What is NOT scoped, and why

Three things stay deliberately global. Changing any of them looks like a
consistency fix and is actually a correctness bug:

1. **The embedding corpus.** `rebuildJobProfileEmbeddingsAction` /
   `startRebuildAction` re-embed every completed profile — all of them, changed
   or not — and delete the vectors whose source document is gone from
   `sync_job_profiles`. `job_profile_embed` is what the scoring engines compare
   candidates against; scoping it would let whichever business unit last pressed
   "Bangun Ulang Job Profile" decide what the others can be scored against.
   That cuts both ways now the rebuild prunes: a tenant-scoped rebuild would
   read one unit's documents and delete every other unit's vectors as
   "orphaned". If the scope is ever applied here, the prune must be dropped in
   the same change.

2. **`scoring-service/src/ahp-topsis-engine.ts`.** Every corpus read there —
   `sync_job_profiles`, `job_profile_embed`, `job_family_matches`,
   `sync_technical_competencies`, `kamus_kompetensi_level_embed` — is unfiltered.
   Applying the display scope would not merely narrow the evidence: a candidate
   with no visible job-profile history scores nothing on career/technical, and
   the engine responds by DROPPING the criterion and redistributing its AHP
   weight. Rankings would change meaning depending on who was logged in.

3. **Cross-tenant candidate pools.** Selecting extra business units for a
   scoring run (`includedTenantIds` in `lib/scoring-engine.ts`) is unaffected by
   document ownership and continues to work as before.

The tenant boundary for scoring is enforced exactly once, at pool construction in
the web app. Everything downstream trusts the candidate id list.

## Runbook A — a new document for an existing business unit

Operational only; no code change, no deploy. Two ways in:

### Via upload (recommended when you have the PDF in hand)

1. Sinkronisasi → Job Profile → pick the file(s), tick the owning business
   unit(s) in the tenant checklist (or leave it blank to stay visible to
   everyone), upload.
2. The upload triggers ingestion automatically. Ownership is applied the moment
   the document exists — no separate step, no detour through another page.

### Via the shared network folder (bulk / IT-managed drops)

1. **Drop the PDFs into the share**, e.g. `<LOCAL_PDF_FOLDER>/MSO/`. The
   subfolder name is free-form and purely cosmetic now — it's recorded as
   `source_folder` for browsing/filtering, but decides nothing about ownership.

2. **Run the job-profile sync.** Any trigger works:

   ```bash
   cd sync-service && npm run cli -- job-profiles   # CLI
   ```

   or the button on the Sinkronisasi page, or `POST /sync/job-profiles`, or wait
   for the weekly cron. `--force` is not needed; new files are always processed.

   Each PDF goes through PDF→PNG→vision-LLM extraction, so a large batch takes a
   while. There is no folder to register and nothing to wait on afterward — the
   documents land unassigned (visible to everyone) and stay that way until
   step 3.

3. **Assign the tenant(s)** on the Job Profiles page — click the tenant control
   on the card, row, or detail dialog, tick the business unit(s), save. Takes
   effect immediately; no re-sync required. Until this step, the new documents
   are visible to every tenant. That is the intended fallback, not a bug.

4. **Rebuild embeddings** — Job Family → Configuration → "Bangun Ulang
   Embedding". Required, and intentionally global: without it the new documents
   exist for neither the Family Tree nor career scoring.

5. **Run Job Profile Match** (`/job-family/sync`) so the unit's candidates are
   linked to the new documents. This populates `job_family_matches`, which is
   what makes incumbents appear under a job family.

6. **Topic modeling**, if needed. A global run remains the sensible default. A
   tenant-scoped run only makes sense once the unit has a substantial corpus of
   its own — BERTopic parameters tuned for hundreds of documents will bucket most
   of a 30-document corpus as outliers. `startTopicRunAction` refuses to start a
   run with fewer than 2 visible documents and says which assignment to check.

## Runbook B — a genuinely new business unit (4th tenant)

**This requires a code change and a deploy.** The tenant list is hardcoded in
`lib/tenant.ts` (`TENANTS`), with UUIDs that must match rows in the `tenants`
table. It is used as an allowlist in several places, including cross-tenant
validation in scoring and in `setJobProfileTenantsAction` — a tenant id absent
from it is rejected.

1. `INSERT` the tenant row (id, slug, name) into `tenants`. See
   `scripts/seed.ts` for the shape of the existing three.
2. Add the matching entry to `TENANTS` in `lib/tenant.ts` and deploy the web app.
   Without this the unit never appears in the switcher, the upload tenant
   checklist, or the Job Profiles page's assignment control.
3. Add a `sync_company_tenant_map` row (MSSQL `company_id` → `tenant_id`), or the
   unit's employees and candidates will never sync.
4. Continue with Runbook A.

Making tenants pure configuration (reading `TENANTS` from the database) is a
separate refactor: it turns a synchronous constant into an async lookup at every
call site.

## Topic run scoping

`job_family_topic_runs.tenant_id` is nullable:

- **NULL = global run** over the whole corpus. Every run created before this
  feature is one of these.
- **Non-null = tenant run** over that tenant's documents only.

Readers (`getLatestTopicRunAction`, `getTopicRunStatusAction`) see global runs
plus their own tenant's, newest first — a stale tenant run does not shadow a
global rebuild that happened afterwards, and another unit's run reads as "not
found".

When a global run is viewed, its topics are filtered down to the documents the
active tenant owns: families with no visible member are dropped, and each card's
size shows the visible member count rather than the stored cluster size. The
run-level total stays on `TopicRunSummary.numDocuments`.

`job_family_topic_configs.tenant_id` is nullable for the same reason — a small
unit needs its own `min_cluster_size` / `n_neighbors`.

Concurrency: `topic-service` blocks a new run only within its own scope, plus
global runs which block everything (they cluster the whole corpus). Before this,
a single run stuck in `processing` after a crash blocked topic modeling for every
business unit indefinitely. Actual parallelism is still serialized by the
in-process `_run_lock`, since UMAP/HDBSCAN are memory-heavy.

## Gotchas

- **Ownership and vectors can live in different databases.** `job_profile_embed`
  follows `VECTOR_DATABASE_URL`, which may not be the main database, so
  `job_profile_tenants` cannot be SQL-joined against it. Every filter across that
  boundary passes an id list instead — keep it that way.

- **An upload's tenant sidecar is consumed exactly once, whenever ingestion
  reaches it.** If the upload store's PDF sits unsynced for a while (share
  unreachable, a run failing partway), the `<path>.tenants.json` file sits right
  next to it and is applied the moment `syncJobProfiles` actually processes
  that file — immediately, or on the next scheduled run, whichever comes
  first. It's read-and-deleted regardless of outcome, so a malformed sidecar
  cannot get stuck retrying forever; it's just silently dropped (logged).

- **A document with an invalid or since-deleted tenant id in its sidecar
  degrades to unassigned for that id, not to a failure.** The foreign key does
  the validating; a bad id's own `INSERT` fails and is logged, the rest of the
  sidecar's ids (if any) still apply.

- **Un-assigning a document re-exposes it to everyone**, because zero rows
  means "not assigned", not "owned by nobody". To hide a document from every
  unit, delete the document.

- **The SharePoint story in `sync-service/README.md` was historical.** There is no
  SharePoint client in the codebase; ingestion reads a local/UNC/CIFS-mounted path
  from `LOCAL_PDF_FOLDER` (with `LOCAL_PDF_USERNAME` / `LOCAL_PDF_PASSWORD` /
  `LOCAL_PDF_DOMAIN` for share credentials on Windows).
