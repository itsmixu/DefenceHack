"""OpenCelliD provider — cell tower locations and estimated coverage rings.

Queries the OpenCelliD getInArea API for all towers in the bbox and emits:
  - One Point feature per tower (category="tower")
  - One Polygon feature per tower representing approximate coverage radius
    (category="coverage"), sized by radio technology:
      NR (5G)  →  300 m
      LTE (4G) → 1000 m
      UMTS (3G)→ 2000 m
      GSM (2G) → 5000 m

Coverage rings are geodesic circles (pyproj.Geod) so they're accurate at
high latitudes rather than naive degree-offset approximations.

Useful for IPB: identifies communications infrastructure, coverage gaps,
and areas where adversary or friendly signals could be exploited/jammed.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime
from math import ceil, cos, radians

import httpx
from pyproj import Geod

from .. import cache
from ..bbox import BBox
from ..http_client import get_client
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

API_URL = "https://opencellid.org/cell/getInArea"
MAX_CELLS = 2000
CACHE_TTL_SECONDS = 24 * 60 * 60  # 1 day
RING_VERTICES = 24  # polygon approximation of coverage circle

# OpenCelliD getInArea hard-rejects bboxes over 4,000,000 sq.m. We tile any
# larger request and merge. TILE_MAX_SIDE_M is the per-tile side in metres
# (~sqrt(3.8M) — leaves margin under the API limit). MAX_TILES_PER_REQUEST
# caps the fan-out to protect the 1000 req/day free-tier budget; beyond it
# we return partial with a "zoom in" reason rather than fanning out widely.
TILE_MAX_SIDE_M = 1900
MAX_TILES_PER_REQUEST = 9
TILE_CONCURRENCY = 4

# Approximate coverage radius by radio technology (metres).
# Values reflect typical rural/mixed Finnish terrain (mostly flat, forested).
# Urban cells are smaller; these are IPB worst-case (widest plausible range).
#   5G NR:  1 km   — millimetre-wave / sub-6 GHz urban small cells
#   4G LTE: 5 km   — typical macro cell in mixed terrain
#   3G UMTS:8 km   — wider than LTE due to lower frequency
#   2G GSM: 15 km  — legacy towers often cover large rural areas; can reach 35 km
# Source: 3GPP TS 36.104 / ITU-R M.1225 field measurement averages.
RADIUS_BY_RADIO: dict[str, int] = {
    "NR":   1_000,
    "LTE":  5_000,
    "UMTS": 8_000,
    "GSM":  15_000,
}
DEFAULT_RADIUS = 5_000

_GEOD = Geod(ellps="WGS84")


def _coverage_ring(lon: float, lat: float, radius_m: int) -> list[list[float]]:
    """Return a closed polygon ring (lon, lat pairs) for a geodesic circle."""
    azimuths = [i * (360 / RING_VERTICES) for i in range(RING_VERTICES)]
    ring: list[list[float]] = []
    for az in azimuths:
        end_lon, end_lat, _ = _GEOD.fwd(lon, lat, az, radius_m)
        ring.append([end_lon, end_lat])
    ring.append(ring[0])  # close
    return ring


def _cell_features(cell: dict) -> list[dict]:
    try:
        lat = float(cell["lat"])
        lon = float(cell["lon"])
    except (KeyError, ValueError, TypeError):
        return []

    radio = str(cell.get("radio") or "LTE").upper()
    radius = RADIUS_BY_RADIO.get(radio, DEFAULT_RADIUS)

    base_props = {
        "source": "opencellid",
        "radio": radio,
        "mcc": cell.get("mcc"),
        "mnc": cell.get("mnc"),
        "lac": cell.get("lac"),
        "cellid": cell.get("cellid"),
        "signal_strength": cell.get("averageSignalStrength"),
        "samples": cell.get("samples"),
        "radius_m": radius,
    }

    tower = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {**base_props, "category": "tower"},
    }
    coverage = {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [_coverage_ring(lon, lat, radius)],
        },
        "properties": {**base_props, "category": "coverage"},
    }
    return [tower, coverage]


def _tile_bbox(bbox: BBox) -> list[BBox]:
    """Split bbox into tiles each ≤ TILE_MAX_SIDE_M on a side."""
    lat_mid = (bbox.min_lat + bbox.max_lat) / 2
    width_m = (bbox.max_lon - bbox.min_lon) * cos(radians(lat_mid)) * 111_320
    height_m = (bbox.max_lat - bbox.min_lat) * 111_320
    nx = max(1, ceil(width_m / TILE_MAX_SIDE_M))
    ny = max(1, ceil(height_m / TILE_MAX_SIDE_M))
    if nx == 1 and ny == 1:
        return [bbox]
    dlon = (bbox.max_lon - bbox.min_lon) / nx
    dlat = (bbox.max_lat - bbox.min_lat) / ny
    tiles: list[BBox] = []
    for i in range(nx):
        for j in range(ny):
            tiles.append(BBox(
                bbox.min_lon + i * dlon,
                bbox.min_lat + j * dlat,
                bbox.min_lon + (i + 1) * dlon,
                bbox.min_lat + (j + 1) * dlat,
            ))
    return tiles


async def _fetch_tile(
    client: httpx.AsyncClient,
    api_key: str,
    tile: BBox,
    sem: asyncio.Semaphore,
) -> tuple[list[dict], int, str | None]:
    """Fetch one tile. Returns (cells, count, error_reason)."""
    params = {
        "key": api_key,
        "BBOX": f"{tile.min_lat},{tile.min_lon},{tile.max_lat},{tile.max_lon}",
        "format": "json",
        "limit": str(MAX_CELLS),
    }
    async with sem:
        try:
            resp = await client.get(API_URL, params=params, timeout=30.0)
            resp.raise_for_status()
            payload = resp.json()
        except httpx.HTTPError as e:
            return [], 0, f"OpenCelliD error: {e}"
        except ValueError as e:
            return [], 0, f"OpenCelliD non-JSON response: {e}"

    if payload.get("error"):
        return [], 0, f"OpenCelliD error: {payload.get('error')}"

    cells = payload.get("cells") or []
    return cells, int(payload.get("count", len(cells))), None


class OpenCelliDProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="opencellid", label="OpenCelliD — cell tower locations")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        api_key = os.getenv("OPENCELLID_API_KEY") or None
        if not api_key:
            self.mark("unavailable", "OPENCELLID_API_KEY not set")
            return empty_collection(
                self.id, status="unavailable", reason="OPENCELLID_API_KEY not set",
                bbox=bbox.as_list(), t=t,
            )

        cache_key = {"bbox": bbox.as_list()}
        cached = cache.read(self.id, cache_key, CACHE_TTL_SECONDS)
        if cached is not None:
            cached_features = cached.get("features", [])
            cached_status = cached.get("status")
            cached_reason = cached.get("reason")
            if cached_status not in {"ok", "partial", "unavailable"}:
                if cached_features:
                    cached_status = "ok"
                    cached_reason = "served from cache"
                else:
                    cached_status = "partial"
                    cached_reason = "served from cache (no towers in bbox)"

            self.mark(cached_status, cached_reason)
            return FeatureCollection(
                features=cached_features,
                meta=LayerMeta(
                    source=self.id, status=cached_status, reason=cached_reason,
                    bbox=bbox.as_list(), t=t,
                ),
            )

        tiles = _tile_bbox(bbox)
        if len(tiles) > MAX_TILES_PER_REQUEST:
            reason = (
                f"bbox covers {len(tiles)} OpenCelliD tiles "
                f"(max {MAX_TILES_PER_REQUEST}); zoom in further"
            )
            self.mark("partial", reason)
            return empty_collection(
                self.id, status="partial", reason=reason,
                bbox=bbox.as_list(), t=t,
            )

        client = get_client()
        sem = asyncio.Semaphore(TILE_CONCURRENCY)
        results = await asyncio.gather(
            *(_fetch_tile(client, api_key, tile, sem) for tile in tiles)
        )

        cells: list[dict] = []
        seen: set[tuple] = set()
        total_count = 0
        errors: list[str] = []
        for tile_cells, tile_count, err in results:
            if err is not None:
                errors.append(err)
                continue
            total_count += tile_count
            for cell in tile_cells:
                # Tiles can overlap with the API's coverage on edges — dedupe
                # by stable cell identifier (mcc, mnc, lac, cellid).
                key = (
                    cell.get("mcc"), cell.get("mnc"),
                    cell.get("lac"), cell.get("cellid"),
                )
                if None in key:
                    key = (cell.get("lat"), cell.get("lon"), cell.get("radio"))
                if key in seen:
                    continue
                seen.add(key)
                cells.append(cell)

        if errors and not cells:
            reason = errors[0]
            self.mark("unavailable", reason)
            return empty_collection(
                self.id, status="unavailable", reason=reason,
                bbox=bbox.as_list(), t=t,
            )

        features = [f for cell in cells for f in _cell_features(cell)]
        tower_count = len(cells)
        truncated = total_count >= MAX_CELLS * len(tiles)
        if truncated:
            status = "partial"
            reason = f"{tower_count} towers (capped per tile; zoom in for full detail)"
        elif errors:
            status = "partial"
            reason = f"{tower_count} towers ({len(errors)}/{len(tiles)} tiles failed)"
        elif features:
            status = "ok"
            reason = f"{tower_count} towers"
            if len(tiles) > 1:
                reason += f" ({len(tiles)} tiles merged)"
        else:
            status = "partial"
            reason = "no towers in bbox"

        cache.write(
            self.id,
            cache_key,
            {"features": features, "status": status, "reason": reason},
        )

        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
            ),
        )
