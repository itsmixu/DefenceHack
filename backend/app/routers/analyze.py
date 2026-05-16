"""Analysis endpoints — synthesized intelligence products on top of raw layers.

WHY THIS EXISTS:
The raw /api/layers/<source> endpoints return individual data feeds.
These analysis endpoints return doctrinal IPB products that fuse multiple
sources into a single tactical view:

  GET /api/analyze/mcoo?bbox=…
      Modified Combined Obstacle Overlay — the doctrinal headline product.
      Returns a GeoJSON FeatureCollection with mcoo_class per feature
      ("go" / "slow-go" / "no-go"). Frontend renders as the primary tactical
      overlay (green / yellow / red).

  GET /api/analyze/terrain-effects?bbox=…
      Terrain Effects Matrix — structured JSON rating each warfighting
      function (maneuver, fires, intelligence, sustainment, protection)
      based on the data in the bbox. Frontend renders as a briefing card.

  GET /api/analyze/viewshed?bbox=…&observer_lon=&observer_lat=
      Line-of-sight / dead-ground analysis. STUB — returns "unavailable"
      with a clear reason. Implementation requires the MML 2m DEM
      raster and rasterio; flagged in the 61N source as a key AI hook
      but parked until raster processing is added (post-MVP).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..analysis.mcoo import build_mcoo
from ..analysis.terrain_effects import build_terrain_effects
from ..bbox import BBox, parse_bbox

router = APIRouter(prefix="/api/analyze", tags=["analysis"])

GEOJSON_MEDIA = "application/geo+json"


@router.get("/mcoo")
async def mcoo(
    bbox: BBox = Depends(parse_bbox),
    t: datetime | None = Query(None),
) -> JSONResponse:
    fc = await build_mcoo(bbox, t)
    return JSONResponse(content=fc.model_dump(mode="json"), media_type=GEOJSON_MEDIA)


@router.get("/terrain-effects")
async def terrain_effects(
    bbox: BBox = Depends(parse_bbox),
    t: datetime | None = Query(None),
) -> dict[str, Any]:
    return await build_terrain_effects(bbox, t)


@router.get("/viewshed")
async def viewshed(
    bbox: BBox = Depends(parse_bbox),
    observer_lon: float | None = Query(None),
    observer_lat: float | None = Query(None),
    observer_height_m: float = Query(2.0, description="Observer height above ground (m)"),
) -> dict[str, Any]:
    """Stub. Will return raster-derived visible/dead-ground polygons once the
    MML DEM pipeline lands; for now reports unavailable with the reason."""
    return {
        "type": "FeatureCollection",
        "features": [],
        "meta": {
            "source": "viewshed",
            "status": "unavailable",
            "reason": "viewshed analysis requires MML DEM raster ingestion (rasterio + GeoTIFF processing) — not yet implemented",
            "bbox": bbox.as_list(),
            "observer": (
                {"lon": observer_lon, "lat": observer_lat, "height_m": observer_height_m}
                if observer_lon is not None and observer_lat is not None
                else None
            ),
        },
    }
