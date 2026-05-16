"""Analysis endpoints — synthesised intelligence products on top of raw layers.

WHY THIS EXISTS:
The raw /api/layers/<source> endpoints return individual data feeds.
These analysis endpoints fuse multiple sources into doctrinal IPB products:

  GET /api/analyze/mcoo?bbox=…
      Modified Combined Obstacle Overlay — go/slow-go/no-go classification.
      Every feature carries mcoo_cite (ATP 2-41.1 Appendix B table) and
      mcoo_reason (one-line doctrinal justification). Primary tactical overlay.

  GET /api/analyze/terrain-effects?bbox=…
      Terrain Effects Matrix — 5 warfighting functions rated against
      ATP 2-41.1 Appendix B thresholds. Frontend renders as briefing card.
      Includes mobility metrics, terrain composition, and weather summary.

  GET /api/analyze/mobility?bbox=…&vehicle_class=tank|wheeled|tracked|logistics|foot
      Force mobility surface — per-feature planning speed (km/h) for the
      requested vehicle class. Bridges checked against load_capacity_tonnes.
      Flood zones (SYKE) override terrain to no-go. Speed coloured heatmap.

  GET /api/analyze/drone-conditions?bbox=…
      UAS/drone flight conditions — per-station drone_rating (go/marginal/
      no-go) from FMI observations + HARMONIE 48-h forecast timeline.
      Thresholds per doctrine.DRONE_LIMITS.

  GET /api/analyze/viewshed?bbox=…&observer_lon=&observer_lat=
      Line-of-sight fallback — Table B-1 geometric horizon circle until the
      MML DEM raster pipeline (rasterio + GeoTIFF) is implemented.

  GET /api/analyze/astronomical?bbox=…
      Sun/moon/twilight — 3-day illumination forecast (civil + nautical
      dawn/dusk, moon phase, night_ops_rating). Computed locally via astral
      — no external API, zero latency.
"""
from __future__ import annotations

from datetime import datetime
from math import cos, radians, sin
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from .. import doctrine
from ..analysis.drone_conditions import build_drone_conditions
from ..analysis.mcoo import build_mcoo
from ..analysis.mobility import build_mobility
from ..analysis.terrain_effects import build_terrain_effects
from ..analysis.weather import build_weather
from ..bbox import BBox, parse_bbox
from ..registry import PROVIDERS

router = APIRouter(prefix="/api/analyze", tags=["analysis"])

GEOJSON_MEDIA = "application/geo+json"
VEHICLE_CLASSES = list(doctrine.VEHICLE_CLASSES.keys())


@router.get("/mcoo")
async def mcoo(
    bbox: BBox = Depends(parse_bbox),
    t: datetime | None = Query(None),
) -> Response:
    fc = await build_mcoo(bbox, t)
    return Response(content=fc.model_dump_json(), media_type=GEOJSON_MEDIA)


@router.get("/terrain-effects")
async def terrain_effects(
    bbox: BBox = Depends(parse_bbox),
    t: datetime | None = Query(None),
) -> dict[str, Any]:
    return await build_terrain_effects(bbox, t)


@router.get("/mobility")
async def mobility(
    bbox: BBox = Depends(parse_bbox),
    vehicle_class: str = Query(
        "wheeled",
        description=f"Vehicle class: {', '.join(VEHICLE_CLASSES)}",
    ),
    t: datetime | None = Query(None),
) -> Response:
    """Force mobility surface — planning speed (km/h) per terrain feature.

    Returns a GeoJSON FeatureCollection where every terrain polygon and road
    carries speed_kmh and passable for the requested vehicle class.
    Speeds are from ATP 2-41.1 Appendix B Tables B-7/B-8.
    Bridges with load_capacity_tonnes < vehicle weight are marked no-go.
    """
    fc = await build_mobility(bbox, t, vehicle_class)
    return Response(content=fc.model_dump_json(), media_type=GEOJSON_MEDIA)


@router.get("/weather")
async def weather(
    bbox: BBox = Depends(parse_bbox),
    t: datetime | None = Query(
        None,
        description="ISO-8601 UTC timestamp. The forecast & wind field are "
                    "centred on this time; ratings reflect this moment.",
    ),
) -> dict[str, Any]:
    """Unified weather analysis — observations, forecast, wind field, and
    operational ratings.

    One call returns everything the weather UI needs at time `t`:

      observations   — current FMI station readings + area summary
      forecast       — 48 h hourly timeline at the AO centre
      wind_field_at_t — 3×3 grid of wind vectors at the queried time (for arrows)
      wind_field_timeline — first 12 h of wind field (for arrow animation)
      ratings        — drone, aviation, ground_mobility, ISR, cold-weather
      thresholds     — doctrinal limits used for ratings

    Wires to the timeline scrubber via `t`. Replaces the older
    `/api/analyze/drone-conditions` for everything except drone-only views.
    """
    return await build_weather(bbox, t)


@router.get("/drone-conditions")
async def drone_conditions(
    bbox: BBox = Depends(parse_bbox),
    t: datetime | None = Query(None),
) -> dict[str, Any]:
    """UAS/drone flight conditions — per-station rating + 48-hour forecast.

    Returns:
      summary.current_rating  — bbox worst-case "go"|"marginal"|"no-go"
      station_features        — GeoJSON points, one per FMI station
      forecast_timeline       — 48-h drone rating from FMI HARMONIE NWP
      thresholds              — the doctrine.DRONE_LIMITS values used
    """
    return await build_drone_conditions(bbox, t)


@router.get("/astronomical")
async def astronomical(
    bbox: BBox = Depends(parse_bbox),
    t: datetime | None = Query(None),
) -> Response:
    """Sun/moon/twilight forecast — 3 days from t (or now).

    Returns a GeoJSON FeatureCollection with one Point per day at the
    bbox centroid. Each feature carries:
      sunrise, sunset, civil_dawn, civil_dusk, nautical_dawn, nautical_dusk, noon
      moon_illumination_pct, moon_phase_days
      night_ops_rating: "dark" | "partial" | "bright"
      darkness_hours

    All computed locally via the astral library — no external API.
    """
    fc = await PROVIDERS["astronomy"].fetch(bbox, t)
    return Response(content=fc.model_dump_json(), media_type=GEOJSON_MEDIA)


@router.get("/viewshed")
async def viewshed(
    bbox: BBox = Depends(parse_bbox),
    observer_lon: float | None = Query(None),
    observer_lat: float | None = Query(None),
    observer_height_m: float = Query(2.0, description="Observer height above ground (m)"),
) -> dict[str, Any]:
    """Table B-1 geometric horizon fallback — true viewshed needs MML DEM."""
    horizon_km = doctrine.horizon_range_km(observer_height_m)
    features: list[dict[str, Any]] = []
    if observer_lon is not None and observer_lat is not None:
        lat_deg_km = 1 / 111.0
        lon_deg_km = 1 / (111.0 * max(cos(radians(observer_lat)), 0.01))
        ring = []
        for i in range(33):
            theta = radians(i * (360 / 32))
            ring.append([
                observer_lon + horizon_km * sin(theta) * lon_deg_km,
                observer_lat + horizon_km * cos(theta) * lat_deg_km,
            ])
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {
                "kind": "horizon_circle",
                "horizon_km": round(horizon_km, 2),
                "cite": "B-1",
                "reason": (
                    f"Geometric horizon at {observer_height_m:.1f} m = "
                    f"{horizon_km:.2f} km (d = 3.57·√h per Table B-1)"
                ),
                "doctrine": "ATP 2-41.1 Appendix B",
            },
        })
    return {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "source": "viewshed",
            "status": "partial" if features else "unavailable",
            "reason": (
                "Table B-1 horizon fallback — true viewshed pending MML DEM raster pipeline"
                if features else "supply observer_lon and observer_lat for horizon fallback"
            ),
            "bbox": bbox.as_list(),
            "observer": (
                {"lon": observer_lon, "lat": observer_lat,
                 "height_m": observer_height_m, "horizon_km": round(horizon_km, 2)}
                if observer_lon is not None and observer_lat is not None else None
            ),
        },
    }
