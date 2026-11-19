"""Environment configuration for the topic-service.

Reads the SAME Postgres database as the Next.js web app and the other services;
DATABASE_URL / POSTGRES_URL are used interchangeably across the repo (the web
app checks both), so we honour both here too.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load THIS service's own .env regardless of the launch cwd (app/config.py →
# ../../.env = topic-service/.env). A bare load_dotenv() resolves against the
# current working directory, so launching from anywhere but topic-service/ found
# no env and every setting fell back to its default (wrong database, no Gemini).
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

PORT: int = int(os.getenv("PORT", "8003"))

POSTGRES_URL: str = (
    os.getenv("POSTGRES_URL")
    or os.getenv("DATABASE_URL")
    or "postgresql://postgres:postgres@localhost:5432/pulse"
)

VECTOR_DATABASE_URL: str = (
    os.getenv("VECTOR_DATABASE_URL")
    or os.getenv("VECTOR_POSTGRES_URL")
    or POSTGRES_URL
)

# How many extra UMAP seeds a build re-clusters under to measure how much the
# published map depends on its seed (diagnostics.seedStability). Each costs one
# more clustering pass; 0 disables the check. Capped at 10.
SEED_STABILITY_SEEDS: int = max(0, min(10, int(os.getenv("TOPIC_SEED_STABILITY_SEEDS", "3"))))

# ── Gemini (optional) — job-family node generalization titles/descriptions ──
# Mirrors the scoring-service defaults. When GEMINI_API_KEY is unset the run
# still completes; nodes fall back to deterministic keyword-based titles.
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_BASE_URL: str = os.getenv(
    "GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"
)
GEMINI_TEMPERATURE: float = float(os.getenv("GEMINI_TEMPERATURE", "0"))
GEMINI_TOP_P: float = float(os.getenv("GEMINI_TOP_P", "0"))
GEMINI_TIMEOUT_S: float = float(os.getenv("GEMINI_TIMEOUT_MS", "60000")) / 1000.0
