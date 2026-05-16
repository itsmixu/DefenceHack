"""FMI weather provider via the Finnish Meteorological Institute Open Data WFS.

Uses the `fmi::observations::weather::simple` stored query, which returns one
GML element per (station, time, parameter). We group these by station+time and
emit one GeoJSON Point feature per observation with all parameter values in
`properties.measurements`. No API key required for this stored query.

ENHANCED IN v2 — broader parameter set for military weather decisions:
  • temperature, dewpoint            — cold-weather ops, condensation risk
  • windspeedms, winddirection,
    windgust                          — drone / aviation / parachute limits
  • humidity, pressure, pressure trend — storm-front detection
  • precipitation1h, precipitationamount — ground trafficability, drone IP rating
  • visibility, cloud_cover           — ISR / observation reach
  • snowdepth, weather (auto-code)    — winter mobility

Computed in-provider (so downstream consumers don't redo it):
  wind_chill_c        from temperature + wind (NWS formula, valid T≤10°C, V≥5km/h)
  is_freezing         convenience boolean
  precip_intensity    "none|trace|light|moderate|heavy" from mm/h thresholds
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

import httpx

from .. import cache
from ..bbox import BBox
from ..http_client import get_client
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

WFS_URL = "https://opendata.fmi.fi/wfs"
STORED_QUERY = "fmi::observations::weather::simple"

# Broader parameter set — see module docstring for why each is included.
DEFAULT_PARAMETERS: tuple[str, ...] = (
    "temperature",
    "dewpoint",
    "windspeedms",
    "winddirection",
    "windgust",
    "humidity",
    "pressure",
    "precipitation1h",
    "precipitationamount",
    "visibility",
    "totalcloudcover",
    "snowdepth",
    "weather",            # WMO auto-code 00..99 (rain, snow, fog…)
)
CACHE_TTL_SECONDS = 10 * 60   # 10 min — stations update every 10 min

NS = {
    "wfs":   "http://www.opengis.net/wfs/2.0",
    "BsWfs": "http://xml.fmi.fi/schema/wfs/2.0",
    "gml":   "http://www.opengis.net/gml/3.2",
}


# ── Derived metric helpers ────────────────────────────────────────────────────

def _wind_chill_c(temp_c: float | None, wind_ms: float | None) -> float | None:
    """North American wind-chill formula. Valid for T ≤ 10°C and V ≥ 1.34 m/s."""
    if temp_c is None or wind_ms is None:
        return None
    if temp_c > 10.0 or wind_ms < 1.34:
        return temp_c
    v_kmh = wind_ms * 3.6
    wci = 13.12 + 0.6215 * temp_c - 11.37 * (v_kmh ** 0.16) + 0.3965 * temp_c * (v_kmh ** 0.16)
    return round(wci, 1)


def _precip_intensity(mmh: float | None) -> str:
    """Bucket precipitation rate into doctrinal categories (drone / mobility impact)."""
    if mmh is None or mmh <= 0.0:
        return "none"
    if mmh < 0.1:
        return "trace"
    if mmh < 2.5:
        return "light"
    if mmh < 7.6:
        return "moderate"
    return "heavy"


def _wind_cardinal(deg: float | None) -> str | None:
    """Convert wind direction (degrees from) to 16-point compass label."""
    if deg is None:
        return None
    sectors = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
               "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    idx = int((deg / 22.5 + 0.5) % 16)
    return sectors[idx]


# ── Time window ───────────────────────────────────────────────────────────────

def _time_window(t: datetime | None) -> tuple[datetime, datetime]:
    """Return (start, end) covering the most recent hour up to t (default: now)."""
    end = (t or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return end - timedelta(hours=1), end


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ── XML parsing ───────────────────────────────────────────────────────────────

def _parse_response(xml_text: str) -> list[dict]:
    """Group BsWfsElement records into one feature per (station, time)."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f"invalid FMI XML response: {e}") from e

    # (lat, lon, time-iso) → parameter → value
    grouped: dict[tuple[float, float, str], dict[str, float]] = defaultdict(dict)

    for elem in root.iter(f"{{{NS['BsWfs']}}}BsWfsElement"):
        pos_node   = elem.find(".//gml:pos", NS)
        time_node  = elem.find("BsWfs:Time", NS)
        name_node  = elem.find("BsWfs:ParameterName", NS)
        value_node = elem.find("BsWfs:ParameterValue", NS)
        if pos_node is None or time_node is None or name_node is None or value_node is None:
            continue
        pos_text = (pos_node.text or "").strip().split()
        if len(pos_text) != 2:
            continue
        try:
            lat = float(pos_text[0])
            lon = float(pos_text[1])
            value = float(value_node.text or "nan")
        except ValueError:
            continue
        if math.isnan(value):
            continue
        key = (lat, lon, (time_node.text or "").strip())
        grouped[key][name_node.text or "unknown"] = value

    # Keep only the most-recent record per station — FMI returns the last
    # ~hour at 10-min cadence, but for the map we want one dot per station.
    latest_by_station: dict[tuple[float, float], tuple[str, dict[str, float]]] = {}
    for (lat, lon, time_iso), measurements in grouped.items():
        prev = latest_by_station.get((lat, lon))
        if prev is None or time_iso > prev[0]:
            latest_by_station[(lat, lon)] = (time_iso, measurements)

    features: list[dict] = []
    for (lat, lon), (time_iso, m) in latest_by_station.items():
        temp_c  = m.get("temperature")
        wind_ms = m.get("windspeedms")
        wind_deg = m.get("winddirection")
        gust_ms = m.get("windgust")
        precip  = m.get("precipitation1h")

        wind_chill = _wind_chill_c(temp_c, wind_ms)

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "source": "fmi",
                "time":   time_iso,
                "measurements": m,
                # Flattened key fields for easy frontend rendering
                "temperature_c":       temp_c,
                "dewpoint_c":          m.get("dewpoint"),
                "humidity_pct":        m.get("humidity"),
                "pressure_hpa":        m.get("pressure"),
                "wind_speed_ms":       wind_ms,
                "wind_direction_deg":  wind_deg,
                "wind_direction_card": _wind_cardinal(wind_deg),
                "wind_gust_ms":        gust_ms,
                "precipitation_mmh":   precip,
                "precip_intensity":    _precip_intensity(precip),
                "visibility_m":        m.get("visibility"),
                "cloud_cover_pct":     m.get("totalcloudcover"),
                "snow_depth_cm":       m.get("snowdepth"),
                "weather_code":        m.get("weather"),
                # Computed
                "wind_chill_c":        wind_chill,
                "is_freezing":         (temp_c is not None and temp_c <= 0.0),
            },
        })
    return features


class FMIProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="fmi", label="FMI — Finnish Meteorological Institute")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        start, end = _time_window(t)
        # Round the cache key to the hour so concurrent requests share results.
        cache_key = {
            "bbox":   bbox.as_list(),
            "start":  _iso(start.replace(minute=0, second=0, microsecond=0)),
            "end":    _iso(end.replace(minute=0, second=0, microsecond=0)),
            "params": list(DEFAULT_PARAMETERS),
        }

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

        params = {
            "service":       "WFS",
            "version":       "2.0.0",
            "request":       "getFeature",
            "storedquery_id": STORED_QUERY,
            # FMI WFS expects bbox as lon,lat,lon,lat with explicit CRS suffix.
            "bbox":          f"{bbox.min_lon},{bbox.min_lat},{bbox.max_lon},{bbox.max_lat},EPSG::4326",
            "starttime":     _iso(start),
            "endtime":       _iso(end),
            "parameters":    ",".join(DEFAULT_PARAMETERS),
        }

        try:
            client = get_client()
            resp = await client.get(WFS_URL, params=params, timeout=30.0)
            resp.raise_for_status()
            xml_text = resp.text
        except httpx.HTTPError as e:
            self.mark("unavailable", f"FMI WFS error: {e}")
            return empty_collection(
                self.id, status="unavailable", reason=f"FMI WFS error: {e}",
                bbox=bbox.as_list(), t=t,
            )

        try:
            features = _parse_response(xml_text)
        except ValueError as e:
            self.mark("unavailable", str(e))
            return empty_collection(
                self.id, status="unavailable", reason=str(e),
                bbox=bbox.as_list(), t=t,
            )

        cache.write(self.id, cache_key, {"features": features})
        status = "ok" if features else "partial"
        reason = f"{len(features)} stations" if features else "no observations in window"
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
                attribution="FMI Open Data — observation network",
            ),
        )
