"""MML provider — National Land Survey of Finland terrain polygons.

Queries MML's Maastotietokanta (topographic database) for terrain-obstacle
polygons: swamp, water bodies, and bedrock — the features that determine where
forces can or cannot move (challenge.md §primary categories: terrain/topography).

MML retired the WFS v3 endpoint and replaced it with an OGC API — Features
service that returns GeoJSON directly in EPSG:4326. No reprojection needed.

Auth: API key added to every request as `api-key=` query param.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime

import httpx

from .. import cache
from ..bbox import BBox
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

logger = logging.getLogger(__name__)

API_BASE = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/features/v1"
PAGE_SIZE = 10000             # per-request page; MML accepts large pages
HARD_CAP_PER_TYPE = 50000     # safety bound per terrain type
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # 1 week — terrain barely changes

# Terrain types and their default OGC API Features collection ids (lowercase
# Finnish singulars). Override via env: MML_LAYER_<TERRAIN_TYPE_UPPER>=<id>.
def _env(name: str, default: str) -> str:
    """getenv but treat empty values as missing so blank .env entries fall back."""
    return os.getenv(name) or default


DEFAULT_TERRAIN_TYPES: dict[str, str] = {
    "swamp":    _env("MML_LAYER_SWAMP",    "suo"),
    "lake":     _env("MML_LAYER_LAKE",     "jarvi"),
    "river":    _env("MML_LAYER_RIVER",    "virtavesialue"),
    "sea":      _env("MML_LAYER_SEA",      "meri"),
    "bedrock":  _env("MML_LAYER_BEDROCK",  "kallioalue"),
    "sand":     _env("MML_LAYER_SAND",     "hietikko"),
}

# IPB passability hint — frontend can colour-code by this without knowing WFS semantics.
PASSABILITY: dict[str, str] = {
    "swamp":   "impassable",
    "lake":    "impassable",
    "river":   "obstacle",
    "sea":     "impassable",
    "bedrock": "obstacle",
    "sand":    "slow",
}


def _api_key() -> str | None:
    return os.getenv("MML_API_KEY") or None


async def _fetch_terrain_type(
    client: httpx.AsyncClient,
    api_key: str,
    terrain_type: str,
    collection: str,
    bbox: BBox,
) -> list[dict]:
    first_url: str | None = f"{API_BASE}/collections/{collection}/items"
    first_params: dict[str, str] | None = {
        "api-key": api_key,
        "bbox": f"{bbox.min_lon},{bbox.min_lat},{bbox.max_lon},{bbox.max_lat}",
        "limit": str(PAGE_SIZE),
        "f": "json",
    }
    features: list[dict] = []
    next_url, next_params = first_url, first_params
    try:
        while next_url is not None:
            resp = await client.get(next_url, params=next_params, timeout=30.0)
            if resp.status_code == 404:
                logger.warning("MML: collection '%s' not found — skip (set MML_LAYER_%s to override)",
                               collection, terrain_type.upper())
                return []
            resp.raise_for_status()
            payload = resp.json()
            for raw in payload.get("features", []):
                geom = raw.get("geometry")
                if geom is None:
                    continue
                features.append({
                    "type": "Feature",
                    "id": raw.get("id"),
                    "geometry": geom,  # already EPSG:4326
                    "properties": {
                        "source": "mml",
                        "terrain_type": terrain_type,
                        "passability": PASSABILITY.get(terrain_type, "unknown"),
                        **(raw.get("properties") or {}),
                    },
                })
            if len(features) >= HARD_CAP_PER_TYPE:
                break
            nxt = next(
                (lnk.get("href") for lnk in payload.get("links", [])
                 if lnk.get("rel") == "next" and lnk.get("href")),
                None,
            )
            next_url = nxt
            next_params = None  # href already carries params
    except httpx.HTTPError as exc:
        logger.warning("MML fetch failed for %s: %s", collection, exc)
        return features
    except ValueError as exc:
        logger.warning("MML non-JSON for %s: %s", collection, exc)
        return features
    return features


class MMLProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="mml", label="MML — National Land Survey of Finland")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        api_key = _api_key()
        if not api_key:
            self.mark("unavailable", "MML_API_KEY not set")
            return empty_collection(
                self.id, status="unavailable", reason="MML_API_KEY not set",
                bbox=bbox.as_list(), t=t,
            )

        cache_key = {"bbox": bbox.as_list(), "types": DEFAULT_TERRAIN_TYPES}
        cached = cache.read(self.id, cache_key, CACHE_TTL_SECONDS)
        if cached is not None:
            self.mark("ok", "served from cache")
            return FeatureCollection(
                features=cached.get("features", []),
                meta=LayerMeta(
                    source=self.id, status="ok", reason="served from cache",
                    bbox=bbox.as_list(), t=t,
                ),
            )

        async with httpx.AsyncClient(headers={"User-Agent": "DefenceHack-IPB/0.1"}) as client:
            tasks = [
                _fetch_terrain_type(client, api_key, terrain_type, collection, bbox)
                for terrain_type, collection in DEFAULT_TERRAIN_TYPES.items()
            ]
            results = await asyncio.gather(*tasks)

        features = [f for group in results for f in group]
        cache.write(self.id, cache_key, {"features": features})

        status = "ok" if features else "partial"
        reason = (
            f"{len(features)} terrain polygons ({', '.join(DEFAULT_TERRAIN_TYPES)})"
            if features else "no terrain polygons in bbox"
        )
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
            ),
        )
