"""MML elevation contour lines — height profile of the terrain.

WHY THIS EXISTS:
Contour lines show the shape of the land — hills, valleys, ridges, cliffs.
This feeds two things:
  1. The topographical map layer Miko renders on the 2D map
  2. The exposure/danger-zone algorithm (high ground = more exposed;
     valleys and reverse slopes = cover from direct fire)

DATA SOURCE:
MML Maastotietokanta OGC API — Features service, collection `korkeuskayra`
(elevation contour line). Returns GeoJSON in EPSG:4326 directly.

PROPERTIES ON EACH FEATURE:
  elevation_m  — height above sea level in metres (from `korkeusarvo`,
                 which the API provides in millimetres — we convert)
  contour_type — "index" (thicker labelled lines, every 25 m) or
                 "intermediate" (every 5 m); frontend can style differently
  source       — "mml_contours"

OVERRIDES:
  MML_LAYER_CONTOUR            — collection id (default: korkeuskayra)
  MML_CONTOUR_ELEVATION_ATTR   — attribute holding elevation value (default: korkeusarvo)
"""
from __future__ import annotations

import os
from datetime import datetime

import httpx

from .. import cache
from ..bbox import BBox
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

API_BASE = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/features/v1"
PAGE_SIZE = 10000         # per-request limit; MML accepts large pages
HARD_CAP = 100000         # absolute upper bound to avoid runaway queries
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # 1 week — terrain doesn't change

DEFAULT_LAYER = os.getenv("MML_LAYER_CONTOUR") or "korkeuskayra"
ELEVATION_ATTR = os.getenv("MML_CONTOUR_ELEVATION_ATTR") or "korkeusarvo"


def _elevation_m(props: dict) -> float | None:
    """MML's `korkeusarvo` is millimetres; convert to metres."""
    raw = props.get(ELEVATION_ATTR)
    try:
        return float(raw) / 1000.0
    except (TypeError, ValueError):
        return None


def _contour_type(elev_m: float | None) -> str:
    """Classify as index (every 25 m) or intermediate (every 5 m) contour."""
    if elev_m is None:
        return "intermediate"
    return "index" if elev_m % 25 == 0 else "intermediate"


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

        first_url = f"{API_BASE}/collections/{DEFAULT_LAYER}/items"
        first_params: dict[str, str] = {
            "api-key": api_key,
            "bbox": f"{bbox.min_lon},{bbox.min_lat},{bbox.max_lon},{bbox.max_lat}",
            "limit": str(PAGE_SIZE),
            "f": "json",
        }

        features: list[dict] = []
        capped = False
        try:
            async with httpx.AsyncClient(timeout=60.0,
                                         headers={"User-Agent": "DefenceHack-IPB/0.1"}) as c:
                next_url: str | None = first_url
                next_params: dict[str, str] | None = first_params
                while next_url is not None:
                    resp = await c.get(next_url, params=next_params)
                    resp.raise_for_status()
                    payload = resp.json()
                    for raw in payload.get("features", []):
                        geom = raw.get("geometry")
                        if geom is None:
                            continue
                        props = raw.get("properties") or {}
                        elev_m = _elevation_m(props)
                        features.append({
                            "type": "Feature",
                            "id": raw.get("id"),
                            "geometry": geom,  # already EPSG:4326
                            "properties": {
                                "source": self.id,
                                "elevation_m": elev_m,
                                "contour_type": _contour_type(elev_m),
                            },
                        })
                    if len(features) >= HARD_CAP:
                        capped = True
                        break
                    # Follow OGC API Features pagination via rel="next" link.
                    nxt = next(
                        (lnk.get("href") for lnk in payload.get("links", [])
                         if lnk.get("rel") == "next" and lnk.get("href")),
                        None,
                    )
                    next_url = nxt
                    next_params = None  # next href already carries query params
        except httpx.HTTPError as e:
            self.mark("unavailable", f"MML contours API error: {e}")
            return empty_collection(self.id, status="unavailable",
                                    reason=f"MML contours API error: {e}",
                                    bbox=bbox.as_list(), t=t)
        except ValueError as e:
            self.mark("unavailable", f"MML contours non-JSON: {e}")
            return empty_collection(self.id, status="unavailable",
                                    reason=f"MML contours non-JSON: {e}",
                                    bbox=bbox.as_list(), t=t)

        cache.write(self.id, cache_key, {"features": features})
        if not features:
            status, reason = "partial", "no contours in bbox"
        elif capped:
            status, reason = "partial", f"capped at {HARD_CAP} contour lines (zoom in for full detail)"
        else:
            status, reason = "ok", f"{len(features)} contour lines"
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(source=self.id, status=status, reason=reason,
                           bbox=bbox.as_list(), t=t),
        )
