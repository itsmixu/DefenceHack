"""Drone / UAS flight conditions analysis.

WHY THIS EXISTS:
UAS (Unmanned Aerial Systems) are a force multiplier for ISR
(intelligence, surveillance, reconnaissance) but are highly weather-
sensitive. A drone that is "go" at 06:00 may be "no-go" by 09:00 as
winds rise. Planners need a per-station, time-stamped assessment they
can overlay on the tactical map.

This analysis synthesises:
  1. FMI weather *observations*  — current conditions at each station
  2. FMI HARMONIE *forecast*     — 48-hour lookahead if available

Each weather station becomes a GeoJSON Point feature with:
  drone_rating     — "go" | "marginal" | "no-go"
  limiting_factors — list of the conditions that drove the rating
  measurements     — raw weather values
  cite             — threshold source

Thresholds come from `app.doctrine.DRONE_LIMITS` and are representative
of tactical quadrotor / small fixed-wing UAS (DJI Matrice 300 class).

The endpoint also returns a bbox-wide worst-case summary so the frontend
can render a single "drone traffic light" in the header without iterating
all station features.

FORECAST TIMELINE:
When FMI forecast data is available, the response includes a
`forecast_timeline` array — one rating per hour for the next 48 hours
at the bbox centroid — so planners can pick the best launch window.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from .. import doctrine
from ..bbox import BBox
from ..registry import PROVIDERS
from ..schemas import FeatureCollection, LayerMeta


async def build_drone_conditions(bbox: BBox, t: datetime | None) -> dict[str, Any]:
    sources = ["fmi", "fmi_forecast"]
    results = await asyncio.gather(
        *[PROVIDERS[s].fetch(bbox, t) for s in sources if s in PROVIDERS],
        return_exceptions=True,
    )
    by_source: dict[str, list[dict[str, Any]]] = {}
    source_status: dict[str, str] = {}
    for src, res in zip(sources, results):
        if isinstance(res, Exception):
            source_status[src] = "error"
            by_source[src] = []
        else:
            source_status[src] = res.meta.status
            by_source[src] = res.features

    # ── Current conditions from FMI observations ─────────────────────────────
    obs_features: list[dict[str, Any]] = []
    all_ratings: list[str] = []

    for f in by_source.get("fmi", []):
        props = f.get("properties") or {}
        m = props.get("measurements") or {}

        wind  = _float(m.get("windspeedms"))
        gust  = None   # observations don't include gust
        temp  = _float(m.get("temperature"))
        vis   = _float(m.get("visibility"))
        prec  = _float(m.get("precipitation1h"))
        ceil  = None   # cloud ceiling not in basic observation set

        rating, summary, factors = doctrine.rate_drone(wind, gust, temp, vis, ceil, prec)
        all_ratings.append(rating)

        obs_features.append({
            "type": "Feature",
            "geometry": f.get("geometry"),
            "properties": {
                "source": "drone_conditions",
                "time": props.get("time"),
                "drone_rating": rating,
                "drone_summary": summary,
                "limiting_factors": factors,
                "measurements": {
                    "wind_ms": wind,
                    "temp_c": temp,
                    "visibility_m": vis,
                    "precip_mmh": prec,
                },
                "thresholds_cite": "doctrine.DRONE_LIMITS (tactical UAS class)",
            },
        })

    # ── 48-hour forecast timeline from HARMONIE ───────────────────────────────
    forecast_timeline: list[dict[str, Any]] = []
    for f in by_source.get("fmi_forecast", []):
        props = f.get("properties") or {}
        fc = props.get("forecast") or {}
        # Forecast already has a pre-computed drone_rating from the provider.
        forecast_timeline.append({
            "time": props.get("time"),
            "drone_rating": props.get("drone_rating", "unknown"),
            "drone_summary": props.get("drone_summary", ""),
            "wind_ms": _float(fc.get("WindSpeedMS")),
            "gust_ms": _float(fc.get("WindGust")),
            "temp_c": _float(fc.get("Temperature")),
            "visibility_m": _float(fc.get("Visibility")),
            "ceiling_m": _float(fc.get("CloudBase1")),
            "cloud_cover_pct": _float(fc.get("TotalCloudCover")),
            "precip_mmh": _float(fc.get("PrecipitationAmount")),
        })

    # ── Bbox-wide worst-case summary ─────────────────────────────────────────
    ORDER = {"no-go": 0, "marginal": 1, "go": 2, "unknown": 3}
    worst_now = min(all_ratings, key=lambda r: ORDER.get(r, 3)) if all_ratings else "unknown"

    # Find next "go" window in forecast.
    next_go_window: str | None = None
    for step in forecast_timeline:
        if step["drone_rating"] == "go":
            next_go_window = step["time"]
            break

    return {
        "bbox": bbox.as_list(),
        "t": t.isoformat() if t else None,
        "summary": {
            "current_rating": worst_now,
            "station_count": len(obs_features),
            "next_go_window": next_go_window,
            "forecast_hours_available": len(forecast_timeline),
        },
        "station_features": obs_features,
        "forecast_timeline": forecast_timeline,
        "thresholds": doctrine.DRONE_LIMITS,
        "source_status": source_status,
    }


def _float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None
