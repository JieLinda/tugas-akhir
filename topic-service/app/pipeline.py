"""The BERTopic topic-modeling pipeline — the five steps requested, in order:

  1. Embeddings          — consumed precomputed from Postgres (job_profile_embed),
                           NOT recomputed here (passed in as `embeddings`).
  2. Dimensionality      — UMAP reduces the 768-dim vectors to `nComponents` dims
     reduction             so HDBSCAN clusters on a compact, denser space.
  3. Clustering          — HDBSCAN groups the reduced vectors, leaving dissimilar
                           documents as noise (topic -1).
  4. Tokenization        — all documents in one cluster are concatenated and
                           tokenized (CountVectorizer, Indonesian stopwords,
                           n-gram range) — handled inside BERTopic per class.
  5. c-TF-IDF            — class-based TF-IDF scores how important each word is to
                           one cluster vs the others → representative keywords.

We drive BERTopic with explicit UMAP / HDBSCAN / CountVectorizer / c-TF-IDF
sub-models so each configured parameter (from the Job Family Configuration UI)
maps to exactly one step. A second, independent 2-D UMAP produces scatter
coordinates for the visualization.

Everything that decides WHICH family a document lands in — steps 2 to 4 plus
topic reduction and outlier re-homing — lives in `cluster()`, and both callers
go through it: `build_topics()` for a real run, `measure()` for an optimizer
trial. That is what lets the optimizer promise a result before anything is
saved: a trial is not a model of the rebuild, it is the rebuild's own code up to
the point where membership is final, and the pipeline is deterministic (fixed
`randomState`, documents loaded in `job_profile_id` order).
"""


from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
from bertopic import BERTopic
from bertopic.vectorizers import ClassTfidfTransformer
from hdbscan import HDBSCAN
from sklearn.feature_extraction.text import CountVectorizer
from umap import UMAP


ProgressCb = Callable[[dict[str, Any]], None]
TOTAL_PHASES = 5

# ── Penempatan ulang outlier ────────────────────────────────────────────────
#
# BERTopic menyediakan empat cara memindahkan dokumen bertopik -1 ke famili
# terdekat, dan keempatnya mengukur "terdekat" dengan satuan yang BERBEDA.
# Perbedaan itu penting dan bukan detail teknis:
#
#   embeddings    — cosine vektor dokumen terhadap centroid embedding tiap
#                   famili (rata-rata vektor anggotanya). Inilah satu-satunya
#                   strategi yang mengukur hal yang SAMA dengan yang dipakai
#                   membentuk petanya, sehingga angkanya sebanding dengan
#                   `centroidSimilarity` yang ditampilkan popup pemetaan manual.
#   c-tf-idf      — cosine bobot kata dokumen terhadap bobot kata tiap famili.
#                   Bagus saat kosakata jabatan sangat khas, tetapi bisa
#                   menempatkan dokumen ke famili yang hanya berbagi istilah
#                   umum sementara isinya jauh berbeda.
#   distributions — memotong dokumen menjadi jendela 4 token lalu mencari topik
#                   yang paling sering muncul. Paling lambat, dan menilai dari
#                   potongan, bukan dari dokumen utuh.
#   probabilities — memakai soft-membership HDBSCAN; hanya tersedia bila
#                   calculateProbabilities aktif.
#
# Bawaan kami adalah `embeddings` — BUKAN `distributions` (bawaan pustaka).
# Alasannya satu: seluruh peta job family dibangun dari kemiripan embedding,
# jadi outlier yang dipindahkan atas dasar tumpang-tindih kata dapat mendarat di
# famili yang menurut petanya sendiri jauh — dan itu muncul belakangan sebagai
# anggota famili yang "kelihatan salah" tanpa jejak sebabnya.
OUTLIER_STRATEGIES = ("embeddings", "c-tf-idf", "distributions", "probabilities")

# Urutan saat cascade dinyalakan: ukuran yang paling dapat dipertanggungjawabkan
# lebih dulu, yang paling longgar terakhir. Tiap tahap hanya menggarap dokumen
# yang MASIH -1, dan tiap tahap tunduk pada ambang yang sama — sehingga cascade
# menambah jangkauan, bukan menurunkan standar.
CASCADE_ORDER = ("embeddings", "c-tf-idf", "distributions")


@dataclass
class Clustering:
    """Outcome of `cluster()`: final membership plus what the rest of a build needs."""

    topic_model: Any
    topics: list[int]
    # Per document: HDBSCAN left it at -1 (after any topic reduction), before
    # outlier re-homing ran. A document that is -1 here and in a family in
    # `topics` was placed by re-homing, not by clustering.
    noise_before_rehoming: list[bool]
    prob_per_doc: list[float | None]
    diagnostics: dict[str, Any]
    vectorizer_model: Any
    metric: str
    random_state: int
    # Calculation trace (app/trace.py) — builds only; None for optimizer trials.
    trace: dict[str, Any] | None = None


# Cache of UMAP output shared by the trials of one corpus: key → reduced vectors.
ReducedCache = dict[tuple[Any, ...], np.ndarray]


class _CachedReducer:
    """A UMAP whose output is shared between trials that use the same UMAP knobs.

    Most optimizer candidates only move HDBSCAN or c-TF-IDF parameters, so they
    would recompute an identical reduction. The cached value is what BERTopic
    itself would have produced — `fit(X)` then `transform(X)` on a fresh UMAP
    with the same seed — so a cache hit changes the running time, not the
    result. The key must identify the input vectors; callers include the corpus
    fingerprint in it.
    """

    def __init__(self, make: Callable[[], Any], cache: ReducedCache, key: tuple[Any, ...]):
        self._make = make
        self._cache = cache
        self._key = key
        self._reduced: np.ndarray | None = None

    def fit(self, X: Any, y: Any = None) -> "_CachedReducer":
        hit = self._cache.get(self._key)
        if hit is None:
            model = self._make()
            model.fit(X)
            hit = np.asarray(model.transform(X))
            self._cache[self._key] = hit
        self._reduced = hit
        return self

    def transform(self, X: Any) -> np.ndarray:
        if self._reduced is None:
            raise RuntimeError("_CachedReducer.transform dipanggil sebelum fit.")
        return self._reduced


def cluster(
    documents: list[str],
    embeddings: np.ndarray,
    cfg: dict[str, Any],
    progress_cb: ProgressCb,
    *,
    reduced_cache: ReducedCache | None = None,
    cache_scope: str = "",
    record: bool = False,
) -> Clustering:
    """Steps 2–4 plus topic reduction and outlier re-homing: every step that
    decides which family a document is in. `reduced_cache` (trials only) reuses
    the UMAP output of an earlier trial with the same UMAP knobs; `cache_scope`
    must identify the corpus, because the cache key otherwise holds only knobs.

    `record` (builds only) copies the intermediates out of the fitted models
    into `Clustering.trace` (app/trace.py). It changes no result: the one
    constructor difference, `gen_min_span_tree`, only makes HDBSCAN keep the
    spanning tree it builds anyway."""
    from .stopwords import stopwords_for

    n_docs = len(documents)

    # ── Parse config — EVERY key here maps to a real pipeline knob (defaults
    #    mirror lib/job-family/config.ts). ──
    n_neighbors = int(cfg.get("nNeighbors", 15))
    n_components = int(cfg.get("nComponents", 5))
    min_dist = float(cfg.get("minDist", 0.0))
    metric = str(cfg.get("metric", "cosine"))

    min_cluster_size = int(cfg.get("minClusterSize", 5))
    _min_samples = cfg.get("minSamples", None)
    min_samples = int(_min_samples) if _min_samples not in (None, "") else None
    cluster_selection_method = str(cfg.get("clusterSelectionMethod", "eom"))
    if cluster_selection_method not in ("eom", "leaf"):
        cluster_selection_method = "eom"
    cluster_selection_epsilon = float(cfg.get("clusterSelectionEpsilon", 0.0))

    ngram_min = int(cfg.get("nGramMin", 1))
    ngram_max = int(cfg.get("nGramMax", 2))
    min_df = int(cfg.get("minDf", 1))
    max_df = float(cfg.get("maxDf", 1.0))
    stop_words = stopwords_for(str(cfg.get("stopwords", "indonesian")))

    top_n_words = int(cfg.get("topNWords", 10))
    reduce_frequent_words = bool(cfg.get("reduceFrequentWords", True))
    bm25_weighting = bool(cfg.get("bm25Weighting", False))

    _nr_topics = cfg.get("nrTopics", None)
    nr_topics = int(_nr_topics) if _nr_topics not in (None, "", 0) else None
    reduce_outliers = bool(cfg.get("reduceOutliers", False))
    outlier_strategy = str(cfg.get("outlierStrategy", "embeddings")).lower()
    if outlier_strategy not in OUTLIER_STRATEGIES:
        outlier_strategy = "embeddings"
    try:
        outlier_threshold = float(cfg.get("outlierThreshold", 0.0) or 0.0)
    except (TypeError, ValueError):
        outlier_threshold = 0.0
    outlier_threshold = max(0.0, min(1.0, outlier_threshold))
    outlier_cascade = bool(cfg.get("outlierCascade", False))
    calc_probs = bool(cfg.get("calculateProbabilities", True))
    _diversity = cfg.get("diversity", None)
    diversity = float(_diversity) if _diversity not in (None, "") else None
    random_state = int(cfg.get("randomState", 42))

    # Clamp to the dataset so tiny corpora don't blow up UMAP/HDBSCAN/vectorizer.
    n_neighbors = max(2, min(n_neighbors, n_docs - 1))
    n_components = max(2, min(n_components, max(2, n_docs - 2)))
    min_cluster_size = max(2, min(min_cluster_size, n_docs))
    ngram_min = max(1, ngram_min)
    ngram_max = max(ngram_min, ngram_max)
    min_df = max(1, min(min_df, n_docs))
    if not (0.0 < max_df <= 1.0):
        max_df = 1.0
    # Keep min_df ≤ max_df (else CountVectorizer raises); relax max_df if needed.
    max_df_count = int(max_df * n_docs) if max_df <= 1.0 else int(max_df)
    if min_df > max_df_count:
        max_df = 1.0

    # ── Step 2: UMAP (dimensionality reduction for clustering) ──
    progress_cb(_p("umap", 1, f"Reduksi dimensi UMAP → {n_components}D..."))

    def make_umap() -> UMAP:
        return UMAP(
            n_neighbors=n_neighbors,
            n_components=n_components,
            min_dist=min_dist,
            metric=metric,
            random_state=random_state,
        )

    umap_model: Any = (
        _CachedReducer(
            make_umap,
            reduced_cache,
            (cache_scope, n_docs, n_neighbors, n_components, min_dist, metric, random_state),
        )
        if reduced_cache is not None
        else make_umap()
    )

    # ── Step 3: HDBSCAN (clustering, noise → -1) ──
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method=cluster_selection_method,
        cluster_selection_epsilon=cluster_selection_epsilon,
        prediction_data=True,
        gen_min_span_tree=record,
    )

    # ── Steps 4 & 5: tokenization + c-TF-IDF ──
    vectorizer_model = CountVectorizer(
        ngram_range=(ngram_min, ngram_max),
        stop_words=stop_words,
        min_df=min_df,
        max_df=max_df,
    )
    ctfidf_model = ClassTfidfTransformer(
        reduce_frequent_words=reduce_frequent_words,
        bm25_weighting=bm25_weighting,
    )

    # Optional keyword diversification (Maximal Marginal Relevance).
    representation_model = None
    if diversity and diversity > 0:
        from bertopic.representation import MaximalMarginalRelevance

        representation_model = MaximalMarginalRelevance(diversity=min(1.0, diversity))

    topic_model = BERTopic(
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        vectorizer_model=vectorizer_model,
        ctfidf_model=ctfidf_model,
        representation_model=representation_model,
        top_n_words=top_n_words,
        calculate_probabilities=calc_probs,
        verbose=False,
    )

    progress_cb(_p("cluster", 2, "Clustering HDBSCAN + ekstraksi c-TF-IDF..."))
    topics, probs = topic_model.fit_transform(documents, embeddings=embeddings)
    prob_per_doc = _doc_probabilities(probs, n_docs)

    trace: dict[str, Any] | None = None
    if record:
        from . import trace as tr

        trace = {
            "effective": {
                "nNeighbors": n_neighbors,
                "nComponents": n_components,
                "minDist": min_dist,
                "metric": metric,
                "minClusterSize": min_cluster_size,
                "minSamples": min_samples,
                "clusterSelectionMethod": cluster_selection_method,
                "clusterSelectionEpsilon": cluster_selection_epsilon,
                "nGramMin": ngram_min,
                "nGramMax": ngram_max,
                "minDf": min_df,
                "maxDf": max_df,
                "topNWords": top_n_words,
                "reduceFrequentWords": reduce_frequent_words,
                "bm25Weighting": bm25_weighting,
                "nrTopics": nr_topics,
                "reduceOutliers": reduce_outliers,
                "outlierStrategy": outlier_strategy,
                "outlierThreshold": outlier_threshold,
                "outlierCascade": outlier_cascade,
                "calculateProbabilities": calc_probs,
                "diversity": diversity,
                "randomState": random_state,
            },
            "umap": tr.umap_trace(topic_model.umap_model, embeddings),
            "hdbscan": tr.hdbscan_trace(topic_model.hdbscan_model, topic_model.umap_model.embedding_),
            "mappingFit": tr.mapping_trace(topic_model),
            "topicsFit": [int(t) for t in topics],
            "probabilities": tr.f64(np.asarray(probs)) if probs is not None else None,
            "topicEmbeddingsFit": tr.topic_embedding_trace(topic_model),
        }

    # Setiap langkah pasca-clustering di bawah ini DAPAT gagal tanpa menggagalkan
    # run — dan dulu memang gagal diam-diam. `diagnostics` adalah tempat kegagalan
    # dan penurunan mutu itu dicatat, supaya run yang berstatus "completed" tidak
    # lagi berarti "semua langkah berhasil". Isinya ikut tersimpan pada baris run
    # dan dibaca panel Pengaturan maupun asisten optimasi.
    diagnostics: dict[str, Any] = {}

    if diversity and diversity > 0:
        # MMR menuntut model embedding kata di dalam BERTopic; service ini sengaja
        # tidak memuatnya (vektor dokumen datang precomputed dari web app), jadi
        # pustaka mengembalikan kata kunci apa adanya. Dicatat, bukan didiamkan —
        # parameter yang tampak aktif tetapi tidak berpengaruh adalah cara
        # tercepat membuat orang salah menyimpulkan sebab-akibat.
        diagnostics["diversityIgnored"] = (
            "Parameter diversity (MMR) tidak berpengaruh pada pipeline ini: "
            "penyusunan ulang kata kunci membutuhkan model embedding kata di dalam "
            "topic-service, sedangkan vektor di sini datang sudah jadi dari web app."
        )

    # Optional topic reduction — merge similar topics down to nr_topics.
    found = len({int(t) for t in topics if int(t) != -1})
    has_outliers = any(int(t) == -1 for t in topics)
    if nr_topics is not None and 1 <= nr_topics < found:
        try:
            topic_model.reduce_topics(documents, nr_topics=nr_topics)
            topics = list(topic_model.topics_)
            after_reduce = len({int(t) for t in topics if int(t) != -1})
            diagnostics["topicReduction"] = {
                "requested": nr_topics,
                "before": found,
                "after": after_reduce,
                # BERTopic meminta `nr_topics - 1` klaster bila topik -1 ada, jadi
                # permintaan 10 menghasilkan 9 famili nyata. Disebutkan supaya
                # selisih satu ini tidak terbaca sebagai kesalahan.
                "note": (
                    "Topik outlier ikut dihitung pustaka, sehingga hasilnya satu "
                    "famili lebih sedikit dari angka yang diminta."
                    if has_outliers
                    else None
                ),
            }
        except Exception as exc:  # noqa: BLE001
            diagnostics["topicReduction"] = {
                "requested": nr_topics,
                "before": found,
                "after": found,
                "error": str(exc)[:300],
            }
    elif nr_topics is not None:
        diagnostics["topicReduction"] = {
            "requested": nr_topics,
            "before": found,
            "after": found,
            "note": (
                f"Tidak ada yang dipangkas: clustering hanya menghasilkan {found} famili, "
                f"tidak lebih dari {nr_topics} yang diminta."
            ),
        }

    noise_before_rehoming = [int(t) == -1 for t in topics]
    if trace is not None and nr_topics is not None:
        from . import trace as tr

        trace["mappingReduced"] = tr.mapping_trace(topic_model)
        trace["topicsReduced"] = [int(t) for t in topics]
        trace["topicEmbeddingsReduced"] = tr.topic_embedding_trace(topic_model)

    # Optional outlier reassignment — push topic -1 docs to their nearest topic.
    if reduce_outliers and any(int(t) == -1 for t in topics):
        progress_cb(_p("cluster", 2, "Menempatkan ulang dokumen outlier..."))
        topics, outlier_report = _reduce_outliers(
            topic_model,
            documents,
            embeddings,
            [int(t) for t in topics],
            probs,
            strategy=outlier_strategy,
            threshold=outlier_threshold,
            cascade=outlier_cascade,
            vectorizer_model=vectorizer_model,
            ctfidf_model=ctfidf_model,
            representation_model=representation_model,
            top_n_words=top_n_words,
            trace=trace,
        )
        diagnostics["outlierReduction"] = outlier_report

    return Clustering(
        topic_model=topic_model,
        topics=[int(t) for t in topics],
        noise_before_rehoming=noise_before_rehoming,
        prob_per_doc=prob_per_doc,
        diagnostics=diagnostics,
        vectorizer_model=vectorizer_model,
        metric=metric,
        random_state=random_state,
        trace=trace,
    )


def build_topics(
    documents: list[str],
    embeddings: np.ndarray,
    cfg: dict[str, Any],
    progress_cb: ProgressCb,
    record: bool = False,
) -> dict[str, Any]:
    n_docs = len(documents)
    fitted = cluster(documents, embeddings, cfg, progress_cb, record=record)
    topic_model = fitted.topic_model
    topics = fitted.topics
    prob_per_doc = fitted.prob_per_doc
    diagnostics = fitted.diagnostics
    vectorizer_model = fitted.vectorizer_model
    metric = fitted.metric
    random_state = fitted.random_state

    # ── 2-D projection for the scatter view (independent of the clustering reduction) ──
    progress_cb(_p("project", 3, "Proyeksi 2D untuk visualisasi..."))
    coords2d, reducer2d = _project_2d(embeddings, metric, random_state, n_docs)

    # ── Assemble topic representations ──
    progress_cb(_p("topics", 4, "Menyusun kata kunci per topik..."))
    topic_info = topic_model.get_topic_info()

    topics_out: list[dict[str, Any]] = []
    for _, row in topic_info.iterrows():
        tid = int(row["Topic"])
        raw_words = topic_model.get_topic(tid) or []
        keywords = [
            {"word": str(w), "score": float(s)}
            for w, s in raw_words
            if isinstance(w, str) and w
        ]
        member_idx = [i for i, t in enumerate(topics) if t == tid]
        size = len(member_idx)

        if member_idx:
            cx = float(np.mean([coords2d[i][0] for i in member_idx]))
            cy = float(np.mean([coords2d[i][1] for i in member_idx]))
        else:
            cx = cy = None

        # Representative docs: highest membership probability within the topic.
        rep = sorted(member_idx, key=lambda i: (prob_per_doc[i] or 0.0), reverse=True)[:3]

        topics_out.append(
            {
                "topicId": tid,
                "label": _label(tid, keywords),
                "keywords": keywords,
                "size": size,
                "x": cx,
                "y": cy,
                "representativeIdx": rep,
            }
        )

    # ── Per-document "reason" it landed in its family (hybrid explanation) ──
    reasons = _document_reasons(documents, embeddings, topics, topics_out, vectorizer_model)
    assignments_out = [
        {
            "idx": i,
            "topicId": topics[i],
            "probability": prob_per_doc[i],
            "x": float(coords2d[i][0]),
            "y": float(coords2d[i][1]),
            "matchedKeywords": reasons[i]["matchedKeywords"],
            "centroidSimilarity": reasons[i]["centroidSimilarity"],
            "altTopicId": reasons[i]["altTopicId"],
            "altSimilarity": reasons[i]["altSimilarity"],
        }
        for i in range(n_docs)
    ]

    num_topics = len([t for t in {int(x) for x in topics} if t != -1])

    # ── Hierarchical topics → Family Tree (needs ≥ 2 real topics) ──
    hierarchy = None
    if num_topics >= 2:
        try:
            htopics = topic_model.hierarchical_topics(documents)
            hierarchy = _serialize_hierarchy(htopics)
        except Exception as exc:  # noqa: BLE001
            hierarchy = None
            diagnostics["hierarchy"] = {
                "built": False,
                "error": str(exc)[:300],
                "note": "Family Tree tidak terbentuk; peta dan daftar famili tetap utuh.",
            }
    else:
        diagnostics["hierarchy"] = {
            "built": False,
            "note": f"Family Tree membutuhkan minimal 2 famili; run ini menghasilkan {num_topics}.",
        }

    trace = fitted.trace
    if trace is not None:
        from . import trace as tr

        keyword_lists = {
            int(t["topicId"]): [(k["word"], k["score"]) for k in t["keywords"]] for t in topics_out
        }
        trace["topicsFinal"] = list(topics)
        trace["noiseBeforeRehoming"] = list(fitted.noise_before_rehoming)
        trace["probPerDoc"] = [None if p is None else float(p) for p in prob_per_doc]
        trace["ctfidf"] = tr.ctfidf_trace(topic_model, documents, list(topics), keyword_lists)
        trace["presence"] = tr.presence_trace(
            vectorizer_model,
            documents,
            list(topics),
            {tid: [w for w, _ in kws] for tid, kws in keyword_lists.items()},
        )
        trace["projection2d"] = (
            {**tr.umap_trace(reducer2d, embeddings, with_graph=False), "coords": tr.f32(np.asarray(coords2d))}
            if reducer2d is not None
            else {"coords": tr.f32(np.asarray(coords2d))}
        )
        trace["topicsOut"] = [
            {
                "topicId": int(t["topicId"]),
                "label": t["label"],
                "size": int(t["size"]),
                "x": t["x"],
                "y": t["y"],
                "representativeIdx": [int(i) for i in t["representativeIdx"]],
            }
            for t in topics_out
        ]
        trace["hierarchy"] = tr.hierarchy_trace(topic_model) if num_topics >= 2 else None

    return {
        "topics": topics_out,
        "assignments": assignments_out,
        "hierarchy": hierarchy,
        "numTopics": num_topics,
        "diagnostics": diagnostics,
        "trace": trace,
    }


def measure(
    documents: list[str],
    embeddings: np.ndarray,
    cfg: dict[str, Any],
    *,
    reduced_cache: ReducedCache | None = None,
    cache_scope: str = "",
) -> dict[str, Any]:
    """What a build with `cfg` would produce on this corpus, without building it.

    Runs `cluster()` — the same code a build runs — and skips only what cannot
    change membership: the 2-D projection, per-document keyword reasons, the
    Family Tree, the generalized titles, and persisting. The numbers returned
    are the ones the optimizer judges a goal by, measured the way the panel
    measures a finished run (`_document_reasons`): family sizes, outliers, and
    per document the cosine to its own family centroid and to the nearest
    other one.

    Per-document arrays are in corpus order (job_profile_id ascending). Topic
    ids are BERTopic's frequency order, so two trials are compared as
    partitions, never by id.
    """
    fitted = cluster(
        documents,
        embeddings,
        cfg,
        lambda _p: None,
        reduced_cache=reduced_cache,
        cache_scope=cache_scope,
    )
    topics = fitted.topics
    real_ids = sorted({t for t in topics if t != -1})

    emb_n = _unit_rows(embeddings)
    centroids = _family_centroids(emb_n, topics)
    own_similarity: list[float | None] = []
    nearest_similarity: list[float | None] = []
    for i, tid in enumerate(topics):
        own_similarity.append(float(np.dot(emb_n[i], centroids[tid])) if tid in centroids else None)
        nearest_similarity.append(_nearest_family(emb_n[i], centroids, exclude=tid)[1])

    keywords: dict[str, list[str]] = {}
    for tid in real_ids:
        raw_words = fitted.topic_model.get_topic(tid) or []
        keywords[str(tid)] = [str(w) for w, _ in raw_words if isinstance(w, str) and w]

    return {
        "topicCount": len(real_ids),
        "outlierCount": sum(1 for t in topics if t == -1),
        "numDocuments": len(topics),
        "sizes": [sum(1 for t in topics if t == tid) for tid in real_ids],
        "keywords": keywords,
        "membership": topics,
        "ownSimilarity": own_similarity,
        "nearestSimilarity": nearest_similarity,
        "rehomed": [
            noise and tid != -1 for noise, tid in zip(fitted.noise_before_rehoming, topics)
        ],
        "diagnostics": fitted.diagnostics,
    }


# ── helpers ────────────────────────────────────────────────────────

def _p(phase: str, done: int, message: str) -> dict[str, Any]:
    return {"phase": phase, "done": done, "total": TOTAL_PHASES, "message": message}


def _reduce_outliers(
    topic_model: Any,
    documents: list[str],
    embeddings: np.ndarray,
    topics: list[int],
    probs: Any,
    *,
    strategy: str,
    threshold: float,
    cascade: bool,
    vectorizer_model: Any,
    ctfidf_model: Any,
    representation_model: Any,
    top_n_words: int,
    trace: dict[str, Any] | None = None,
) -> tuple[list[int], dict[str, Any]]:
    """Pindahkan dokumen bertopik -1 ke famili terdekat, dengan AMBANG.

    Ambang inilah bagian yang membedakan fungsi ini dari pemanggilan polos
    `reduce_outliers()`. Tanpa ambang, penempatan ulang bersifat semua-atau-tidak:
    setiap outlier dipaksa masuk ke famili apa pun yang kebetulan paling dekat,
    betapa pun jauhnya — sehingga "0 outlier" tercapai dengan cara menyembunyikan
    dokumen yang memang tidak berhubungan dengan apa pun ke dalam famili yang
    salah. Dengan ambang, pustaka menolak penempatan yang kemiripannya di bawah
    nilai itu (`similarity[similarity < threshold] = 0`, lalu baris yang seluruhnya
    nol tetap -1), sehingga yang tersisa sebagai outlier adalah tepat dokumen yang
    tidak cukup dekat dengan famili mana pun — yang justru merupakan temuan.

    `cascade` mencoba sisa outlier dengan strategi berikutnya pada ambang yang
    sama. Yang bertambah adalah jumlah sudut pandang yang dicoba, bukan
    kelonggarannya.

    Kembaliannya adalah topik baru DAN laporan apa yang terjadi di tiap tahap —
    termasuk tahap yang gagal atau dilewati. Sebelumnya seluruh blok ini
    dibungkus `except: pass`, sehingga kegagalannya tidak terlihat di mana pun
    dan hasilnya terbaca sebagai "memang tidak ada yang bisa dipindahkan".
    """
    before = sum(1 for t in topics if t == -1)

    # Cascade hanya boleh melintasi strategi ketika ambangnya NOL.
    #
    # Ketiga strategi mengukur pada skala yang berbeda: cosine antar vektor
    # dokumen, cosine antar bobot c-TF-IDF, dan kecocokan potongan token. Angka
    # 0,45 bukan hal yang sama pada ketiganya, dan ambang di sini DIPILIH dari
    # sebaran kemiripan embedding (lihat lib/job-family/optimize/diagnose.ts). Memakai
    # ulang angka itu pada dua skala lain berarti diam-diam mengubah ketatnya
    # penyaringan justru pada parameter yang seluruh gunanya adalah menyatakan
    # ketatnya penyaringan.
    #
    # Pada ambang 0 tidak ada yang bisa salah kalibrasi: syaratnya hanya "ada
    # kemiripan positif", dan itu berlaku sama di skala mana pun. Karena itu
    # "jangan ada outlier sama sekali" (ambang 0) tetap memperoleh cascade penuh,
    # sedangkan "hanya yang benar-benar asing yang tersisa" (ambang > 0) bertahan
    # pada skala yang mengkalibrasinya.
    cross_scale_ok = threshold <= 0.0
    order = (
        list(dict.fromkeys([strategy, *CASCADE_ORDER]))
        if (cascade and cross_scale_ok)
        else [strategy]
    )
    limited_note = (
        "Cascade dibatasi pada strategi utama karena ambang > 0 dikalibrasi untuk "
        f"skala '{strategy}'; strategi lain memakai skala kemiripan yang berbeda."
        if (cascade and not cross_scale_ok)
        else None
    )

    steps: list[dict[str, Any]] = []
    current = list(topics)

    for strat in order:
        remaining = sum(1 for t in current if t == -1)
        if remaining == 0:
            break

        kwargs: dict[str, Any] = {}
        if strat == "embeddings":
            # Vektor dokumen diserahkan apa adanya; tanpa ini pustaka mencari
            # model embedding di dalam dirinya sendiri dan melempar ValueError,
            # karena vektor di service ini datang precomputed.
            kwargs["embeddings"] = embeddings
        elif strat == "probabilities":
            # Matriks dibaca dari MODEL, bukan dari `probs` yang ditangkap saat
            # fit: bila nrTopics memangkas topik lebih dulu, `reduce_topics`
            # mengikat ulang `probabilities_` ke matriks BARU yang jumlah dan
            # urutan kolomnya berbeda. Memakai salinan lama berarti argmax-nya
            # menunjuk topik yang salah — dan setiap outlier mendarat di famili
            # yang keliru tanpa satu pun tanda bahwa ada yang meleset.
            live = getattr(topic_model, "probabilities_", None)
            arr = np.asarray(live if live is not None else probs) if (
                live is not None or probs is not None
            ) else None
            if arr is None or arr.ndim != 2:
                steps.append(
                    {
                        "strategy": strat,
                        "remaining": remaining,
                        "skipped": "Butuh calculateProbabilities aktif (matriks probabilitas per topik).",
                    }
                )
                continue
            kwargs["probabilities"] = arr

        try:
            proposed = topic_model.reduce_outliers(
                documents, current, strategy=strat, threshold=threshold, **kwargs
            )
        except Exception as exc:  # noqa: BLE001
            steps.append({"strategy": strat, "remaining": remaining, "error": str(exc)[:200]})
            continue

        proposed = [int(t) for t in proposed]
        if trace is not None:
            trace.setdefault("rehoming", []).append(
                _rehoming_record(topic_model, documents, embeddings, current, proposed, strat, threshold)
            )
        after = sum(1 for t in proposed if t == -1)
        steps.append(
            {"strategy": strat, "reassigned": remaining - after, "remaining": after}
        )
        current = proposed

    after_all = sum(1 for t in current if t == -1)

    # Representasi topik disusun ulang SEKALI di akhir, bukan tiap tahap: tiap
    # tahap cascade harus menilai terhadap sasaran yang sama (c-TF-IDF dan
    # centroid dari clustering aslinya), dan memperbaruinya di tengah jalan akan
    # membuat tahap berikutnya mengejar sasaran yang sudah bergeser oleh
    # keputusan tahap sebelumnya.
    if after_all != before:
        try:
            topic_model.update_topics(
                documents,
                topics=current,
                vectorizer_model=vectorizer_model,
                ctfidf_model=ctfidf_model,
                representation_model=representation_model,
                # Tanpa ini pustaka memakai bawaan tanda tangannya (10) dan
                # diam-diam memangkas top_n_words yang dikonfigurasi user.
                top_n_words=top_n_words,
            )
        except Exception as exc:  # noqa: BLE001
            steps.append({"strategy": "update_topics", "error": str(exc)[:200]})

    if limited_note:
        steps.append({"strategy": "cascade", "skipped": limited_note})

    return current, {
        "strategy": strategy,
        "cascade": cascade,
        "cascadeApplied": len(order) > 1,
        "threshold": threshold,
        "before": before,
        "after": after_all,
        "reassigned": before - after_all,
        "steps": steps,
    }


def _rehoming_record(
    topic_model: Any,
    documents: list[str],
    embeddings: np.ndarray,
    before: list[int],
    proposed: list[int],
    strategy: str,
    threshold: float,
) -> dict[str, Any]:
    """One re-homing step as the library measured it: which documents were
    outliers, the similarity of each to every family under this strategy (the
    library's own formula, recomputed — it does not return it), the threshold,
    and what it proposed. Similarities are recorded for 'embeddings' and
    'c-tf-idf'; the other two strategies are recorded by outcome only."""
    from sklearn.metrics.pairwise import cosine_similarity

    from . import trace as tr

    outlier_ids = [i for i, t in enumerate(before) if t == -1]
    rec: dict[str, Any] = {
        "strategy": strategy,
        "threshold": float(threshold),
        "outlierIdx": outlier_ids,
        "proposed": [int(proposed[i]) for i in outlier_ids],
        "topicIds": None,
        "similarity": None,
    }
    try:
        offset = int(topic_model._outliers)
        if strategy == "embeddings" and getattr(topic_model, "topic_embeddings_", None) is not None:
            te = np.asarray(topic_model.topic_embeddings_)[offset:]
            sim = cosine_similarity(np.asarray(embeddings)[outlier_ids], te)
        elif strategy == "c-tf-idf":
            bow = topic_model.vectorizer_model.transform([documents[i] for i in outlier_ids])
            sim = cosine_similarity(topic_model.ctfidf_model.transform(bow), topic_model.c_tf_idf_[offset:])
        else:
            sim = None
        if sim is not None:
            rec["similarity"] = tr.f64(sim)
            rec["topicIds"] = sorted({int(t) for t in topic_model.topics_ if int(t) != -1})
    except Exception as exc:  # noqa: BLE001
        rec["error"] = str(exc)[:200]
    return rec


def _doc_probabilities(probs: Any, n_docs: int) -> list[float | None]:
    """Per-document membership strength. Handles both HDBSCAN's 1-D probabilities
    and BERTopic's 2-D probability matrix (max across topics)."""
    if probs is None:
        return [None] * n_docs
    arr = np.asarray(probs)
    if arr.size == 0:
        return [None] * n_docs
    if arr.ndim == 1:
        return [float(x) for x in arr]
    return [float(r.max()) for r in arr]


def _document_reasons(
    documents: list[str],
    embeddings: np.ndarray,
    topics: list[int],
    topics_out: list[dict[str, Any]],
    vectorizer_model: Any,
    max_keywords: int = 6,
) -> list[dict[str, Any]]:
    """Per-document hybrid "reason" it belongs to its family:

      • matchedKeywords    — the family's c-TF-IDF keywords that actually occur in
                             THIS document (deterministic keyword attribution via
                             the same CountVectorizer analyzer / n-gram scheme).
      • centroidSimilarity — cosine of the doc embedding to its family centroid
                             (mean of member vectors, original 768-dim space).
      • altTopicId / altSimilarity — the nearest OTHER family by centroid cosine,
                             a borderline / alternative-family signal.

    Noise (topic -1) docs get empty keywords + null own-family similarity (they
    still get a nearest real family as the alternative).
    """
    n = len(documents)
    kw_by_topic: dict[int, list[dict[str, Any]]] = {
        int(t["topicId"]): t.get("keywords", []) for t in topics_out
    }

    emb_n = _unit_rows(embeddings)
    centroids = _family_centroids(emb_n, topics)

    try:
        analyzer = vectorizer_model.build_analyzer()
    except Exception:
        analyzer = None

    out: list[dict[str, Any]] = []
    for i in range(n):
        tid = topics[i]

        matched: list[dict[str, Any]] = []
        if tid != -1 and analyzer is not None:
            try:
                terms = set(analyzer(documents[i]))
            except Exception:
                terms = set()
            for kw in kw_by_topic.get(tid, []):
                w = kw.get("word")
                if isinstance(w, str) and w in terms:
                    matched.append({"word": w, "score": float(kw.get("score", 0.0))})
                    if len(matched) >= max_keywords:
                        break

        centroid_sim: float | None = None
        if tid in centroids:
            centroid_sim = float(np.dot(emb_n[i], centroids[tid]))

        alt_id, alt_sim = _nearest_family(emb_n[i], centroids, exclude=tid)

        out.append(
            {
                "matchedKeywords": matched,
                "centroidSimilarity": centroid_sim,
                "altTopicId": alt_id,
                "altSimilarity": alt_sim,
            }
        )
    return out


def _unit_rows(embeddings: np.ndarray) -> np.ndarray:
    """L2-normalized rows, so cosine == dot product."""
    emb = np.asarray(embeddings, dtype=np.float32)
    norms = np.linalg.norm(emb, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return emb / norms


def _family_centroids(emb_n: np.ndarray, topics: list[int]) -> dict[int, np.ndarray]:
    """Real-topic centroids: the normalized mean of each family's member vectors."""
    n = len(topics)
    centroids: dict[int, np.ndarray] = {}
    for tid in {t for t in topics if t != -1}:
        member = [i for i in range(n) if topics[i] == tid]
        if not member:
            continue
        c = emb_n[member].mean(axis=0)
        cn = float(np.linalg.norm(c))
        centroids[tid] = c / cn if cn > 0 else c
    return centroids


def _nearest_family(
    vec: np.ndarray, centroids: dict[int, np.ndarray], *, exclude: int
) -> tuple[int | None, float | None]:
    """The nearest family other than `exclude`, by centroid cosine."""
    alt_id: int | None = None
    best = -2.0
    for otid, centroid in centroids.items():
        if otid == exclude:
            continue
        s = float(np.dot(vec, centroid))
        if s > best:
            best = s
            alt_id = otid
    return alt_id, (best if alt_id is not None else None)


# ── Reproducibility & seed stability ───────────────────────────────
#
# A fixed seed makes a run REPRODUCIBLE: same corpus (same rows, same
# job_profile_id order), same config, same library versions → the same map, bit
# for bit (verified across processes, thread counts and PYTHONHASHSEED by
# scripts/verify_reproducibility.py). It does NOT make the map ROBUST: UMAP's
# seed is a real input, and another seed over the same corpus can give a
# noticeably different partition. Two things follow, and both are recorded on
# the run so an expert reviewing a map can check them instead of trusting them:
#
#   reproducibility — the seed, the ordering rule and the exact library versions.
#     umap-learn / pynndescent / numba / hdbscan / scikit-learn / numpy are
#     version RANGES in requirements.txt, so an image rebuild can change the
#     result under the same seed; without the versions on the row, nobody could
#     tell a rebuilt image from a changed corpus.
#   seedStability — `cluster()` re-run under a few other seeds, compared with
#     the published partition by ARI, plus per document how consistently it
#     keeps the same family-mates. Measured, never fed back into the map: the
#     published partition is still the one under the configured seed.

REPRO_PACKAGES = (
    "umap-learn",
    "pynndescent",
    "numba",
    "hdbscan",
    "bertopic",
    "scikit-learn",
    "numpy",
    "scipy",
)

# Below this mean co-membership agreement a document is reported as unstable:
# under the other seeds it shares fewer than half of its family-mates.
UNSTABLE_DOC_AGREEMENT = 0.5
MAX_UNSTABLE_LISTED = 50


def reproducibility_record(cfg: dict[str, Any]) -> dict[str, Any]:
    """What someone needs to reproduce this run exactly, besides the corpus."""
    import platform
    from importlib.metadata import PackageNotFoundError, version

    versions: dict[str, str | None] = {"python": platform.python_version()}
    for pkg in REPRO_PACKAGES:
        try:
            versions[pkg] = version(pkg)
        except PackageNotFoundError:
            versions[pkg] = None
    return {
        "randomState": int(cfg.get("randomState", 42)),
        "documentOrder": "job_profile_id ascending",
        "versions": versions,
    }


def _co_membership_agreement(a: list[int], b: list[int]) -> list[float]:
    """Per document: Jaccard of its family-mates under `a` vs under `b`.

    An outlier (-1) is its own singleton family, so a document that is an
    outlier under both partitions agrees fully, and one that is an outlier
    under exactly one of them agrees by 1/|family|."""
    def groups(p: list[int]) -> list[frozenset[int]]:
        by: dict[int, set[int]] = {}
        for i, t in enumerate(p):
            if t != -1:
                by.setdefault(t, set()).add(i)
        frozen = {t: frozenset(s) for t, s in by.items()}
        return [frozen[t] if t != -1 else frozenset((i,)) for i, t in enumerate(p)]

    ga, gb = groups(a), groups(b)
    return [len(x & y) / len(x | y) for x, y in zip(ga, gb)]


def seed_stability(
    documents: list[str],
    embeddings: np.ndarray,
    cfg: dict[str, Any],
    published: list[int],
    n_seeds: int,
    progress_cb: ProgressCb = lambda _p: None,
) -> dict[str, Any] | None:
    """Re-run `cluster()` under `n_seeds` other seeds and compare with `published`.

    The alternative seeds are `randomState + 1 … randomState + n_seeds`, so the
    check itself is reproducible. Returns None when disabled."""
    if n_seeds <= 0:
        return None
    from sklearn.metrics import adjusted_rand_score

    base = int(cfg.get("randomState", 42))
    n = len(published)
    per_seed: list[dict[str, Any]] = []
    # The alternative partitions themselves — for the trace only (main.py pops
    # them before the summary is stored on the run), so the workbook can
    # recompute each ARI and each document's agreement from them.
    partitions: list[dict[str, Any]] = []
    agreement_sum = [0.0] * n
    for k in range(1, n_seeds + 1):
        seed = base + k
        progress_cb(_p("stability", 4, f"Uji stabilitas seed {k}/{n_seeds} (random_state={seed})..."))
        alt = cluster(documents, embeddings, {**cfg, "randomState": seed}, lambda _p: None).topics
        partitions.append({"seed": seed, "topics": [int(t) for t in alt]})
        agree = _co_membership_agreement(published, alt)
        for i, v in enumerate(agree):
            agreement_sum[i] += v
        per_seed.append(
            {
                "seed": seed,
                "ari": round(float(adjusted_rand_score(published, alt)), 4),
                "topicCount": len({t for t in alt if t != -1}),
                "outlierCount": sum(1 for t in alt if t == -1),
            }
        )

    mean_agreement = [s / n_seeds for s in agreement_sum]
    unstable = sorted(
        (i for i, v in enumerate(mean_agreement) if v < UNSTABLE_DOC_AGREEMENT),
        key=lambda i: mean_agreement[i],
    )
    aris = [s["ari"] for s in per_seed]
    return {
        "publishedSeed": base,
        "seeds": per_seed,
        "ariMean": round(float(np.mean(aris)), 4),
        "ariMin": round(float(np.min(aris)), 4),
        "meanAgreement": round(float(np.mean(mean_agreement)), 4) if n else None,
        "agreementThreshold": UNSTABLE_DOC_AGREEMENT,
        "unstableCount": len(unstable),
        # Indices into the run's document order; main.py maps them to
        # job_profile_id before persisting.
        "unstableIdx": unstable[:MAX_UNSTABLE_LISTED],
        "unstableAgreement": [round(mean_agreement[i], 4) for i in unstable[:MAX_UNSTABLE_LISTED]],
        "_partitions": partitions,
    }


def _project_2d(
    embeddings: np.ndarray, metric: str, random_state: int, n_docs: int
) -> tuple[list[list[float]], Any]:
    """2-D scatter coordinates, and the reducer that produced them (for the trace)."""
    if n_docs <= 2:
        return [[0.0, 0.0] for _ in range(n_docs)], None
    from umap import UMAP

    reducer = UMAP(
        n_neighbors=max(2, min(15, n_docs - 1)),
        n_components=2,
        min_dist=0.1,
        metric=metric,
        random_state=random_state,
    )
    return reducer.fit_transform(embeddings).tolist(), reducer


def _label(tid: int, keywords: list[dict[str, Any]]) -> str:
    if tid == -1:
        return "Noise / Outlier"
    top = [k["word"] for k in keywords[:4]]
    return ", ".join(top) if top else f"Topic {tid}"


def _serialize_hierarchy(htopics: Any) -> dict[str, Any]:
    """BERTopic's hierarchical_topics DataFrame → JSON linkage rows the UI can
    render as a collapsible tree."""
    rows: list[dict[str, Any]] = []
    for _, r in htopics.iterrows():
        rows.append(
            {
                "parentId": _s(r.get("Parent_ID")),
                "parentName": _s(r.get("Parent_Name")),
                "childLeftId": _s(r.get("Child_Left_ID")),
                "childLeftName": _s(r.get("Child_Left_Name")),
                "childRightId": _s(r.get("Child_Right_ID")),
                "childRightName": _s(r.get("Child_Right_Name")),
                "distance": _f(r.get("Distance")),
            }
        )
    return {"linkage": rows}


def _s(v: Any) -> str | None:
    return None if v is None else str(v)


def _f(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
