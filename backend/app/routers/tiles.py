"""Tile proxy — MML basemaps + FMI weather rasters.

The browser hits this router for any tile that needs server-side handling:
  • MML WMTS basemaps (needs API key on the server, not in JS)
  • FMI weather WMS (cached + time-parameterised)

Routes:
  GET /api/tiles/mml/{layer}/{z}/{y}/{x}.png
      Maastokartta / taustakartta / selkokartta / ortokuva
  GET /api/tiles/weather/{layer}/{z}/{y}/{x}.png?t=ISO
      Precipitation radar / cloud cover / temperature / wind-speed (FMI WMS)
  GET /api/tiles/weather/catalog
      JSON catalog of available weather tile layers + metadata
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query, Response

from ..providers import fmi_radar

router = APIRouter(prefix="/api/tiles", tags=["tiles"])

# ── MML basemaps (existing) ───────────────────────────────────────────────────

MML_BASE = (
    "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0"
    "/{layer}/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png"
)
ALLOWED_MML_LAYERS = {"maastokartta", "taustakartta", "selkokartta", "ortokuva"}

_mml_client: httpx.AsyncClient | None = None


def _get_mml_client() -> httpx.AsyncClient:
    global _mml_client
    if _mml_client is None:
        _mml_client = httpx.AsyncClient(timeout=10.0)
    return _mml_client


@router.get("/mml/{layer}/{z}/{y}/{x}.png")
async def mml_tile(layer: str, z: int, y: int, x: int) -> Response:
    if layer not in ALLOWED_MML_LAYERS:
        raise HTTPException(status_code=404, detail=f"Unknown MML layer: {layer}")

    api_key = os.getenv("MML_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="MML_API_KEY not configured")

    url = MML_BASE.format(layer=layer, z=z, y=y, x=x)
    try:
        resp = await _get_mml_client().get(url, auth=(api_key, ""))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"upstream error: {exc}") from exc

    if resp.status_code != 200:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"MML upstream returned {resp.status_code}",
        )

    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/png"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ── Weather tile catalog ──────────────────────────────────────────────────────

@router.get("/weather/catalog")
def weather_catalog() -> dict[str, Any]:
    """Return metadata for all weather tile layers.

    Frontend uses this to populate the basemap stack / overlay menu so new
    layers added on the server appear without a frontend code change.
    """
    return {
        "layers": [
            {
                "id":             tile_id,
                "label":          spec["label"],
                "category":       spec["category"],
                "url_template":   f"/api/tiles/weather/{tile_id}/{{z}}/{{y}}/{{x}}.png",
                "time_aware":     spec.get("time_aware", False),
                "history_hours":  spec.get("history_hours"),
                "forecast_hours": spec.get("forecast_hours"),
                "description":    spec.get("description", ""),
                "attribution":    spec.get("attribution", "FMI Open Data"),
            }
            for tile_id, spec in fmi_radar.WEATHER_LAYERS.items()
        ],
        "attribution": "Finnish Meteorological Institute — CC BY 4.0",
        "wms_base":    fmi_radar.WMS_BASE,
    }


# ── Weather tiles ─────────────────────────────────────────────────────────────

@router.get("/weather/{layer}/{z}/{y}/{x}.png")
async def weather_tile(
    layer: str,
    z: int,
    y: int,
    x: int,
    t: datetime | None = Query(
        None,
        description="ISO-8601 UTC timestamp. Forwarded to WMS as TIME for "
                    "radar/forecast frame selection. Wires this tile to the "
                    "frontend timeline scrubber.",
    ),
) -> Response:
    """Proxy a single weather tile from FMI WMS.

    Tile is 256×256 PNG, transparent where there's no data, suitable for
    use as a Leaflet TileLayer stacked over any basemap.
    """
    try:
        content, content_type = await fmi_radar.fetch_weather_tile(layer, z, x, y, t)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"FMI WMS upstream error: {exc}") from exc

    # Radar frames update every 5 min; forecast frames are stable until the
    # next NWP cycle (1 h). Use a conservative 5 min cache.
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=300"},
    )
