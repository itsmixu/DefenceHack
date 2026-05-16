"""N2YO provider — satellites currently above the area of interest.

Uses the N2YO /above endpoint to return satellites overhead the bbox center
at the current moment (or near-time t). Two IPB-relevant categories are
queried in parallel:
  - 52: Earth observation (imaging satellites that can observe the AOI)
  - 20: Weather (weather satellites relevant to forecast coverage)

Results are Point features at each satellite's current sub-satellite point,
annotated with name, COSPAR designator, altitude, and category.

Note: N2YO gives real-time positions; t= is used for cache bucketing only —
the endpoint always returns current positions, not historical or future.
Free tier: 1000 transactions/hour (each /above call = 1 transaction).
"""
from __future__ import annotations

import asyncio
import math
import os
from datetime import datetime, timezone

import httpx

from .. import cache
from ..bbox import BBox
from ..http_client import get_client
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

API_BASE = "https://api.n2yo.com/rest/v1/satellite"
CACHE_TTL_SECONDS = 5 * 60  # 5 min — satellites move ~2 km/s, cache stays useful briefly

_EARTH_RADIUS_KM = 6371.0
_FOOTPRINT_VERTICES = 36  # polygon approximation of footprint circle


def _footprint_radius_km(altitude_km: float) -> float:
    """Horizon-to-horizon ground radius for a satellite at the given altitude.

    This is the maximum area from which the satellite is above the horizon
    (elevation ≥ 0°).  Imaging swath is narrower; this is the visibility
    window — relevant for signal intercept and electro-optical observation.

    Formula: half-angle θ = arccos(R / (R + h)), footprint = R × θ.
    """
    if altitude_km <= 0:
        return 0.0
    half_angle = math.acos(_EARTH_RADIUS_KM / (_EARTH_RADIUS_KM + altitude_km))
    return _EARTH_RADIUS_KM * half_angle


def _footprint_polygon(lon: float, lat: float, radius_km: float) -> dict:
    """Approximate geodesic footprint circle as a GeoJSON Polygon."""
    from pyproj import Geod
    geod = Geod(ellps="WGS84")
    radius_m = radius_km * 1000
    azimuths = [i * (360 / _FOOTPRINT_VERTICES) for i in range(_FOOTPRINT_VERTICES)]
    ring = []
    for az in azimuths:
        end_lon, end_lat, _ = geod.fwd(lon, lat, az, radius_m)
        ring.append([end_lon, end_lat])
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}

# Categories queried in parallel. Extend with additional IDs if needed.
CATEGORIES: dict[int, str] = {
    52: "earth_observation",
    20: "weather",
}


def _search_radius_deg(bbox: BBox) -> int:
    """Angular radius (degrees) that covers bbox from centre, with practical floor."""
    lat_half = (bbox.max_lat - bbox.min_lat) / 2
    lon_half = (bbox.max_lon - bbox.min_lon) / 2
    return max(8, min(30, math.ceil(math.sqrt(lat_half ** 2 + lon_half ** 2))))


def _center(bbox: BBox) -> tuple[float, float]:
    return (bbox.min_lat + bbox.max_lat) / 2, (bbox.min_lon + bbox.max_lon) / 2


async def _fetch_above(
    client: httpx.AsyncClient,
    api_key: str,
    lat: float,
    lon: float,
    radius: int,
    category_id: int,
    category_label: str,
) -> tuple[list[dict], str | None]:
    url = f"{API_BASE}/above/{lat}/{lon}/0/{radius}/{category_id}/&apiKey={api_key}"
    try:
        resp = await client.get(url, timeout=20.0,
                                headers={"User-Agent": "DefenceHack-IPB/0.1"})
        resp.raise_for_status()
        payload = resp.json()
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.text[:160]
        except Exception:
            pass
        return [], f"{category_label}: HTTP {e.response.status_code} {detail}".strip()
    except httpx.HTTPError as e:
        return [], f"{category_label}: upstream error: {e}"
    except ValueError:
        return [], f"{category_label}: invalid JSON from upstream"

    if isinstance(payload, dict) and payload.get("error"):
        return [], f"{category_label}: {payload.get('error')}"

    features: list[dict] = []
    for sat in payload.get("above") or []:
        sat_lat = sat.get("satlat")
        sat_lon = sat.get("satlng")
        if sat_lat is None or sat_lon is None:
            continue
        alt_km = sat.get("satalt")
        radius_km = _footprint_radius_km(float(alt_km)) if alt_km is not None else None

        base_props = {
            "source": "n2yo",
            "category": category_label,
            "satid": sat.get("satid"),
            "satname": sat.get("satname"),
            "cospar_id": sat.get("intDesignator"),
            "launch_date": sat.get("launchDate"),
            "altitude_km": alt_km,
            "footprint_radius_km": round(radius_km, 1) if radius_km is not None else None,
            "footprint_note": (
                "Horizon-to-horizon visibility circle. "
                "Actual imaging swath is narrower (sensor-dependent)."
            ),
        }
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(sat_lon), float(sat_lat)]},
            "properties": {**base_props, "feature_type": "position"},
        })
        if radius_km is not None:
            features.append({
                "type": "Feature",
                "geometry": _footprint_polygon(float(sat_lon), float(sat_lat), radius_km),
                "properties": {**base_props, "feature_type": "footprint"},
            })
    return features, None


class N2YOProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="n2yo", label="N2YO — satellite overpass tracking")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        api_key = os.getenv("N2YO_API_KEY") or None
        if not api_key:
            self.mark("unavailable", "N2YO_API_KEY not set")
            return empty_collection(
                self.id, status="unavailable", reason="N2YO_API_KEY not set",
                bbox=bbox.as_list(), t=t,
            )

        lat, lon = _center(bbox)
        radius = _search_radius_deg(bbox)

        # Cache key uses a 5-minute bucket so rapid re-requests share results
        # without hammering N2YO's transaction quota.
        now = datetime.now(timezone.utc)
        bucket = now.strftime("%Y%m%d%H") + str(now.minute // 5)
        cache_key = {"bbox": bbox.as_list(), "radius": radius, "bucket": bucket}

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

        client = get_client()
        tasks = [
            _fetch_above(client, api_key, lat, lon, radius, cat_id, cat_label)
            for cat_id, cat_label in CATEGORIES.items()
        ]
        results = await asyncio.gather(*tasks)

        errors = [err for _, err in results if err]

        # Deduplicate by satid — each satellite now emits a position Point AND a
        # footprint Polygon, so dedup on (satid, feature_type) not just satid.
        seen: set[tuple] = set()
        features: list[dict] = []
        for group, _ in results:
            for f in group:
                props = f["properties"]
                key = (props.get("satid"), props.get("feature_type"))
                if key not in seen:
                    seen.add(key)
                    features.append(f)

        # Count unique satellites (positions only) for the status string.
        sat_count = sum(
            1 for f in features if f["properties"].get("feature_type") == "position"
        )

        if errors and not features:
            reason = "; ".join(errors[:2])
            self.mark("unavailable", reason)
            return empty_collection(
                self.id,
                status="unavailable",
                reason=reason,
                bbox=bbox.as_list(),
                t=t,
            )

        cache.write(self.id, cache_key, {"features": features})
        status = "ok" if features and not errors else "partial"
        if features:
            reason = f"{sat_count} satellites within {radius}°"
            if errors:
                reason += f"; degraded ({'; '.join(errors[:1])})"
        else:
            reason = f"no satellites within {radius}°"
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
            ),
        )
