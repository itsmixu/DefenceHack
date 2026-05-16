"""FMI HARMONIE forecast provider — cloud cover, precipitation, wind aloft.

WHY THIS EXISTS:
The `fmi` provider returns current weather *observations* from physical
stations. For planning ahead we need the *forecast*, especially:
  • Cloud ceiling height (critical for aviation go/no-go and drone rating)
  • Precipitation type and rate (ground trafficability, drone operations)
  • Total cloud cover % (visibility, observation, ISR)
  • Wind at 10 m (matches drone limits) and at 100 m (fixed-wing UAS)
  • Temperature and humidity forecast

This provider queries FMI's HARMONIE NWP (Numerical Weather Prediction)
model via the `fmi::forecast::harmonie::surface::point::simple` stored
query. HARMONIE is FMI's mesoscale model — ~2.5 km resolution over
Finland, updated every hour, 48-hour lookahead.

The bbox centroid is used as the forecast point. Forecast data is
returned as GeoJSON Point features, one per forecast time step.

Rain radar WMS tile for Miko:
  https://openwms.fmi.fi/geoserver/wms?SERVICE=WMS&VERSION=1.3.0&
  REQUEST=GetMap&LAYERS=Radar:suomi_rr_eureffin&...
(render directly in MapLibre as a raster source — no backend call needed)
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from xml.etree import ElementTree as ET

import httpx

from .. import cache
from ..bbox import BBox
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

WFS_URL = "https://opendata.fmi.fi/wfs"
STORED_QUERY = "fmi::forecast::harmonie::surface::point::simple"

# Parameters available in the HARMONIE surface stored query.
FORECAST_PARAMETERS: tuple[str, ...] = (
    "Temperature",          # 2 m air temperature (°C)
    "WindSpeedMS",          # 10 m wind speed (m/s)
    "WindDirection",        # 10 m wind direction (degrees)
    "WindGust",             # Wind gust speed (m/s)
    "TotalCloudCover",      # Total cloud cover (0–100 %)
    "LowCloudCover",        # Low-level cloud cover (0–100 %)
    "PrecipitationAmount",  # Precipitation amount per time step (mm)
    "Humidity",             # Relative humidity (%)
    "Visibility",           # Horizontal visibility (m)
    "CloudBase",            # Lowest cloud base height (m AGL)
)

CACHE_TTL_SECONDS = 60 * 60   # 1 hour — HARMONIE updates hourly
FORECAST_HOURS = 48

NS = {
    "wfs": "http://www.opengis.net/wfs/2.0",
    "BsWfs": "http://xml.fmi.fi/schema/wfs/2.0",
    "gml": "http://www.opengis.net/gml/3.2",
}


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_forecast(xml_text: str) -> list[dict[str, Any]]:
    """Parse HARMONIE WFS XML into GeoJSON Point features (one per timestep)."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"invalid FMI XML: {exc}") from exc

    grouped: dict[tuple[float, float, str], dict[str, float]] = defaultdict(dict)

    for elem in root.iter(f"{{{NS['BsWfs']}}}BsWfsElement"):
        pos   = elem.find(".//gml:pos", NS)
        time  = elem.find("BsWfs:Time", NS)
        name  = elem.find("BsWfs:ParameterName", NS)
        value = elem.find("BsWfs:ParameterValue", NS)
        if any(x is None for x in (pos, time, name, value)):
            continue
        parts = (pos.text or "").strip().split()
        if len(parts) != 2:
            continue
        try:
            lat = float(parts[0])
            lon = float(parts[1])
            val = float(value.text or "nan")
        except ValueError:
            continue
        if val != val:  # NaN
            continue
        key = (lat, lon, (time.text or "").strip())
        grouped[key][(name.text or "").strip()] = val

    features: list[dict[str, Any]] = []
    for (lat, lon, time_iso), params in sorted(grouped.items(), key=lambda x: x[0][2]):
        if not params:
            continue
        if "CloudBase" in params and "CloudBase1" not in params:
            params["CloudBase1"] = params["CloudBase"]
        # Derive a simple drone-rating hint so frontend can colour without
        # calling the analysis endpoint separately.
        wind = params.get("WindSpeedMS")
        gust = params.get("WindGust")
        temp = params.get("Temperature")
        vis  = params.get("Visibility")
        ceil = params.get("CloudBase") or params.get("CloudBase1")
        prec = params.get("PrecipitationAmount")
        from .. import doctrine
        drone_rating, drone_summary, _ = doctrine.rate_drone(wind, gust, temp, vis, ceil, prec)

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "source": "fmi_forecast",
                "time": time_iso,
                "forecast": params,
                "drone_rating": drone_rating,
                "drone_summary": drone_summary,
            },
        })
    return features


class FMIForecastProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="fmi_forecast", label="FMI HARMONIE forecast — clouds, rain, ceiling")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        lat = (bbox.min_lat + bbox.max_lat) / 2.0
        lon = (bbox.min_lon + bbox.max_lon) / 2.0
        start = (t or datetime.now(timezone.utc)).astimezone(timezone.utc)
        end   = start + timedelta(hours=FORECAST_HOURS)

        cache_key = {
            "latlon": [round(lat, 3), round(lon, 3)],
            "start_h": start.strftime("%Y-%m-%dT%H:00Z"),
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
            "service": "WFS",
            "version": "2.0.0",
            "request": "getFeature",
            "storedquery_id": STORED_QUERY,
            "latlon": f"{lat},{lon}",
            "starttime": _iso(start),
            "endtime": _iso(end),
            "parameters": ",".join(FORECAST_PARAMETERS),
        }

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.get(
                    WFS_URL, params=params,
                    headers={"User-Agent": "DefenceHack-IPB/0.1"},
                )
                resp.raise_for_status()
                xml_text = resp.text
        except httpx.HTTPError as exc:
            self.mark("unavailable", f"FMI forecast WFS error: {exc}")
            return empty_collection(
                self.id, status="unavailable",
                reason=f"FMI HARMONIE WFS unavailable: {exc}",
                bbox=bbox.as_list(), t=t,
            )

        try:
            features = _parse_forecast(xml_text)
        except ValueError as exc:
            self.mark("unavailable", str(exc))
            return empty_collection(
                self.id, status="unavailable", reason=str(exc),
                bbox=bbox.as_list(), t=t,
            )

        cache.write(self.id, cache_key, {"features": features})
        status = "ok" if features else "partial"
        reason = (
            f"{len(features)} forecast timesteps ({FORECAST_HOURS}h ahead)"
            if features else "no forecast data returned"
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
