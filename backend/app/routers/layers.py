"""GET /api/layers/<source> — bbox-scoped GeoJSON FeatureCollection."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from ..bbox import BBox, parse_bbox
from ..registry import PROVIDERS, SOURCE_IDS
from ..schemas import empty_collection

router = APIRouter(prefix="/api/layers", tags=["layers"])

GEOJSON_MEDIA = "application/geo+json"


@router.get("/{source}")
async def get_layer(
    source: str,
    bbox: BBox = Depends(parse_bbox),
    t: datetime | None = Query(
        None, description="ISO 8601 UTC timestamp, e.g. 2026-05-15T12:00:00Z"
    ),
) -> Response:
    if source not in SOURCE_IDS:
        raise HTTPException(404, f"unknown source '{source}'")

    provider = PROVIDERS.get(source)
    if provider is None:
        fc = empty_collection(
            source=source,
            status="unavailable",
            reason="provider not yet implemented",
            bbox=bbox.as_list(),
            t=t,
        )
    else:
        fc = await provider.fetch(bbox, t)

    # model_dump_json() serializes straight to a JSON string, skipping the
    # intermediate Python dict that JSONResponse(content=fc.model_dump(...))
    # would build for every feature. On large FeatureCollections this halves
    # the transient memory of the response.
    return Response(
        content=fc.model_dump_json(),
        media_type=GEOJSON_MEDIA,
    )
