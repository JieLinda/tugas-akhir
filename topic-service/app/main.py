"""Pulse topic-service — FastAPI.

Runs the BERTopic topic-modeling pipeline over the precomputed job-profile
document embeddings and writes results back to Postgres, while the Next.js web
app polls the run row for progress. Fire-and-forget, exactly like scoring-service:
the web app creates the `job_family_topic_runs` row, POSTs /topics/build, gets a
202 immediately, and watches the DB.

Endpoints:
  POST /topics/build            — start processing a run (background task)
  GET  /topics/{run_id}/status  — current status of a run
  POST /topics/trials           — measure candidate configs on the current corpus
  GET  /topics/trials/{id}      — progress + results of a trial batch
  GET  /health                  — liveness + DB reachability
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from typing import Any

import numpy as np
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import config, db, generalize, pipeline

import torch

print("TORCH:", torch.__version__)
print("TORCH FILE:", torch.__file__)

from bertopic import BERTopic

print("BERTopic imported successfully")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [topic] %(message)s")
log = logging.getLogger("topic-service")

app = FastAPI(title="Pulse Topic Service", version="1.0.0")

# Serialize pipeline execution — UMAP/HDBSCAN are memory-heavy, so a build and
# an optimizer trial batch never compute at the same time.
_run_lock = threading.Lock()

# At most one build accepted at a time, held from the 202 until it finishes. A
# second build is rejected (409) as before. A trial batch is NOT a reason to
# reject a build: trials are optional measurements, so a build that arrives
# while they run sets `_build_waiting`, the batch stops after the config it is
# measuring, and the build takes the compute lock. Rejecting instead would turn
# "Bangun Ulang Peta" into a failed run whenever somebody was measuring.
_build_slot = threading.Lock()
_build_waiting = threading.Event()
BUILD_WAIT_S = 15 * 60

# Trial batches live in memory: they are a few kilobytes, worth nothing after
# the corpus changes, and the web app re-reads them from here (never from the
# browser) before it saves anything they measured.
TRIAL_TTL_S = 30 * 60
TRIAL_MAX_BATCHES = 20
TRIAL_MAX_CONFIGS = 12
_trials: dict[str, dict[str, Any]] = {}
_trials_guard = threading.Lock()

# UMAP output shared between trials of one corpus — see pipeline._CachedReducer.
# Keys start with the corpus fingerprint, so a changed corpus never hits.
_reduced_cache: pipeline.ReducedCache = {}
REDUCED_CACHE_MAX = 16


class BuildRequest(BaseModel):
    runId: str
    # BERTopic params snapshot from lib/job-family-config.json (bertopic block).
    # Optional — the pipeline falls back to the same defaults the config uses.
    config: dict[str, Any] = Field(default_factory=dict)


class TrialConfig(BaseModel):
    # `key` and `note` are chosen by the caller and echoed back untouched, so
    # results can be matched to the configs (and the reasons) that produced them.
    key: str
    config: dict[str, Any] = Field(default_factory=dict)
    note: str = ""


class TrialRequest(BaseModel):
    configs: list[TrialConfig]


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "db": db.ping()}


@app.post("/topics/build", status_code=202)
def build(req: BuildRequest, background: BackgroundTasks) -> dict[str, Any]:
    run = db.get_run(req.runId)
    if not run:
        raise HTTPException(status_code=404, detail="Run tidak ditemukan.")
    # The run row itself carries the scope (tenant_id NULL = global corpus); the
    # request body never does, so a caller cannot widen a run's scope after the
    # fact by re-POSTing it.
    tenant_id = run.get("tenantId")
    busy = HTTPException(
        status_code=409,
        detail="Sebuah proses topic modeling sedang berjalan. Tunggu hingga selesai.",
    )
    if not _build_slot.acquire(blocking=False):
        raise busy
    try:
        if db.has_processing_run(tenant_id):
            raise busy
        background.add_task(_run_pipeline, req.runId, req.config or {}, tenant_id)
    except BaseException:
        _build_slot.release()
        raise
    return {"accepted": True, "runId": req.runId, "tenantId": tenant_id}


@app.post("/topics/trials", status_code=202)
def start_trials(req: TrialRequest, background: BackgroundTasks) -> dict[str, Any]:
    """Measure what each config would produce on the CURRENT global corpus.

    Nothing is written to the database: a trial run would become "the latest
    completed run" that the map, scoring's career anchors and the optimizer
    itself all read. The batch runs in the background; poll GET
    /topics/trials/{trialId}.
    """
    if not req.configs:
        raise HTTPException(status_code=400, detail="Tidak ada konfigurasi untuk diukur.")
    if len(req.configs) > TRIAL_MAX_CONFIGS:
        raise HTTPException(
            status_code=400,
            detail=f"Paling banyak {TRIAL_MAX_CONFIGS} konfigurasi per pengukuran.",
        )
    if _build_slot.locked():
        raise HTTPException(
            status_code=409,
            detail="Peta sedang dibangun ulang. Ukur setelah pembangunan selesai.",
        )
    if _run_lock.locked():
        raise HTTPException(
            status_code=409,
            detail="Pengukuran lain sedang berjalan. Tunggu hingga selesai.",
        )
    trial_id = uuid.uuid4().hex
    with _trials_guard:
        _prune_trials()
        _trials[trial_id] = {
            "trialId": trial_id,
            "status": "pending",
            "done": 0,
            "total": len(req.configs),
            "corpus": None,
            "results": [],
            "error": None,
            "createdAt": time.time(),
        }
    background.add_task(_run_trials, trial_id, [c.model_dump() for c in req.configs])
    return {"accepted": True, "trialId": trial_id}


@app.get("/topics/trials/{trial_id}")
def trial_status(trial_id: str) -> dict[str, Any]:
    with _trials_guard:
        trial = _trials.get(trial_id)
        if not trial:
            raise HTTPException(
                status_code=404,
                detail="Hasil pengukuran tidak ditemukan atau sudah kedaluwarsa.",
            )
        return {**trial, "results": list(trial["results"])}


@app.get("/topics/{run_id}/status")
def status(run_id: str) -> dict[str, Any]:
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run tidak ditemukan.")
    return run


def _run_pipeline(run_id: str, cfg: dict[str, Any], tenant_id: str | None = None) -> None:
    """Background worker: load → UMAP → HDBSCAN → c-TF-IDF → persist. Any failure
    is recorded on the run row so the web UI can surface the real cause."""
    try:
        # A trial batch may hold the compute lock; ask it to stop and wait for it.
        _build_waiting.set()
        if _run_lock.locked():
            db.update_progress(
                run_id,
                {"phase": "pending", "message": "Menunggu pengukuran optimasi berhenti..."},
            )
        acquired = _run_lock.acquire(timeout=BUILD_WAIT_S)
    except BaseException:
        _build_waiting.clear()
        _build_slot.release()
        raise
    if not acquired:
        _build_waiting.clear()
        _build_slot.release()
        db.fail_run(run_id, "Proses lain sedang berjalan.")
        return
    _build_waiting.clear()
    try:
        _build_locked(run_id, cfg, tenant_id)
    finally:
        _run_lock.release()
        _build_slot.release()


def _build_locked(run_id: str, cfg: dict[str, Any], tenant_id: str | None) -> None:
    try:
        docs = db.load_documents(tenant_id)
        if not docs:
            db.fail_run(
                run_id,
                "Tidak ada dokumen ter-embed untuk cakupan run ini. "
                + (
                    "Business unit ini belum punya dokumen job profile yang dipetakan "
                    "(atur pemetaan folder → tenant), atau embedding-nya belum dibangun."
                    if tenant_id
                    else "Jalankan 'Bangun Ulang Embedding' di Configuration terlebih dahulu."
                ),
            )
            return

        model = docs[0].get("embedding_model")
        db.set_processing(run_id, model, len(docs))

        documents = [d["document"] for d in docs]
        embeddings = np.asarray([d["embedding"] for d in docs], dtype=np.float32)

        # Guard against ragged/empty vectors (a partial embed run).
        if embeddings.ndim != 2 or embeddings.shape[1] == 0:
            db.fail_run(run_id, "Vektor embedding tidak valid atau kosong.")
            return

        log.info(
            "run %s (%s): %d documents, dim=%d",
            run_id,
            f"tenant={tenant_id}" if tenant_id else "global",
            len(docs),
            embeddings.shape[1],
        )

        result = pipeline.build_topics(
            documents,
            embeddings,
            cfg,
            progress_cb=lambda p: db.update_progress(run_id, p),
            record=True,
        )
        # The calculation trace (app/trace.py) rides along on the result; it is
        # completed below and stored on its own table, never on the run row.
        trace: dict[str, Any] | None = result.pop("trace", None)

        # Generalize every hierarchy node (leaf cluster + internal sub-family):
        # deterministic aggregate keywords/centroid reps + optional Gemini
        # title/description, bottom-up. Mutates result["topics"] + hierarchy.
        db.update_progress(
            run_id, {"phase": "generalize", "done": 0, "total": 1, "message": "Merangkum topik umum..."}
        )
        topics_seq = [-1] * len(docs)
        for a in result["assignments"]:
            topics_seq[a["idx"]] = a["topicId"]
        doc_titles = [(d.get("position_name") or "") for d in docs]
        generalize_trace: list[dict[str, Any]] | None = [] if trace is not None else None
        generalize.generalize_nodes(
            result["topics"],
            topics_seq,
            embeddings,
            doc_titles,
            documents,
            result["hierarchy"],
            progress_cb=lambda p: db.update_progress(run_id, p),
            trace=generalize_trace,
        )

        # Which corpus this map describes, so the web app can tell when the map
        # (and anything an optimizer measured) no longer matches what is embedded.
        diagnostics = {
            **(result.get("diagnostics") or {}),
            "corpus": {"fingerprint": db.corpus_fingerprint(docs), "documents": len(docs)},
            "reproducibility": pipeline.reproducibility_record(cfg),
        }

        # How much the published partition depends on the UMAP seed. Measured
        # only — the map stays the configured seed's. A failure here must not
        # fail a run whose map is already computed.
        try:
            stability = pipeline.seed_stability(
                documents,
                embeddings,
                cfg,
                [int(a["topicId"]) for a in sorted(result["assignments"], key=lambda a: a["idx"])],
                config.SEED_STABILITY_SEEDS,
                progress_cb=lambda p: db.update_progress(run_id, p),
            )
            if stability is not None:
                idx = stability.pop("unstableIdx")
                partitions = stability.pop("_partitions", [])
                stability["unstableJobProfileIds"] = [int(docs[i]["job_profile_id"]) for i in idx]
                diagnostics["seedStability"] = stability
                if trace is not None:
                    trace["seedStability"] = {**stability, "unstableIdx": idx, "partitions": partitions}
        except Exception as exc:  # noqa: BLE001
            log.exception("run %s: seed stability check failed", run_id)
            diagnostics["seedStability"] = {"error": str(exc)[:300]}

        db.update_progress(run_id, pipeline._p("persist", 5, "Menyimpan hasil..."))
        db.persist_results(run_id, docs, result)

        # Store the calculation trace. Its own table and its own failure mode:
        # a map that is computed and persisted must not be failed by its audit
        # copy, so a trace that cannot be built or written is reported on the
        # run (diagnostics.trace) instead — and the export then says so.
        if trace is not None:
            try:
                from . import trace as tr

                trace["version"] = tr.TRACE_VERSION
                trace["config"] = cfg
                trace["corpus"] = {
                    **tr.corpus_trace(docs, embeddings),
                    "fingerprint": diagnostics["corpus"]["fingerprint"],
                    "embeddingModel": model,
                    "tenantId": tenant_id,
                }
                trace["generalize"] = generalize_trace
                trace["hierarchyRows"] = result["hierarchy"]
                trace["reproducibility"] = diagnostics.get("reproducibility")
                blob = tr.pack(trace)
                db.store_trace(run_id, tr.TRACE_VERSION, blob)
                diagnostics["trace"] = {"stored": True, "version": tr.TRACE_VERSION, "bytes": len(blob)}
            except Exception as exc:  # noqa: BLE001
                log.exception("run %s: trace not stored", run_id)
                diagnostics["trace"] = {"stored": False, "error": str(exc)[:300]}
        db.complete_run(run_id, result["numTopics"], result["hierarchy"], diagnostics)
        log.info("run %s: completed, %d topics", run_id, result["numTopics"])
    except Exception as exc:  # noqa: BLE001 — record every failure on the run row
        log.exception("run %s failed", run_id)
        db.fail_run(run_id, str(exc))


def _prune_trials() -> None:
    """Drop expired batches, then the oldest beyond the cap. Caller holds _trials_guard."""
    now = time.time()
    for tid in [t for t, v in _trials.items() if now - v["createdAt"] > TRIAL_TTL_S]:
        del _trials[tid]
    while len(_trials) >= TRIAL_MAX_BATCHES:
        oldest = min(_trials, key=lambda t: _trials[t]["createdAt"])
        del _trials[oldest]


def _update_trial(trial_id: str, **fields: Any) -> None:
    with _trials_guard:
        trial = _trials.get(trial_id)
        if trial is not None:
            trial.update(fields)


def _run_trials(trial_id: str, configs: list[dict[str, Any]]) -> None:
    """Background worker for one trial batch: load the global corpus once, then
    measure each config in order. A failing config is reported in its own result
    and does not stop the others."""
    if not _run_lock.acquire(blocking=False):
        _update_trial(trial_id, status="failed", error="Proses lain sedang berjalan.")
        return
    try:
        docs = db.load_documents(None)
        if len(docs) < 2:
            _update_trial(
                trial_id,
                status="failed",
                error="Belum ada cukup dokumen ter-embed untuk diukur.",
            )
            return
        documents = [d["document"] for d in docs]
        embeddings = np.asarray([d["embedding"] for d in docs], dtype=np.float32)
        if embeddings.ndim != 2 or embeddings.shape[1] == 0:
            _update_trial(trial_id, status="failed", error="Vektor embedding tidak valid atau kosong.")
            return

        fingerprint = db.corpus_fingerprint(docs)
        _update_trial(
            trial_id,
            status="running",
            corpus={"fingerprint": fingerprint, "documents": len(docs)},
        )
        log.info("trial %s: %d configs over %d documents", trial_id, len(configs), len(docs))

        for i, item in enumerate(configs):
            if _build_waiting.is_set():
                _update_trial(
                    trial_id,
                    status="cancelled",
                    error="Pengukuran dihentikan karena peta sedang dibangun ulang.",
                )
                return
            started = time.time()
            echo = {
                "key": item["key"],
                "config": item.get("config") or {},
                "note": item.get("note") or "",
            }
            try:
                measured = pipeline.measure(
                    documents,
                    embeddings,
                    echo["config"],
                    reduced_cache=_reduced_cache,
                    cache_scope=fingerprint,
                )
                result = {**echo, "ok": True, **measured}
            except Exception as exc:  # noqa: BLE001 — one bad config must not sink the batch
                log.exception("trial %s: config %s failed", trial_id, item.get("key"))
                result = {**echo, "ok": False, "error": str(exc)[:300]}
            result["seconds"] = round(time.time() - started, 2)
            with _trials_guard:
                trial = _trials.get(trial_id)
                if trial is not None:
                    trial["results"].append(result)
                    trial["done"] = i + 1
            while len(_reduced_cache) > REDUCED_CACHE_MAX:
                _reduced_cache.pop(next(iter(_reduced_cache)))

        _update_trial(trial_id, status="completed")
    except Exception as exc:  # noqa: BLE001
        log.exception("trial %s failed", trial_id)
        _update_trial(trial_id, status="failed", error=str(exc)[:500])
    finally:
        _run_lock.release()
