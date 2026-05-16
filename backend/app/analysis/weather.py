"""Unified weather analysis — the single endpoint behind the tactical weather UI.

WHY THIS EXISTS:
The frontend's weather panel needs to render half a dozen distinct things —
current conditions tile, hourly forecast strip, wind arrows on the map,
drone/aviation/mobility ratings, cloud and precipitation summaries — and
the user wants them all synchronised with the timeline scrubber.

Doing this from the frontend would mean N parallel requests (fmi obs +
fmi_forecast + analyze/drone-conditions + …) every time the scrubber moves.
Instead this analysis fuses everything server-side into one response that:

  • Aggregates current observations into an area-wide summary
  • Picks out the hourly forecast at the bbox centre (a clean line chart)
  • Exposes the full 3×3 wind field at the queried time `t`
  • Computes operational ratings for several mission types
  • Identifies the next significant weather change

RESPONSE SHAPE:
  bbox, t                        — context
  observations:
    stations: GeoJSON FC         — per-station Point features (raw + enriched)
    summary: {temperature_c, wind_speed_ms, wind_gust_ms, wind_direction_deg,
              cloud_cover_pct, precipitation_mmh, visibility_m, station_count}
  forecast:
    timeline: [{time, temp, wind, gust, dir, precip, cloud, vis, ceiling,
                drone_rating, aviation_rating}, ...]       — 48 hourly steps
    wind_field_at_t: GeoJSON FC  — 9 wind vectors at requested t (Point + props)
    wind_field_timeline: {iso: [9 vectors]}                — first 12 hours
  ratings:
    drone, aviation, ground_mobility, isr, cold_weather    — for time t
    trend: "improving|stable|degrading"
    next_change_at: ISO or null
  source_status: {fmi, fmi_forecast: status}

WIND FIELD VS POINT FORECAST:
The `forecast.timeline` is at the bbox centre — cheap and clean for a line
chart. The `wind_field_at_t` is the 3×3 grid of vectors at the queried
time — that's what gets rendered as arrows on the map. Together they give
both a temporal view (when does it get worse?) and a spatial view
(which sector is windier?).
"""
from __future__ import annotations

import asyncio
import math
import statistics
from datetime import datetime, timezone
from typing import Any

from .. import doctrine
from ..bbox import BBox
from ..registry import PROVIDERS


# ── Operational rating helpers ────────────────────────────────────────────────

def _rate_ground_mobility(
    precip_mmh: float | None,
    temp_c: float | None,
    snow_cm: float | None,
) -> tuple[str, str]:
    """Effect of weather on wheeled/tracked cross-country movement."""
    if precip_mmh is not None and precip_mmh >= 7.6:
        return "degraded", "heavy rain — soft ground, reduced speed"
    if temp_c is not None and 0 <= temp_c <= 5 and (precip_mmh or 0) > 0:
        return "degraded", "freezing rain risk — black ice"
    if snow_cm is not None and snow_cm >= 30:
        return "restricted", f"snow depth {snow_cm:.0f} cm — chains/tracks required"
    if precip_mmh is not None and precip_mmh >= 2.5:
        return "marginal", "moderate rain — some bog risk"
    return "normal", "no significant weather impact"


def _rate_isr(visibility_m: float | None, cloud_cover_pct: float | None) -> tuple[str, str]:
    """Effect of weather on EO/IR reconnaissance reach."""
    if visibility_m is not None and visibility_m < 1000:
        return "no-go", f"visibility {visibility_m:.0f} m < 1 km (fog/heavy precip)"
    if visibility_m is not None and visibility_m < 5000:
        return "marginal", f"visibility {visibility_m:.0f} m — EO range reduced"
    if cloud_cover_pct is not None and cloud_cover_pct >= 80:
        return "marginal", f"cloud cover {cloud_cover_pct:.0f}% — overhead ISR limited"
    return "go", "clear conditions for EO/IR reconnaissance"


def _rate_cold_weather(temp_c: float | None, wind_ms: float | None) -> tuple[str, str]:
    """Cold-weather operations risk (frostbite, equipment, hypothermia)."""
    if temp_c is None:
        return "unknown", "no temperature data"
    wci = doctrine.WIND_CHILL_LOOKUP if hasattr(doctrine, "WIND_CHILL_LOOKUP") else None  # noqa: F841
    if temp_c <= -30:
        return "extreme", f"temperature {temp_c:.0f}°C — frostbite minutes, lubricants gel"
    if temp_c <= -20:
        return "severe", f"temperature {temp_c:.0f}°C — battery life cut, frostbite risk"
    if temp_c <= -10 and wind_ms is not None and wind_ms >= 5:
        return "moderate", f"sustained cold {temp_c:.0f}°C + wind — wind chill significant"
    if temp_c <= 0:
        return "low", "below freezing — normal cold-weather kit"
    return "none", "above freezing"


# ── Aggregation helpers ───────────────────────────────────────────────────────

def _mean_safe(vals: list[float]) -> float | None:
    """Mean of values, ignoring None. Returns None if list is empty."""
    real = [v for v in vals if v is not None and not math.isnan(v)]
    return round(statistics.mean(real), 2) if real else None


def _max_safe(vals: list[float]) -> float | None:
    real = [v for v in vals if v is not None and not math.isnan(v)]
    return round(max(real), 2) if real else None


def _circular_mean_deg(degs: list[float]) -> float | None:
    """Circular mean of wind directions in degrees."""
    real = [d for d in degs if d is not None and not math.isnan(d)]
    if not real:
        return None
    rad = [math.radians(d) for d in real]
    sx = sum(math.sin(r) for r in rad) / len(rad)
    cx = sum(math.cos(r) for r in rad) / len(rad)
    mean_rad = math.atan2(sx, cx)
    return round((math.degrees(mean_rad) + 360) % 360, 1)


def _summarise_observations(features: list[dict[str, Any]]) -> dict[str, Any]:
    """Build an area-wide summary from per-station observation features."""
    if not features:
        return {"station_count": 0}

    def pull(key: str) -> list[float]:
        return [(f.get("properties") or {}).get(key) for f in features]

    return {
        "station_count":       len(features),
        "temperature_c":       _mean_safe(pull("temperature_c")),
        "wind_speed_ms":       _mean_safe(pull("wind_speed_ms")),
        "wind_gust_ms":        _max_safe(pull("wind_gust_ms")),
        "wind_direction_deg":  _circular_mean_deg(pull("wind_direction_deg")),
        "humidity_pct":        _mean_safe(pull("humidity_pct")),
        "pressure_hpa":        _mean_safe(pull("pressure_hpa")),
        "precipitation_mmh":   _mean_safe(pull("precipitation_mmh")),
        "visibility_m":        _mean_safe(pull("visibility_m")),
        "cloud_cover_pct":     _mean_safe(pull("cloud_cover_pct")),
        "snow_depth_cm":       _mean_safe(pull("snow_depth_cm")),
        "wind_chill_c":        _mean_safe(pull("wind_chill_c")),
    }


# ── Wind field extraction ────────────────────────────────────────────────────

def _wind_field_at(
    forecast_features: list[dict[str, Any]],
    t: datetime,
    tolerance_s: int = 1800,
) -> list[dict[str, Any]]:
    """Pull the 3×3 wind grid at the timestep closest to `t`.

    Returns a list of GeoJSON Features each carrying wind speed/direction
    plus grid (i, j) so the renderer can position arrows.
    """
    if not forecast_features:
        return []

    t_utc = t.astimezone(timezone.utc)

    # Map (i, j) → best feature for time t
    best: dict[tuple[int, int], tuple[float, dict[str, Any]]] = {}
    for feat in forecast_features:
        props = feat.get("properties") or {}
        time_iso = props.get("time")
        if not time_iso:
            continue
        try:
            f_t = datetime.fromisoformat(time_iso.replace("Z", "+00:00"))
        except ValueError:
            continue
        delta = abs((f_t - t_utc).total_seconds())
        if delta > tolerance_s:
            continue
        key = (props.get("grid_i", 0), props.get("grid_j", 0))
        prev = best.get(key)
        if prev is None or delta < prev[0]:
            best[key] = (delta, feat)

    out: list[dict[str, Any]] = []
    for (i, j), (_, feat) in sorted(best.items()):
        props = feat.get("properties") or {}
        out.append({
            "type": "Feature",
            "geometry": feat.get("geometry"),
            "properties": {
                "grid_i":              i,
                "grid_j":              j,
                "time":                props.get("time"),
                "wind_speed_ms":       props.get("wind_speed_ms"),
                "wind_direction_deg":  props.get("wind_direction_deg"),
                "wind_gust_ms":        props.get("wind_gust_ms"),
            },
        })
    return out


def _centre_timeline(forecast_features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extract the line-chart-friendly hourly timeline at the grid centre (1, 1)."""
    centre = [
        f for f in forecast_features
        if (f.get("properties") or {}).get("grid_i") == 1
        and (f.get("properties") or {}).get("grid_j") == 1
    ]
    # If grid wasn't 3×3 (e.g. degenerate bbox), fall back to first grid point.
    if not centre:
        # group by time then take first feature per time
        seen: set[str] = set()
        centre = []
        for f in forecast_features:
            time_iso = (f.get("properties") or {}).get("time")
            if not time_iso or time_iso in seen:
                continue
            seen.add(time_iso)
            centre.append(f)

    centre.sort(key=lambda f: (f.get("properties") or {}).get("time") or "")

    timeline: list[dict[str, Any]] = []
    for f in centre:
        p = f.get("properties") or {}
        timeline.append({
            "time":               p.get("time"),
            "temperature_c":      p.get("temperature_c"),
            "wind_speed_ms":      p.get("wind_speed_ms"),
            "wind_direction_deg": p.get("wind_direction_deg"),
            "wind_gust_ms":       p.get("wind_gust_ms"),
            "precipitation_mmh":  p.get("precipitation_mmh"),
            "cloud_cover_pct":    p.get("cloud_cover_pct"),
            "low_cloud_pct":      p.get("low_cloud_pct"),
            "visibility_m":       p.get("visibility_m"),
            "ceiling_m":          p.get("ceiling_m"),
            "humidity_pct":       p.get("humidity_pct"),
            "drone_rating":       p.get("drone_rating"),
            "drone_summary":      p.get("drone_summary"),
            "aviation_rating":    p.get("aviation_rating"),
        })
    return timeline


def _wind_field_timeline(
    forecast_features: list[dict[str, Any]],
    hours: int = 12,
) -> dict[str, list[dict[str, Any]]]:
    """First `hours` hours of wind field — used by frontend for arrow animation."""
    by_time: dict[str, list[dict[str, Any]]] = {}
    for f in forecast_features:
        p = f.get("properties") or {}
        time_iso = p.get("time")
        if not time_iso:
            continue
        by_time.setdefault(time_iso, []).append({
            "type": "Feature",
            "geometry": f.get("geometry"),
            "properties": {
                "grid_i":              p.get("grid_i"),
                "grid_j":              p.get("grid_j"),
                "wind_speed_ms":       p.get("wind_speed_ms"),
                "wind_direction_deg": p.get("wind_direction_deg"),
                "wind_gust_ms":        p.get("wind_gust_ms"),
            },
        })

    # Keep only the first `hours` entries (sorted chronologically).
    sorted_times = sorted(by_time.keys())[:hours]
    return {t: by_time[t] for t in sorted_times}


# ── Trend & next-change detection ────────────────────────────────────────────

_RATING_ORDER = {"no-go": 0, "marginal": 1, "go": 2, "unknown": 3}


def _detect_next_change(timeline: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return info on the next time the drone rating crosses to a worse class."""
    if len(timeline) < 2:
        return None
    first = timeline[0].get("drone_rating", "unknown")
    for step in timeline[1:]:
        cur = step.get("drone_rating", "unknown")
        if _RATING_ORDER.get(cur, 3) < _RATING_ORDER.get(first, 3):
            return {
                "time":        step.get("time"),
                "from_rating": first,
                "to_rating":   cur,
                "summary":     step.get("drone_summary") or "conditions deteriorate",
            }
        if _RATING_ORDER.get(cur, 3) > _RATING_ORDER.get(first, 3):
            return {
                "time":        step.get("time"),
                "from_rating": first,
                "to_rating":   cur,
                "summary":     "conditions improve",
            }
    return None


def _trend(timeline: list[dict[str, Any]]) -> str:
    """Compare first vs ~6h-out rating — improving, stable, or degrading."""
    if not timeline:
        return "unknown"
    head = _RATING_ORDER.get(timeline[0].get("drone_rating", "unknown"), 3)
    horizon = timeline[min(6, len(timeline) - 1)]
    tail = _RATING_ORDER.get(horizon.get("drone_rating", "unknown"), 3)
    if tail > head:
        return "improving"
    if tail < head:
        return "degrading"
    return "stable"


# ── Main entry point ─────────────────────────────────────────────────────────

async def build_weather(bbox: BBox, t: datetime | None) -> dict[str, Any]:
    """Build the unified weather response. Called by /api/analyze/weather."""
    t_utc = (t or datetime.now(timezone.utc)).astimezone(timezone.utc)

    fmi_task = PROVIDERS["fmi"].fetch(bbox, t_utc)
    forecast_task = PROVIDERS["fmi_forecast"].fetch(bbox, t_utc)
    obs_fc, forecast_fc = await asyncio.gather(fmi_task, forecast_task, return_exceptions=True)

    obs_features: list[dict[str, Any]] = []
    forecast_features: list[dict[str, Any]] = []
    source_status: dict[str, str] = {}

    if isinstance(obs_fc, Exception):
        source_status["fmi"] = "error"
    else:
        source_status["fmi"] = obs_fc.meta.status
        obs_features = [f.model_dump(mode="json") if hasattr(f, "model_dump") else f
                        for f in obs_fc.features]

    if isinstance(forecast_fc, Exception):
        source_status["fmi_forecast"] = "error"
    else:
        source_status["fmi_forecast"] = forecast_fc.meta.status
        forecast_features = [f.model_dump(mode="json") if hasattr(f, "model_dump") else f
                             for f in forecast_fc.features]

    # ── Observations summary
    obs_summary = _summarise_observations(obs_features)

    # ── Forecast timeline (centre of grid) + wind field at t
    timeline = _centre_timeline(forecast_features)
    wind_field_now = _wind_field_at(forecast_features, t_utc)
    wind_timeline = _wind_field_timeline(forecast_features, hours=12)

    # ── Operational ratings — prefer forecast at t, fall back to obs summary
    # Find the forecast timestep closest to t.
    rating_step: dict[str, Any] | None = None
    if timeline:
        best_delta = float("inf")
        for step in timeline:
            try:
                f_t = datetime.fromisoformat((step.get("time") or "").replace("Z", "+00:00"))
            except ValueError:
                continue
            delta = abs((f_t - t_utc).total_seconds())
            if delta < best_delta:
                best_delta = delta
                rating_step = step

    src = rating_step or {}
    temp_c   = src.get("temperature_c")     or obs_summary.get("temperature_c")
    wind_ms  = src.get("wind_speed_ms")     or obs_summary.get("wind_speed_ms")
    gust_ms  = src.get("wind_gust_ms")      or obs_summary.get("wind_gust_ms")
    vis_m    = src.get("visibility_m")      or obs_summary.get("visibility_m")
    ceil_m   = src.get("ceiling_m")
    precip   = src.get("precipitation_mmh") or obs_summary.get("precipitation_mmh")
    cloud    = src.get("cloud_cover_pct")   or obs_summary.get("cloud_cover_pct")
    snow_cm  = obs_summary.get("snow_depth_cm")

    drone_rating, drone_summary, drone_factors = doctrine.rate_drone(
        wind_ms, gust_ms, temp_c, vis_m, ceil_m, precip,
    )
    aviation_rating, aviation_summary = doctrine.rate_aviation(wind_ms)
    ground_rating, ground_summary = _rate_ground_mobility(precip, temp_c, snow_cm)
    isr_rating, isr_summary = _rate_isr(vis_m, cloud)
    cold_rating, cold_summary = _rate_cold_weather(temp_c, wind_ms)

    return {
        "bbox":  bbox.as_list(),
        "t":     t_utc.isoformat(),
        "observations": {
            "stations": {"type": "FeatureCollection", "features": obs_features},
            "summary":  obs_summary,
        },
        "forecast": {
            "timeline":            timeline,
            "wind_field_at_t":     {"type": "FeatureCollection", "features": wind_field_now},
            "wind_field_timeline": wind_timeline,
            "horizon_hours":       len(timeline),
            "grid_size":           3,
        },
        "ratings": {
            "drone":           {"rating": drone_rating,    "summary": drone_summary,    "limiting_factors": drone_factors},
            "aviation":        {"rating": aviation_rating, "summary": aviation_summary},
            "ground_mobility": {"rating": ground_rating,   "summary": ground_summary},
            "isr":             {"rating": isr_rating,      "summary": isr_summary},
            "cold_weather":    {"rating": cold_rating,     "summary": cold_summary},
            "trend":            _trend(timeline),
            "next_change":      _detect_next_change(timeline),
        },
        "thresholds": {
            "drone": doctrine.DRONE_LIMITS,
        },
        "source_status": source_status,
    }
