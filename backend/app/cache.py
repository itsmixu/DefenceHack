"""File-based response cache under data/cache/<source>/.

Cached entries are keyed by a SHA-256 hash of (bbox + params). Each cache
namespace (source id) has its own subdirectory and its own size budget,
because raw vector layers (MML terrain, MML contours) are far larger per
entry than computed layers.

Why disk-size accounting matters for memory:
  Cache reads load the entire JSON payload into RAM (and JSON decoding
  inflates strings into Python objects roughly 3–5× the on-disk size). A
  137 MB cache file therefore costs ~500 MB of transient RAM per request
  that touches it. Bounding the cache disk footprint indirectly bounds
  the worst-case per-request RAM spike.

Eviction strategy:
  - Per-source size budget (`SOURCE_BUDGETS_MB`, default `DEFAULT_BUDGET_MB`).
  - Single-entry size cap (`MAX_ENTRY_MB`): oversized payloads are
    silently dropped — the next request will refetch and serve the live
    response without persisting it.
  - LRU eviction by mtime when a write would push the namespace over its
    budget.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from .paths import DATA_ROOT

CACHE_ROOT = DATA_ROOT / "cache"

# Per-namespace disk budgets. Keep terrain-heavy sources generous; everything
# else stays small. Tune via env if needed later.
DEFAULT_BUDGET_MB = 256
SOURCE_BUDGETS_MB: dict[str, int] = {
    "mml":          1024,   # terrain polygons — large geometries
    "mml_contours": 1024,   # elevation lines — densest payload
    "digiroad":     512,
    "statfin":      256,
    "osm":          256,
    "syke":         128,
    "exposure":     128,
    "fmi":          64,
    "fmi_forecast": 64,
    "n2yo":         32,
    "opencellid":   32,
}

# Single-entry cap: anything bigger is not cached at all. Picked so the worst-
# case JSON decode stays under ~250 MB peak resident memory.
MAX_ENTRY_MB = 48


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


def _budget_bytes(source: str) -> int:
    return SOURCE_BUDGETS_MB.get(source, DEFAULT_BUDGET_MB) * 1024 * 1024


def _evict_to_budget(source: str, budget_bytes: int) -> None:
    """Drop oldest files (by mtime) until the namespace fits in budget."""
    d = CACHE_ROOT / source
    if not d.exists():
        return
    try:
        entries = [(f, f.stat()) for f in d.iterdir() if f.is_file()]
    except OSError:
        return
    total = sum(s.st_size for _, s in entries)
    if total <= budget_bytes:
        return
    # Oldest first.
    entries.sort(key=lambda e: e[1].st_mtime)
    for f, s in entries:
        if total <= budget_bytes:
            break
        try:
            f.unlink()
            total -= s.st_size
        except OSError:
            continue


def write(source: str, parts: dict[str, Any], payload: dict[str, Any]) -> None:
    """Persist payload to cache. Best-effort: silently skips oversized writes."""
    try:
        blob = json.dumps(payload)
    except (TypeError, ValueError):
        return
    size = len(blob.encode())
    if size > MAX_ENTRY_MB * 1024 * 1024:
        # Too large to cache safely — would dominate RAM on the next read.
        return
    p = cache_path(source, parts)
    try:
        p.write_text(blob)
    except OSError:
        return  # cache is best-effort
    _evict_to_budget(source, _budget_bytes(source))
