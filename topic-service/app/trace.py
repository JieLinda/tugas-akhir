"""Calculation trace of a job-family map build (`job_family_topic_traces`).

A build keeps its RESULT (families, assignments, keywords) and a few
diagnostics, but none of the numbers in between: UMAP's neighbour graph and its
per-document bandwidths, HDBSCAN's spanning tree and condensed tree, the
c-TF-IDF count matrix and idf weights, the soft-membership matrix behind each
"keanggotaan", the similarities that re-homed an outlier. Those live inside the
fitted models and disappear with the process. This module copies them out —
read-only, after the fact — so the web app can export a workbook in which every
step from a job profile's text to its family is a live Excel formula over the
numbers recorded here (lib/job-family-trace/).

Nothing here may change a result. Every function reads fitted models, recomputes
only what the library computed but did not keep (with the library's OWN
functions where they are public), and reports in `checks` how far its
recomputation is from the fitted model — so a recorder that silently drifted
from the library would show up as a number, not as a plausible workbook.

Vectors travel as base64 float32: they are float32 in the pipeline, and the
workbook writes each one back as the exact double of that float32.
"""

from __future__ import annotations

import base64
import gzip
import json
import math
from collections import Counter
from typing import Any

import numpy as np

TRACE_VERSION = 1


# ── encoding ─────────────────────────────────────────────────────────────


def f32(arr: Any) -> dict[str, Any]:
    """A float array as base64 little-endian float32, with its shape."""
    a = np.ascontiguousarray(np.asarray(arr, dtype="<f4"))
    return {"dtype": "f32", "shape": list(a.shape), "b64": base64.b64encode(a.tobytes()).decode("ascii")}


def f64(arr: Any) -> dict[str, Any]:
    """A float array as base64 little-endian float64 (values the library holds in double)."""
    a = np.ascontiguousarray(np.asarray(arr, dtype="<f8"))
    return {"dtype": "f64", "shape": list(a.shape), "b64": base64.b64encode(a.tobytes()).decode("ascii")}


def _num(v: Any) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def pack(trace: dict[str, Any]) -> bytes:
    """gzip(JSON) — what the table stores."""
    return gzip.compress(json.dumps(trace, separators=(",", ":"), allow_nan=False).encode("utf-8"), 6)


# ── UMAP ─────────────────────────────────────────────────────────────────


def umap_trace(umap_model: Any, X: np.ndarray, *, with_graph: bool = True) -> dict[str, Any]:
    """The neighbour graph UMAP built and the layout it produced.

    For fewer than 4096 documents UMAP computes the EXACT pairwise distance
    matrix with its own metric and takes each row's k smallest (self included,
    at distance 0) — so the kNN is reproduced here the same way, through the
    library's own `nearest_neighbors(..., "precomputed")`. Above that it used
    NNDescent and kept the result on the model, which is read instead.
    """
    from umap.umap_ import fuzzy_simplicial_set, nearest_neighbors

    X32 = np.asarray(X, dtype=np.float32)
    n = X32.shape[0]
    k = int(getattr(umap_model, "_n_neighbors", umap_model.n_neighbors))
    small = bool(getattr(umap_model, "_small_data", True))
    out: dict[str, Any] = {
        "params": {
            "nNeighbors": k,
            "nComponents": int(umap_model.n_components),
            "minDist": float(umap_model.min_dist),
            "spread": float(umap_model.spread),
            "metric": str(umap_model.metric),
            "localConnectivity": float(umap_model.local_connectivity),
            "setOpMixRatio": float(umap_model.set_op_mix_ratio),
            "learningRate": float(umap_model.learning_rate),
            "repulsionStrength": float(umap_model.repulsion_strength),
            "negativeSampleRate": int(umap_model.negative_sample_rate),
            "init": str(umap_model.init) if isinstance(umap_model.init, str) else "array",
            "randomState": umap_model.random_state if isinstance(umap_model.random_state, int) else None,
            "nEpochsConfigured": umap_model.n_epochs,
            "a": float(umap_model._a),
            "b": float(umap_model._b),
            "disconnectionDistance": _num(getattr(umap_model, "_disconnection_distance", None)),
        },
        "exactKnn": small,
    }

    if small:
        from sklearn.metrics import pairwise_distances

        dmat = pairwise_distances(X32, metric=umap_model._input_distance_func)
        disc = getattr(umap_model, "_disconnection_distance", np.inf)
        dmat[dmat >= disc] = np.inf
        knn_indices, knn_dists, _ = nearest_neighbors(dmat, k, "precomputed", {}, False, None)
    else:
        dmat = None
        knn_indices = np.asarray(umap_model._knn_indices)
        knn_dists = np.asarray(umap_model._knn_dists)

    out["knnIndices"] = np.asarray(knn_indices, dtype=np.int64).tolist()
    out["knnDists"] = f32(knn_dists)
    out["sigmas"] = f32(umap_model._sigmas)
    out["rhos"] = f32(umap_model._rhos)

    # The fuzzy graph BEFORE the layout pruned it. `graph_` on the model is NOT
    # that graph: simplicial_set_embedding() prunes every edge below
    # max / n_epochs in place on the very object (tocoo() of a COO matrix is the
    # same object), so the model only keeps the pruned graph. The full graph is
    # rebuilt here with the library's own fuzzy_simplicial_set, and the check is
    # that pruning it by that rule gives back exactly what the model holds.
    checks: dict[str, Any] = {}
    if with_graph:
        kept = umap_model.graph_.tocoo()
        kept.sum_duplicates()
        # Pruning sets dropped edges to 0 in place without eliminating them;
        # what the layout kept is the nonzero part.
        kept = kept.copy()
        kept.eliminate_zeros()
        n_epochs = umap_model.n_epochs
        if n_epochs is None:
            n_epochs = 500 if kept.shape[0] <= 10000 else 200
        out["params"]["nEpochsUsed"] = int(n_epochs)
        g = None
        try:
            regraph, s2, r2 = fuzzy_simplicial_set(
                dmat if dmat is not None else X32,
                k,
                None,
                "precomputed" if dmat is not None else umap_model.metric,
                {},
                knn_indices,
                knn_dists,
                False,
                float(umap_model.set_op_mix_ratio),
                float(umap_model.local_connectivity),
                True,
                False,
            )
            g = regraph.tocoo()
            g.sum_duplicates()
            pruned = g.copy()
            limit = pruned.data.max() / float(n_epochs) if n_epochs > 10 else pruned.data.max() / 500.0
            pruned.data[pruned.data < limit] = 0.0
            pruned.eliminate_zeros()
            diff = pruned.tocsr() - kept.tocsr()
            checks["prunedGraphMaxAbsDiff"] = float(np.abs(diff.data).max()) if diff.nnz else 0.0
            checks["sigmaMaxAbsDiff"] = float(np.abs(np.asarray(s2) - np.asarray(umap_model._sigmas)).max())
            checks["rhoMaxAbsDiff"] = float(np.abs(np.asarray(r2) - np.asarray(umap_model._rhos)).max())
        except Exception as exc:  # noqa: BLE001 — a check, never a failure
            checks["graphError"] = str(exc)[:200]
        if g is not None:
            upper = g.row < g.col
            out["graph"] = {
                "rows": g.row[upper].astype(np.int64).tolist(),
                "cols": g.col[upper].astype(np.int64).tolist(),
                "vals": f32(g.data[upper]),
                "max": float(g.data.max()) if g.nnz else 0.0,
            }
        k_up = kept.row < kept.col
        out["graphKept"] = {
            "rows": kept.row[k_up].astype(np.int64).tolist(),
            "cols": kept.col[k_up].astype(np.int64).tolist(),
            "vals": f32(kept.data[k_up]),
        }
    out["embedding"] = f32(umap_model.embedding_)
    out["checks"] = checks
    out["n"] = int(n)
    return out


# ── HDBSCAN ──────────────────────────────────────────────────────────────


def _effective_min_samples(h: Any, n: int) -> int:
    """hdbscan(): None → min_cluster_size, then min(n − 1, ·), and 0 → 1."""
    ms = h.min_samples if h.min_samples is not None else h.min_cluster_size
    ms = min(n - 1, int(ms))
    return 1 if ms == 0 else ms


def hdbscan_trace(h: Any, reduced: np.ndarray) -> dict[str, Any]:
    """Everything between the reduced coordinates and a label + membership."""
    from hdbscan._hdbscan_tree import compute_stability
    from hdbscan.prediction import all_points_membership_vectors
    from sklearn.neighbors import KDTree

    X = np.asarray(reduced, dtype=np.float64)
    n = X.shape[0]
    ms = _effective_min_samples(h, n)

    # Core distance exactly as the clustering computed it: the (ms+1)-th nearest
    # INCLUDING the point itself, i.e. the ms-th other point (both the Prim and
    # the Boruvka KD-tree paths query k = min_samples + 1). PredictionData keeps
    # a core_distances of its own with k = min_samples — a different number —
    # so that one is deliberately NOT what is recorded here.
    tree = KDTree(X, metric="euclidean", leaf_size=int(getattr(h, "leaf_size", 40)))
    core = tree.query(X, k=ms + 1)[0][:, -1]

    raw = h.condensed_tree_._raw_tree
    stability = compute_stability(raw)
    selected = sorted(int(c) for c in h.condensed_tree_._select_clusters())

    mst = None
    if getattr(h, "_min_spanning_tree", None) is not None:
        m = np.asarray(h._min_spanning_tree)
        mst = {"a": m[:, 0].astype(np.int64).tolist(), "b": m[:, 1].astype(np.int64).tolist(), "w": f64(m[:, 2])}
    sl = np.asarray(h.single_linkage_tree_._linkage)

    # Exemplars as PredictionData defines them: for each selected cluster, the
    # points of every leaf cluster below it whose lambda equals that leaf's max.
    cluster_tree = raw[raw["child_size"] > 1]

    def children(c: int) -> list[int]:
        return [int(x) for x in cluster_tree["child"][cluster_tree["parent"] == c]]

    def leaves(c: int) -> list[int]:
        ch = children(c)
        return [c] if not ch else [leaf for x in ch for leaf in leaves(x)]

    exemplars: list[list[int]] = []
    for c in selected:
        pts: list[int] = []
        for leaf in leaves(c):
            rows = raw[raw["parent"] == leaf]
            if len(rows) == 0:
                continue
            mx = rows["lambda_val"].max()
            pts.extend(int(p) for p in rows["child"][(rows["lambda_val"] == mx)] if p < n)
        exemplars.append(pts)

    checks: dict[str, Any] = {}
    soft = None
    try:
        if selected:
            soft = np.asarray(all_points_membership_vectors(h), dtype=np.float64)
            pd_ex = getattr(h.prediction_data_, "exemplars", None)
            if pd_ex is not None:
                same = all(
                    np.allclose(np.sort(X[idx], axis=0), np.sort(np.asarray(e), axis=0))
                    for idx, e in zip(exemplars, pd_ex)
                ) and len(pd_ex) == len(exemplars)
                checks["exemplarsMatchPredictionData"] = bool(same)
    except Exception as exc:  # noqa: BLE001
        checks["softError"] = str(exc)[:200]

    # Self-check: the recorded MST weights must be mutual-reachability distances
    # under the recorded core distances.
    if mst is not None:
        m = np.asarray(h._min_spanning_tree)
        a, b, w = m[:, 0].astype(int), m[:, 1].astype(int), m[:, 2]
        d = np.linalg.norm(X[a] - X[b], axis=1)
        mrd = np.maximum(np.maximum(core[a], core[b]), d)
        checks["mstMrdMaxAbsDiff"] = float(np.abs(mrd - w).max()) if len(w) else 0.0

    return {
        "params": {
            "minClusterSize": int(h.min_cluster_size),
            "minSamplesConfigured": h.min_samples,
            "minSamplesEffective": ms,
            "clusterSelectionMethod": str(h.cluster_selection_method),
            "clusterSelectionEpsilon": float(h.cluster_selection_epsilon),
            "allowSingleCluster": bool(h.allow_single_cluster),
            "alpha": float(h.alpha),
            "metric": str(h.metric),
            "algorithm": str(h.algorithm),
            "approxMinSpanTree": bool(getattr(h, "approx_min_span_tree", True)),
            "leafSize": int(getattr(h, "leaf_size", 40)),
            "maxClusterSize": int(getattr(h, "max_cluster_size", 0) or 0),
            "matchReferenceImplementation": bool(getattr(h, "match_reference_implementation", False)),
        },
        "core": f64(core),
        "mst": mst,
        "singleLinkage": {
            "left": sl[:, 0].astype(np.int64).tolist(),
            "right": sl[:, 1].astype(np.int64).tolist(),
            "dist": f64(sl[:, 2]),
            "size": sl[:, 3].astype(np.int64).tolist(),
        },
        "condensed": {
            "parent": raw["parent"].astype(np.int64).tolist(),
            "child": raw["child"].astype(np.int64).tolist(),
            "lambda": [(_num(v) if math.isfinite(float(v)) else None) for v in raw["lambda_val"]],
            "size": raw["child_size"].astype(np.int64).tolist(),
        },
        # _num: a zero merge distance makes a lambda (and so a stability)
        # infinite, which JSON cannot carry; it is recorded as null instead.
        "stability": {str(int(k)): _num(v) for k, v in stability.items()},
        "selected": selected,
        "labels": np.asarray(h.labels_, dtype=np.int64).tolist(),
        "probabilities": f64(h.probabilities_),
        "exemplars": exemplars,
        "soft": f64(soft) if soft is not None else None,
        "checks": checks,
    }


# ── BERTopic: topic ids, c-TF-IDF, centroids ─────────────────────────────


def mapping_trace(topic_model: Any) -> dict[str, Any]:
    """hdbscan label → BERTopic topic id. Each row of `mappings_` is one topic's
    history: [original, after the frequency sort, (after a reduction)…]."""
    rows = [[int(x) for x in r] for r in getattr(topic_model.topic_mapper_, "mappings_", [])]
    return {"mappings": rows}


def ctfidf_trace(
    topic_model: Any, documents: list[str], topics: list[int], keyword_lists: dict[int, list[tuple[str, float]]]
) -> dict[str, Any]:
    """The c-TF-IDF behind the FINAL keywords: the count matrix it was computed
    from, the idf it multiplied by, and the weights it produced.

    The counts are recomputed exactly as BERTopic's `_c_tf_idf` produced them —
    documents concatenated per topic (groupby order: ascending topic id), the
    library's own `_preprocess_text`, then the fitted vectorizer — because the
    transformer normalises its input IN PLACE and the original matrix no longer
    exists after a fit. `checks.weightMaxAbsDiff` says how far the weights
    recomputed from these counts are from the model's own c_tf_idf_.
    """
    import pandas as pd

    frame = pd.DataFrame({"Document": documents, "Topic": topics})
    per_topic = frame.groupby(["Topic"], as_index=False).agg({"Document": " ".join})
    clean = topic_model._preprocess_text(per_topic.Document.values)
    counts = topic_model.vectorizer_model.transform(clean).tocsr()
    words = [str(w) for w in topic_model.vectorizer_model.get_feature_names_out()]
    ct = topic_model.ctfidf_model
    idf = np.asarray(ct._idf_diag.diagonal(), dtype=np.float64)
    weights = topic_model.c_tf_idf_.tocsr()

    checks: dict[str, Any] = {}
    try:
        recomputed = ct.transform(counts.copy().astype(np.float64)).tocsr()
        diff = recomputed - weights
        checks["weightMaxAbsDiff"] = float(np.abs(diff.data).max()) if diff.nnz else 0.0
    except Exception as exc:  # noqa: BLE001
        checks["weightError"] = str(exc)[:200]

    coo = counts.tocoo()
    w_at = weights.tocsr()
    return {
        "topicOrder": [int(t) for t in per_topic.Topic.values],
        "vocabulary": words,
        "counts": {
            "row": coo.row.astype(np.int64).tolist(),
            "col": coo.col.astype(np.int64).tolist(),
            "val": coo.data.astype(np.int64).tolist(),
        },
        "weights": f64(np.asarray(w_at[coo.row, coo.col]).ravel()),
        "idf": f64(idf),
        "avgNrSamples": int(counts.sum(axis=1).mean()),
        "params": {
            "reduceFrequentWords": bool(ct.reduce_frequent_words),
            "bm25Weighting": bool(ct.bm25_weighting),
            "topNWords": int(topic_model.top_n_words),
            "language": str(getattr(topic_model, "language", "english")),
            "ngramRange": list(topic_model.vectorizer_model.ngram_range),
            "minDf": topic_model.vectorizer_model.min_df,
            "maxDf": topic_model.vectorizer_model.max_df,
            "lowercase": bool(topic_model.vectorizer_model.lowercase),
            "tokenPattern": str(topic_model.vectorizer_model.token_pattern),
            "stopWordsCount": (
                len(topic_model.vectorizer_model.stop_words)
                if isinstance(topic_model.vectorizer_model.stop_words, (list, set, tuple))
                else topic_model.vectorizer_model.stop_words
            ),
            "representationModel": type(topic_model.representation_model).__name__
            if topic_model.representation_model is not None
            else None,
        },
        "keywords": {
            str(t): [[str(w), float(s)] for w, s in kws] for t, kws in keyword_lists.items()
        },
        "checks": checks,
    }


def topic_embedding_trace(topic_model: Any) -> dict[str, Any] | None:
    """The per-topic mean vectors BERTopic holds (`topic_embeddings_`) — what the
    'embeddings' outlier strategy measured cosine against. Rows follow ascending
    topic id with -1 first when outliers existed."""
    te = getattr(topic_model, "topic_embeddings_", None)
    if te is None:
        return None
    return {"embeddings": f32(np.asarray(te)), "outliersRow": int(getattr(topic_model, "_outliers", 0))}


def presence_trace(
    vectorizer_model: Any, documents: list[str], topics: list[int], keywords: dict[int, list[str]]
) -> list[list[bool]]:
    """Per document: for each keyword of its own family, in keyword order, whether
    the tokenizer finds it in the document (the test `_document_reasons` applies
    to the RAW document text). Outliers get an empty list."""
    try:
        analyzer = vectorizer_model.build_analyzer()
    except Exception:  # noqa: BLE001
        return [[] for _ in documents]
    out: list[list[bool]] = []
    for doc, t in zip(documents, topics):
        if t == -1:
            out.append([])
            continue
        try:
            terms = set(analyzer(doc))
        except Exception:  # noqa: BLE001
            terms = set()
        out.append([w in terms for w in keywords.get(t, [])])
    return out


def hierarchy_trace(topic_model: Any) -> dict[str, Any] | None:
    """Inputs of the Family Tree: 1 − cosine between the real topics' c-TF-IDF
    rows, and the Ward linkage scipy built from it."""
    try:
        import scipy.cluster.hierarchy as sch
        from bertopic._utils import validate_distance_matrix
        from sklearn.metrics.pairwise import cosine_similarity

        emb = topic_model.c_tf_idf_[topic_model._outliers :]
        X = 1 - cosine_similarity(emb)
        cond = validate_distance_matrix(X, emb.shape[0])
        Z = sch.linkage(cond, "ward", optimal_ordering=True)
        uniquified = False
        if len(Z[:, 2]) != len(np.unique(Z[:, 2])):
            from bertopic._utils import get_unique_distances

            Z[:, 2] = get_unique_distances(Z[:, 2])
            uniquified = True
        return {"distance": f64(np.asarray(X)), "linkage": f64(np.asarray(Z)), "uniquified": uniquified}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)[:200]}


def corpus_trace(docs: list[dict[str, Any]], embeddings: np.ndarray) -> dict[str, Any]:
    """The input exactly as clustered: one entry per document in run order."""
    meta = []
    for d in docs:
        meta.append(
            {
                "jobProfileId": int(d["job_profile_id"]),
                "positionName": d.get("position_name"),
                "divisionDepartment": d.get("division_department"),
                "embeddingModel": d.get("embedding_model"),
                "docMd5": d.get("doc_md5"),
                "embMd5": d.get("emb_md5"),
                "embedSource": d.get("embed_source"),
                "embedDimensions": d.get("embed_dimensions"),
                "embedTemplate": d.get("embed_template"),
                "extractedHash": d.get("extracted_hash"),
                "embeddedAt": d.get("embedded_at"),
            }
        )
    return {
        "documents": [d.get("document") or "" for d in docs],
        "meta": meta,
        "vectors": f32(embeddings),
    }


def sizes_of(topics: list[int]) -> dict[str, int]:
    return {str(k): int(v) for k, v in sorted(Counter(topics).items())}
