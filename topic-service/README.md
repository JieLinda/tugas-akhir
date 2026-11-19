# Pulse Topic Service

A standalone Python (FastAPI) service that runs **BERTopic** topic modeling over
job-profile document embeddings to discover **job families**. It is the
downstream half of the Job Family Discovery feature: the web app produces the
document embeddings (`job_profile_embed`), this service clusters them into topics
and extracts representative keywords.

## Why a separate (Python) service?

The clustering stack — **UMAP** (dimensionality reduction), **HDBSCAN**
(density clustering), and **c-TF-IDF** (class-based TF-IDF keyword extraction) —
is Python-native and has no equivalent in the Node/TS ecosystem. Rather than
reimplement it, this service uses the `bertopic` library directly. It mirrors
`scoring-service`'s pattern: a long-running job runs here as a background task,
mutating Postgres rows the web app polls for progress.

## The pipeline (5 steps)

| # | Step | Library | Config (Job Family → Configuration) |
|---|------|---------|--------------------------------------|
| 1 | **Embeddings** | — (precomputed) | read from `job_profile_embed.embedding` (768-dim) — NOT recomputed here |
| 2 | **Dimensionality reduction** | `umap-learn` | `nNeighbors`, `nComponents`, `minDist`, `metric` |
| 3 | **Clustering** | `hdbscan` | `minClusterSize`, `minSamples` (noise → topic `-1`) |
| 3b | **Outlier re-homing** | `bertopic` | `reduceOutliers`, `outlierStrategy`, `outlierThreshold`, `outlierCascade` |
| 4 | **Tokenization** | `scikit-learn` CountVectorizer + Sastrawi stopwords | `nGramMin`, `nGramMax` |
| 5 | **c-TF-IDF** | `bertopic` ClassTfidfTransformer | `topNWords` |

Plus: a second independent 2-D UMAP for scatter coordinates, and BERTopic
`hierarchical_topics` for the Family **Tree**.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/topics/build` | Start processing a run (`{ runId, config }`) — returns `202` immediately, work runs in the background |
| `GET`  | `/topics/:runId/status` | Current status of a run |
| `POST` | `/topics/trials` | Measure candidate configs on the current global corpus without persisting anything (`{ configs: [{ key, config, note }] }`, at most 12) — returns `202` + `trialId` |
| `GET`  | `/topics/trials/:trialId` | Progress and per-config results of a trial batch (kept in memory 30 min) |
| `GET`  | `/health` | Liveness + DB reachability |

The web app creates the `job_family_topic_runs` row first, then POSTs `runId`
here. Results land in `job_family_topics` + `job_family_topic_assignments`; the
web app reads them directly from Postgres.

## Running

```bash
cd topic-service
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
cp .env.example .env   # then edit POSTGRES_URL
uvicorn app.main:app --reload --port 8003
```

Or via Docker (part of the root `docker-compose.yml` as service `topic`):

```bash
docker compose up --build topic
```

## Outlier re-homing, and the threshold that makes it honest

HDBSCAN leaves anything it cannot fit into a dense cluster at topic `-1`. Those
documents are two different populations wearing one label: job profiles that sit
just outside a family (they failed a density rule, not a similarity test), and
job profiles that genuinely resemble nothing in the corpus — which is a finding,
not a defect.

`reduceOutliers` alone cannot tell them apart, so the pipeline exposes three
knobs rather than one:

| Config key | Default | Meaning |
|---|---|---|
| `outlierStrategy` | `embeddings` | How "nearest family" is measured |
| `outlierThreshold` | `0` | Minimum similarity before a document may be moved |
| `outlierCascade` | `false` | Retry the leftovers with the remaining strategies |

**`outlierThreshold` is the load-bearing one.** At `0`, every outlier is forced
into whichever family is nearest, however far that is — the count reaches zero
by hiding unrelated documents inside families they do not belong to, and once
inside, nothing marks the placement as doubtful. Above `0`, BERTopic zeroes any
similarity below the bar (`similarity[similarity < threshold] = 0`) and a row
that ends up all-zero stays `-1`, so what remains an outlier is exactly what is
close to nothing. The optimizer panel picks this value from the observed
distribution of `job_family_topic_assignments.alt_similarity` (widest gap in the
sorted list) instead of guessing a constant, because different corpora separate
at different values.

**The default strategy is `embeddings`, not the library's `distributions`.** It
is the only strategy that measures the same thing the map is built from — cosine
against each family's centroid in the original vector space, the same number
`getOutlierClusterDistancesAction` shows in the manual-mapping popup. The others
rank by keyword overlap, which can seat a document in a family it shares
vocabulary with while sitting far away on the map — surfacing much later as a
family member that "looks wrong", with no trace of why.

`outlierCascade` retries whatever is still `-1` with the remaining strategies **at
the same threshold**. It widens how many angles are tried; it never lowers the bar.

## Trials: measuring a config without building a map

The optimizer panel on Pengaturan Job Family offers a setting only after it has
been MEASURED to meet the user's goal on the corpus embedded now
(`lib/job-family/optimize/search.ts`). `POST /topics/trials` is that measurement.

- **Same code as a build.** `pipeline.cluster()` holds every step that decides
  which family a document lands in — UMAP, HDBSCAN, topic reduction, outlier
  re-homing — and both `build_topics()` and `measure()` go through it. A trial
  skips only what cannot change membership: the 2-D projection, keyword
  reasons, the Family Tree, generalized titles, persisting. Combined with the
  determinism below, a config measured here produces the same families when the
  map is rebuilt on the same corpus — which the web app then checks.
- **Nothing is written.** A trial run would become "the latest completed run",
  which the map, scoring-service's career anchors and the optimizer itself read.
  Batches live in memory for 30 minutes; the web app re-reads them from here,
  never from the browser, before it saves anything they measured.
- **Per-document results**, in `job_profile_id` order: family id (`membership`),
  cosine to the own family centroid and to the nearest other one, and whether
  re-homing placed the document. That is what lets "only genuinely unrelated
  positions stay outside" be judged on documents, not on a count.
- **UMAP output is shared between trials** with the same UMAP knobs on the same
  corpus (`_CachedReducer`, keyed by the corpus fingerprint). It holds what a
  fresh `fit` + `transform` with the same seed returns, so a cache hit changes
  the time, not the result. Builds never use it, so the check after a rebuild
  is an independent run.
- **Builds come first.** Builds and trials share one compute lock. A build that
  arrives while a batch runs is accepted, the batch stops after the config it is
  measuring (`status: "cancelled"`), and the build proceeds; a trial requested
  while a build runs gets `409`.

## Corpus fingerprint

Every completed run records the corpus it clustered in
`diagnostics.corpus = { fingerprint, documents }`, and every trial batch reports
the one it measured. The fingerprint is md5 over
`"job_profile_id:md5(document):md5(vector text)"` for each embedded row, in
`job_profile_id` order, joined by `","` — the per-row hashes computed by
Postgres, so the web app's SQL (`lib/job-family/corpus.ts`) produces the same
value. It hashes the vectors rather than `content_hash` on purpose: a re-embed
can return different vectors for identical text, and the vectors are what is
clustered. The web app uses it to say when the map no longer describes the
corpus, and to refuse applying a measurement made on a different one.

## Run diagnostics

Three post-clustering steps may fail without failing the run — outlier
re-homing, topic reduction (`nrTopics`), and `hierarchical_topics`. They used to
fail inside `except Exception: pass`, so a run read `completed` while the thing
the operator asked for had not happened, with no record anywhere.

They now write `job_family_topic_runs.diagnostics` (jsonb, `JobFamilyRunDiagnostics`
in `lib/db/schema.ts`): what each step did, what it skipped and why, and what it
threw. Two other honest notes land there too — `nrTopics: N` yields `N-1` real
families when outliers are present (the library counts the outlier topic), and
`diversity` is recorded as ignored because MMR needs a word-embedding model
inside this service while the vectors here arrive precomputed.

## Calculation trace (`job_family_topic_traces`)

A build keeps its result (families, assignments, keywords) and the diagnostics
above, but the numbers in between live inside the fitted models and used to die
with the process. `app/trace.py` copies them out after the fit — read-only;
nothing in it can change a result — into one gzip-JSON row per run
(`job_family_topic_traces`, drizzle/0094), which the web app turns into the
"Unduh trace perhitungan (XLSX)" workbook on Pengaturan Job Family
(`lib/job-family-trace/`): every step from a job profile's text to its family
written as live Excel formulas beside the numbers recorded here.

What is recorded, per run: the corpus exactly as clustered (documents, vectors,
per-document provenance incl. the template and extracted-data hash the web app
now stores on `job_profile_embed`); UMAP's exact kNN (indices + float32
distances), σ, ρ, the full fuzzy graph AND the graph the layout kept, `a`/`b`,
the coordinates; HDBSCAN's core distances, spanning tree (`gen_min_span_tree`,
the one constructor difference — it only keeps the tree HDBSCAN builds anyway),
single-linkage tree, condensed tree, stability, selection, labels, hard and soft
membership and exemplars; BERTopic's label→topic mappings (fit and after
`nrTopics`), topic embeddings, every re-homing step with the similarities it
judged; the c-TF-IDF count triplets, idf and weights; keyword presence per
document; the 2-D projection; the hierarchy's distance matrix and Ward linkage;
generalization nodes; and the seed-stability partitions.

Three things the library does not leave where you would look, each measured:

- **`graph_` is the PRUNED graph.** `simplicial_set_embedding()` zeroes every edge
  below `max/n_epochs` in place on the model's own matrix and leaves the zeros
  stored. The full graph is rebuilt with the library's `fuzzy_simplicial_set`
  and the check is that pruning it gives back `graph_` exactly.
- **HDBSCAN's core distance is the `(min_samples + 1)`-th neighbour including
  the point itself.** `PredictionData` keeps a `core_distances` with
  `k = min_samples` — a different number — so it is not the one recorded.
- **The transformer normalises its input in place**, so the c-TF-IDF count
  matrix no longer exists after a fit; it is recomputed from the per-topic
  documents with the fitted vectorizer and checked against the model's weights.

Each recorder reports in `checks` how far its recomputation is from the fitted
model (all exact on the runs measured). A trace that cannot be built or stored
never fails the build: the run records `diagnostics.trace = { stored: false,
error }` and the export says so. Trials do not record (`record=False`).

## Notes

- **Prereqs:** migration `0037_job_family_topics.sql` applied, and
  `job_profile_embed` populated (Job Family → Configuration → *Bangun Ulang
  Embedding*). With zero embedded documents a run fails fast with a clear message.
- **Image size:** `bertopic` hard-depends on `sentence-transformers`/`torch`.
  The Dockerfile installs the **CPU-only** torch wheel (~200MB) since we never
  embed here — only cluster precomputed vectors.
- **Determinism:** UMAP uses `randomState` from config (default 42), HDBSCAN is
  deterministic, and documents load in `job_profile_id` order, so repeated runs
  over an unchanged corpus reproduce exactly — the property the optimizer's
  measurements rely on. Verified (fresh processes, 1 vs N threads, other
  `PYTHONHASHSEED`, trial vs build) by `python scripts/verify_reproducibility.py`
  (`--db` for the real corpus). Two caveats are recorded on every build rather
  than assumed: `diagnostics.reproducibility` (seed, order, exact library
  versions — requirements.txt holds ranges, so an image rebuild can move the map
  under the same seed) and `diagnostics.seedStability` (the map re-clustered
  under `randomState+1..k`, `TOPIC_SEED_STABILITY_SEEDS`, default 3, 0 = off,
  compared by ARI, plus the documents whose family-mates change). Reproducible
  is not robust: another seed can give a different partition, and the
  optimizer's diagnosis says how much. One exception to "exactly", measured:
  when two Ward merges of the Family Tree sit at exactly the same distance,
  BERTopic's `get_unique_distances` separates them with UNSEEDED
  `np.random.uniform` noise (≤ 1e-7), so those tied distances differ in the 8th
  decimal between two builds of one corpus — the families, assignments,
  keywords and the tree's shape and names do not. The trace workbook compares
  those rows within 1e-6 for that reason.
- **Concurrency:** one computation at a time (in-process lock). A second
  concurrent `/topics/build` returns `409`; a build during a trial batch waits
  for the batch to stop (see Trials).
