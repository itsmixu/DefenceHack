"""MML provider — National Land Survey of Finland terrain polygons via WFS.

Queries MML's Maastotietokanta (topographic database) WFS for terrain-obstacle
polygons: swamp, water bodies, and bedrock — the features that determine where
forces can or cannot move (challenge.md §primary categories: terrain/topography).

Auth: API key added to every request as `api-key=` query param.
Native CRS: EPSG:3067 — reprojected to EPSG:4326 before emission.

Layer names are based on MML WFS v3 documented feature types. Override any of
them with env vars if the service has renamed them since this was written.
A startup GetCapabilities probe logs the real available type names so mismatches
are easy to diagnose.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime

import httpx

from .. import cache
from ..bbox import BBox
from ..geo import reproject_bbox, reproject_geometry
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

logger = logging.getLogger(__name__)

WFS_BASE = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/wfs/v3"
SRC_CRS = "EPSG:3067"
MAX_FEATURES_PER_TYPE = 500
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # 1 week — terrain barely changes

# Terrain types and their default WFS feature type names.
# The terrain_type value becomes properties.terrain_type in the GeoJSON output.
# Override via env: MML_LAYER_<TERRAIN_TYPE_UPPER>=<WFS type name>
DEFAULT_TERRAIN_TYPES: dict[str, str] = {
    "swamp":    os.getenv("MML_LAYER_SWAMP",    "Suo"),
    "lake":     os.getenv("MML_LAYER_LAKE",     "Jarvi"),
    "river":    os.getenv("MML_LAYER_RIVER",    "Virtavesialue"),
    "sea":      os.getenv("MML_LAYER_SEA",      "Meriaalue"),
    "bedrock":  os.getenv("MML_LAYER_BEDROCK",  "KallioAlue"),
    "sand":     os.getenv("MML_LAYER_SAND",     "HiekkaSoraAlue"),
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


def _wfs_params(api_key: str, extra: dict) -> dict:
    return {
        "service": "WFS",
        "version": "2.0.0",
        "api-key": api_key,
        **extra,
    }


async def _probe_capabilities(client: httpx.AsyncClient, api_key: str) -> None:
    """Fetch GetCapabilities and log available feature type names for diagnostics."""
    try:
        resp = await client.get(
            WFS_BASE,
            params=_wfs_params(api_key, {"request": "GetCapabilities"}),
            timeout=15.0,
        )
        resp.raise_for_status()
        # Pull out <Name> tags to show what's available — XML, but tiny regex is fine.
        import re
        names = re.findall(r"<Name>([^<]+)</Name>", resp.text)
        logger.info("MML WFS available feature types: %s", names)
    except Exception as exc:
        logger.warning("MML capabilities probe failed: %s", exc)


async def _fetch_terrain_type(
    client: httpx.AsyncClient,
    api_key: str,
    terrain_type: str,
    wfs_type: str,
    src_bbox: tuple[float, float, float, float],
) -> list[dict]:
    params = _wfs_params(api_key, {
        "request": "GetFeature",
        "typeNames": wfs_type,
        "outputFormat": "application/json",
        "srsName": SRC_CRS,
        "count": str(MAX_FEATURES_PER_TYPE),
        "bbox": f"{src_bbox[0]},{src_bbox[1]},{src_bbox[2]},{src_bbox[3]},{SRC_CRS}",
    })
    try:
        resp = await client.get(WFS_BASE, params=params, timeout=30.0)
        if resp.status_code == 400:
            logger.warning("MML: unknown feature type '%s' — skip (set MML_LAYER_%s to override)",
                           wfs_type, terrain_type.upper())
            return []
        resp.raise_for_status()
        payload = resp.json()
    except httpx.HTTPError as exc:
        logger.warning("MML WFS fetch failed for %s: %s", wfs_type, exc)
        return []
    except ValueError as exc:
        logger.warning("MML WFS non-JSON for %s: %s", wfs_type, exc)
        return []

    features: list[dict] = []
    for raw in payload.get("features", []):
        geom = raw.get("geometry")
        if geom is None:
            continue
        features.append({
            "type": "Feature",
            "id": raw.get("id"),
            "geometry": reproject_geometry(geom, SRC_CRS),
            "properties": {
                "source": "mml",
                "terrain_type": terrain_type,
                "passability": PASSABILITY.get(terrain_type, "unknown"),
                **(raw.get("properties") or {}),
            },
        })
    return features


class MMLProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="mml", label="MML — National Land Survey of Finland")
        self._capabilities_logged = False

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

        src_bbox = reproject_bbox(
            (bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat),
            "EPSG:4326", SRC_CRS,
        )

        async with httpx.AsyncClient(headers={"User-Agent": "DefenceHack-IPB/0.1"}) as client:
            # Log available types once so mismatches are easy to spot in the log.
            if not self._capabilities_logged:
                asyncio.create_task(_probe_capabilities(client, api_key))
                self._capabilities_logged = True

            tasks = [
                _fetch_terrain_type(client, api_key, terrain_type, wfs_type, src_bbox)
                for terrain_type, wfs_type in DEFAULT_TERRAIN_TYPES.items()
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
