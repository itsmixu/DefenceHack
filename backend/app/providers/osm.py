"""OpenStreetMap provider via Overpass API.

Returns nodes/ways matching IPB-relevant tags inside the bbox.
Categories:
  hospital, clinic, pharmacy               — medical infrastructure
  fuel, charging_station, power_plant,
  power_substation                         — energy & logistics
  police, fire_station, shelter            — emergency services
  airfield, helipad                        — aviation assets
  railway, railway_bridge                  — logistics chokepoints
  waterway, ford                           — mobility obstacles / crossings

No API key required. Tile servers should not be queried from the backend
— Overpass is the right tool for tagged features.
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

CATEGORIES: tuple[tuple[str, str], ...] = (
    # Medical
    ("hospital",         '["amenity"="hospital"]'),
    ("clinic",           '["amenity"="clinic"]'),
    ("pharmacy",         '["amenity"="pharmacy"]'),
    # Energy & logistics
    ("fuel",             '["amenity"="fuel"]'),
    ("charging_station", '["amenity"="charging_station"]'),
    ("power_plant",      '["power"="plant"]'),
    ("power_substation", '["power"="substation"]'),
    # Emergency services
    ("police",           '["amenity"="police"]'),
    ("fire_station",     '["amenity"="fire_station"]'),
    ("shelter",          '["amenity"="shelter"]'),
    # Aviation
    ("airfield",         '["aeroway"="aerodrome"]'),
    ("helipad",          '["aeroway"="helipad"]'),
    # Rail logistics
    ("railway",          '["railway"="rail"]["bridge"!="yes"]'),
    ("railway_bridge",   '["railway"="rail"]["bridge"="yes"]'),
    # Waterway crossings and obstacles
    ("waterway",         '["waterway"~"^(river|stream|canal)$"]'),
    ("ford",             '["ford"="yes"]'),
)


def _build_query(bbox: BBox) -> str:
    bb = f"{bbox.min_lat},{bbox.min_lon},{bbox.max_lat},{bbox.max_lon}"
    parts: list[str] = []
    for _, sel in CATEGORIES:
        parts.append(f"nwr{sel}({bb});")
    body = "".join(parts)
    return f"[out:json][timeout:30];({body});out center tags;"


def _category_for(tags: dict[str, str]) -> str | None:
    amenity  = tags.get("amenity", "")
    power    = tags.get("power", "")
    aeroway  = tags.get("aeroway", "")
    railway  = tags.get("railway", "")
    waterway = tags.get("waterway", "")
    bridge   = tags.get("bridge", "")
    ford     = tags.get("ford", "")

    if amenity == "hospital":           return "hospital"
    if amenity == "clinic":             return "clinic"
    if amenity == "pharmacy":           return "pharmacy"
    if amenity == "fuel":               return "fuel"
    if amenity == "charging_station":   return "charging_station"
    if amenity == "police":             return "police"
    if amenity == "fire_station":       return "fire_station"
    if amenity == "shelter":            return "shelter"
    if power == "plant":                return "power_plant"
    if power == "substation":           return "power_substation"
    if aeroway == "aerodrome":          return "airfield"
    if aeroway == "helipad":            return "helipad"
    if railway == "rail" and bridge == "yes": return "railway_bridge"
    if railway == "rail":               return "railway"
    if ford == "yes":                   return "ford"
    if waterway in ("river", "stream", "canal"): return "waterway"
    return None


def _extra_props(tags: dict[str, str], category: str) -> dict[str, Any]:
    """Pull category-specific useful tags into flat properties."""
    extra: dict[str, Any] = {}
    if category == "hospital":
        extra["beds"] = tags.get("beds")
        extra["emergency"] = tags.get("emergency")
    elif category == "clinic":
        extra["healthcare"] = tags.get("healthcare")
        extra["emergency"] = tags.get("emergency")
    elif category == "pharmacy":
        extra["dispensing"] = tags.get("dispensing")
    elif category == "airfield":
        extra["icao"] = tags.get("icao")
        extra["iata"] = tags.get("iata")
        extra["runway_length_m"] = tags.get("aeroway:runway:length")
        extra["surface"] = tags.get("surface")
    elif category in ("railway", "railway_bridge"):
        extra["electrified"] = tags.get("electrified")
        extra["gauge_mm"] = tags.get("gauge")
        extra["max_speed"] = tags.get("maxspeed")
        extra["load_limit_t"] = tags.get("load_limit")
    elif category == "waterway":
        extra["width_m"] = tags.get("width")
        extra["depth_m"] = tags.get("depth")
        extra["boat"] = tags.get("boat")
    elif category == "ford":
        extra["surface"] = tags.get("surface")
        extra["maxdepth_m"] = tags.get("maxdepth")
    return {k: v for k, v in extra.items() if v is not None}


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
            **_extra_props(tags, category),
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
            return FeatureCollection(
                features=cached.get("features", []),
                meta=LayerMeta(
                    source=self.id, status="ok", reason="served from cache",
                    bbox=bbox.as_list(), t=t,
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
                self.id, status="unavailable", reason=f"overpass error: {e}",
                bbox=bbox.as_list(), t=t,
            )

        elements = payload.get("elements", [])
        features = [f for f in (_element_to_feature(e) for e in elements) if f]
        by_cat: dict[str, int] = {}
        for f in features:
            cat = f["properties"]["category"]
            by_cat[cat] = by_cat.get(cat, 0) + 1

        cache.write(self.id, cache_key, {"features": features})
        status = "ok" if features else "partial"
        reason = (
            ", ".join(f"{v} {k}" for k, v in sorted(by_cat.items()))
            if features else "no features in bbox"
        )
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
            ),
        )
