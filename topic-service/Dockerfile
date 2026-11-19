FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8003

WORKDIR /app

# Build toolchain for any source-built wheels (umap-learn pulls numba/llvmlite;
# hdbscan is Cython). Manylinux wheels usually cover cp311, but gcc keeps the
# source fallback working across environments.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch FIRST. sentence-transformers is a hard BERTopic dependency, and
# its default torch wheel is multi-GB CUDA. We never embed here (vectors are
# precomputed in Postgres) — the import just has to resolve — so the ~200MB CPU
# wheel is all we need. Installing it before requirements makes pip treat torch
# as already-satisfied when it resolves bertopic/sentence-transformers.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
