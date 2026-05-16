"""Tile proxy for MML WMTS basemaps.

Browser-side Leaflet hits /api/tiles/mml/{layer}/{z}/{y}/{x}.png and we
forward to MML's avoin-karttakuva WMTS with HTTP Basic Auth (API key as
username, empty password). Keeps the MML key on the server.
"""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, HTTPException, Response

from ..http_client import get_client

router = APIRouter(prefix="/api/tiles", tags=["tiles"])

MML_BASE = (
    "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0"
    "/{layer}/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png"
)
ALLOWED_LAYERS = {"maastokartta", "taustakartta", "selkokartta", "ortokuva"}


@router.get("/mml/{layer}/{z}/{y}/{x}.png")
async def mml_tile(layer: str, z: int, y: int, x: int) -> Response:
    if layer not in ALLOWED_LAYERS:
        raise HTTPException(status_code=404, detail=f"Unknown MML layer: {layer}")

    api_key = os.getenv("MML_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="MML_API_KEY not configured")

    url = MML_BASE.format(layer=layer, z=z, y=y, x=x)
    try:
        resp = await get_client().get(url, auth=(api_key, ""), timeout=10.0)
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
