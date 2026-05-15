"""GET /api/layers/<source> — bbox-scoped GeoJSON. Returns empty FC until providers land."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from ..bbox import BBox, parse_bbox
from ..registry import SOURCE_IDS
from ..schemas import empty_collection

router = APIRouter(prefix="/api/layers", tags=["layers"])

GEOJSON_MEDIA = "application/geo+json"


@router.get("/{source}")
def get_layer(
    source: str,
    bbox: BBox = Depends(parse_bbox),
    t: datetime | None = Query(
        None, description="ISO 8601 UTC timestamp, e.g. 2026-05-15T12:00:00Z"
    ),
) -> JSONResponse:
    if source not in SOURCE_IDS:
        raise HTTPException(404, f"unknown source '{source}'")

    # Step 1: no provider implementations yet — return an empty, transparent FC.
    fc = empty_collection(
        source=source,
        status="unavailable",
        reason="provider not yet implemented",
        bbox=bbox.as_list(),
        t=t,
    )
    return JSONResponse(
        content=fc.model_dump(mode="json"),
        media_type=GEOJSON_MEDIA,
    )
