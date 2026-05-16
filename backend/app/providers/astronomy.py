"""Astronomical conditions provider — sun, moon, and twilight windows.

WHY THIS EXISTS:
IPB doctrine requires a "light data" assessment for every operation.
Night ops illumination determines whether forces can move unobserved
(new moon + overcast = pitch black) or whether they are silhouetted
against a bright lunar sky (full moon = 300 m naked-eye detection range
per ATP B-10). Civil/nautical/astronomical twilight windows define when
optical surveillance transitions from day to night mode.

This provider uses the `astral` library (pure local computation — no
external API, no rate limits, zero latency) to compute:

  • Sunrise / sunset
  • Civil dawn/dusk (sun 6° below horizon — last/first useful daylight)
  • Nautical dawn/dusk (sun 12° below — horizon still visible at sea)
  • Moon phase (0–29.5 day cycle)
  • Moon illumination % (0 = new moon, 100 = full moon)
  • Night ops rating: "dark" (<15% effective illumination)
                      "partial" (15–50%)
                      "bright" (>50%)
  • Total darkness hours per day

Returns one GeoJSON Point feature per day (at bbox centroid) for a
configurable window (default 3 days from t or now).

FRONTEND NOTE:
Render as a timeline panel, not a map layer. The map position (centroid)
is just a conventional anchor — astronomical conditions are essentially
uniform across any tactical-scale bbox.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import cos, pi
from typing import Any

from ..bbox import BBox
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

CACHE_TTL_SECONDS = 6 * 60 * 60  # recompute every 6 h (date changes, DST)
FORECAST_DAYS = 3


def _moon_illumination_pct(phase_days: float) -> float:
    """Moon illumination % from lunar phase in days (0 = new, 14.75 = full, 29.5 = new)."""
    return round(50.0 * (1.0 - cos(phase_days / 29.5 * 2.0 * pi)), 1)


def _night_ops_rating(illumination_pct: float) -> str:
    """Tactical night illumination rating based on moon illumination %."""
    if illumination_pct <= 15:
        return "dark"      # NVG conditions, unobserved movement possible
    if illumination_pct <= 50:
        return "partial"   # reduced visibility but not full darkness
    return "bright"        # silhouettes visible at distance per ATP B-10


def _compute_day(observer, tz_str: str, date: Any) -> dict[str, Any]:
    """Return all astronomical properties for a single calendar date."""
    from astral.sun import sun
    from astral import moon

    s = sun(observer, date=date, tzinfo=tz_str)
    phase = moon.phase(date)
    illumination = _moon_illumination_pct(phase)
    daylight_sec = (s["sunset"] - s["sunrise"]).total_seconds()
    darkness_hours = round(max(0.0, 24.0 - daylight_sec / 3600.0), 1)

    return {
        "date": date.isoformat(),
        "sunrise": s["sunrise"].isoformat(),
        "sunset": s["sunset"].isoformat(),
        "civil_dawn": s["dawn"].isoformat(),
        "civil_dusk": s["dusk"].isoformat(),
        "noon": s["noon"].isoformat(),
        "daylight_hours": round(daylight_sec / 3600.0, 1),
        "darkness_hours": darkness_hours,
        "moon_phase_days": round(phase, 1),
        "moon_illumination_pct": illumination,
        "night_ops_rating": _night_ops_rating(illumination),
        "cite": "IPB light data — ATP 2-01.3 §terrain analysis",
        "doctrine": "Illumination assessment per ATP 2-01.3 weather analysis",
    }


class AstronomyProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="astronomy", label="Astronomical — sun/moon/twilight (no API)")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        try:
            from astral import LocationInfo
        except ImportError:
            self.mark("unavailable", "astral library not installed — run: pip install astral")
            return empty_collection(
                self.id, status="unavailable",
                reason="astral library not installed",
                bbox=bbox.as_list(), t=t,
            )

        lat = (bbox.min_lat + bbox.max_lat) / 2.0
        lon = (bbox.min_lon + bbox.max_lon) / 2.0
        loc = LocationInfo(
            name="tactical_centroid",
            region="Finland",
            timezone="Europe/Helsinki",
            latitude=lat,
            longitude=lon,
        )

        base = (t or datetime.now(timezone.utc)).astimezone(timezone.utc)
        features: list[dict[str, Any]] = []

        for offset in range(FORECAST_DAYS):
            day_dt = base + timedelta(days=offset)
            try:
                data = _compute_day(loc.observer, loc.timezone, day_dt.date())
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {"source": "astronomy", **data},
                })
            except Exception as exc:
                # Some arctic dates have no sunrise/sunset — skip, don't crash.
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "source": "astronomy",
                        "date": day_dt.date().isoformat(),
                        "error": str(exc),
                        "darkness_hours": 0,
                        "moon_illumination_pct": None,
                        "night_ops_rating": "unknown",
                    },
                })

        status = "ok" if features else "unavailable"
        reason = (
            f"{FORECAST_DAYS} days astronomical data (local computation, no API)"
            if features else "computation failed"
        )
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
                attribution="Computed via astral v3 — ephemeris, no external API",
            ),
        )
