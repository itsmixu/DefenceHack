"""Starlink satellite coverage provider — real-time positions from Celestrak TLE data.

WHY NO API KEY:
SpaceX has no public tracking API. Celestrak (celestrak.org) distributes
TLE (Two-Line Element) orbital data for the full Starlink constellation under
the same open-data terms used by NORAD/Space-Track. No key required.

HOW IT WORKS:
1. TLE text (one record per satellite, 3 lines each) is fetched from Celestrak
   and cached for 6 hours — TLEs drift slowly and are republished daily.
2. skyfield propagates every satellite's position to the requested timestamp
   using the SGP4 orbital model (the standard for LEO).
3. We filter to satellites currently above the horizon (elevation ≥ 0°)
   as seen from the bbox centre, then rank by elevation angle.
4. Each visible satellite emits two GeoJSON features:
     position  — Point at current sub-satellite point
     footprint — Polygon of the visibility/signal horizon circle

MILITARY RELEVANCE:
Starlink operates at ~340–570 km altitude with inclinations of 53°, 70°, and
97.6°. The high-inclination shells give near-polar coverage. For any point in
Finland, 10–30 satellites are typically above the horizon simultaneously.
Coverage circles are ~2500–3000 km radius, so multiple sats can relay
comms even from deep terrain dead-zones.
The footprint polygon shows the ground area that can see the same satellite
— relevant for inter-unit coordination, terminal-guidance data links, and
adversary satellite communication windows.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

import httpx

from .. import cache
from ..bbox import BBox
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

CELESTRAK_TLE_URL = (
    "https://celestrak.org/NORAD/elements/gp.php"
    "?GROUP=starlink&FORMAT=tle"
)

TLE_CACHE_TTL   = 6 * 60 * 60   # 6 hours — TLEs are republished daily
POS_CACHE_TTL   = 2 * 60         # 2 minutes — positions move fast
MAX_VISIBLE     = 150            # cap response; rank by elevation angle
MIN_ELEVATION   = 0.0            # degrees above horizon to include

_EARTH_RADIUS_KM  = 6371.0
_FOOTPRINT_VERTS  = 36


# ── Geometry helpers ──────────────────────────────────────────────────────────

def _footprint_radius_km(altitude_km: float) -> float:
    """Horizon-to-horizon ground radius for satellite at altitude_km."""
    if altitude_km <= 0:
        return 0.0
    half_angle = math.acos(_EARTH_RADIUS_KM / (_EARTH_RADIUS_KM + altitude_km))
    return _EARTH_RADIUS_KM * half_angle


def _footprint_polygon(lon: float, lat: float, radius_km: float) -> dict[str, Any]:
    try:
        from pyproj import Geod
        geod = Geod(ellps="WGS84")
        radius_m = radius_km * 1000
        ring = []
        for i in range(_FOOTPRINT_VERTS):
            az = i * (360.0 / _FOOTPRINT_VERTS)
            end_lon, end_lat, _ = geod.fwd(lon, lat, az, radius_m)
            ring.append([end_lon, end_lat])
        ring.append(ring[0])
        return {"type": "Polygon", "coordinates": [ring]}
    except Exception:
        return {"type": "Polygon", "coordinates": [[[lon, lat]] * 4]}


# ── TLE fetching & parsing ────────────────────────────────────────────────────

async def _fetch_tle_text() -> str:
    """Fetch raw TLE text from Celestrak, with cache."""
    tle_cache_key = {"source": "celestrak-starlink"}
    cached = cache.read("starlink_tle", tle_cache_key, TLE_CACHE_TTL)
    if cached is not None and "tle_text" in cached:
        return cached["tle_text"]

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        headers={"User-Agent": "DefenceHack-IPB/0.1 (+research)"},
    ) as client:
        resp = await client.get(CELESTRAK_TLE_URL)
        resp.raise_for_status()
        tle_text = resp.text

    cache.write("starlink_tle", tle_cache_key, {"tle_text": tle_text})
    return tle_text


def _parse_tles(tle_text: str) -> list[tuple[str, str, str]]:
    """Parse TLE text into (name, line1, line2) tuples."""
    lines = [l.rstrip() for l in tle_text.strip().splitlines() if l.strip()]
    records: list[tuple[str, str, str]] = []
    i = 0
    while i + 2 < len(lines):
        name  = lines[i].strip()
        line1 = lines[i + 1].strip()
        line2 = lines[i + 2].strip()
        if line1.startswith("1 ") and line2.startswith("2 "):
            records.append((name, line1, line2))
            i += 3
        else:
            i += 1
    return records


# ── Position propagation ──────────────────────────────────────────────────────

def _propagate(
    tles: list[tuple[str, str, str]],
    t: datetime,
    center_lat: float,
    center_lon: float,
) -> list[dict[str, Any]]:
    """Propagate all TLEs to time t; return visible satellite dicts, ranked by elevation."""
    try:
        from skyfield.api import EarthSatellite, load, wgs84
    except ImportError:
        return []

    ts = load.timescale()
    t_sf = ts.from_datetime(t.astimezone(timezone.utc))
    observer = wgs84.latlon(center_lat, center_lon)

    results: list[dict[str, Any]] = []

    for name, line1, line2 in tles:
        try:
            sat = EarthSatellite(line1, line2, name, ts)
            geocentric = sat.at(t_sf)

            # Sub-satellite point
            subpoint = wgs84.subpoint_of(geocentric)
            sat_lat = subpoint.latitude.degrees
            sat_lon = subpoint.longitude.degrees
            alt_km  = subpoint.elevation.km

            # Elevation angle from bbox centre
            diff = sat - observer
            topo = diff.at(t_sf)
            el_alt, _, _ = topo.altaz()
            elevation_deg = el_alt.degrees

            if elevation_deg < MIN_ELEVATION:
                continue

            # Orbital velocity magnitude (km/h)
            vel = geocentric.velocity.km_per_s
            speed_kmh = math.sqrt(sum(v * v for v in vel)) * 3600.0

            # Orbital inclination from TLE line 2 (field 3, columns 8-16)
            try:
                inclination_deg = float(line2[8:16])
            except (ValueError, IndexError):
                inclination_deg = None

            # NORAD catalog number from TLE line 1
            try:
                norad_id = int(line1[2:7])
            except (ValueError, IndexError):
                norad_id = None

            # Epoch from TLE for "last updated" display
            try:
                epoch_yr = int(line1[18:20])
                epoch_day = float(line1[20:32])
                full_year = 2000 + epoch_yr if epoch_yr < 57 else 1900 + epoch_yr
                epoch_str = f"{full_year}-DOY{int(epoch_day)}"
            except (ValueError, IndexError):
                epoch_str = None

            fp_radius = _footprint_radius_km(alt_km)

            results.append({
                "name":            name,
                "norad_id":        norad_id,
                "sat_lat":         sat_lat,
                "sat_lon":         sat_lon,
                "altitude_km":     round(alt_km, 1),
                "elevation_deg":   round(elevation_deg, 1),
                "speed_kmh":       round(speed_kmh, 0),
                "inclination_deg": inclination_deg,
                "footprint_km":    round(fp_radius, 1),
                "epoch":           epoch_str,
            })
        except Exception:
            continue

    # Rank by elevation (highest = most directly overhead)
    results.sort(key=lambda d: d["elevation_deg"], reverse=True)
    return results[:MAX_VISIBLE]


# ── GeoJSON feature builder ───────────────────────────────────────────────────

def _build_features(sats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    for s in sats:
        lon, lat = s["sat_lon"], s["sat_lat"]
        base_props: dict[str, Any] = {
            "source":          "starlink",
            "satname":         s["name"],
            "norad_id":        s["norad_id"],
            "altitude_km":     s["altitude_km"],
            "elevation_deg":   s["elevation_deg"],
            "speed_kmh":       s["speed_kmh"],
            "inclination_deg": s["inclination_deg"],
            "footprint_radius_km": s["footprint_km"],
            "epoch":           s["epoch"],
        }
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {**base_props, "feature_type": "position"},
        })
        features.append({
            "type": "Feature",
            "geometry": _footprint_polygon(lon, lat, s["footprint_km"]),
            "properties": {**base_props, "feature_type": "footprint"},
        })
    return features


# ── Provider ──────────────────────────────────────────────────────────────────

class StarlinkProvider(Provider):
    def __init__(self) -> None:
        super().__init__(
            id="starlink",
            label="Starlink — real-time LEO constellation (Celestrak TLE)",
        )

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        now = (t or datetime.now(timezone.utc)).astimezone(timezone.utc)
        center_lat = (bbox.min_lat + bbox.max_lat) / 2.0
        center_lon = (bbox.min_lon + bbox.max_lon) / 2.0

        # Position cache — 2-minute bucket (sats move ~14 km/s, 2 min ≈ ~1700 km)
        bucket = now.strftime("%Y%m%d%H") + str(now.minute // 2)
        pos_cache_key = {
            "bbox_round": [round(v, 1) for v in bbox.as_list()],
            "bucket": bucket,
        }
        cached = cache.read(self.id, pos_cache_key, POS_CACHE_TTL)
        if cached is not None:
            self.mark("ok", "served from cache")
            return FeatureCollection(
                features=cached.get("features", []),
                meta=LayerMeta(
                    source=self.id, status="ok",
                    reason="served from cache",
                    bbox=bbox.as_list(), t=t,
                    attribution="Celestrak TLE / SGP4 — SpaceX Starlink",
                ),
            )

        # Fetch TLE data
        try:
            tle_text = await _fetch_tle_text()
        except httpx.HTTPError as exc:
            self.mark("unavailable", f"Celestrak TLE fetch failed: {exc}")
            return empty_collection(
                self.id, status="unavailable",
                reason=f"Celestrak TLE fetch failed: {exc}",
                bbox=bbox.as_list(), t=t,
            )

        tles = _parse_tles(tle_text)
        if not tles:
            self.mark("unavailable", "Celestrak returned no TLE records")
            return empty_collection(
                self.id, status="unavailable",
                reason="Celestrak returned no TLE records",
                bbox=bbox.as_list(), t=t,
            )

        # Check skyfield is available before heavy computation
        try:
            import skyfield  # noqa: F401
        except ImportError:
            self.mark("unavailable", "skyfield not installed (pip install skyfield)")
            return empty_collection(
                self.id, status="unavailable",
                reason="skyfield not installed — run: pip install skyfield",
                bbox=bbox.as_list(), t=t,
            )

        visible = _propagate(tles, now, center_lat, center_lon)
        features = _build_features(visible)

        cache.write(self.id, pos_cache_key, {"features": features})

        sat_count = len(visible)
        status = "ok" if sat_count > 0 else "partial"
        reason = (
            f"{sat_count} Starlink satellites above horizon ({len(tles)} in constellation)"
            if sat_count else "no Starlink satellites above horizon right now"
        )
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
                attribution="Celestrak TLE data / SGP4 orbital model — SpaceX Starlink",
            ),
        )
