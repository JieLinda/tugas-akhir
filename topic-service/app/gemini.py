"""Minimal Gemini JSON client for job-family node generalization.

Mirrors the scoring-service Gemini client (temperature 0, topP 0 for
determinism) but uses ONLY the Python stdlib (urllib) so the topic-service gains
no new dependency. Unlike the education scorer this path needs no Google-Search
grounding, so it uses Gemini's native structured-output mode
(responseMimeType=application/json + responseSchema) for reliable JSON.

Entirely optional: when GEMINI_API_KEY is unset (or any call fails) the caller
falls back to deterministic keyword-based titles.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from . import config

log = logging.getLogger("topic-service.gemini")


def configured() -> bool:
    return bool(config.GEMINI_API_KEY)


def generate_json(
    system_prompt: str,
    user_prompt: str,
    schema: dict[str, Any],
) -> dict[str, Any] | None:
    """One deterministic Gemini call returning parsed JSON, or None on any
    failure (missing key, transport/HTTP error, or unparseable output)."""
    if not config.GEMINI_API_KEY:
        return None

    url = (
        f"{config.GEMINI_BASE_URL.rstrip('/')}/models/"
        f"{config.GEMINI_MODEL}:generateContent?key={config.GEMINI_API_KEY}"
    )
    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": config.GEMINI_TEMPERATURE,
            "topP": config.GEMINI_TOP_P,
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=config.GEMINI_TIMEOUT_S) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        log.warning("gemini call failed: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001 — never let a labeling call crash a run
        log.warning("gemini call error: %s", exc)
        return None

    try:
        parts = payload["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts).strip()
        if not text:
            return None
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        log.warning("gemini response parse failed: %s", exc)
        return None
