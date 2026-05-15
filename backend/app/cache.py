"""File-based response cache under data/cache/<source>/. Keyed by bbox+params hash."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

# data/cache lives at repo root, two levels up from backend/app/cache.py
CACHE_ROOT = Path(__file__).resolve().parents[2] / "data" / "cache"


def _key(parts: dict[str, Any]) -> str:
    blob = json.dumps(parts, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def cache_path(source: str, parts: dict[str, Any]) -> Path:
    d = CACHE_ROOT / source
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{_key(parts)}.json"


def read(source: str, parts: dict[str, Any], ttl_seconds: int) -> dict[str, Any] | None:
    p = cache_path(source, parts)
    if not p.exists():
        return None
    if time.time() - p.stat().st_mtime > ttl_seconds:
        return None
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def write(source: str, parts: dict[str, Any], payload: dict[str, Any]) -> None:
    p = cache_path(source, parts)
    try:
        p.write_text(json.dumps(payload))
    except OSError:
        pass  # cache is best-effort
