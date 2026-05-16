"""OpenStreetMap provider via Overpass API.

Returns nodes/ways tagged as hospital, fuel station, or power infrastructure
inside the bbox. No API key required. Tile servers should not be queried from
the backend — Overpass is the right tool for tagged features.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from .. import cache
from ..bbox import BBox
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
CACHE_TTL_SECONDS = 24 * 60 * 60  # 1 day — OSM data changes slowly

# Categories relevant to IPB (challenge.md §"logistics chokepoints", "infrastructure").
# Tuple of (category, overpass selector).
CATEGORIES: tuple[tuple[str, str], ...] = (
    ("hospital", '["amenity"="hospital"]'),
    ("clinic", '["amenity"="clinic"]'),
    ("pharmacy", '["amenity"="pharmacy"]'),
    ("fuel", '["amenity"="fuel"]'),
    ("charging_station", '["amenity"="charging_station"]'),
    ("police", '["amenity"="police"]'),
    ("fire_station", '["amenity"="fire_station"]'),
    ("shelter", '["amenity"="shelter"]'),
    ("power_plant", '["power"="plant"]'),
    ("power_substation", '["power"="substation"]'),
)


def _build_query(bbox: BBox) -> str:
    bbox_str = f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}"
    parts: list[str] = []
    for _, sel in CATEGORIES:
        # nwr = node + way + relation, centered so ways return a representative point
        parts.append(f"nwr{sel}({bbox_str});")
    body = "".join(parts)
    return f"[out:json][timeout:25];({body});out center tags;"


def _category_for(tags: dict[str, str]) -> str | None:
    if tags.get("amenity") == "hospital":
        return "hospital"
    if tags.get("amenity") == "clinic":
        return "clinic"
    if tags.get("amenity") == "pharmacy":
        return "pharmacy"
    if tags.get("amenity") == "fuel":
        return "fuel"
    if tags.get("amenity") == "charging_station":
        return "charging_station"
    if tags.get("amenity") == "police":
        return "police"
    if tags.get("amenity") == "fire_station":
        return "fire_station"
    if tags.get("amenity") == "shelter":
        return "shelter"
    power = tags.get("power")
    if power == "plant":
        return "power_plant"
    if power == "substation":
        return "power_substation"
    return None


def _element_to_feature(elem: dict[str, Any]) -> dict[str, Any] | None:
    tags = elem.get("tags") or {}
    category = _category_for(tags)
    if category is None:
        return None
    if elem["type"] == "node":
        lon, lat = elem.get("lon"), elem.get("lat")
    else:
        center = elem.get("center") or {}
        lon, lat = center.get("lon"), center.get("lat")
    if lon is None or lat is None:
        return None
    return {
        "type": "Feature",
        "id": f"{elem['type']}/{elem['id']}",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "source": "osm",
            "category": category,
            "name": tags.get("name"),
            "operator": tags.get("operator"),
            "tags": tags,
        },
    }


class OSMProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="osm", label="OpenStreetMap — Overpass API")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        cache_key = {"bbox": bbox.as_list(), "categories": [c for c, _ in CATEGORIES]}

        cached = cache.read(self.id, cache_key, CACHE_TTL_SECONDS)
        if cached is not None:
            self.mark("ok", "served from cache")
            features = cached.get("features", [])
            return FeatureCollection(
                features=features,
                meta=LayerMeta(
                    source=self.id,
                    status="ok",
                    reason="served from cache",
                    bbox=bbox.as_list(),
                    t=t,
                ),
            )

        query = _build_query(bbox)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    OVERPASS_URL,
                    data={"data": query},
                    headers={"User-Agent": "DefenceHack-IPB/0.1"},
                )
                resp.raise_for_status()
                payload = resp.json()
        except httpx.HTTPError as e:
            self.mark("unavailable", f"overpass error: {e}")
            return empty_collection(
                self.id,
                status="unavailable",
                reason=f"overpass error: {e}",
                bbox=bbox.as_list(),
                t=t,
            )

        elements = payload.get("elements", [])
        features = [f for f in (_element_to_feature(e) for e in elements) if f]

        cache.write(self.id, cache_key, {"features": features})
        self.mark("ok", f"{len(features)} features")
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id,
                status="ok",
                bbox=bbox.as_list(),
                t=t,
            ),
        )
