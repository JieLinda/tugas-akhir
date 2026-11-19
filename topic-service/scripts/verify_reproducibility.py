"""Verify that the job-family clustering is reproducible, and how seed-dependent it is.

    python scripts/verify_reproducibility.py            # synthetic corpus (no DB)
    python scripts/verify_reproducibility.py --db       # the real global corpus
    python scripts/verify_reproducibility.py --db --seed 42 --alt-seeds 5

Each check runs the REAL `pipeline.build_topics()` in a FRESH Python process, so
nothing (numba caches, module state, the trials' UMAP cache) carries over:

  R1  same seed, 3 separate processes        → membership, 2-D coords, keywords
                                                and Family Tree must be identical
  R2  same seed, 1 thread (NUMBA/OMP/BLAS)   → identical to R1
  R3  same seed, other PYTHONHASHSEED        → identical to R1
  R4  `measure()` (the optimizer's trial)    → same membership as a build
  S1  other seeds (informational)            → ARI vs the published seed; this is
                                                what diagnostics.seedStability
                                                records on every build
  S2  same seed, shuffled row order (info)   → why documents are loaded in
                                                job_profile_id order

R1–R4 failing is a bug (exit 1). S1/S2 are measurements, not pass/fail: a fixed
seed buys reproducibility, not robustness, and S1 says how much of the map is the
seed. Nothing is written to the database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _corpus(use_db: bool):
    import numpy as np

    if use_db:
        from app import db

        docs = db.load_documents(None)
        return [d["document"] for d in docs], np.asarray([d["embedding"] for d in docs], dtype=np.float32)

    # Synthetic: families of varying tightness plus pure noise, 768-d like Nomic.
    rng = np.random.default_rng(20261104)
    vocab = [f"kata{i}" for i in range(600)]
    centers = rng.normal(size=(24, 768))
    documents, emb = [], []
    for f in range(24):
        words = vocab[f * 20 : (f + 1) * 20]
        spread = 0.35 + 0.5 * (f % 4) / 3
        for _ in range(11):
            emb.append(centers[f] + rng.normal(scale=spread * 8, size=768) / np.sqrt(768) * np.linalg.norm(centers[f]))
            documents.append(" ".join(rng.choice(words, 25)) + " " + " ".join(rng.choice(vocab, 10)))
    for _ in range(16):
        emb.append(rng.normal(size=768))
        documents.append(" ".join(rng.choice(vocab, 35)))
    return documents, np.asarray(emb, dtype=np.float32)


def _h(x) -> str:
    return hashlib.sha256(json.dumps(x, sort_keys=True, default=float).encode()).hexdigest()[:16]


def _worker(args: argparse.Namespace) -> None:
    """One pipeline run; prints a JSON fingerprint on the last line."""
    import warnings

    import numpy as np

    warnings.filterwarnings("ignore")
    from app import pipeline

    documents, emb = _corpus(args.db)
    cfg = dict(json.loads(args.config))
    cfg["randomState"] = args.seed
    perm = None
    if args.shuffle is not None:
        perm = np.random.default_rng(args.shuffle).permutation(len(documents))
        documents = [documents[i] for i in perm]
        emb = emb[perm]

    if args.worker == "measure":
        mem = pipeline.measure(documents, emb, cfg, reduced_cache={}, cache_scope="verify")["membership"]
        out = {"membership": mem}
    else:
        r = pipeline.build_topics(documents, emb, cfg, lambda _p: None)
        mem = [a["topicId"] for a in sorted(r["assignments"], key=lambda a: a["idx"])]
        out = {
            "membership": mem,
            "coords": _h([[round(a["x"], 6), round(a["y"], 6)] for a in r["assignments"]]),
            "keywords": _h([[k["word"] for k in t["keywords"]] for t in r["topics"]]),
            "hierarchy": _h(r["hierarchy"]),
        }
    if perm is not None:  # back to canonical document order
        inv = np.empty_like(perm)
        inv[perm] = np.arange(len(perm))
        out["membership"] = [out["membership"][i] for i in inv]
    out["topics"] = len({t for t in out["membership"] if t != -1})
    out["membershipHash"] = _h(out["membership"])
    print(json.dumps(out))


def _spawn(args: argparse.Namespace, mode: str, seed: int, env: dict[str, str] | None = None, shuffle: int | None = None):
    cmd = [sys.executable, __file__, "--worker", mode, "--seed", str(seed), "--config", args.config]
    if args.db:
        cmd.append("--db")
    if shuffle is not None:
        cmd += ["--shuffle", str(shuffle)]
    return subprocess.Popen(
        cmd, cwd=ROOT, env={**os.environ, **(env or {})}, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True
    )


def _collect(proc) -> dict:
    out, _ = proc.communicate()
    if proc.returncode != 0:
        raise SystemExit(f"worker failed (exit {proc.returncode})")
    return json.loads(out.strip().splitlines()[-1])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", action="store_true", help="use the real global corpus from Postgres")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--alt-seeds", type=int, default=4)
    ap.add_argument(
        "--config",
        default=json.dumps({"reduceOutliers": True, "outlierThreshold": 0.0}),
        help="bertopic config JSON (job_family_topic_runs.config of the run to reproduce)",
    )
    ap.add_argument("--worker", choices=["build", "measure"], help=argparse.SUPPRESS)
    ap.add_argument("--shuffle", type=int, help=argparse.SUPPRESS)
    args = ap.parse_args()
    sys.path.insert(0, str(ROOT))
    if args.worker:
        _worker(args)
        return

    from sklearn.metrics import adjusted_rand_score

    from app import pipeline

    print("Lingkungan:", json.dumps(pipeline.reproducibility_record({"randomState": args.seed})["versions"]))
    one = {k: "1" for k in ("NUMBA_NUM_THREADS", "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS")}
    procs = {
        "R1a": _spawn(args, "build", args.seed),
        "R1b": _spawn(args, "build", args.seed),
        "R1c": _spawn(args, "build", args.seed),
        "R2": _spawn(args, "build", args.seed, one),
        "R3": _spawn(args, "build", args.seed, {"PYTHONHASHSEED": "12345"}),
        "R4": _spawn(args, "measure", args.seed),
    }
    res = {k: _collect(p) for k, p in procs.items()}
    ref = res["R1a"]
    failed = False
    print(f"\nSeed {args.seed}: {ref['topics']} famili, membership {ref['membershipHash']}")
    for k, r in res.items():
        fields = ["membershipHash"] + ([f for f in ("coords", "keywords", "hierarchy")] if k != "R4" else [])
        diff = [f for f in fields if r[f] != ref[f]]
        failed |= bool(diff)
        print(f"  {k:4s} {'IDENTIK' if not diff else 'BERBEDA: ' + ', '.join(diff)}")

    alt = {s: _spawn(args, "build", s) for s in range(args.seed + 1, args.seed + 1 + args.alt_seeds)}
    shuf = {s: _spawn(args, "build", args.seed, shuffle=s) for s in (1, 2)}
    print("\nS1 seed lain (informasi — ARI 1 = pembagian identik):")
    for s, p in alt.items():
        r = _collect(p)
        print(f"  seed {s:6d}: {r['topics']:3d} famili, ARI {adjusted_rand_score(ref['membership'], r['membership']):.3f}")
    print("S2 urutan baris diacak, seed sama (informasi):")
    for s, p in shuf.items():
        r = _collect(p)
        print(f"  acak #{s}: {r['topics']:3d} famili, ARI {adjusted_rand_score(ref['membership'], r['membership']):.3f}")

    print("\nHASIL:", "GAGAL — pipeline tidak deterministik" if failed else "LULUS — dapat direproduksi persis")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
