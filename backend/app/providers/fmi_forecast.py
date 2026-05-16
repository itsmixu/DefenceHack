"""FMI HARMONIE forecast provider — spatial grid sampling for wind field.

WHY v2 IS DIFFERENT:
The old version queried a single point (the bbox centroid) and returned
48 timesteps for that one location. Useful for "is it raining at the AO
centre", useless for visualising wind FLOW across the area.

This version samples a **3×3 grid (9 points)** across the bbox in parallel,
so every forecast timestep has wind vectors at 9 separate locations. The
frontend can render this as proper wind arrows / barbs / particle flow —
the kind of detail commanders need for parachute drops, artillery
trajectories, smoke screens, NBC drift, etc.

DATA STRUCTURE PER FEATURE:
  geometry:    Point(lon, lat)
  properties:
    source:    "fmi_forecast"
    time:      ISO timestamp
    grid_i, grid_j: 0..2 — position in the 3x3 sampling grid
    forecast:  {Temperature, WindSpeedMS, WindDirection, WindGust,
                TotalCloudCover, LowCloudCover, PrecipitationAmount,
                Humidity, Visibility, CloudBase}
    drone_rating, drone_summary: pre-computed by doctrine
    Flattened convenience fields: wind_speed_ms, wind_direction_deg, etc.

This means a 48-hour forecast at 9 points = 432 features per response.
That's ~80 KB JSON — well within budget. Single-point clients can filter
to grid_i=1, grid_j=1 (centre) for the old behaviour.

CACHING:
HARMONIE updates hourly. We cache the whole 3x3 result for 1 hour keyed
by the rounded grid centroids — neighbouring viewports share a cache hit.

RAIN RADAR WMS:
For rasters (radar imagery, cloud cover heatmap), see fmi_radar.py.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from xml.etree import ElementTree as ET

import httpx

from .. import cache, doctrine
from ..bbox import BBox
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

WFS_URL      = "https://opendata.fmi.fi/wfs"
STORED_QUERY = "fmi::forecast::harmonie::surface::point::simple"

FORECAST_PARAMETERS: tuple[str, ...] = (
    "Temperature",
    "WindSpeedMS",
    "WindDirection",
    "WindGust",
    "TotalCloudCover",
    "LowCloudCover",
    "PrecipitationAmount",
    "Humidity",
    "Visibility",
    "CloudBase",
)

CACHE_TTL_SECONDS = 60 * 60     # HARMONIE updates hourly
FORECAST_HOURS    = 48
GRID_SIZE         = 3            # 3×3 = 9 sample points

NS = {
    "wfs":   "http://www.opengis.net/wfs/2.0",
    "BsWfs": "http://xml.fmi.fi/schema/wfs/2.0",
    "gml":   "http://www.opengis.net/gml/3.2",
}


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _grid_points(bbox: BBox, n: int) -> list[tuple[int, int, float, float]]:
    """Return n × n evenly-spaced (i, j, lat, lon) sampling points across bbox."""
    pts: list[tuple[int, int, float, float]] = []
    if n <= 1:
        return [(0, 0,
                 (bbox.min_lat + bbox.max_lat) / 2.0,
                 (bbox.min_lon + bbox.max_lon) / 2.0)]
    for i in range(n):
        for j in range(n):
            # Step from edge to edge so corner points hit the actual bbox corners.
            lat = bbox.min_lat + (bbox.max_lat - bbox.min_lat) * (i / (n - 1))
            lon = bbox.min_lon + (bbox.max_lon - bbox.min_lon) * (j / (n - 1))
            pts.append((i, j, lat, lon))
    return pts


def _parse_point_forecast(xml_text: str) -> list[dict[str, float]]:
    """Parse HARMONIE point WFS response — returns list of {time, params...}."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"invalid FMI XML: {exc}") from exc

    # (time-iso) → param → value
    grouped: dict[str, dict[str, float]] = defaultdict(dict)

    for elem in root.iter(f"{{{NS['BsWfs']}}}BsWfsElement"):
        time_node = elem.find("BsWfs:Time", NS)
        name_node = elem.find("BsWfs:ParameterName", NS)
        val_node  = elem.find("BsWfs:ParameterValue", NS)
        if time_node is None or name_node is None or val_node is None:
            continue
        try:
            val = float(val_node.text or "nan")
        except ValueError:
            continue
        if val != val:   # NaN
            continue
        grouped[(time_node.text or "").strip()][(name_node.text or "").strip()] = val

    out: list[dict[str, Any]] = []
    for time_iso in sorted(grouped.keys()):
        params = grouped[time_iso]
        params["__time__"] = time_iso   # sentinel; pulled out by caller
        out.append(params)
    return out


async def _fetch_point(
    client: httpx.AsyncClient,
    lat: float,
    lon: float,
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    """Fetch HARMONIE forecast at a single point. Returns list of timestep dicts."""
    params = {
        "service":       "WFS",
        "version":       "2.0.0",
        "request":       "getFeature",
        "storedquery_id": STORED_QUERY,
        "latlon":        f"{lat},{lon}",
        "starttime":     _iso(start),
        "endtime":       _iso(end),
        "parameters":    ",".join(FORECAST_PARAMETERS),
    }
    resp = await client.get(WFS_URL, params=params)
    resp.raise_for_status()
    return _parse_point_forecast(resp.text)


def _feature_from_point_step(
    lat: float, lon: float, grid_i: int, grid_j: int, step: dict[str, Any],
) -> dict[str, Any]:
    """Build one GeoJSON Feature from a single grid point at a single timestep."""
    time_iso = step.pop("__time__", None)

    # Normalise cloud-base aliases (HARMONIE returns either CloudBase or CloudBase1).
    if "CloudBase" in step and "CloudBase1" not in step:
        step["CloudBase1"] = step["CloudBase"]

    wind = step.get("WindSpeedMS")
    gust = step.get("WindGust")
    temp = step.get("Temperature")
    vis  = step.get("Visibility")
    ceil = step.get("CloudBase") or step.get("CloudBase1")
    prec = step.get("PrecipitationAmount")
    drone_rating, drone_summary, _ = doctrine.rate_drone(wind, gust, temp, vis, ceil, prec)
    aviation_rating, _ = doctrine.rate_aviation(wind)

    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "source":   "fmi_forecast",
            "time":     time_iso,
            "grid_i":   grid_i,
            "grid_j":   grid_j,
            "forecast": step,
            # Flattened convenience fields
            "temperature_c":      temp,
            "wind_speed_ms":      wind,
            "wind_direction_deg": step.get("WindDirection"),
            "wind_gust_ms":       gust,
            "precipitation_mmh":  prec,
            "cloud_cover_pct":    step.get("TotalCloudCover"),
            "low_cloud_pct":      step.get("LowCloudCover"),
            "visibility_m":       vis,
            "ceiling_m":          ceil,
            "humidity_pct":       step.get("Humidity"),
            # Ratings
            "drone_rating":       drone_rating,
            "drone_summary":      drone_summary,
            "aviation_rating":    aviation_rating,
        },
    }


class FMIForecastProvider(Provider):
    def __init__(self) -> None:
        super().__init__(
            id="fmi_forecast",
            label="FMI HARMONIE forecast — wind field, clouds, rain, ceiling",
        )

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        start = (t or datetime.now(timezone.utc)).astimezone(timezone.utc)
        end   = start + timedelta(hours=FORECAST_HOURS)

        # Coarse cache key — neighbouring viewports share results.
        cache_key = {
            "bbox_round": [round(v, 2) for v in bbox.as_list()],
            "start_h":    start.strftime("%Y-%m-%dT%H:00Z"),
            "grid":       GRID_SIZE,
        }
        cached = cache.read(self.id, cache_key, CACHE_TTL_SECONDS)
        if cached is not None:
            self.mark("ok", "served from cache")
            return FeatureCollection(
                features=cached.get("features", []),
                meta=LayerMeta(
                    source=self.id, status="ok",
                    reason="served from cache (grid)",
                    bbox=bbox.as_list(), t=t,
                    attribution="FMI HARMONIE NWP 2.5 km / 48 h",
                ),
            )

        pts = _grid_points(bbox, GRID_SIZE)

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(45.0, connect=10.0),
                headers={"User-Agent": "DefenceHack-IPB/0.1 (+research)"},
            ) as client:
                tasks = [_fetch_point(client, lat, lon, start, end) for _, _, lat, lon in pts]
                grid_results = await asyncio.gather(*tasks, return_exceptions=True)
        except httpx.HTTPError as exc:
            self.mark("unavailable", f"FMI forecast WFS error: {exc}")
            return empty_collection(
                self.id, status="unavailable",
                reason=f"FMI HARMONIE WFS unavailable: {exc}",
                bbox=bbox.as_list(), t=t,
            )

        features: list[dict[str, Any]] = []
        partial_failures = 0
        for (i, j, lat, lon), result in zip(pts, grid_results):
            if isinstance(result, Exception):
                partial_failures += 1
                continue
            for step in result:
                features.append(_feature_from_point_step(lat, lon, i, j, step))

        if partial_failures == len(pts):
            self.mark("unavailable", "all grid points failed")
            return empty_collection(
                self.id, status="unavailable",
                reason="HARMONIE returned no usable data at any grid point",
                bbox=bbox.as_list(), t=t,
            )

        cache.write(self.id, cache_key, {"features": features})

        status = "ok" if partial_failures == 0 else "partial"
        reason = (
            f"{len(features)} features across {GRID_SIZE}×{GRID_SIZE} grid, "
            f"{FORECAST_HOURS}h horizon"
            + (f" ({partial_failures} grid points failed)" if partial_failures else "")
        )
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
                attribution="FMI HARMONIE NWP 2.5 km / 48 h",
            ),
        )
