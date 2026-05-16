"""FMI weather raster tile provider — radar precipitation, cloud cover, temperature.

WHY THIS EXISTS:
For tactical weather visualisation we need RASTER overlays — radar rainfall
imagery, cloud cover heatmaps, temperature fields — not just point GeoJSON
data. FMI's openwms.fmi.fi WMS service exposes these as standard OGC WMS
layers and we proxy them as XYZ slippy-map tiles so Leaflet can use them
as a stack-able overlay (the user's "4th basemap option").

KEY ENDPOINTS:
  GET /api/tiles/weather/{layer}/{z}/{y}/{x}.png?t=ISO
      Returns a transparent 256×256 PNG suitable for Leaflet TileLayer.
      The ?t parameter is forwarded to WMS as ?time= so we get the correct
      radar/forecast frame — this is what wires the basemap to the timeline.

WHY WE PROXY (rather than the frontend hitting FMI directly):
  • Backend cache (FMI WMS is fast but rate-limits aggressive clients)
  • Centralised layer whitelist — friendly names like "precipitation"
    instead of "Radar:suomi_rr_eureffin" leaking into frontend code
  • Time parameter is canonicalised server-side
  • No CORS surprises when FMI rotates their config

WMS LAYER CATALOG (FMI openwms.fmi.fi):
  Radar:suomi_dbz_eureffin     — radar reflectivity dBZ
  Radar:suomi_rr_eureffin      — instantaneous rainfall rate (mm/h)
  Radar:suomi_rr1h_eureffin    — accumulated 1-hour rainfall (mm)
  Radar:suomi_rr5min_eureffin  — accumulated 5-min rainfall (mm)
  Weather:cloud_cover          — cloud coverage forecast
  Weather:temperature          — 2m temperature forecast
  Weather:windspeedms          — 10m wind speed forecast

All FMI WMS layers are CC-BY 4.0. No API key required.
"""
from __future__ import annotations

import asyncio
import math
import os
from datetime import datetime, timezone
from typing import Any

import httpx

WMS_BASE = "https://openwms.fmi.fi/geoserver/wms"

# Friendly tile-layer names → real FMI WMS layer identifiers.
# Add new layers here; the routers/tiles.py whitelist references this.
WEATHER_LAYERS: dict[str, dict[str, Any]] = {
    "precipitation": {
        "wms_layer":    "Radar:suomi_rr_eureffin",
        "label":        "Precipitation (radar, mm/h)",
        "category":     "radar",
        "time_aware":   True,
        "history_hours": 24,
        "description":  "Instantaneous radar rainfall rate over Finland.",
        "attribution":  "FMI Open Data — radar mosaic",
    },
    "rain_1h": {
        "wms_layer":    "Radar:suomi_rr1h_eureffin",
        "label":        "Rain — 1 h accumulation (mm)",
        "category":     "radar",
        "time_aware":   True,
        "history_hours": 24,
        "description":  "Total rainfall in the past hour.",
        "attribution":  "FMI Open Data — radar mosaic",
    },
    "reflectivity": {
        "wms_layer":    "Radar:suomi_dbz_eureffin",
        "label":        "Radar reflectivity (dBZ)",
        "category":     "radar",
        "time_aware":   True,
        "history_hours": 24,
        "description":  "Classic radar reflectivity — picks out storms & convection.",
        "attribution":  "FMI Open Data — radar mosaic",
    },
    "clouds": {
        "wms_layer":    "Weather:cloud_cover",
        "label":        "Cloud cover (%)",
        "category":     "forecast",
        "time_aware":   True,
        "forecast_hours": 48,
        "description":  "Total cloud cover from HARMONIE NWP — flight planning / ISR.",
        "attribution":  "FMI HARMONIE NWP",
    },
    "temperature": {
        "wms_layer":    "Weather:temperature",
        "label":        "Temperature (°C)",
        "category":     "forecast",
        "time_aware":   True,
        "forecast_hours": 48,
        "description":  "2 m air temperature forecast — cold-weather ops planning.",
        "attribution":  "FMI HARMONIE NWP",
    },
    "wind_speed": {
        "wms_layer":    "Weather:windspeedms",
        "label":        "Wind speed (m/s)",
        "category":     "forecast",
        "time_aware":   True,
        "forecast_hours": 48,
        "description":  "10 m wind speed — drone / aviation / parachute planning.",
        "attribution":  "FMI HARMONIE NWP",
    },
}

# Mercator world extent (EPSG:3857)
_MERC_EXTENT = 20037508.342789244


def xyz_to_3857_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Convert XYZ slippy-map tile coordinates to an EPSG:3857 bbox.

    Web Mercator origin is top-left at (-extent, +extent). Returns
    (minx, miny, maxx, maxy) — the standard EPSG:3857 axis order
    expected by WMS 1.3.0 GetMap requests.
    """
    n = 2 ** z
    tile_size = (_MERC_EXTENT * 2.0) / n
    minx = -_MERC_EXTENT + x * tile_size
    maxx = -_MERC_EXTENT + (x + 1) * tile_size
    maxy = _MERC_EXTENT - y * tile_size
    miny = _MERC_EXTENT - (y + 1) * tile_size
    return minx, miny, maxx, maxy


def _iso_z(t: datetime | None) -> str | None:
    """Format a datetime as the strict ISO-Z form FMI WMS expects."""
    if t is None:
        return None
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# Module-global async client — reused across requests for connection pooling.
_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    """Return the shared httpx.AsyncClient, creating it on first use."""
    global _client
    if _client is None:
        async with _client_lock:
            if _client is None:
                _client = httpx.AsyncClient(
                    timeout=httpx.Timeout(15.0, connect=5.0),
                    headers={"User-Agent": "DefenceHack-IPB/0.1 (+research)"},
                )
    return _client


async def fetch_weather_tile(
    layer: str,
    z: int,
    x: int,
    y: int,
    t: datetime | None = None,
) -> tuple[bytes, str]:
    """Fetch one weather-tile PNG from FMI WMS. Returns (bytes, content_type).

    Raises:
        KeyError      — unknown friendly layer name
        httpx.HTTPError — upstream failure (caller maps to HTTP 502)
    """
    spec = WEATHER_LAYERS.get(layer)
    if spec is None:
        raise KeyError(f"unknown weather tile layer: {layer!r}")

    minx, miny, maxx, maxy = xyz_to_3857_bbox(z, x, y)

    params: dict[str, str] = {
        "service":     "WMS",
        "version":     "1.3.0",
        "request":     "GetMap",
        "layers":      spec["wms_layer"],
        "styles":      "",
        "crs":         "EPSG:3857",
        "bbox":        f"{minx},{miny},{maxx},{maxy}",
        "width":       "256",
        "height":      "256",
        "format":      "image/png",
        "transparent": "true",
    }
    iso_t = _iso_z(t)
    if iso_t and spec.get("time_aware"):
        params["time"] = iso_t

    client = await _get_client()
    resp = await client.get(WMS_BASE, params=params)
    resp.raise_for_status()
    return resp.content, resp.headers.get("content-type", "image/png")
