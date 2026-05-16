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

import os
from datetime import datetime

import httpx
from pyproj import Geod

from .. import cache
from ..bbox import BBox
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

API_URL = "https://opencellid.org/cell/getInArea"
MAX_CELLS = 2000
CACHE_TTL_SECONDS = 24 * 60 * 60  # 1 day
RING_VERTICES = 24  # polygon approximation of coverage circle

# Approximate coverage radius by radio technology (metres).
RADIUS_BY_RADIO: dict[str, int] = {
    "NR":   300,
    "LTE":  1000,
    "UMTS": 2000,
    "GSM":  5000,
}
DEFAULT_RADIUS = 1000

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

        # OpenCelliD BBOX order: minLat,minLon,maxLat,maxLon
        params = {
            "key": api_key,
            "BBOX": f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}",
            "format": "json",
            "limit": str(MAX_CELLS),
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(
                    API_URL, params=params,
                    headers={"User-Agent": "DefenceHack-IPB/0.1"},
                )
                resp.raise_for_status()
                payload = resp.json()
        except httpx.HTTPError as e:
            self.mark("unavailable", f"OpenCelliD error: {e}")
            return empty_collection(
                self.id, status="unavailable", reason=f"OpenCelliD error: {e}",
                bbox=bbox.as_list(), t=t,
            )
        except ValueError as e:
            self.mark("unavailable", f"OpenCelliD non-JSON response: {e}")
            return empty_collection(
                self.id, status="unavailable",
                reason=f"OpenCelliD non-JSON response: {e}",
                bbox=bbox.as_list(), t=t,
            )

        if payload.get("error"):
            reason = f"OpenCelliD error: {payload.get('error')}"
            self.mark("unavailable", reason)
            return empty_collection(
                self.id,
                status="unavailable",
                reason=reason,
                bbox=bbox.as_list(),
                t=t,
            )

        cells = payload.get("cells") or []
        features = [f for cell in cells for f in _cell_features(cell)]

        truncated = payload.get("count", 0) >= MAX_CELLS
        tower_count = len(cells)
        status = "ok" if features else "partial"
        if truncated:
            reason = f"{tower_count} towers (capped at {MAX_CELLS}; zoom in for full detail)"
            status = "partial"
        elif features:
            reason = f"{tower_count} towers"
        else:
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
