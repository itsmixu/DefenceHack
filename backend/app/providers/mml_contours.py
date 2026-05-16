"""MML elevation contour lines — height profile of the terrain.

WHY THIS EXISTS:
Contour lines show the shape of the land — hills, valleys, ridges, cliffs.
This feeds two things:
  1. The topographical map layer Miko renders on the 2D map
  2. The exposure/danger-zone algorithm (high ground = more exposed;
     valleys and reverse slopes = cover from direct fire)

DATA SOURCE:
MML Maastotietokanta WFS — feature type `Korkeusviiva` (elevation line).
Same API key and WFS endpoint as the terrain polygons (mml source).
Native CRS EPSG:3067 → reprojected to EPSG:4326 before emission.

PROPERTIES ON EACH FEATURE:
  elevation_m  — height above sea level in metres (from `korkeusarvo`)
  contour_type — "index" (thicker labelled lines, every 25 m) or
                 "intermediate" (every 5 m); frontend can style differently
  source       — "mml_contours"

OVERRIDES:
  MML_LAYER_CONTOUR            — WFS feature type name (default: Korkeusviiva)
  MML_CONTOUR_ELEVATION_ATTR   — attribute holding elevation value (default: korkeusarvo)
"""
from __future__ import annotations

import os
from datetime import datetime

import httpx

from .. import cache
from ..bbox import BBox
from ..geo import reproject_bbox, reproject_geometry
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

WFS_BASE = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/wfs/v3"
SRC_CRS = "EPSG:3067"
MAX_FEATURES = 3000       # contour lines are small; more is fine
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # 1 week — terrain doesn't change

DEFAULT_LAYER = os.getenv("MML_LAYER_CONTOUR", "Korkeusviiva")
ELEVATION_ATTR = os.getenv("MML_CONTOUR_ELEVATION_ATTR", "korkeusarvo")


def _contour_type(props: dict) -> str:
    """Classify as index (every 25 m) or intermediate (every 5 m) contour."""
    elev = props.get(ELEVATION_ATTR)
    try:
        return "index" if float(elev) % 25 == 0 else "intermediate"
    except (TypeError, ValueError):
        return "intermediate"


class MMLContoursProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="mml_contours", label="MML — elevation contour lines")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        api_key = os.getenv("MML_API_KEY") or None
        if not api_key:
            self.mark("unavailable", "MML_API_KEY not set")
            return empty_collection(
                self.id, status="unavailable", reason="MML_API_KEY not set",
                bbox=bbox.as_list(), t=t,
            )

        cache_key = {"bbox": bbox.as_list(), "layer": DEFAULT_LAYER}
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

        src_bbox = reproject_bbox(
            (bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat),
            "EPSG:4326", SRC_CRS,
        )
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": DEFAULT_LAYER,
            "outputFormat": "application/json",
            "srsName": SRC_CRS,
            "count": str(MAX_FEATURES),
            "bbox": f"{src_bbox[0]},{src_bbox[1]},{src_bbox[2]},{src_bbox[3]},{SRC_CRS}",
            "api-key": api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=60.0,
                                         headers={"User-Agent": "DefenceHack-IPB/0.1"}) as c:
                resp = await c.get(WFS_BASE, params=params)
                resp.raise_for_status()
                payload = resp.json()
        except httpx.HTTPError as e:
            self.mark("unavailable", f"MML contours WFS error: {e}")
            return empty_collection(self.id, status="unavailable",
                                    reason=f"MML contours WFS error: {e}",
                                    bbox=bbox.as_list(), t=t)
        except ValueError as e:
            self.mark("unavailable", f"MML contours non-JSON: {e}")
            return empty_collection(self.id, status="unavailable",
                                    reason=f"MML contours non-JSON: {e}",
                                    bbox=bbox.as_list(), t=t)

        features: list[dict] = []
        for raw in payload.get("features", []):
            geom = raw.get("geometry")
            if geom is None:
                continue
            props = raw.get("properties") or {}
            features.append({
                "type": "Feature",
                "id": raw.get("id"),
                "geometry": reproject_geometry(geom, SRC_CRS),
                "properties": {
                    "source": self.id,
                    "elevation_m": props.get(ELEVATION_ATTR),
                    "contour_type": _contour_type(props),
                },
            })

        cache.write(self.id, cache_key, {"features": features})
        status = "ok" if features else "partial"
        reason = f"{len(features)} contour lines" if features else "no contours in bbox"
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(source=self.id, status=status, reason=reason,
                           bbox=bbox.as_list(), t=t),
        )
