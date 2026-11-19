# Talent 5-Box: Data Sources & Calculation Reference

> **⚠️ The feature described here is deleted from `main`** and lives on branch
> `parked/talent-5box` — see
> [`docs/talent-5box-parked.md`](talent-5box-parked.md). The four sync jobs below
> no longer run, so nothing has written to `talent_data_staging` since; the boxes
> in there are as old as the last build before removal. This document stays on
> `main` because those rows are still in the database and this is the only
> explanation of what their numbers mean. Read it as a specification, not as a
> description of something currently running.

How every employee gets placed in a 5-Box (`system_recommended_box`), which
tables and columns feed the calculation, and how missing data is handled.

Applies to the Talent Matrix module (`/talent`), the staging build
(`sync-service/src/services/talent-sync.ts`) and the rule engine
(`sync-service/src/services/talent-box-engine.ts`).

> **This is not the only 5-Box in the repo.** The box described here is derived
> from *numeric* scores (weighted PA + assessment centre + technical competency)
> against tenant-editable thresholds. The HAV 16-quadrant grid on Beranda rolls
> up into the same five names from *categorical* inputs (PA letter pairs ×
> behavioural recommendation) — see
> [`docs/hav-16-kuadran.md`](hav-16-kuadran.md). They answer the same question
> two ways and will not always agree; nothing copies a number from one into a
> place expecting the other.

## Pipeline overview

```
EDP / SDP / Orange (MSSQL)  ──sync──▶  sync_* tables (Postgres)  ──build──▶  talent_data_staging  ──engine──▶  system_recommended_box
```

| Stage | Where | What happens |
|---|---|---|
| 1. Ingest | `sync-service` jobs (see [sync jobs](#sync-jobs)) | Pull raw rows from the EDP / SDP / Orange source databases into `sync_*` tables. |
| 2. Merge | `buildTalentStaging()` | Joins every source per employee into one `talent_data_staging` row (keyed `tenant_id` + `employee_id`). |
| 3. Compute | `computeTalentScores()` (pure engine) | `Performance_Score` and `Potential_Score` → levels → box. |
| 4. Validate | Talent page (web) | HC / division head overrides `final_validated_box`, audited in `talent_audit_logs`. |

All scoring inputs are **per-employee snapshots copied into
`talent_data_staging` at build time** — a finished box never changes when the
underlying sync tables change; only a re-run of "Hitung Rekomendasi" does.

## Join key

`employee_id` (NPK) joins every source. **Padding is inconsistent across
sources** (e.g. `sync_performance_appraisals` stores `00598`,
`sync_education` stores `5017`), so every join compares
`LPAD(TRIM(employee_id), 5, '0')` on both sides. The staging build writes the
canonical 5-character padded form into `talent_data_staging.employee_id`.

## Sync jobs

| Job | CLI / route | Source DB | Writes to |
|---|---|---|---|
| Employees | `talent` stage-1 prerequisite: `employees` | MPMDS (`MPMDS_ORANGE_DATA`) | `sync_employees` |
| Performance Appraisal | `performance` | MPMHRGA (`DVP_PA_HISTORY_DTL`) | `sync_performance_appraisals` |
| Technical competencies | `tech-competencies` | MPMHRGA (`DVP_*` competency mapping) | `sync_technical_competencies` |
| Assessment Center | `talent/assessment-center` | SDP/Orange (`DVP_ASSESSMENT_CENTER_*`) | `sync_assessment_center` |
| Talent Mapping history | `talent/mapping` | EDP (table discovered via `INFORMATION_SCHEMA`, see below) | `sync_talent_mapping_history` |
| RTC history | `talent/rtc` | EDP (table discovered) | `sync_rtc_history` |
| Behavior (latest rec) | `behavior-competencies` | MPMHRGA (`DVP_ASSESSMENT_CENTER_HDR/DTL` + `DVP_MASTER_REKOMENDASI`) | `sync_behavior_competencies` |

The three talent-specific syncs are **defensive**: they discover the source
table among a candidate list (e.g. `DVP_TALENT_MAPPING`,
`DVP_TALENT_MAPPING_HDR`, `TALENT_MAPPING`, …) and pick available columns from
a preference list via `INFORMATION_SCHEMA`. When nothing matches, the sync
reports `success: true` with 0 rows and names the tables it looked for — a
deployment that never had that source keeps working, and affected employees
are flagged as missing data instead of the sync failing.

## Per-component data sources

### 1. `Performance_Score` (0–100)

```
Performance_Score = w₀×PA(current) + w₁×PA(year−1) + w₂×PA(year−2)
w₀ = 0.50, w₁ = 0.30, w₂ = 0.20   (configurable, see thresholds)
```

**Source table:** `sync_performance_appraisals` (from EDP/MPMHRGA)
columns `employee_id`, `tahun`, `s1`, `s2` (letters A–E per semester).

- Reference year: the **latest available appraisal year**, clamped to the
  current calendar year (`MIN(now, MAX(tahun))`). A source that lags the
  calendar still scores against its 3 most recent years instead of everyone
  silently having "no PA".
- One row per year: the year's entry with the **largest `seq`** (the year's
  final assessment).
- Year score = average of `s1` and `s2`, mapped letter → value:
  A=100, B=80, C=60, D=20, E=0 (repo-wide convention, see
  `scoring-service/src/scoring-engine.ts` `PA_SCORE_MAP`). Unknown grades
  (`IS`, `BS`, …) read as **null**.
- **Missing years**: weights are renormalized over the years that exist
  (e.g. only year−1 available → its weight becomes 1.0). Zero usable years →
  `performance_score = NULL`, `missing_pa = true`.

Stored in staging: `pa_current_year`, `pa_year1`, `pa_year2` (letters, for
audit) and `performance_score` / `performance_level`.

### 2. `Potential_Score` (0–100)

```
Potential_Score = 0.70×AssessmentCenter + 0.30×Competency   (configurable)
```

**Assessment Center input** — source table `sync_assessment_center`
(columns `employee_id`, `score`, `assessment_date`, `dimension`):
average of all `score` rows for the employee, normalized by scale:
≤ 5 → ×20 (1–5 scale), otherwise clamped 0–100. Latest assessment date is
kept in `assessment_center_date`. No rows → `assessment_center_score = NULL`,
`missing_assessment = true`.

**Competency input** — source table `sync_technical_competencies`
(columns `employee_id`, `current_score`, `score`):
average of `COALESCE(current_score, score)` across the employee's competency
rows, normalized ≤ 5 → ×20 (1–4 scale → 0–100). Count kept in
`competency_count`. No rows → `competency_score = NULL`,
`missing_competency = true`.

**Missing inputs**: with both inputs present the configured weights apply;
with only one present it is used alone; with neither → `potential_score =
NULL` and the employee gets **no box** (the card is flagged).

### 3. Level thresholds (configurable)

`talent_box_configs` (one row per tenant; absent row → defaults 75/60):

| Score | HIGH ≥ | MEDIUM ≥ |
|---|---|---|
| Performance | `performance_high` (75) | `performance_medium` (60) |
| Potential | `potential_high` (75) | `potential_medium` (60) |

### 4. Box matrix (fixed rules)

| Performance \ Potential | HIGH | MEDIUM | LOW |
|---|---|---|---|
| **HIGH** | TOP | STRONG | BORDER |
| **MEDIUM** | STRONG | SOLID | BORDER |
| **LOW** | BORDER | BORDER | BOTTOM |

### 5. Contextual (non-scoring) data

| Staging column | Source table | Notes |
|---|---|---|
| `past_talent_mapping`, `past_talent_mapping_year` | `sync_talent_mapping_history` | Latest-year row per employee (`mapping_year`, `mapping_status`). Display only. |
| `rtc_count`, `rtc_history` | `sync_rtc_history` | Count + `[{year, name, status}]`, newest first. Display only. |
| `name`, `department`, `division`, `position_title`, `grade_id`, `entry_date` | `sync_employees` | Profile shown on cards and the 360 view. |
| `company_id` | `sync_employees` | Resolved to `tenant_id` via `sync_company_tenant_map` (active rows only). Employees of an unmapped company are skipped by the build. |

The 360 quick view additionally reads `sync_behavior_competencies` (latest
assessment recommendation), `sync_education` (education history) and
`talent_audit_logs` (this employee's validation history).

## Missing-data behaviour

| Situation | Flag / result |
|---|---|
| No usable PA in the 3-year window | `missing_pa = true`, no `performance_score` |
| No assessment-center rows | `missing_assessment = true`, no AC input |
| No competency rows | `missing_competency = true`, no competency input |
| No PA **and** no potential inputs | no box at all → card in the "Tanpa kotak" strip |
| Unmapped company (no tenant) | employee skipped by the build (counted in the sync message) |
| Source table missing (migration lag) | 360 view section degrades with a per-section notice; other sections unaffected |

A box is only produced when BOTH levels are known — the engine never guesses a
level from half the data.

## Re-runs and validation state

- The build upserts (`ON CONFLICT (tenant_id, employee_id)`) and **never
  overwrites** `final_validated_box` / `final_validated_by` /
  `final_validated_at` / `justification_reason` — a re-sync cannot overturn an
  HC decision; the UI shows both boxes when they differ.
- The build **deletes stale staging rows**: rows with a non-canonical
  `employee_id` (leftovers of pre-normalization builds) and rows whose
  employee no longer exists in `sync_employees`. History is safe:
  `talent_audit_logs` is untouched.
- Every override writes `talent_audit_logs` (`old_box`, `new_box`,
  `justification_reason` — mandatory when the box differs from the system's —
  `changed_by_user_id`, `timestamp`).

## Inspecting an employee's provenance

The 360 quick view (click any card) shows a **"Sumber Data & Perhitungan
Kotak"** panel that reproduces the calculation for that employee: the PA years
and weights actually applied, the assessment-center and competency inputs
(raw + normalized), the active thresholds, and the resulting box. It is
served from the stored staging row + `talent_box_configs` by
`getTalentQuickViewAction` (`lib/talent-actions.ts`).
