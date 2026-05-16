"""Terrain exposure / danger-zone scoring layer.

WHY THIS EXISTS:
Directly answers "what forces can do and what is possible" from the
whiteboard — the core tactical question of the 61N challenge.

The algorithm combines MML terrain polygons and OSM land-use data to
assign each area a danger_level from 1 (safe / concealed) to 5
(fully exposed / no cover). This can be visualised as a green-to-red
choropleth on the 2D map, giving an immediate visual read of where
movement is safe vs suicidal.

SCORING RATIONALE:
  1 — Hard cover (buildings, dense forest): protected from direct observation
      and direct fire
  2 — Soft cover (mixed forest, scrub, swamp edges): concealment but not
      protection from fire
  3 — Partial exposure (forest edge, bedrock, elevated ground): can be
      seen but terrain provides some protection
  4 — Exposed (open ground, sparse vegetation, roads): visible and
      largely unprotected
  5 — Maximum exposure (open fields, beaches, water crossings): fully
      visible from all directions, no cover at all

ALGORITHM:
  1. Fetches MML terrain polygons (swamp/lake/river/sea/bedrock/sand)
     for the bbox — these are the ground truth for terrain type.
  2. Fetches OSM landuse/natural/building polygons for additional
     context (farmland, forest, buildings, parks).
  3. Assigns danger_level to every feature based on its type.
  4. Returns a merged FeatureCollection. Frontend renders as choropleth.
     No spatial merging is done server-side; overlapping polygons are
     returned as-is and the frontend layer order handles visual priority.

NOTE ON LIMITATIONS:
  This is a static terrain analysis — it does not account for enemy
  positions, line-of-sight from specific observer points, or movement.
  True viewshed analysis requires DEM raster processing (future work).
  The contour lines layer (mml_contours) can supplement this with
  elevation context on the map.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime
from typing import Any

import httpx

from .. import cache
from ..bbox import BBox
from ..geo import reproject_bbox, reproject_geometry
from ..http_client import get_client
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

MML_WFS = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/wfs/v3"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
SRC_CRS = "EPSG:3067"
CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours
MAX_FEATURES = 500

# ── MML terrain type → (danger_level, reason) ──────────────────────────────
MML_SCORES: dict[str, tuple[int, str]] = {
    "Suo":           (2, "swamp — impassable, partial concealment"),
    "Jarvi":         (0, "lake — impassable water barrier"),
    "Virtavesialue": (0, "river — water barrier, crossing point needed"),
    "Meriaalue":     (0, "sea — impassable"),
    "KallioAlue":    (3, "bedrock — elevated, limited cover, defensible"),
    "HiekkaSoraAlue":(4, "sand/gravel — exposed, poor footing"),
}

# ── OSM tag combos → (danger_level, reason) ────────────────────────────────
def _osm_score(tags: dict) -> tuple[int, str] | None:
    landuse = tags.get("landuse", "")
    natural = tags.get("natural", "")
    building = tags.get("building", "")
    amenity  = tags.get("amenity", "")

    if building or amenity in ("hospital", "school"):
        return (1, "building — hard cover")
    if landuse in ("forest",) or natural in ("wood", "scrub"):
        return (1, "forest/scrub — cover and concealment")
    if natural == "wetland":
        return (2, "wetland — impassable, some concealment")
    if landuse in ("farmland", "meadow", "grass") or natural == "grassland":
        return (5, "open farmland/meadow — maximum exposure, no cover")
    if landuse in ("residential", "commercial", "industrial", "retail"):
        return (2, "urban area — mixed cover behind structures")
    if landuse == "military":
        return (3, "military zone")
    if natural in ("beach", "sand"):
        return (5, "beach/sand — fully exposed")
    if natural == "cliff":
        return (3, "cliff — obstacle, limited cover")
    return None


async def _fetch_mml_terrain(
    client: httpx.AsyncClient,
    api_key: str,
    src_bbox: tuple[float, float, float, float],
) -> list[dict]:
    features: list[dict] = []
    bbox_str = f"{src_bbox[0]},{src_bbox[1]},{src_bbox[2]},{src_bbox[3]},{SRC_CRS}"
    for wfs_type, (score, reason) in MML_SCORES.items():
        params = {
            "service": "WFS", "version": "2.0.0", "request": "GetFeature",
            "typeNames": wfs_type, "outputFormat": "application/json",
            "srsName": SRC_CRS, "count": str(MAX_FEATURES),
            "bbox": bbox_str, "api-key": api_key,
        }
        try:
            resp = await client.get(MML_WFS, params=params, timeout=20.0)
            if resp.status_code == 400:
                continue  # unknown layer name, skip silently
            resp.raise_for_status()
            payload = resp.json()
        except Exception:
            continue
        for raw in payload.get("features", []):
            geom = raw.get("geometry")
            if not geom:
                continue
            features.append({
                "type": "Feature",
                "geometry": reproject_geometry(geom, SRC_CRS),
                "properties": {
                    "source": "exposure",
                    "data_source": "mml",
                    "terrain_type": wfs_type,
                    "danger_level": score,
                    "reason": reason,
                },
            })
    return features


async def _fetch_osm_landuse(
    client: httpx.AsyncClient,
    bbox: BBox,
) -> list[dict]:
    """Fetch OSM landuse and building polygons for exposure scoring."""
    bbox_str = f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}"
    query = (
        f"[out:json][timeout:25];"
        f"("
        f'way["landuse"]({bbox_str});'
        f'way["natural"~"wood|scrub|wetland|grassland|beach|sand|cliff"]({bbox_str});'
        f'way["building"]({bbox_str});'
        f");"
        f"out center tags;"
    )
    features: list[dict] = []
    try:
        resp = await client.post(
            OVERPASS_URL, data={"data": query},
            headers={"User-Agent": "DefenceHack-IPB/0.1"}, timeout=30.0,
        )
        resp.raise_for_status()
        payload = resp.json()
    except Exception:
        return []

    for elem in payload.get("elements", []):
        tags = elem.get("tags") or {}
        scored = _osm_score(tags)
        if scored is None:
            continue
        score, reason = scored
        center = elem.get("center") or {}
        lon = center.get("lon") or elem.get("lon")
        lat = center.get("lat") or elem.get("lat")
        if lon is None or lat is None:
            continue
        # OSM ways come back as centre points here — for a polygon we'd need
        # full geometry. Centre points are enough for heatmap/choropleth hints.
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "source": "exposure",
                "data_source": "osm",
                "terrain_type": tags.get("landuse") or tags.get("natural") or "building",
                "danger_level": score,
                "reason": reason,
                "name": tags.get("name"),
            },
        })
    return features


class ExposureProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="exposure",
                         label="Terrain exposure — danger zone scoring")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        cache_key = {"bbox": bbox.as_list()}
        cached = cache.read(self.id, cache_key, CACHE_TTL_SECONDS)
        if cached is not None:
            self.mark("ok", "served from cache")
            return FeatureCollection(
                features=cached.get("features", []),
                meta=LayerMeta(source=self.id, status="ok",
                               reason="served from cache",
                               bbox=bbox.as_list(), t=t),
            )

        api_key = os.getenv("MML_API_KEY") or None
        src_bbox = (
            reproject_bbox(
                (bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat),
                "EPSG:4326", SRC_CRS,
            ) if api_key else None
        )

        client = get_client()
        tasks: list[Any] = [_fetch_osm_landuse(client, bbox)]
        if api_key and src_bbox:
            tasks.append(_fetch_mml_terrain(client, api_key, src_bbox))
        results = await asyncio.gather(*tasks)

        features = [f for group in results for f in group]
        cache.write(self.id, cache_key, {"features": features})

        mml_note = "" if api_key else " (MML skipped — no API key)"
        status = "ok" if features else "partial"
        reason = f"{len(features)} scored zones{mml_note}"
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(source=self.id, status=status, reason=reason,
                           bbox=bbox.as_list(), t=t),
        )
