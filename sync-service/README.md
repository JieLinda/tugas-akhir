# Pulse Sync Service

Node.js/Express service that synchronises data from multiple sources (MSSQL databases, REST APIs, shared-folder PDFs, and Excel files) into a PostgreSQL database.

## Data Sources & Features

| Source | Type | Data |
|--------|------|------|
| DB MPMDS | MSSQL | Employees, divisions, departments |
| DB MPMHRGA | MSSQL | Performance appraisal history |
| REST API | Token-based | Disciplinary, education & personal information (birth date) |
| Shared folder / upload | PDF files | Job profiles (with LLM extraction) |
| Local Excel | XLSX files | HAV (kuadran/quadrant), MCU (medical status) |

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database and API credentials

# Run development server
npm run dev

# Run CLI commands
npm run cli -- all              # Sync everything
npm run cli -- employees        # Sync employees only
npm run cli -- job-profiles     # Sync job profiles from the shared folder/uploads
npm run cli -- hav              # Sync HAV (quadrant data) from Excel
npm run cli -- mcu              # Sync MCU (medical status) from Excel
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health check |
| `POST` | `/sync/all` | Run all sync jobs sequentially |
| `POST` | `/sync/employees` | Sync employees from DB MPMDS |
| `POST` | `/sync/divisions` | Sync divisions from DB MPMDS |
| `POST` | `/sync/departments` | Sync departments from DB MPMDS |
| `POST` | `/sync/performance` | Sync performance appraisals from DB MPMHRGA |
| `POST` | `/sync/disciplinary` | Sync disciplinary records from API |
| `POST` | `/sync/education` | Sync education records from API |
| `POST` | `/sync/personal` | Sync employee personal information (birth date) from API |
| `POST` | `/sync/candidates` | Derive candidate rows from the `sync_*` tables (`src/services/candidate-populate.ts`). A CHANGED PA or BA (from MSSQL or a PA/BA workbook) is a HAV event whenever the formula can place the candidate afterwards — even under a HAV upload and even when the band is unchanged: it stamps `candidates.hav_auto_changed_at` (origin `candidate_sync`, or `pa_ba_upload` when chained after a PA/BA upload), pins `candidates.hav_auto_tier = 'formula'` (drizzle/0098) and supersedes Talent Mapping placements older than it (`superseded_by_sync`), per batch transaction. A PA (`/sync/performance`) or BA (`/sync/behavior-competencies`) workbook upload runs this job straight after its commit, so the HAV moves the same day. Re-copying an older `sync_hav` value is not an event, and `hav_quadrant` is COALESCEd so a candidate with no `sync_hav` row keeps their HAV |
| `POST` | `/sync/job-profiles` | Sync job profiles from the shared folder / uploaded PDFs |
| `POST` | `/sync/hav` | Sync HAV (quadrant data) from Excel file — an upload applies the moment it lands, any day, not on the next Monday cron. Rows whose quadrant CHANGES — or, for an upload made in the app only, differs from the candidate's HAV in force (a placement or a formula pinned by a PA/BA change) — update `candidates.hav_quadrant` immediately, stamp `candidates.hav_auto_changed_at` (origin `hav_upload` / `hav_folder`), pin `hav_auto_tier = 'upload'`, and supersede every Talent Mapping placement OLDER than that change (`superseded_by_upload`); an unchanged re-read of the shared HAV.xlsx touches nothing. The whole order-of-events rule — whichever of a hand placement and a sync came last wins — is in `src/services/hav-supersede.ts` / `hav-order.ts` and docs/talent-mapping.md § Urutan waktu. Refused whole while encryption is locked |
| `POST` | `/sync/mcu` | Sync MCU (medical status) from Excel file |

## Features

### 1. **Multi-Database Sync**
- MSSQL Server (DB MPMDS & B) for employee and performance data
- REST API integration for disciplinary, education and personal-information records

### 2. **Job Profile Processing**
- **Shared folder ingestion:** PDFs from `LOCAL_PDF_FOLDER` (UNC share, mounted
  CIFS path, or a local directory) plus PDFs uploaded from the web app
- **PDF Extraction:** PDF → PNG → vision LLM, page by page
- **LLM Processing:** Structured data extraction using LLM
- **Database Storage:** Persisted in `sync_job_profiles` table
- **Tenant ownership:** assigned directly — chosen at upload time (applied via a
  `.tenants.json` sidecar the moment the document is ingested) or set per
  document on the web app's Job Profiles page — see
  [`docs/job-profile-tenant-scope.md`](../docs/job-profile-tenant-scope.md)

### 3. **Scheduled Syncing**
- Cron-based automated syncing (default: Monday 1:00 AM). `runFullSync` runs the behavioural-assessment job BEFORE the candidate step, like the personal-info job: the candidate step copies BA onto candidate rows, and BA is half of the HAV formula, so running it after (as it used to) reached the HAV in force a week late
- Manual trigger via HTTP endpoints
- CLI commands for development/testing

### 4. **Error Handling & Retry**
- Automatic retries on network failures
- Detailed error logging
- Transaction support for data consistency

## Project Structure

```
sync-service/
├── src/
│   ├── index.ts              # Express server entry
│   ├── cli.ts                # CLI commands
│   ├── scheduler.ts          # Cron-based scheduled syncs
│   ├── config.ts             # Configuration from .env
│   ├── types.ts              # TypeScript type definitions
│   ├── db/
│   │   ├── index.ts          # PostgreSQL connection pool
│   │   └── schema.ts         # Drizzle ORM schema
│   ├── services/
│   │   ├── network-share.ts  # UNC share connect/credentials (Windows only)
│   │   ├── upload-store.ts   # PDFs uploaded from the web app
│   │   ├── llm-processor.ts  # LLM extraction via LangChain
│   │   ├── job-profile-sync.ts # Main orchestrator + tenant reconciliation
│   │   └── mssql-utils.ts    # MSSQL connection helpers
│   └── routes/
│       └── sync.ts           # HTTP sync endpoints
├── drizzle/                  # Database migrations
├── test-pdfs/                # Test PDFs directory
├── package.json
├── tsconfig.json
├── .env
└── Dockerfile
```

## Configuration

### Environment Variables

```env
# ── PostgreSQL ──
POSTGRES_URL=postgresql://user:pass@localhost:5432/mpm_ai_pulse

# ── MSSQL Databases ──
DB_MPMDS_SERVER=10.x.x.x
DB_MPMDS_PORT=1433
DB_MPMDS_USER=appuser
DB_MPMDS_PASSWORD=password
DB_MPMDS_DATABASE=MPMDS

DB_MPMHRGA_SERVER=10.x.x.x
DB_MPMHRGA_PORT=1433
DB_MPMHRGA_USER=appuser
DB_MPMHRGA_PASSWORD=password
DB_MPMHRGA_DATABASE=MPMHRGA_LIVE

# ── REST API ──
API_BASE_URL=https://api.example.com
API_CLIENT_ID=client_id
API_CLIENT_SECRET=secret

# ── Job Profile PDFs ──
# UNC path on Windows, mounted CIFS path on Linux, or a local dir for testing.
LOCAL_PDF_FOLDER=./test-pdfs
LOCAL_PDF_USERNAME=service.account
LOCAL_PDF_PASSWORD=password
LOCAL_PDF_DOMAIN=DOMAIN

# ── PDFs / Excel uploaded from the web app ──
LOCAL_UPLOAD_FOLDER=uploads

# ── Excel Files (HAV & MCU) ──
LOCAL_HAV_FOLDER=\\\\server\\share\\hav
LOCAL_MCU_FOLDER=\\\\server\\share\\mcu

# ── LLM Processing ──
LLM_BASE_URL=https://models.example.com/v1
LLM_API_KEY=sk-xxxxx
LLM_MODEL=model-name

# ── Scheduling ──
SYNC_CRON_HOUR=1
SYNC_CRON_MINUTE=0
SYNC_CRON_DAY_OF_WEEK=mon
```

## Job Profile Sync: Setup Guide

> **There is no SharePoint client in this codebase.** The `SP_*` variables that
> earlier revisions of this README documented are never read by any code, and
> `src/services/sharepoint.ts` does not exist. Job profile PDFs are read from a
> filesystem path — a UNC share on Windows, a mounted CIFS path on Linux, or a
> local folder for testing. Mentions of "SharePoint" elsewhere in this file are
> historical labels on the same local-folder path.

### 1. Point the service at the folder

```env
# Windows: a UNC path (\\server\share\JobProfiles)
# Linux:   the mounted CIFS path (/mnt/jobprofiles)
# Testing: a relative local path
LOCAL_PDF_FOLDER=./test-pdfs

# Only needed for an authenticated Windows share
LOCAL_PDF_USERNAME=service.account
LOCAL_PDF_PASSWORD=password
LOCAL_PDF_DOMAIN=DOMAIN
```

Share connect/credential handling lives in `src/services/network-share.ts` and is
skipped entirely off Windows. `LOCAL_PDF_FOLDER` may be left unset: PDFs uploaded
from the web app's Sinkronisasi page (`LOCAL_UPLOAD_FOLDER`) are a valid source on
their own.

### 2. Lay out the PDFs

```
test-pdfs/
├── SomeProfile.pdf         ← root-level PDFs are picked up (folder key: "general")
├── MULIA/
│   └── AnotherProfile.pdf
└── MSO/
    └── YetAnother.pdf
```

The base folder AND every subfolder one level down are scanned. The subfolder
name is stored as `sync_job_profiles.source_folder`.

### 3. Run the sync

```bash
npm run cli -- job-profiles            # add --force to re-run LLM extraction
```

Also available as `POST /sync/job-profiles`, as a button on the web app's
Sinkronisasi page, and via the weekly cron.

### 4. Assign each document to a business unit

**The folder name does not determine ownership.** The subfolder is display
metadata only. Ownership (`job_profile_tenants`) is assigned directly: an upload
carries its tenant choice as a `<path>.tenants.json` sidecar, applied the moment
`syncJobProfiles` ingests that file (`applyPendingTenantSidecar` in
`src/services/job-profile-sync.ts`); a document scanned from the shared network
folder has no such moment, so it starts unassigned and is set afterward on the
web app's Job Profiles page.

Unassigned documents stay visible to every tenant until someone assigns them.

This ownership affects **display and analysis only** — the scoring engines read
the whole corpus so that cross-tenant talent search stays comparable. Full
runbook, including adding a new business unit:
[`docs/job-profile-tenant-scope.md`](../docs/job-profile-tenant-scope.md).

## CLI Commands

```bash
# Sync all data sources
npm run cli -- all

# Sync specific modules
npm run cli -- employees
npm run cli -- performance
npm run cli -- candidates
npm run cli -- job-profiles

# Help
npm run cli -- --help
```

## Database

### Schema

Main tables:
- `employees` - Employee master data
- `divisions` - Organizational divisions
- `departments` - Organization departments
- `performance_appraisals` - Performance history
- `disciplinary_records` - Disciplinary actions
- `education_records` - Education/training records
- `sync_employee_personal` - Birth date per employee (source of candidate age)
- `candidates` - Recruitment candidates
- `sync_job_profiles` - Job profile extraction cache

### Migrations

```bash
# Generate migration
npm run drizzle-kit generate

# Apply migration
npm run drizzle-kit push

# View schema
npm run drizzle-kit studio
```

## Troubleshooting

### Shared folder unreachable
- **Cause:** UNC path not accessible, wrong credentials, or the CIFS mount is down
- **Symptom:** `Folder bersama tidak tersedia — memakai berkas unggahan saja` in the
  log. This is informational, not fatal: the run continues with uploaded PDFs.
- **Solution:** Verify `LOCAL_PDF_FOLDER` and the `LOCAL_PDF_USERNAME` /
  `LOCAL_PDF_PASSWORD` / `LOCAL_PDF_DOMAIN` credentials (Windows only; the connect
  step is skipped on other platforms)

### New PDFs synced but a business unit cannot see them
- **Cause:** the document has not been assigned to that tenant (or is assigned to
  a different one) in `job_profile_tenants`
- **Solution:** assign it on the web app's Job Profiles page — the
  tenant-assignment control on every card/row/detail view, marked "belum
  dipetakan" when unassigned. Full runbook:
  [`docs/job-profile-tenant-scope.md`](../docs/job-profile-tenant-scope.md)

### PDF Extraction Failed
- **Cause:** Corrupted PDF or unsupported format
- **Solution:** Validate PDF with external tool, check `raw_text` field in DB

### LLM Processing Timeout
- **Cause:** LLM service unreachable or slow
- **Solution:** 
  - Verify `LLM_BASE_URL` and `LLM_API_KEY`
  - Check network connectivity
  - Increase timeout in config

### Database Connection Failed
- **Cause:** PostgreSQL unreachable
- **Solution:** Verify `POSTGRES_URL`, check firewall rules

## Development

```bash
# Format code
npm run format

# Type check
npm run type-check

# Start with auto-reload
npm run dev
```

## Docker

```bash
# Build
docker build -t pulse-sync-service .

# Run
docker run -e POSTGRES_URL=... pulse-sync-service
```

## License

Proprietary


---

## Excel upload for MSSQL / API sources

Every externally-sourced job can be fed from an Excel workbook instead of its live source. This
exists for the two cases that actually happen: the source database is unreachable, or someone needs
to correct data that is wrong at the source and cannot wait for it to be fixed there.

**Uploadable sources** (`POST /api/sync/upload/<kind>?filename=<name>`):

| kind | feeds sync route | target table |
|---|---|---|
| `employees` | `/employees` | `sync_employees` |
| `positions-master` | `/positions/master` | `sync_positions` |
| `positions-hierarchy` | `/positions/hierarchy` | `sync_position_hierarchy` |
| `positions-employees` | `/positions/employees` | `sync_employee_positions` |
| `positions-competencies` | `/positions/competencies` | `sync_technical_competencies` |
| `performance` | `/performance` | `sync_performance_appraisals` |
| `grade-levels` | `/grade-levels` | `sync_grade_levels` |
| `behavior-competencies` | `/behavior-competencies` | `sync_behavior_competencies` (latest assessment per employee — what the HAV formula reads) + `sync_behavior_competency_history` (the 3 newest assessment DATES per employee, drizzle/0081, from a separate MSSQL query whose failure is reported in the message and never fails the latest-BA sync; read by the Talent Mapping work queue). An Excel upload writes only the first table — readers merge it back in |
| `disciplinary` | `/disciplinary` | `sync_disciplinary` |
| `education` | `/education` | `sync_education` |

Not uploadable, deliberately:

- **`candidates`, `divisions`, `departments`, and the `positions` population step** are *derived from
  Postgres*, not pulled from anywhere. Upload the employee/position data they read and re-run them.
- **`personal`** (birth date → candidate age) reads a listing endpoint that already returns every
  employee in one paged scan, so it is fast enough not to need a manual override; a wrong birth date
  is a correction to make upstream, not one to paste into a spreadsheet.
- **`hav`, `mcu`, `kamus`, `job-profiles`** were already upload-driven and keep their own bespoke
  parsers (fixed sheet names, PDF extraction).

### How it behaves

- **Update-only. It never deletes.** A row absent from the sheet keeps whatever the last sync gave
  it. This differs from the REST education sync, which reconciles per employee — an uploaded sheet is
  a *patch*, not a snapshot.
- **The upload wins for one run, then the file is deleted**, so the next scheduled sync goes back to
  MSSQL/REST. It is a correction, not a permanent switch.
- **`?uploadsOnly=1`** (what the UI tile sends) forbids the fallback: a failed ingest is reported as a
  failure rather than quietly succeeding from a different source. Without that flag — a manual "sync
  now", or cron — a failed ingest logs a warning and falls through to the live source, so one
  malformed workbook cannot silently disable a weekly sync.
- **Conflict targets match the automated sync's**, so a hand-uploaded row updates the same DB row the
  automated sync would have. For the three tables keyed on a synthesised `source_key`, the key is
  rebuilt with the identical formula (`services/excel-sources.ts`).
- Rows missing a required column are **skipped and reported**, not silently dropped and not fatal.
- Duplicate rows sharing a conflict key are **merged before the INSERT** — Postgres rejects a
  statement whose `VALUES` contain the same conflict key twice.

### Templates

`GET /api/sync/upload/template/<kind>` generates the starter workbook **from the same spec the parser
reads**, so a column cannot be renamed in one without the other following. Each template ships three
example rows and a `Petunjuk` sheet documenting the columns, the row key, and the update-not-replace
semantics.

### Adding a source

Append a spec to `src/services/excel-sources.ts`, add one `tryExcelUpload(req, res, "<route>")` line
to that route in `src/routes/sync.ts`, and add a tile to `EXCEL_DATA_SOURCES` in
`components/settings/sync-settings-client.tsx`. Nothing else changes — the upload route, the
template endpoint and the ingester are all driven by the spec.

---

## Operational endpoints (`/api/sync/_*`)

Paths beginning with `_` are skipped by the audit middleware, so they never appear in the sync run
history. This service has **no authentication**, so every one of them is either secret-free,
idempotent, or verified against material already in the database.

| endpoint | purpose |
|---|---|
| `GET /_db-settings` | Resolved MSSQL settings. **Never returns a password.** |
| `POST /_reload-db-config` | Parameterless. Drops the settings cache and the live pools. |
| `POST /_test-connection?source=MPMDS\|MPMHRGA` | Connects with a **throwaway** pool and runs `SELECT 1`. Tests what is *saved* — it accepts no credentials, because an endpoint on an unauthenticated service that took a password would let anyone repoint the sync at a database they control. |
| `GET /_encryption-status` | Whether this process holds the data key. |
| `POST /_unlock` | Accepts `{ dataKey }` (base64) — but only if it decrypts the stored `verifier`, so a wrong or hostile key is rejected rather than installed. |
| `POST /_lock` | Drops the data key from memory. |

### Source-database settings

`DB_MPMDS_*` / `DB_MPMHRGA_*` still work and are still the fallback. When a row exists in
`sync_source_connections` (written by the web app, which enforces `sync.manage`), it wins.

The password is stored encrypted. This service reads the master key from `PULSE_MASTER_KEY_FILE`
(default `secrets/master.key`, mounted read-only from the host) and unwraps the data key itself, so it
recovers on its own after a restart — that is what lets a 01:00 cron sync decrypt anything on a
service that restarted at 23:00 with nobody awake. `POST /_unlock` still exists as a fallback for
deployments where the file is not mounted here.

If the key cannot be read or does not match the active `app_encryption_keys` row, the service logs
loudly and falls back to `DB_MPMDS_PASSWORD` / `DB_MPMHRGA_PASSWORD`, rather than failing the sync.

> `src/db/mssql.ts` used to build its pool configs as module-level `const` snapshots. Anything that
> reintroduces that makes the settings page silently ineffective: the row updates, the API answers
> 200, and the service keeps connecting to the old server forever.
