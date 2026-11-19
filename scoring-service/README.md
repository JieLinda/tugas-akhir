# Pulse Scoring Service

A standalone Node.js service that runs AHP + TOPSIS succession scoring in the
background, independently of the Next.js web app. The Next.js app calls this
service to start processing a scoring session and polls for progress.

## Why a separate service?

The web app uses Next.js server actions. One scoring run is minutes of work —
embedding calls, a grounded Gemini call per candidate whose education does not
match exactly, an LLM insight note per finalist — which cannot be reliably kept
alive across server-action timeouts or when the user navigates away. This
service runs as a standalone Node process and processes sessions independently,
updating the database as it goes. The Next.js app simply monitors the DB and
displays progress.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/scoring/start` | Start (or resume) processing a scoring session |
| `GET` | `/api/scoring/:sessionId/status` | Read current state of a session |
| `POST` | `/api/scoring/:sessionId/cancel` | Mark a session as failed and stop processing |
| `POST` | `/api/scoring/:sessionId/finalize` | Re-run the (idempotent) AHP + TOPSIS engine for a session — the web app's fallback when polling gave up; 409 for a session of a removed method |
| `GET` | `/health` | Health check |

## Running

```bash
cd scoring-service
pnpm install
cp .env.example .env  # then edit
pnpm dev              # development
pnpm start            # production
```

The service reads the same PostgreSQL database as the Next.js app, so they
share state. The Next.js app reads/writes `tournament_sessions` and
`scoring_runs` directly; the service mutates them as it computes the run.

### Concurrency

`SCORING_MAX_CONCURRENT` (default **2**) bounds how many sessions process at
once. A `POST /start` beyond the cap is **queued, not rejected**: the session
stays `running` in the database with no worker on it, which is exactly what the
orphan sweeper (`ORPHAN_SWEEP_INTERVAL_MS`, default 10s) looks for, so it starts
as soon as a slot frees. The start response says which happened
(`queued: true` plus a `capacity` object).

The cap exists because dispatch is per session and unbounded — Position
Management's bulk add starts one run per position, dozens in a single click, and
each AHP run fans out into embedding and LLM calls of its own. Without it they
all begin at once and every one of them finishes later.

## Scoring method — AHP + TOPSIS (`scoring_method = 'ahp_topsis'`)

AHP + TOPSIS is the only method. The LLM "AI Tournament"
(`scoring_method = 'sequential'`, run method `LLM`: aspect subagents, replace-worst
stages, a justification agent, the `candidate_aspect_scores` cache) was removed
in 2026-11, together with its prompts (`aspect_subagent_technical`,
`aspect_subagent_education`, `justification_agent`) and the env keys
`STAGE_BATCH_SIZE`, `FIRST_ROUND_MULTIPLIER`, `ASPECT_SCORE_CACHE` and
`ASPECT_LLM_CONCURRENCY`. `runner.ts` fails a session carrying any other
`scoring_method` with `REMOVED_METHOD_MESSAGE` instead of scoring it, and
drizzle/0097 deletes the stored tournament runs. `src/scoring-engine.ts` now only
holds the loaders the engine shares (session, position row, readiness bands, the
HAV quadrant → score rule).

A deterministic method (`src/ahp-topsis-engine.ts`). Six aspects each produce
a 0-100 value:

| # | Aspect | Logic |
|---|--------|-------|
| 1 | Technical Competency | Σ/M over a Hungarian one-to-one assignment between the candidate's competencies and the target's reference set. Each cell is `sim′ × levelFactor` (see below). Reference set falls back job profile → critical position → incumbent → all holders of the position code (see below) |
| 2 | Career Relevance | Accumulated relevant experience, decayed by age and saturating on two axes: `depthYears × (1 − w + w × depthRows)` where `depthYears = min(1, Σ(sim'×yr×rec)/T_yr)`, `depthRows = min(1, Σ(sim'×rec)/T_rows)`, `rec = exp(−0.043 × years since the stint ended)` and `w = 0.25` — depth carries the score, breadth only modulates it. `T` is ABSOLUTE (8 yr / 2 stints, or the target JD's stated requirement × 2), never pool-derived. `sim'` is the document cosine rescaled onto anchors measured by three independent estimators, and a CAPPED, IDF-weighted incumbent-competency match where a stint has no profile (see below) |
| 3 | Behavior Competency | Paired ordinal categorization (VERY HIGH/STRENGTH = 6 … BELUM ADA POTENSI/VERY LOW = 0, NOT READY = 0), scaled to 0-100 |
| 4 | Performance Appraisal | **Absolute-anchor TOPSIS** over the six semester slots: ideal = all-A (4), anti-ideal = all-D (1), fixed rather than set-derived, so a PA score is comparable across runs. `D⁺/D⁻` are weighted Euclidean distances to those anchors and `score = round(D⁻/(D⁺+D⁻) × 100)`. **Older periods are deliberately degraded**: AHP-derived recency weights from a `0.8^k` preference (`PA_RECENCY_DECAY`), CR = 0 — 0.271 · 0.217 · 0.173 · 0.139 · 0.111 · 0.089, newest first, so the latest semester counts ~3x the oldest. The ORDER therefore matters and is meant to: `A,C,C,C,C,C` scores 51 (recent improvement) while `C,C,C,C,C,A` scores 41 (recent decline). Blank/unrecognised slots read as **C**, not skipped, so a candidate with no PA at all scores 33. Two properties worth knowing: with a uniform record the weighting is mathematically irrelevant (both distances scale by √Σw = 1) — 94% of this deployment's candidates, so the decay only discriminates among the 6% whose record moves — and E maps to 0, *below* the negative anchor, so an all-E record scores 20 while all-D scores 0. `lib/pa-topsis.ts` rebuilds the whole derivation from the stored CSV for display, so even pre-existing runs are explainable. |
| 5 | HAV Mapping | 5-tier quadrant rule: {1}=100, {2,3,4,7,8}=80, {5,6,9,13,14}=60, {10,11,12,15}=40, {16}=20, none = 40. The quadrant is the **HAV in force** (`src/hav-effective.ts`, mirror of the web app's `lib/hav-effective.ts`): a Talent Mapping placement (`talent_mapping_placements`) — only while it is NEWER than `candidates.hav_auto_changed_at`, the last sync that changed the automatic answer (drizzle/0080; the same SQL predicate as the web loader) — > the HAV Excel (`candidates.hav_quadrant`) > the PA × behaviour formula — the same value the web app's eligibility rules judged the pool on. Formula-sourced HAV re-weighs PA and behaviour; HR accepted that, and every run records each candidate's `rawInputs.havSource` and the totals in `runInfo.hav.sources`. The engine's loader routes through `src/hav-placements.ts`; parity with the web and sync-service copies is pinned by `tests/talent-mapping/hav-parity.test.ts` |
| 6 | Education | **Two axes.** The LEVEL axis is always decided by rule (`compareEducationLevel`: above the stated minimum 100 · equal 80 · below 50; dropped when neither side names a level) — never by a model, on either path. If the MAJOR also matches exactly (all tokens of one acceptable major, deterministic, no model call) the score IS that level tier. Otherwise a **grounded Gemini** call (temperature 0, topP 0, Grounding with Google Search, fixed rubric, strict JSON `{education_level, major_relevance, reason}` validated with retry) supplies the RELEVANCE axis — both of its answers accumulate into that one axis — and `score = (level axis + relevance axis) / 2`. `reason` cites the grounding sources for gap analysis. Grounding and Gemini's native JSON mode are mutually exclusive, so a grounded call can answer with prose; the parser scans every balanced object in the reply and, if all grounded retries fail, a **structured-output repair pass** re-asks with grounding off + `responseSchema` (source `llm-structured`, no citations). Only when that also fails is education reported as "tidak dinilai" (0), quoting the actual error. Full analysis is persisted per candidate in `analysis_results.details.ahpTopsis.educationDetail` and rendered on the **Progress Running** page. Requires `GEMINI_API_KEY`. |

Criteria weights come from an AHP pairwise matrix stored per program template
(`program_templates.ahp_config`, edited in Tata Kelola with a live consistency
ratio; saving is rejected when CR > 0.1), falling back to the template's
criteria weights. The final ranking is classic TOPSIS over the 6-criteria
decision matrix; the closeness coefficient becomes
`analysis_results.final_score` (method `AHP_TOPSIS`).

#### Insight notes (`src/ahp-narrative.ts`)

The three narrative blocks on a finalist's dossier — **Keunggulan Kompetitif**,
**Kebutuhan Pengembangan**, and **Arahan Langkah Suksesi & Penugasan** — are
written by an LLM, one call per finalist at `INSIGHT_LLM_CONCURRENCY`.

They used to come from `buildNarrative()`: six canned sentences keyed by aspect
and cut at a threshold, so every candidate scoring under 60 on technical received
the identical line *"Ikutkan pelatihan/sertifikasi teknis yang menutup gap
kompetensi posisi target"* — naming no competency, no seat and no person. The
numbers were defensible; the words were not. The agent instead gets the evidence
this engine already computes and nothing else does: the Hungarian assignment's
per-competency **required vs held level** (weakest first), which career stints
matched which job profile and on which axis the score saturated, the education
reasoning, the behavior category, the HAV quadrant, and the JD's responsibilities
with their success indicators.

Load-bearing properties:

- **Prose only.** It runs *after* the ranking is fixed, is handed the final
  scores as read-only context, and nothing it returns is read back into an aspect
  score, the closeness coefficient, the rank or the readiness band. `justification`
  also stays deterministic — it states the method and the closeness coefficient,
  which is an audit line, not commentary.
- **Failure is per-candidate.** A failed, timed-out or unparseable reply falls back
  to the deterministic template for that candidate alone, and an empty array falls
  back per *array* — an empty "Keunggulan Kompetitif" heading reads as "this person
  has none" rather than "the writer said nothing". The mix is reported in
  `runInfo.narrative` and shown as a banner on the **Konfigurasi Run** tab,
  because a templated bullet and a written one look equally finished on the page.
- **A defaulted PA is not a finding.** `scorePerformanceAspect()` reads an empty
  semester as C, so a candidate with no appraisal history scores 33 — the first
  live run duly reported *"inkonsistensi pencapaian target kinerja"* and cited
  that 33 as the proof. The evidence block now states the substitution outright
  and the guideline forbids both the inference and citing the aspect score for it.
- **Finalists only**, because those are the rows `analysis_results` holds; the rest
  of the scored pool lives in `scoring_run_pool_aspects` as numbers for a later
  exclusion re-rank, where prose would never be read.

**Not in demo mode.** A demo-mode session (`is_demo`) never calls the writer:
its finalists keep the deterministic template, so no demo data is sent to a
model to be written about. `runInfo.narrative` records `llmEnabled: false` and
`disabledBy: 'demo'` (`'config'` when `AHP_NARRATIVE_LLM=false`), and the web app
shows no "teks template" banner for a demo run.

Guideline is editable in Tata Kelola (prompt key `ahp_narrative_agent`; the
default lives in `AHP_NARRATIVE_PROMPT_DEFAULT` and the two must stay in step).
Uses `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` at `LLM_INSIGHT_TEMPERATURE`
(0.7 — flat temperature-0 prose reads templated and repeats across candidates).
Set `AHP_NARRATIVE_LLM=false` to go back to the templates.

#### Positions without a job profile (fallback pipeline)

Technical and Career both assume a job profile exists. Many positions have none,
so both fall back to the people who hold them — never silently.

**One reference set, two aspects.** `resolveTargetRequiredSet` resolves the
target's required competencies through four tiers and records which one won
(`runInfo.technical.requiredSource`):

| Tier | Source | Level |
|---|---|---|
| `profile` | job profile `technicalCompetencies` | from the profile |
| `critical_position` | `critical_positions.required_competencies` | unknown → 2 |
| `incumbent` | the sitting incumbent's `sync_technical_competencies` | **`proficiency_name` / `score` = the level the JOB demands**, not `current_*` (the person's attainment) |
| `position_aggregate` | every holder of the same position code, merged at max level | as above |

That one set is the reference for the technical aspect **and** for the career
fallback below, so the fallback is the same measurement rather than a lookalike.

### Competency identity is the kamus CODE, not the string

Before a cell is computed, both sides are resolved onto a kamus-kompetensi code,
and "same competency" means "same code". Comparing normalized strings failed in
one direction that matters: required names are extracted from job-profile PDFs
by an LLM, so a profile says `Business Process Analyst` where the kamus and the
HR sync both say `BUSINESS PROCESS ANALYSIS`. 34 of 102 distinct required names
in this deployment match no kamus entry, against 2 of 65 on the candidate side.

The cost is a WRONG PAIRING, not a missing vector. An unresolved required
competency has no level vector, so every cell in its column is 0 — and Hungarian
maximises, so the candidate competency that belonged there is spent on whichever
other column scores above zero. The reported case put a candidate's `BUSINESS
PROCESS ANALYSIS` against the position's `Budgeting`.

Resolution has three tiers and lives in the WEB APP (`lib/kamus-name-match.ts`),
persisted to `kamus_competency_match_cache` (drizzle/0063). This service only
reads that table (`kamus-codes.ts`). The split is deliberate: the last tier needs
an LLM, and scoring must stay runnable with no model reachable — the orphan
sweeper restarts sessions with nobody watching.

| tier | rule | cached |
|---|---|---|
| exact | normalized name == a kamus name | no — free to recompute |
| fuzzy | same token count, every token pairing by shared prefix ≥5 with ≤3 leftover chars each, and exactly ONE kamus entry qualifying | yes |
| ai | a SPELLING corrector over the WHOLE kamus (90 entries fit one prompt, so no shortlist can cut off the right answer). May only say yes when both names carry the SAME keywords, differing by typo, inflection, word order or punctuation; adding/dropping/substituting a meaningful word, or expanding an abbreviation it would have to guess, must be "none". Floor 0.9 confidence | yes, rejections included |

Measured on this deployment: the fuzzy tier resolves 8 of 35 unmatched names —
including the reported `Business Process Analyst` → `TC 012` — and maps every
kamus entry to itself with zero collisions. `MANAGEMENT` ~ `MANAGER` and
`RECRUIT` ~ `RECRUITMENT` are deliberately refused and left to the AI tier.

`code` NULL is a real answer. `Leadership`, `Communication`, `Problem Solving`
and `Coaching` are behavioural, not technical-dictionary entries, and caching
that "no" is what stops them costing a call per run.

The web app primes the cache inside `notifyScoringService` — the one chokepoint
every session-start path goes through — capped by `KAMUS_AI_MAX_NAMES_PER_RUN`
(12) so a cold start cannot hold up a dispatch. Uncapped priming is the
"Petakan" button on `/settings/sync`.

**Unmeasurable required columns are dropped from the divisor.** A required
competency with no kamus code AND no candidate holding its literal name can
never score above 0 for anybody, so counting it in M depresses every candidate
equally by the dictionary's incompleteness. It is excluded from the divisor
(`effectiveRequiredCount`) but still returned as a pair with
`matchType: "unmeasurable"`, so the drill-down shows that the job profile
demands something the kamus does not define — a governance finding, not a
scoring detail. If NO required competency is measurable, the technical criterion
is dropped from TOPSIS entirely and its AHP weight redistributed, exactly as it
already is when there is no reference set at all.

### Matching runs in two stages: identity, then similarity

Identity is **discovered, never optimised**. Two competencies resolving to the
same kamus code ARE the same competency, so they are paired before Hungarian
sees the matrix, and both sides are removed from it. Hungarian then runs only
over what is genuinely ambiguous.

Leaving identity to the optimiser was wrong, not merely untidy: Hungarian
maximises the SUM, so it trades a correct pair away whenever the total improves.

```
sel(A_cand→A_req) 0.00    sel(A_cand→B_req) 0.60
sel(Z→A_req)      0.20    sel(Z→B_req)      0.30

A→A, Z→B = 0.30      A→B, Z→A = 0.80   ← Hungarian picks this
```

and the candidate's own `A` is reported as covering `B`. Under-levelled identity
pairs were the usual trigger, because a near-zero cell has no pull in a sum.

**Identity key** = kamus code when there is one, else the normalized name
(namespaced `C:`/`N:` so a name can never collide with a code). The name
fallback is what keeps `SHE Management` — absent from the kamus, spelled the
same on both sides — pairing as it always did. Duplicates resolve by highest
level, mirroring `unionMaxLevel`. A profile listing one competency twice pairs
the first occurrence and lets the second fall through to stage 2, which is
honest: there is no second competency to cover it.

`matchType` distinguishes the three outcomes: `exact` (identity, same literal
name), `code` (identity, different spellings resolved to one kamus entry), and
`semantic` (paired by embedding similarity in stage 2).

### The competency cell: `sim′ × levelFactor`

| term | identity pair | similarity pair |
|---|---|---|
| `sim′` | 1 — no embedding is consulted at all | cosine of the two cumulative level embeddings, **stretched onto 0..1** by `TECHNICAL_SIM_FLOOR`/`TECHNICAL_SIM_CEIL` |
| `levelFactor`, c ≥ r | `min(1 + 0.75·(c−r)/3, 1.75)`, surplus = `TECHNICAL_OVERQUALIFICATION_SURPLUS` (0.75) | 1 (capped) |
| `levelFactor`, c < r | `1 − (r−c)/SPAN`, SPAN = `TECHNICAL_LEVEL_GAP_SPAN` (4) | same |
| `levelFactor`, level unreadable | 1 (neutral, reported) | same |

Level is an ordinal ladder (Basic → Intermediate → Advance → Mastery), so only
the DIFFERENCE carries meaning — the same reading the cumulative embeddings are
built on (level L = descriptors 1..L accumulated). A ratio `c/r` would instead
assert that Mastery is "twice" Intermediate, which the kamus never claims.

SPAN is 4, not 3, so the worst possible shortfall still keeps a quarter of the
credit:

| gap | 1 | 2 | 3 |
|---|---|---|---|
| `1 − g/4` | 0.75 | 0.50 | **0.25** |

Holding a competency three levels short is not the same as not holding it — the
candidate demonstrably has the thing the job asked for, just not enough of it.
A span of 3 would zero that case out, which reads as "does not have it".

The over-qualification surplus is **0.75** (ceiling 1.75), raised from 0.25
(ceiling 1.25). At +25% a candidate three levels clear of the requirement was
worth barely more than one who merely met it, so depth of mastery hardly showed
in the score; at +75% exceeding the bar is worth roughly what one more met
requirement is. It applies to **identity pairs only** — a similarity pair stays
capped at 1.0 — so raising it also widens the gap between genuinely holding a
competency and merely resembling one. `Σ pair.value / M` can therefore now reach
~1.75, so a Technical score can read well above 100; the raw value feeds TOPSIS
(which normalizes per column) while the displayed bar is clipped to 0–100.

Two measurements decided the similarity side, both taken over the full census of
this deployment's dictionary (90 competencies × 4 levels, `nomic-embed-text-v2-moe`):

- **The embeddings barely encode level.** The same competency at level 1 vs
  level 4 sits at cosine 0.958, and Advance vs Mastery at 0.997 — while moving
  to a *different* competency drops it to ~0.571. Identity outweighs level by
  roughly 10×, so a raw cosine can neither see a proficiency gap nor, being
  symmetric, tell its direction. Hence the explicit level term on both kinds of
  pair.
- **A raw cosine is not a percentage.** Every competency has some *other*
  competency sitting at 0.72–0.86 (best-wrong-match p25 0.723, median 0.758,
  p95 0.859), and the most similar distinct pair in the whole dictionary reaches
  only 0.892. Feeding the raw value in scored a wholly wrong pairing at 72–86
  points. The anchors are read off that census — floor 0.72 = p25 of
  best-wrong, ceil 0.89 = the observed maximum — and are FIXED, not per-run
  percentiles, for the same reason career's are: a technical score has to mean
  the same thing across runs and positions.

**The anchors are derived, not constant.** `simFloor`/`simCeil` describe ONE
embedding corpus. Re-embedding the kamus, adding or removing a competency, or
switching the embedding model all move that distribution while every cosine
keeps computing — so a hardcoded anchor goes wrong without anything failing,
which is the least detectable kind of wrong. They are therefore recomputed from
the corpus and cached in `kamus_similarity_calibration` (drizzle/0064), keyed by
a **fingerprint** — `md5` over (code, level, content_hash) of every embedded row
plus the model name. Any change to the vectors moves the fingerprint and the
next run recalibrates; a kamus text edit that leaves the vectors alone correctly
changes nothing. That is how "recompute on any action that affects it" is made
exact without every write path having to know this exists.

The census: for each embedded (code, level) row, the best similarity to a row of
a DIFFERENT code — the number that matters, since Hungarian always reaches for
the best wrong match available. `simFloor` = p25 of that per-row distribution,
`simCeil` = **p99, not the maximum**: the max is a single point, so one
near-duplicate competency added to the kamus would drag the ceiling to ~0.99 and
compress every semantic score. On the corpus this was designed against the two
agree (0.8905 vs 0.8917), so the robustness is free.

Precedence: `TECHNICAL_SIM_FLOOR` + `TECHNICAL_SIM_CEIL` pin the values and skip
the census entirely (an operator who pins them means it) → stored calibration
whose fingerprint still matches → a fresh census → the `config.ts` fallbacks,
reported as `runInfo.technical.simAnchorSource: "fallback"` when the corpus is
absent or has fewer than 20 embedded competencies.

This is NOT the per-run percentile approach the career aspect deliberately
refuses. Those vary with who happens to be in the pool — an accident of the run.
These vary only with the measuring instrument, and every run records the anchors
and their provenance in `runInfo.technical`, so a ranking finished before a
re-embed stays explainable afterwards.

Refresh is eager as well as lazy: `POST /api/embed/technical-anchors/refresh`
recalibrates on demand, and the web app calls it when a kamus re-embed finishes
so the new scale is visible immediately instead of at the next scoring run. It is
best-effort — the fingerprint check is what guarantees correctness.

**An unreadable proficiency is never a shortfall.** `NULL` / `#N/A` /
`NOT ASSESSED` is ~17% of `candidate_technical_competencies`. Those rows keep a
neutral level term and are counted in `TechnicalDetail.levelUnknownPairs` and
`runInfo.technical.levelUnknownPairs`, surfaced on Progress Running as "level
belum diasesmen". Scoring them as level 1 — which is what the vector lookup
still uses — would turn a data gap into a competency finding.


**Career, target side.** Tried in order: `job_family_matches` → filename-code /
exact-title / embedding tiers → the **incumbent's own position code**
(`incumbent_position`) → a **synthesized job-profile document**
(`pseudo_profile`) built from position data + the reference competencies, in the
same label shape `lib/job-family/restructure.ts` writes, embedded with the model
recorded in `job_profile_embed.embedding_model` and its prefix convention
reproduced (`storedVectorKind`) so it lands in the same vector space.

**Career, stint side.** A history stint that resolves to no profile — or every
stint, when the target has no document — is scored by matching the **incumbent
competencies of that position** against the target reference set, with the same
Hungarian matcher (`matchCompetencySets`). Position vs position, so it measures
what Career means rather than duplicating Technical. Holder selection: the union
of all active holders (levels merged at max), or the most recent past holder if
vacant; **the candidate being evaluated is excluded**, otherwise a stint they
still occupy would match their own assessment for a free ~1.0. Which assessment
rows represent a holder is decided most-specific-first: rows whose `position_id`
is that position → rows whose `create_date` falls inside the holder's tenure →
the currently active rows (reported as `fallbackBasis`).

**Coverage is IDF-weighted** (`competency-idf.ts`). It used to be a plain mean over
the required competencies, and measured over this corpus that was a large free
gift to anybody senior: the vocabulary is dominated by near-universal entries —
`SOFTWARE APPLICATION OPERATION` on **92.7%** of 275 JDs, `PRODUCT AND SERVICE
KNOWLEDGE` 92.4%, `DOCUMENT ADMINISTRATION` 64%, `BUDGETING` 57.8%, `PROJECT
MANAGEMENT` 50.5% — so about 7 of the 15 competencies on *IT Application
Development Department Head* are ones any manager holds, and an unrelated manager
covered ~45% of the requirements for being a manager at all. Weighting each
requirement by `ln(N/df)` drops the median coverage of an **unrelated** job pair
from 0.286 to 0.104 and improves separation (AUC 0.743 → 0.775). The weight is
clamped to `[0.15, max observed]`: a near-universal requirement is de-emphasised
but never erased, and an unseen name — most likely an extraction typo — cannot
outweigh every measured one. **Technical does not use this** and its numbers are
unchanged to the bit; there the question is "can this person do what the JD
demands", where a common requirement being common does not excuse missing it.
`CAREER_FALLBACK_IDF=0` disables it.

**Calibration is a CAPPED band, not the run's own percentiles.** Coverage (0..1)
and document cosines live on different scales, so coverage is mapped onto
`[simFloor, simFloor + cap × (simCeil − simFloor)]` with `cap` =
`CAREER_FALLBACK_CAP` (default 0.5). Coverage 0 → `sim'` 0, coverage 1 → `sim'` =
`cap`, identically in every run.

This replaced `p5..p95` of the document similarities observed *in that run*, and
the replacement is the point rather than a tidy-up. The old rule's own comment
promised that a fallback measurement "must not be able to out-score a real
document match"; the implementation did the opposite, because p95 of the few dozen
stints a run matches is very nearly their maximum. On the *IT Application
Development Department Head* run the band came out `[0.563, 0.949]` — and 0.949 is
exactly that target's cosine against its own *IT Application Development Analyst*
JD. Full competency coverage bought the claim "this IS the job". Measured over 660
scored candidates in 8 runs: candidates scored from real documents averaged
**35.1**, candidates scored through the fallback averaged **66.7**, and 90 of the
104 candidates scoring ≥ 90 had fallback evidence. The criterion was reporting how
much of a history *lacked* a job profile.

0.5 is measured, not round: the fallback signal separates job families at AUC
0.743 against the document cosine's 0.874, and 5% of unrelated job pairs share
≥ 75% of their competencies. `CAREER_FALLBACK_ANCHOR_LO/HI` pin the band if set
(and then the cap does not apply); they carry no hardcoded defaults of their own,
because two independently-defaulted pairs describing one distribution is what let
them drift. On an **incremental run** the band is *pinned to the base run's*
(`source: "inherited"`), recovered from a reused candidate's
`careerMatching.calibration` — the same invariant the depth yardstick has, so
identical raw coverage maps to the same similarity for the carried-over candidates
and the added ones. Which was used, and why, is recorded in
`runInfo.career.calibration` and
echoed per candidate.

The over-qualification surplus (`matchCompetencySets` returns up to 1.25) is
truncated at 1, so full coverage maps to `hi` and no further: the band ends at
the document path's p95, and a stand-in built from whoever happens to hold the
position must not be able to out-score a real document match.

**Education.** The requirement falls back job profile → `critical_positions.education`
→ the **incumbent's own education + major** (`educationDetail.requirementSource`).

Two mutually exclusive scoring paths, and conflating them is the single most
common explanation error on this criterion:

| path | score is | axes |
|---|---|---|
| `exact-match` | the **level tier** alone: higher 100 · **equal 80** · lower 50 | level only; the major is a pass/fail gate |
| `llm-grounded` / `llm-structured` | `(level tier + grounded relevance) / 2` | **two**, equally weighted |
| `none` | 0 = *not assessed*, never "education unsuitable" | none |

**The level axis is decided by RULE on every path — never by the model.** It used
to be computed only inside `exactEducationMatch`, so a candidate routed to
grounding had their level judged by Gemini instead. The principle the ladder
exists to enforce — a level *above* the stated minimum is worth more than one
merely equal to it — therefore held on one path and was silently overridden on
the other, and what decided which applied was something unrelated: whether the
MAJOR matched. `compareEducationLevel` now runs for both paths.

Gemini is still asked about level and major separately (they are genuinely
different searches, and its reading of whether a level suits the responsibilities
is useful evidence), but **both answers accumulate into the single relevance
axis**:

```
level axis      = 100 higher / 80 equal / 50 lower      (rule, both paths)
relevance axis  = (grounded level answer + grounded major answer) / 2
score           = (level axis + relevance axis) / 2
```

`lower = 50` becomes reachable for the first time: the exact-match path rejects a
below-requirement candidate outright, so that tier was dead. On the grounding path
it is exactly the candidate who needs it.

When neither side names a recognisable level the axis is **dropped**, not guessed,
and the score is the relevance axis alone — the same "drop, don't zero" rule the
engine applies to any criterion nobody can be scored on.

The invariant is checkable: at identical relevance, a higher level always outscores
an equal one. Relevance 60 → higher `(100+60)/2 = 80`, equal `(80+60)/2 = 70`.

An exact match at `equal` scoring 80 is a full mark for "exactly meets the
requirement", not a deduction — 100 needs a level *above* the requirement.

**The tier table is the only rule.** `EDUCATION_EXACT_MATCH_SCORE` used to give
every exact match one flat score and survived as an unreachable `??` fallback,
which made the code look like it still had a flat path and let operators set a
value that did nothing; it is now removed.

The tier is persisted as `educationDetail.exactComparison`. Where a run predates
that, `lib/education-tier.ts` **re-derives** it from the candidate's education
string vs the requirement string — a pure function of two fields every run
stores, mirroring `exactEducationMatch` here. It is deliberately never inferred
from the *score*, because legacy flat values collide with tier values (this
deployment has exact-match rows at 90, and the retired env default was 100 —
which would be mislabelled `higher`).

When a stored score disagrees with its tier's rule value, both are shown and the
score is **not** rewritten: that number is what fed TOPSIS and produced the rank,
so changing it would make the explanation contradict the ranking it explains.
Re-scoring the run is what moves it onto the rule.

**The level ladder treats some levels as equal, and its keys must match the data.**
`EDU_LEVEL_RANK` ranks SD 1 · SMP 2 · SMA-family 3 · D1 4 · D2 5 · D3 6 ·
**D4 = S1 = 8** · S2 9 · S3 10. D4 shares S1's rank because both are KKNI level 6,
so D4 against an S1 requirement is `equal`, not a shortfall; rank 7 is left unused
to record that. Four things were wrong here and all four were measurable on live
data:

- **English labels were missing.** The HR source stores `SENIOR HIGH SCHOOL`,
  `JUNIOR HIGH SCHOOL`, `ELEMENTARY SCHOOL` — **318 of 806 active candidates
  (39%)** ranked 0, failed the level test, and were pushed to the Gemini scorer
  instead of matching deterministically.
- **`S-1` did not tokenize.** Punctuation flattens to a space, so `S-1` became
  `["s","1"]`. 5 of 113 job profiles write it that way and could not produce an
  exact match for *any* candidate.
- **`ahlimadya` was an unreachable key** — `AHLI MADYA` tokenizes to two words.
- **`sederajat` was ranked 3.** It is a modifier, already a stopword, and the
  rank made `"Minimal S1 atau sederajat"` yield `[8,3]`; the minimum branch takes
  the lowest, so an SMA holder satisfied an S1 requirement. Removed.

The collapse rules run *before* punctuation is flattened, and the `\b` on both
sides of the `S-1`/`D 3` rule is load-bearing: without the leading boundary,
`"Kelas 3"` becomes `"Kela"` + `"s3"` and injects a doctorate rank.

This table is duplicated in `lib/education-tier.ts` (separate deployables, no
shared lib) so the web app can re-derive tiers for older runs. Change both.

**A grounded answer is reused when the question is identical**
(`src/education-reuse.ts`, `AHP_EDUCATION_REUSE`, default on). Education is the
input that changes least between two runs of one seat, yet the only one scored by
a grounded call — which costs search quota and is not reproducible: temperature 0
removes sampling noise, but search results move. So before calling Gemini for a
candidate, `scoreEducationAspect` reads the LAST completed AHP+TOPSIS run of the
same position (same `is_demo`) and reuses its answer when the `inputKey` matches.

- The key is sha256 over the exact system + user prompt the model is sent, minus
  the candidate's name, plus model / grounding / tool / temperature / topP. Prompt
  and key come from one `buildEducationUserPrompt`, so they cannot drift. It
  therefore covers education + major and the requirement, but ALSO title, job
  purpose, the first 10 responsibilities + indicators and the prompt — a
  re-extracted JD or an edited prompt makes the old answer a reply to a different
  question.
- The model's ANSWER is reused (`education_level`, `major_relevance`, reason,
  queries, sources); the level axis is recomposed with the current rule.
- Exact matches are recomputed; failures (`none`) are never reused; runs from
  before keys existed are asked once more. A failed read of the previous run is
  logged (`ahpTopsis.educationReuseLoadFailed`) and only costs calls.
- Provenance: `educationEval.inputKey` and `.reusedFrom` (`answeredInRunId` names
  the run where the model really answered, through chains), persisted in pool rows
  and in `educationDetail`; per run in `run_info.education.reuse`
  (`eligible` / `reused` / `modelCalls`). Pinned by `test/education-reuse.test.ts`.

**The MAJOR must match in full, or the pair goes to grounding.** It used to be
enough for ONE token to overlap, which made different fields read as identical:
requirement `Manajemen Informatika` vs candidate `Teknik Informatika` share
`informatika`, so that pair earned a full exact-match tier when it should have
been judged by grounded search — where `Sistem Informasi` vs `Manajemen
Informatika` already lands correctly despite sharing no token at all.

"Every token" cannot apply to the requirement as a whole, because most of them
list alternatives (`S1 Ekonomi / Manajemen / Akuntansi` means any one of three).
So the requirement is split on `/`, `,`, `;`, `atau`, `or`, and an exact match
needs **all** tokens of **one** alternative. Parenthesised clauses are dropped
first — every one in this corpus is `(diutamakan X)`, a preference that the
all-tokens rule would otherwise make mandatory.

The direction is deliberate: every token of the alternative must appear in the
CANDIDATE's major, not the reverse. Requirement `Informatika` is satisfied by
`Manajemen Informatika`; requirement `Manajemen Informatika` is not satisfied by
`Informatika` alone. Set equality would reject the first, which is over-strict.

`MAJOR_SYNONYM` folds English and Indonesian spellings first, because the HR
source stores majors in English while job profiles are written in Indonesian —
`ACCOUNTING` (61 candidates), `MANAGEMENT` (57), `ECONOMIC` (28) share no token
with `Akuntansi` / `Manajemen` / `Ekonomi`. That gap predated the stricter rule
(the any-token rule missed it too) but the strict rule makes it bite harder. Only
word-for-word translations and observed misspellings are folded; fields that
merely sound alike are not — `informatika` and `sistem informasi` stay distinct,
which is exactly the discrimination the all-tokens rule exists to preserve.

Measured over 806 candidates × 113 requirements, weighted by headcount: the old
any-token rule matched 40.0% exactly, the all-tokens rule 37.4% (the 2.6pp
difference is the false positives being corrected), and with the synonym fold
38.9% (recovering 1.5pp of genuine matches both earlier rules missed).

**Similarity rescale.** A raw cosine is not a percentage: measured on this
deployment's corpus an *arbitrary* pair of job-profile documents already scores
0.56, so feeding the raw value into a 0–100 criterion made "56% similar" worth 56
points when it means *no relationship*. Every stint similarity — document **and**
calibrated fallback, so the two stay commensurate — is stretched onto a true 0..1
between a floor and a ceiling. Fixed within and across runs (never per-run
percentiles), so a Career score means the same thing everywhere. Reported in
`runInfo.career.scale`.

**The anchors are MEASURED, by THREE independent estimators whose median wins** —
`career-anchors.ts`, cached in `job_profile_similarity_calibration`
(drizzle/0066, estimator breakdown in drizzle/0068). They describe one embedding
corpus, so a re-embed, an added or removed document, or a model switch moves the
distribution while every cosine keeps computing: the score silently changes
meaning — and the same is true of the label sources the other two estimators read.
The fingerprint therefore covers **four** things:

```
md5(job_profile_id, content_hash …) : model : t<topicRun>/<n>/h<historyHash> : METHOD_VERSION
```

| component | moves when | estimator it protects |
|---|---|---|
| `md5(job_profile_id, content_hash)` | a JD's text changes, or one is added/removed | `corpus`, and the cosines every estimator reads |
| `model` | the embedding model changes — same documents, different space | all three |
| `t<topicRun>/<n>` | the job families are re-clustered (this deployment has 8 completed topic runs already) | `family` |
| `h<historyHash>` | `candidate_position_history` gains a stint or a corrected date — the Monday HR sync | `transitions` |
| `METHOD_VERSION` | what the estimators compute changes | all three |

An earlier version tracked only the first two and argued the label-based estimators
were "stable in aggregate". That argument is wrong in the way that matters: a
re-clustering reassigns every topic id and the failure is invisible — 200 response,
completed run, scale calibrated against a clustering that no longer exists. The fix
is one aggregate query, so the trade was never worth making. The history component
hashes the ordered `(candidate, position, valid_from)` set rather than counting it,
because a corrected date silently reorders somebody's career and changes which
pairs are moves at all.

None of the write paths in `lib/job-family-actions.ts` or the sync service need to
know this exists. `POST /api/embed/career-anchors/refresh` only makes it immediate.

**One change no fingerprint can see**, and the reason that endpoint takes
`?force=1`: a re-embed that produces different VECTORS from the same text with the
same model — a re-tuned embedding service, or a half-finished earlier run.
`content_hash` covers text+model only, which is exactly why
`rebuildJobProfileEmbeddings` re-embeds every document unconditionally instead of
trusting it. The anchors have to make the same assumption, so that rebuild calls
the refresh with `force=1`; otherwise a rebuild that *fixed* the vectors would
leave the scale describing the ones it replaced.

`METHOD_VERSION` is load-bearing, not decoration. When the estimator set changed,
the corpus had NOT moved, so the fingerprint still matched and every deployment
kept serving the single-estimator numbers — a wrong answer with a 200 response and
a completed run. Bump it whenever what the estimators compute changes.

| estimator | measures | on this deployment |
|---|---|---|
| `corpus` | p25 of **arbitrary cross-document** pairs / p99 of each document's **best genuine match**, pairs ≥ 0.999 dropped first. Needs no labels, so it is always available and is why this never returns nothing. | 0.519 – 0.998 |
| `family` | the cosine at which running precision against **job-family labels** falls through **50%** and **95%**, using the newest completed topic run **that actually has assignments** — "completed" is not proof of content, and picking an empty one makes this estimator silently vanish while a good clustering sits one row behind. The fingerprint names the same run by the same rule, or a change in the run the estimator reads would be invisible to the cache. Partly circular — those families were clustered from these very vectors. | 0.672 – 0.878 |
| `transitions` | **REVEALED PREFERENCE**: p10 / p75 of the cosines of internal moves people **actually made**, read out of `candidate_position_history` in `valid_from` order. The only NON-circular estimator, and the smallest sample. Resolution is restricted to the filename-code and exact-title tiers — pairing a stint *by cosine* and then measuring that cosine would be circular in the one place circularity is not already acknowledged. | 0.633 – 0.892 (102 moves) |
| **resolved** | median of the available estimates | **0.633 – 0.892** |

**Why the single `corpus` estimator was not enough.** It answers a question whose
answer nobody can check, and calibrating against observable labels shows where it
lands: **at cosine 0.519 the probability that two profiles are even in the same job
family is 10%.** So `sim'` = 0 sat where 90% of pairs are unrelated, and everything
above earned positive relevance — the median arbitrary pair (0.562) scored 0.09 and
the 95th-percentile-of-noise pair (0.709) scored 0.39. Career multiplies `sim'` by
years and accumulates, so a 12-year career of unrelated work banked ~4.7 effective
relevant years against a target of ~7.

Independent confirmation from the moves themselves: real internal transitions have
median cosine **0.827** against 0.562 for arbitrary pairs, and the old floor of
0.519 sat **below the 10th percentile** of moves that really happened.

The median is the combiner so that no single estimator can move the scale alone, an
unavailable one degrades gracefully, and a wrong one is outvoted. The three agree
closely on the floor and disagree more on the ceiling, which is expected —
"definitely the same job" is rare and each estimator sees a different tail.

Still **fixed within and across runs**, never per-run percentiles: these vary with
the measuring instrument and with recorded history, not with who entered a run.
`CAREER_SIM_FLOOR`/`_CEIL` still pin it (`source: "env"`). The old per-family
constants (0.45/0.85 non-E5, 0.75/0.95 E5) remain only as the last resort when the
corpus is absent, under 30 documents, or degenerate (`source: "fallback"`).

Re-baselining is a **deliberate score shift, not a silent bugfix**. Runs keep
their own `runInfo.career.scale` including the estimator breakdown, so a ranking
finished under the old anchors stays explainable — and visibly incomparable.

They used to *be* the live values, and on this corpus they were wrong at both
ends: floor 0.45 sat below the 5th percentile of arbitrary pairs, so the median
**unrelated** pair still scored 0.28 relevance — and career multiplies `sim'` by
years and accumulates, so that leaked into every candidate's effective-relevant-
years total; ceiling 0.85 sat below the median document's own twin (0.905), so
over half the corpus saturated at `sim'` 1.0 and the top of the scale stopped
discriminating. Measured on the same corpus: **0.519 / 0.998**.

**Depth: thin histories are penalized.** The score used to be a duration-*weighted
average*, in which duration cancels out — one six-month stint at `sim'` 0.5 scored
exactly the same as a twenty-year, five-stint career at 0.5, and a thin history
was in fact advantaged because it had no weaker stints to dilute it. Relevant
experience is now **accumulated** on two axes, each saturating at its own target:

```
recᵢ     = exp(−δ × years since stint i ENDED)   (1 while ongoing)
effYears = Σ(sim'ᵢ × yearsᵢ × recᵢ)   depthYears = sat(effYears / T_years)
effRows  = Σ(sim'ᵢ × recᵢ)            depthRows  = sat(effRows  / T_rows)
score    = depthYears × (1 − w + w × depthRows) × 100
```

Unscored stints contribute 0 to both sums, so poor coverage costs real points
instead of being quietly dropped from a denominator.

**Recency (δ = `CAREER_RECENCY_DECAY`, default 0.043).** Relevance decays once the
work stops. Nothing decayed before: a stint that ended in 2006 counted exactly as
much as the one the candidate holds today, and `CareerPair.isCurrent` was recorded
without ever reaching the score. 0.043 is the skill-depreciation rate estimated in
the human-capital literature (~4.3%/yr), not a tuned constant. Applied to both
axes — an assignment long finished is less of a qualifying assignment too, not
only fewer relevant years — and it widens the genuine-versus-spurious separation
from +34 to +39 on the reference run, because the candidates whose only relevance
is old are exactly the ones it demotes. Each stint's factor is stored as
`CareerPair.recencyFactor`.

**Depth carries, breadth modulates (`w` = `CAREER_DEPTH_BREADTH_WEIGHT`, 0.25).**
This replaced `min(depthYears, depthRows)`. That rule was justified as "many brief
stints are capped by years, one long stint by rows", and the second half is a bug
wearing a rationale: one long stint *in the exact target job* is the strongest
evidence this criterion can receive. Measured on the reference run, a candidate
with 10.6 years as an *IT Application Development Analyst* scored **47** while
support-only candidates scored **100**. Of five shapes measured, the multiplicative
one separated genuine from spurious relevance by **+22** points; `min()` managed
+2, a geometric mean +16. `binding` now compares points *lost* (`1 − depthYears`
against `w × (1 − depthRows)`), because breadth can only ever cost `w` of the
score and the two attainments are no longer directly comparable.

**`sat` is `min(1, x)`** unless `CAREER_DEPTH_CONCAVITY` > 1, which applies
`x^(1/γ)` — the concave shape human-capital theory implies, and the reason the
Mincer earnings function fits experience quadratically. It is **default off
because it was measured and made this objective worse**: diminishing returns lift
the middle of the scale, and the middle is where long-but-irrelevant careers sit.
Separation fell from +39 at γ=1 to +30 at 1.5 and +24 at 2, and the corpus average
rose from 29 to 42. Right for modelling what experience *earns*, wrong for
deciding whether experience is *relevant*. Kept configurable so the choice stays
visible and re-testable.

**`T` IS ABSOLUTE.** It used to be median-of-pool × 2, which made Career the only
pool-relative quantity among the six aspects — and gave it a fatal corollary: the
yardstick shrinks exactly when the bench is weakest, so a hopeless pool scores
flatteringly. Measured, on runs in the database now:

| target | `T` | avg Career | avg with fixed 8/2 |
|---|---|---|---|
| LEARNING & DEVELOPMENT DEPT HEAD (pool avg relevance 0.168) | 2.06 yr / **1.0** stints — clamp floor, so ONE stint saturated that axis | 33.1 | **11.3** |
| IT APPLICATION DEVELOPMENT DEPT HEAD | 6.71 / 1.80 | 50.2 | 35.9 |
| IT APPLICATION DEVELOPMENT DEPT HEAD | 9.0 / 2.71 | 48.8 | 47.4 |

So the inflation ran 1.4× on a normal pool and 3× on a bad one, always toward
making a weak bench look viable. (The MCDM literature has a name for the general
problem — TOPSIS and VIKOR anchor on the extremes of whoever showed up, which is
what the Reference Ideal Method exists to avoid.)

Precedence now: **`inherited`** on an incremental run (the carried-over candidates
were scored against the base run's yardstick) → **`jd`**, the target job profile's
own `jobSpecification.experience` × `CAREER_DEPTH_STATED_MULTIPLIER`, used only
when it exceeds the default → **`fixed`**, `CAREER_DEPTH_TARGET_YEARS`/`_ROWS`
(8 / 2). The stated requirement is multiplied because it is a **minimum to be
eligible**, not the point deserving a full score — at ×1 everyone who qualifies
scores 100 and the criterion stops ranking. It is parseable on 182 of 275
profiles; `Fresh graduate` (75 profiles) yields null rather than 0, because a
stated requirement of none is not a statement that none is enough.

`runInfo.career.depth.source` carries which applied, echoed per candidate as
`careerMatching.targetSource`. **`pool` can only appear on runs finished before
this change**, and it is still labelled as pool-relative everywhere it renders,
because those scores are not comparable with later ones. The pool medians are
still measured and reported — "this bench's median relevant experience is 0.37
effective stints" is the most useful single sentence about a bench that scored
badly — they just no longer set the scale.

**Coverage is always reported.** `runInfo.career.coverage` and each candidate's
`careerMatching` carry how many stints (and years) were scored by document, by
fallback, and not at all, so a Career score over 20% of a candidate's tenure is
visibly different from one over 100%.

A stint that stays unscored is attributed to **which** of the three fallback
gates it failed (`CareerUnscoredReason`, per stint and tallied in
`coverage.unscoredByReason`), because each names different data to fix:

| reason | meaning | where the gap is |
|---|---|---|
| `no_target_reference` | the target has no reference competency set at all, so the fallback could not run for any stint | the target position — job profile, `critical_positions` competencies, incumbent |
| `no_position_code` | the stint is recorded by title only; incumbents are looked up by position code, so there is no key | the candidate's position-history rows (common for outside-company history) |
| `no_incumbent_competency` | the code IS known, but no usable holder (vacant, or only the candidate) or the holders carry no rows | `sync_employee_positions` / `sync_technical_competencies` |

This used to be one message asserting the third cause for all three, which sent
operators to `sync_employee_positions` when the real gap was elsewhere.

**Unscorable criteria are dropped, not zeroed.** If nobody could be scored on a
criterion (no reference competencies at all; no target document *and* no
reference set; every candidate's education unassessable), that column is removed
from the TOPSIS matrix and the remaining AHP weights are renormalized —
`runInfo.ahp.droppedCriteria` / `activeCriteria` / `effectiveWeights`. Leaving a
dead all-zero column in would consume its weight share and drag every closeness
score down without separating anyone.

#### Derived runs: "Tambah Kandidat Pembanding" (one mode, frozen parent)

Re-running a finished run is ONE operation: the parent, frozen, plus the people a
forum asked about. Rules: "Re-run scoring — aturan desain" in the root
`CLAUDE.md`; what the code did before: `docs/rerun-modes-inventory.md`. The web
app resolves what the child inherits and writes
`final_ranked.ahpRerun = { mode: "incremental_add", baseRunId, newCandidateIds,
existingPoolCandidateIds, frozen }` (contract mirrored in `src/rerun-freeze.ts`).
The engine then:

1. **Refuses anything else.** `parseRerunSpec` fails a session carrying a retired
   mode (`refresh_add`, `exclude`, `finalists_rematch`, `refresh_full`), a retired
   key (`ahpAugment`, `ahpExclude`, `ahpAlwaysInclude`) or no `frozen` block —
   a session queued by the old web app ends with that message instead of being
   scored under rules that no longer exist.
2. **Carries the parent's pool as it was.** Every non-new candidate — including
   `existingPoolCandidateIds`, people the user named who were already in the
   parent's pool below its cut — keeps ALL SIX aspects and the raw strings they
   were computed from (`loadCachedAspects` → `planFrozenRerun` →
   `assembleAspectScores`). Carried candidates soft-deleted since are loaded
   anyway (`loadAhpCandidates(…, carriedIds)`) and counted in
   `runInfo.rerun.carriedDeleted`. A carried candidate without stored aspects
   fails the run rather than being scored today.
3. **Scores only `newCandidateIds`**, against the parent's anchors
   (`inheritedTechnicalAnchors` / `inheritedCareerAnchors`), depth target and the
   reference date stint ages are measured to (`recencyFactor` / `stintYears` take
   `asOf`, Pers. 2.5).
4. **Ranks with the parent's priority vector and active criteria** —
   `frozenWeights` (the full-precision eigenvector, NOT re-derived from the stored
   matrix, which is rounded to 4 decimals and would move every closeness by
   ~1e-5) and `frozenDroppedCriteria` (a parent that dropped education keeps it
   dropped even when an added candidate could be assessed; the disagreement is
   recorded in `runInfo.rerun.criteriaLiveDisagrees`, not applied).
5. **Appends every named candidate below the cut when needed**, at its rank in
   the WHOLE pool (`analysis_results.rank` is 23, not 12). `is_finalist` in
   `scoring_run_pool_aspects` still means *made the cut*. Each row carries
   `details.ahpTopsis.rerunSource` (`new` / `existing_pool` / `carried`) and
   `rerunAnchorsSource`.
6. **Records what it ranked with.** Every AHP run — root or child — writes
   `runInfo.frozen` (`buildFrozenRecord`): weights, pairwise, active and dropped
   criteria, anchors, depth, reference date. A child records the inherited values,
   so a grandchild gets the ROOT's. A part the parent never recorded is
   `live_fallback`: resolved live, recorded, and filled into the child's
   `config_snapshot.rerun.frozen`. `runInfo.rerun.positionBasis` says when the
   position's job profile / competency reference changed between parent and
   child, since new candidates are scored against today's.

`runInfo.augment.shifts` keeps the before/after table, and `runInfo.freshness`
still measures how far carried candidates' behavior/PA/HAV have drifted since —
reported, never applied. The web app's "Selisih Peringkat" panel recomputes both
rankings from the stored pool aspects (`lib/run-diff.ts`, which mirrors
`topsisRank` + `rankCandidatesByTopsis` bit for bit) and explains the movement
deterministically.

Excluding a candidate is a MARK only (`scoring_run_exclusions`, web app); there is
no exclusion re-rank any more.

#### Ties break deterministically

`loadAhpCandidates` now has an `ORDER BY id`, and the closeness sort carries an
explicit `|| a.candidate.id.localeCompare(b.candidate.id)`. Without both, exact
ties — which happen, since two candidates with identical six-aspect scores get
bit-identical closeness — resolved by whatever row order Postgres happened to
return under an otherwise stable sort, so the same inputs could rank two ways.
The tiebreak is arbitrary on purpose: a "meaningful" one would be a seventh
criterion the run never declared. Real ties are broken by the manual tie-order
control on the position page, which is recorded.

#### Embeddings

The default is **Nomic Embed Text v2 MoE over an OpenAI-compatible endpoint**
(`EMBEDDING_PROVIDER=openai`, `EMBEDDING_API_BASE=http://localhost:11434/v1`,
768-dim) — deliberately the same model and transport the web app's Job Family
rebuild uses (`lib/job-family/embed.ts`), because every vector this service
compares against (`job_profile_embed`, `kamus_kompetensi_level_embed`) is written
there. A different model would put the two sides in different spaces and make
every cosine meaningless. `EMBEDDING_API_KEY` is sent as a bearer token when set.

Set `EMBEDDING_PROVIDER=transformers` + `EMBEDDING_MODEL=Xenova/multilingual-e5-base`
to go back to the in-process Transformers.js path — the model is then downloaded
from the HuggingFace Hub on FIRST use and cached on disk, so that first run needs
internet access (or a pre-populated `EMBEDDING_CACHE_DIR`).

Instruction prefixes are per model family (E5 `query: `, Nomic
`search_document: `/`search_query: `/`clustering: `). One case must NOT be
prefixed: reproducing a vector the web app stored via its OpenAI-compatible path,
which posts the text verbatim — `storedVectorKind()` derives the right convention
from the recorded `embedding_model`, and the synthetic job-profile document uses
it. Prefixing one side of a cosine comparison and not the other silently skews
every similarity.

Note that `CAREER_EMBED_MIN_SIM` (title ↔ `position_name` pairing) stays at
**0.98** regardless of model. That threshold was calibrated for E5; under Nomic
it is effectively unreachable, so most stints route through the competency
fallback by design. See `.env.example` for `EMBEDDING_*`,
`CAREER_FALLBACK_*`, and `EDUCATION_LLM_CONCURRENCY`.
