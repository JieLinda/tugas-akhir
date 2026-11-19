"""Per-node "general topic recognition" for the Family Tree hierarchy.

For EVERY node — each leaf job-family cluster AND each internal sub-family level
of the BERTopic dendrogram — produce a generalized title + description that
abstracts what sits beneath it. Hybrid method (per the product decision):

  1. Deterministic signals (always computed, no LLM):
       • aggregated keywords  — a size-weighted merge of the descendant leaves'
         c-TF-IDF keywords (the subtree's salient terms).
       • representative jabatan — the member profiles nearest the subtree
         embedding centroid (the "direct-mode" cluster representation).
  2. LLM generalization (bottom-up, optional): Gemini turns those signals — plus,
     for internal nodes, the ALREADY-generated titles/descriptions of the child
     sub-families — into a concise Indonesian title + description. Deterministic
     fallback (keyword-joined title, no description) when Gemini is unavailable.

Bottom-up so a parent is summarized with knowledge of its children's themes
(HERCULES-style). Everything is computed once, at run time, and persisted:
leaves onto job_family_topics, internal nodes onto the run's hierarchy JSON.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

import numpy as np

from . import gemini

log = logging.getLogger("topic-service.generalize")

ProgressCb = Callable[[dict[str, Any]], None]

# Safety cap: skip the LLM (keep deterministic titles) for pathologically large
# hierarchies so a run can't fan out into thousands of API calls.
MAX_LLM_NODES = 300

_GEN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"title": {"type": "string"}, "description": {"type": "string"}},
    "required": ["title", "description"],
}

_SYSTEM = (
    "Anda ahli taksonomi jabatan (job family) di sebuah perusahaan. Diberi sebuah "
    "kelompok jabatan beserta kata kunci dan contohnya, hasilkan nama umum yang "
    "ringkas dan deskripsi singkat dalam Bahasa Indonesia. Balas HANYA objek JSON "
    "dengan field 'title' dan 'description'. 'title': 2-5 kata yang MENGGENERALKAN "
    "tema kelompok (mis. 'Pengendalian Keuangan'), bukan menyalin satu jabatan "
    "spesifik. 'description': 1-2 kalimat yang menjelaskan cakupan kelompok."
)


def _fallback_title(keywords: list[dict[str, Any]]) -> str:
    words = [str(k.get("word", "")).strip() for k in keywords[:4]]
    words = [w for w in words if w]
    return ", ".join(words) if words else "Kelompok"


def _merge_keywords(
    leaf_keywords: list[list[dict[str, Any]]],
    weights: list[float],
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """Size-weighted merge of several leaves' keyword lists → top_k terms."""
    acc: dict[str, float] = {}
    for kws, w in zip(leaf_keywords, weights):
        for k in kws:
            word = str(k.get("word", "")).strip()
            if not word:
                continue
            acc[word] = acc.get(word, 0.0) + float(k.get("score", 0.0)) * (w or 1.0)
    ranked = sorted(acc.items(), key=lambda kv: kv[1], reverse=True)[:top_k]
    total = sum(s for _, s in ranked) or 1.0
    return [{"word": w, "score": s / total} for w, s in ranked]


def generalize_nodes(
    topics_out: list[dict[str, Any]],
    topics: list[int],
    embeddings: np.ndarray,
    doc_titles: list[str] | None,
    documents: list[str],
    hierarchy: dict[str, Any] | None,
    progress_cb: ProgressCb | None = None,
    trace: list[dict[str, Any]] | None = None,
) -> None:
    """Attach a general title/description to every leaf (topics_out) and every
    internal hierarchy node (hierarchy['linkage'][*].parent*). Mutates in place.

    `trace` (builds only) receives one record per node: the leaves it spans, the
    keywords it was summarised from, its representative titles, and whether the
    title came from the model or the keyword fallback."""
    n = len(documents)
    titles = doc_titles if doc_titles and len(doc_titles) == n else [""] * n

    emb = np.asarray(embeddings, dtype=np.float32)
    norms = np.linalg.norm(emb, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    emb_n = emb / norms

    # Leaf (real) topic → member doc indices, keywords, size.
    member_idx: dict[int, list[int]] = {}
    for i, t in enumerate(topics):
        member_idx.setdefault(int(t), []).append(i)
    kw_by_topic: dict[int, list[dict[str, Any]]] = {
        int(t["topicId"]): t.get("keywords", []) for t in topics_out
    }
    size_by_topic: dict[int, int] = {int(t["topicId"]): int(t.get("size", 0)) for t in topics_out}

    def rep_titles(idxs: list[int], k: int = 3) -> list[str]:
        """Up to k representative jabatan: members nearest the subtree centroid."""
        if not idxs:
            return []
        c = emb_n[idxs].mean(axis=0)
        cn = float(np.linalg.norm(c))
        if cn > 0:
            c = c / cn
        order = sorted(idxs, key=lambda i: float(np.dot(emb_n[i], c)), reverse=True)
        out: list[str] = []
        for i in order:
            name = (titles[i] or "").strip() or (documents[i][:60].strip())
            if name and name not in out:
                out.append(name)
            if len(out) >= k:
                break
        return out

    # ── Build the dendrogram node graph (internal nodes + leaf refs) ──
    linkage: list[dict[str, Any]] = (hierarchy or {}).get("linkage", []) if hierarchy else []
    children_of: dict[str, list[str]] = {}
    row_by_parent: dict[str, dict[str, Any]] = {}
    referenced: set[str] = set()
    for row in linkage:
        pid = row.get("parentId")
        if pid is None:
            continue
        kids = [row.get("childLeftId"), row.get("childRightId")]
        children_of[pid] = [c for c in kids if c is not None]
        row_by_parent[pid] = row
        for c in children_of[pid]:
            referenced.add(c)

    # Subtree leaf-topic ids under a node (memoized).
    leaf_topics_cache: dict[str, list[int]] = {}

    def leaf_topics(node: str) -> list[int]:
        if node in leaf_topics_cache:
            return leaf_topics_cache[node]
        if node not in children_of:  # a leaf reference → a real topic id
            try:
                out = [int(node)]
            except ValueError:
                out = []
        else:
            out = []
            for c in children_of[node]:
                out.extend(leaf_topics(c))
        leaf_topics_cache[node] = out
        return out

    def subtree_idx(node: str) -> list[int]:
        idxs: list[int] = []
        for tid in leaf_topics(node):
            idxs.extend(member_idx.get(tid, []))
        return idxs

    def node_keywords(node: str) -> list[dict[str, Any]]:
        tids = leaf_topics(node)
        if len(tids) == 1:
            return kw_by_topic.get(tids[0], [])
        return _merge_keywords(
            [kw_by_topic.get(t, []) for t in tids],
            [float(size_by_topic.get(t, 1)) for t in tids],
        )

    # Count nodes (real leaves in the dendrogram + internal) to gate LLM usage.
    real_leaf_ids = [str(t["topicId"]) for t in topics_out if int(t["topicId"]) != -1]
    total_nodes = len(real_leaf_ids) + len(children_of)
    use_llm = gemini.configured() and total_nodes <= MAX_LLM_NODES
    if gemini.configured() and total_nodes > MAX_LLM_NODES:
        log.warning("generalize: %d nodes > cap %d — deterministic titles only", total_nodes, MAX_LLM_NODES)

    # gen[node_id] = {"title", "description", "keywords"}
    gen: dict[str, dict[str, Any]] = {}

    def call_llm(user_prompt: str) -> tuple[str, str | None] | None:
        res = gemini.generate_json(_SYSTEM, user_prompt, _GEN_SCHEMA)
        if not res:
            return None
        title = str(res.get("title", "")).strip()
        desc = str(res.get("description", "")).strip()
        if not title:
            return None
        return title, (desc or None)

    done = 0

    def tick(msg: str) -> None:
        nonlocal done
        done += 1
        if progress_cb and (done % 5 == 0 or done == total_nodes):
            progress_cb({"phase": "generalize", "done": done, "total": max(1, total_nodes), "message": msg})

    # ── Leaves (each real cluster) ──
    for t in topics_out:
        tid = int(t["topicId"])
        if tid == -1:
            t["generalTitle"] = t.get("label")
            t["generalDescription"] = None
            continue
        kws = t.get("keywords", [])
        reps = rep_titles(member_idx.get(tid, []))
        snippet = (documents[member_idx[tid][0]][:200] if member_idx.get(tid) else "").replace("\n", " ")
        title = _fallback_title(kws)
        desc: str | None = None
        from_model = False
        if use_llm:
            prompt = (
                "Jenis: job family tunggal (klaster daun).\n"
                f"Kata kunci: {', '.join(k['word'] for k in kws[:10])}\n"
                f"Contoh jabatan: {', '.join(reps) or '-'}\n"
                f"Cuplikan uraian: {snippet or '-'}\n"
                "Buat nama umum + deskripsi untuk kelompok ini."
            )
            r = call_llm(prompt)
            if r:
                title, desc = r
                from_model = True
        t["generalTitle"] = title
        t["generalDescription"] = desc
        gen[str(tid)] = {"title": title, "description": desc, "keywords": kws}
        if trace is not None:
            trace.append(
                {
                    "node": str(tid),
                    "kind": "leaf",
                    "leafTopics": [tid],
                    "keywords": [[k.get("word"), float(k.get("score", 0.0))] for k in kws],
                    "representatives": reps,
                    "title": title,
                    "description": desc,
                    "fromModel": from_model,
                }
            )
        tick("Merangkum topik umum per klaster...")

    # ── Internal nodes (sub-family levels), bottom-up (children before parents) ──
    roots = [pid for pid in children_of if pid not in referenced]
    order: list[str] = []
    seen: set[str] = set()

    def post_order(node: str) -> None:
        if node in seen or node not in children_of:
            return
        seen.add(node)
        for c in children_of[node]:
            post_order(c)
        order.append(node)

    for r in roots:
        post_order(r)

    for node in order:
        kws = node_keywords(node)
        reps = rep_titles(subtree_idx(node))
        child_gen = [gen.get(c) for c in children_of.get(node, [])]
        child_gen = [c for c in child_gen if c]
        title = _fallback_title(kws)
        desc = None
        from_model = False
        if use_llm:
            child_block = "\n".join(
                f"- {c['title']}: {c.get('description') or '(tanpa deskripsi)'}" for c in child_gen
            )
            prompt = (
                "Jenis: kelompok gabungan (sub-family) yang membawahi sub-kelompok berikut:\n"
                f"{child_block or '- (sub-kelompok tanpa label)'}\n"
                f"Kata kunci gabungan: {', '.join(k['word'] for k in kws[:12])}\n"
                f"Contoh jabatan perwakilan: {', '.join(reps) or '-'}\n"
                "Buat SATU nama umum + deskripsi yang menggeneralkan dan mencakup seluruh "
                "sub-kelompok di atas (lebih umum daripada tiap anak)."
            )
            r = call_llm(prompt)
            if r:
                title, desc = r
                from_model = True
        gen[node] = {"title": title, "description": desc, "keywords": kws}
        if trace is not None:
            trace.append(
                {
                    "node": node,
                    "kind": "internal",
                    "children": children_of.get(node, []),
                    "leafTopics": leaf_topics(node),
                    "keywords": [[k.get("word"), float(k.get("score", 0.0))] for k in kws],
                    "representatives": reps,
                    "title": title,
                    "description": desc,
                    "fromModel": from_model,
                }
            )
        row = row_by_parent.get(node)
        if row is not None:
            row["parentTitle"] = title
            row["parentDescription"] = desc
            row["parentKeywords"] = kws
        tick("Merangkum topik umum per level hirarki...")

    if progress_cb:
        progress_cb(
            {"phase": "generalize", "done": max(1, total_nodes), "total": max(1, total_nodes),
             "message": "Generalisasi topik selesai."}
        )
