"""Postgres access for the topic-service.

Reads the precomputed document vectors from `job_profile_embed` (written by the
web app's Job Family "Bangun Ulang Embedding" flow) and writes topic-modeling
results into `job_family_topic_runs` / `job_family_topics` /
`job_family_topic_assignments`. The web app polls the run row for progress —
exactly how it polls `tournament_sessions` for scoring-service.

A lazy connection pool (min_size=0) so importing this module never forces a DB
connection at container start; connections open on first use.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

from psycopg import errors as pg_errors
from psycopg.types.json import Json
from psycopg_pool import ConnectionPool

from . import config

log = logging.getLogger("topic-service")

pool = ConnectionPool(
    conninfo=config.POSTGRES_URL,
    min_size=0,
    max_size=5,
    open=True,
    kwargs={"application_name": "topic-service"},
)

vector_pool = ConnectionPool(
    conninfo=config.VECTOR_DATABASE_URL,
    min_size=0,
    max_size=5,
    open=True,
    kwargs={"application_name": "topic-service-vector"},
)


# ── Runs ───────────────────────────────────────────────────────────

def get_run(run_id: str) -> dict[str, Any] | None:
    with pool.connection() as c:
        row = c.execute(
            "SELECT id::text, status, tenant_id::text FROM job_family_topic_runs WHERE id = %s",
            (run_id,),
        ).fetchone()
    return {"id": row[0], "status": row[1], "tenantId": row[2]} if row else None


def has_processing_run(tenant_id: str | None) -> bool:
    """True if a run that CONFLICTS with this one is mid-flight.

    Scoped rather than global: a run stuck in 'processing' (a crash mid-pipeline)
    used to block topic modeling for every business unit forever. Now it only
    blocks its own scope. A GLOBAL run (tenant_id IS NULL) still blocks everything
    because it clusters the whole corpus, and a global request is blocked by any
    in-flight run for the same reason.

    Note this is a data-level backstop only — actual concurrency is already
    serialized by the in-process _run_lock in main.py, since UMAP/HDBSCAN are
    memory-heavy and the service is a single process.
    """
    with pool.connection() as c:
        if tenant_id is None:
            row = c.execute(
                "SELECT 1 FROM job_family_topic_runs WHERE status = 'processing' LIMIT 1"
            ).fetchone()
        else:
            row = c.execute(
                """
                SELECT 1 FROM job_family_topic_runs
                 WHERE status = 'processing'
                   AND (tenant_id IS NULL OR tenant_id = %s)
                 LIMIT 1
                """,
                (tenant_id,),
            ).fetchone()
    return row is not None


def set_processing(run_id: str, embedding_model: str | None, num_documents: int) -> None:
    with pool.connection() as c:
        c.execute(
            """
            UPDATE job_family_topic_runs
               SET status = 'processing',
                   embedding_model = %s,
                   num_documents = %s,
                   error = NULL,
                   progress = %s,
                   updated_at = now()
             WHERE id = %s
            """,
            (
                embedding_model,
                num_documents,
                Json({"phase": "load", "done": 0, "total": 5, "message": "Memuat embedding..."}),
                run_id,
            ),
        )


def update_progress(run_id: str, progress: dict[str, Any]) -> None:
    with pool.connection() as c:
        c.execute(
            "UPDATE job_family_topic_runs SET progress = %s, updated_at = now() WHERE id = %s",
            (Json(progress), run_id),
        )


def fail_run(run_id: str, error: str) -> None:
    with pool.connection() as c:
        c.execute(
            """
            UPDATE job_family_topic_runs
               SET status = 'failed', error = %s,
                   progress = %s, updated_at = now(), completed_at = now()
             WHERE id = %s
            """,
            (error, Json({"phase": "failed", "message": error[:500]}), run_id),
        )


def complete_run(
    run_id: str,
    num_topics: int,
    hierarchy: Any,
    diagnostics: Any = None,
) -> None:
    """Tandai run selesai.

    `diagnostics` memuat langkah pasca-clustering yang tidak berjalan sebagaimana
    diminta — penempatan ulang outlier, pemangkasan jumlah topik, penyusunan
    Family Tree. Ketiganya boleh gagal tanpa menggagalkan run, dan sebelum kolom
    ini ada, kegagalannya tidak tercatat di mana pun: run tetap berstatus
    'completed' dan hasilnya terbaca seolah semua permintaan terpenuhi.

    Kolomnya lahir dari migrasi 0062, dan penulisannya SENGAJA mundur dengan
    anggun bila kolom itu belum ada. Alasannya bukan kehati-hatian umum: fungsi
    ini dipanggil sebagai langkah TERAKHIR, setelah `persist_results` menuliskan
    seluruh topik dan penugasannya, dan pemanggilnya di `main.py` menangkap
    setiap galat menjadi `fail_run`. Tanpa mundur di sini, satu deployment yang
    belum menjalankan migrasinya akan menandai run yang SEPENUHNYA BERHASIL
    sebagai gagal — hasilnya sudah tersimpan, tetapi tidak ada satu pun pembaca
    yang mau melihatnya, dan pesan galatnya berbicara tentang nama kolom kepada
    orang yang hanya menekan "Bangun Ulang Peta".
    """
    base_set = "status = 'completed', num_topics = %s, hierarchy = %s"
    tail = ", progress = %s, updated_at = now(), completed_at = now() WHERE id = %s"
    progress = Json({"phase": "done", "done": 5, "total": 5, "message": "Selesai"})

    try:
        with pool.connection() as c:
            c.execute(
                f"UPDATE job_family_topic_runs SET {base_set}, diagnostics = %s{tail}",
                (
                    num_topics,
                    Json(hierarchy) if hierarchy is not None else None,
                    Json(diagnostics) if diagnostics else None,
                    progress,
                    run_id,
                ),
            )
            return
    except pg_errors.UndefinedColumn:
        # Transaksi di atas sudah dibatalkan saat blok `with` keluar; koneksi baru
        # di bawah memulai yang bersih.
        log.warning(
            "run %s: kolom job_family_topic_runs.diagnostics belum ada — "
            "run ditandai selesai TANPA catatan mutu. Jalankan migrasi "
            "drizzle/0062_job_family_optimizer_agent.sql agar catatan itu tersimpan.",
            run_id,
        )

    with pool.connection() as c:
        c.execute(
            f"UPDATE job_family_topic_runs SET {base_set}{tail}",
            (
                num_topics,
                Json(hierarchy) if hierarchy is not None else None,
                progress,
                run_id,
            ),
        )


# ── Input documents ────────────────────────────────────────────────

def visible_job_profile_ids(tenant_id: str) -> list[int]:
    """Job profile ids a tenant may see, per `job_profile_tenants`.

    Mirrors lib/job-profile-tenant-scope.ts: owned by this tenant, OR owned by
    nobody (folder not mapped yet → still visible to everyone).

    Lives on `pool`, not `vector_pool`: ownership is in the main database while
    `job_profile_embed` may sit in a separate pgvector instance
    (VECTOR_DATABASE_URL), so this cannot be a join.
    """
    with pool.connection() as c:
        rows = c.execute(
            """
            SELECT p.id
              FROM sync_job_profiles p
             WHERE EXISTS (SELECT 1 FROM job_profile_tenants jpt
                            WHERE jpt.job_profile_id = p.id AND jpt.tenant_id = %s)
                OR NOT EXISTS (SELECT 1 FROM job_profile_tenants jpt
                                WHERE jpt.job_profile_id = p.id)
            """,
            (tenant_id,),
        ).fetchall()
    return [r[0] for r in rows]


def load_documents(tenant_id: str | None = None) -> list[dict[str, Any]]:
    """Embedded job profiles: (id, position, dept, document, vector).

    `tenant_id` None = a GLOBAL run over the whole corpus (the original
    behaviour). Otherwise the corpus is restricted to that tenant's documents.

    Restricting shrinks N, and BERTopic is sensitive to it: parameters tuned for
    the full corpus can collapse a small business unit into all-outliers. That is
    why job_family_topic_configs is scopable too — a per-tenant run should carry
    per-tenant min_cluster_size / n_neighbors.

    pgvector's text form is "[a,b,c]" — parsed here so the service needs no
    pgvector client adapter.

    Each row also carries the md5 of its document text and of its vector text,
    computed by Postgres; `corpus_fingerprint` folds them into one value.
    """
    allowed: list[int] | None = None
    if tenant_id is not None:
        allowed = visible_job_profile_ids(tenant_id)
        if not allowed:
            return []

    # Provenance of each vector (drizzle/0094: the template, source and
    # dimension it was embedded with, and a hash of the extracted data it was
    # restructured from). Read when the columns exist; an un-migrated vector
    # database clusters exactly as before and the trace says "not recorded".
    with vector_pool.connection() as c:
        have = {
            r[0]
            for r in c.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'job_profile_embed'"
            ).fetchall()
        }
    extra = [col for col in ("embed_template", "embed_source", "embed_dimensions", "extracted_hash") if col in have]
    extra_sql = "".join(f", {col}" for col in extra)

    columns = f"""
        SELECT job_profile_id, position_name, division_department,
               document, embedding::text AS emb, embedding_model,
               md5(coalesce(document, '')) AS doc_md5, md5(embedding::text) AS emb_md5,
               to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS embedded_at{extra_sql}
          FROM job_profile_embed
         WHERE embedding IS NOT NULL
    """
    with vector_pool.connection() as c:
        if allowed is None:
            rows = c.execute(columns + " ORDER BY job_profile_id").fetchall()
        else:
            rows = c.execute(
                columns + " AND job_profile_id = ANY(%s) ORDER BY job_profile_id",
                (allowed,),
            ).fetchall()

    docs: list[dict[str, Any]] = []
    for row in rows:
        (
            job_profile_id,
            position_name,
            division_department,
            document,
            emb_text,
            model,
            doc_md5,
            emb_md5,
            embedded_at,
        ) = row[:9]
        provenance = dict(zip(extra, row[9:]))
        docs.append(
            {
                "job_profile_id": job_profile_id,
                "position_name": position_name,
                "division_department": division_department,
                "document": document or "",
                "embedding": _parse_vector(emb_text),
                "embedding_model": model,
                "doc_md5": doc_md5,
                "emb_md5": emb_md5,
                "embedded_at": embedded_at,
                **provenance,
            }
        )
    return docs


def corpus_fingerprint(docs: list[dict[str, Any]]) -> str:
    """One value that changes whenever the clustering input changes.

    md5 over "job_profile_id:md5(document):md5(vector text)" for every row, in
    job_profile_id order, joined by ",". The web app computes the same value in
    SQL (lib/job-family/corpus.ts) to tell whether a run, or an optimizer
    measurement, still describes the corpus — so the per-row hashes come from
    Postgres in both places and only this outer, ASCII-only md5 is done here.

    The vector is hashed rather than its content_hash because a re-embed can
    return different vectors for identical text, and the pipeline clusters the
    vectors. A re-embed that returns the SAME vectors leaves the fingerprint
    alone, which is correct: the map it would produce is the same map.
    """
    joined = ",".join(f"{d['job_profile_id']}:{d['doc_md5']}:{d['emb_md5']}" for d in docs)
    return hashlib.md5(joined.encode("ascii")).hexdigest()


def _parse_vector(text: str | None) -> list[float]:
    if not text:
        return []
    return [float(x) for x in text.strip().strip("[]").split(",") if x.strip() != ""]


# ── Results ────────────────────────────────────────────────────────

def persist_results(run_id: str, docs: list[dict[str, Any]], result: dict[str, Any]) -> None:
    """Replace this run's topics + assignments with the pipeline output (idempotent)."""
    idx_to_jpid = {i: docs[i]["job_profile_id"] for i in range(len(docs))}

    with pool.connection() as c:
        with c.cursor() as cur:
            cur.execute("DELETE FROM job_family_topics WHERE run_id = %s", (run_id,))
            cur.execute("DELETE FROM job_family_topic_assignments WHERE run_id = %s", (run_id,))

            for t in result["topics"]:
                rep_ids = [idx_to_jpid[i] for i in t.get("representativeIdx", []) if i in idx_to_jpid]
                cur.execute(
                    """
                    INSERT INTO job_family_topics
                        (run_id, topic_id, label, keywords, size, representative_doc_ids, x, y,
                         general_title, general_description)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run_id,
                        t["topicId"],
                        t["label"],
                        Json(t["keywords"]),
                        t["size"],
                        Json(rep_ids),
                        t["x"],
                        t["y"],
                        t.get("generalTitle"),
                        t.get("generalDescription"),
                    ),
                )

            for a in result["assignments"]:
                d = docs[a["idx"]]
                cur.execute(
                    """
                    INSERT INTO job_family_topic_assignments
                        (run_id, job_profile_id, position_name, division_department,
                         topic_id, probability, x, y,
                         matched_keywords, centroid_similarity, alt_topic_id, alt_similarity)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run_id,
                        d["job_profile_id"],
                        d["position_name"],
                        d["division_department"],
                        a["topicId"],
                        a["probability"],
                        a["x"],
                        a["y"],
                        Json(a.get("matchedKeywords") or []),
                        a.get("centroidSimilarity"),
                        a.get("altTopicId"),
                        a.get("altSimilarity"),
                    ),
                )


def store_trace(run_id: str, version: int, payload: bytes) -> None:
    """Write the run's calculation trace (gzip JSON, app/trace.py). One row per
    run, replaced if a run is ever re-processed. Raises when the table is absent
    (drizzle/0094 not applied) — the caller records that on the run instead."""
    with pool.connection() as c:
        c.execute(
            """
            INSERT INTO job_family_topic_traces (run_id, format_version, payload, byte_size)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (run_id) DO UPDATE
               SET format_version = EXCLUDED.format_version,
                   payload = EXCLUDED.payload,
                   byte_size = EXCLUDED.byte_size,
                   created_at = now()
            """,
            (run_id, version, payload, len(payload)),
        )


def ping() -> bool:
    try:
        with pool.connection() as c:
            c.execute("SELECT 1").fetchone()
        return True
    except Exception:
        return False
