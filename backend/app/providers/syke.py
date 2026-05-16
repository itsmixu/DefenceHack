"""SYKE — Finnish Environment Institute spatial hazard layers.

WHY THIS EXISTS:
The Finnish Environment Institute (SYKE) publishes authoritative open
GIS data for:
  • Flood risk zones (tulvariskialueet) — areas inundated in 1:100 and
    1:1000 year events; tactically these are seasonal no-go areas along
    river corridors and in low-lying coastal zones.
  • Significant flood risk areas (merkittävät tulvariskialueet) — SYKE's
    official list of 22 priority areas with highest flood impact.
  • Protected areas / Natura 2000 — movement through these is legally
    restricted and may attract political/environmental sensitivity.

These layers complement MML terrain polygons (which give soil type but
not flood risk) and Digiroad (which gives roads but not inundation risk).

DATA SOURCE:
SYKE WFS endpoint: https://paikkatieto.ymparisto.fi/geoserver/ows
Service: WFS 2.0.0 — open access, no API key required.

Layer names used:
  syke:tulvariskialueet_2022_2027   — flood risk polygons (HQ100 band)
  syke:n2000                        — Natura 2000 protected areas

If SYKE's WFS changes naming (it has in the past), both layers fail
gracefully and return empty collections with status "unavailable".
"""
from __future__ import annotations

from datetime import datetime
import os
from typing import Any

import httpx

from .. import cache
from ..bbox import BBox
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # 1 week — flood zones change rarely

# (endpoint_url, type_name, category, mcoo_implication)
LAYERS: tuple[tuple[str, str, str, str], ...] = (
    (
        os.getenv("SYKE_FLOOD_WFS_URL") or "https://paikkatiedot.ymparisto.fi/geoserver/inspire_nz/wfs",
        os.getenv("SYKE_FLOOD_TYPENAME") or "inspire_nz:NZ.Tulvavaaravyohykkeet_Vesistotulva_1_100a",
        "flood_risk",
        "no-go",    # flooded in HQ100 event — impassable to ground forces
    ),
    (
        os.getenv("SYKE_PROTECTED_WFS_URL") or "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs",
        os.getenv("SYKE_PROTECTED_TYPENAME") or "inspire_ps:PS.ProtectedSitesSpecialAreaOfConservation",
        "protected_area",
        "slow-go",  # legally restricted movement, not physically impassable
    ),
)

NS_WFS = {
    "wfs": "http://www.opengis.net/wfs/2.0",
    "gml": "http://www.opengis.net/gml/3.2",
    "syke": "http://www.ymparisto.fi/syke",
}


def _wfs_params(type_name: str, bbox: BBox) -> dict[str, str]:
    return {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": type_name,
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "count": "500",
        "bbox": f"{bbox.min_lon},{bbox.min_lat},{bbox.max_lon},{bbox.max_lat},EPSG:4326",
    }


def _features_from_geojson(payload: dict, category: str, mcoo: str) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    for raw in payload.get("features", []):
        geom = raw.get("geometry")
        props = raw.get("properties") or {}
        if geom is None:
            continue
        features.append({
            "type": "Feature",
            "id": raw.get("id"),
            "geometry": geom,
            "properties": {
                "source": "syke",
                "category": category,
                "mcoo_implication": mcoo,
                "name": props.get("nimi") or props.get("name") or props.get("sitename"),
                "area_type": props.get("tyyppi") or props.get("type"),
                "hazard_return_period": "HQ100" if category == "flood_risk" else None,
                "cite": "SYKE open data — paikkatieto.ymparisto.fi",
            },
        })
    return features


class SYKEProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="syke", label="SYKE — flood risk & protected areas")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        cache_key = {
            "bbox": bbox.as_list(),
            "layers": [
                {"url": url, "type": type_name, "category": category}
                for url, type_name, category, _ in LAYERS
            ],
        }
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

        all_features: list[dict[str, Any]] = []
        errors: list[str] = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            for endpoint_url, type_name, category, mcoo in LAYERS:
                try:
                    resp = await client.get(
                        endpoint_url,
                        params=_wfs_params(type_name, bbox),
                        headers={"User-Agent": "DefenceHack-IPB/0.1"},
                    )
                    resp.raise_for_status()
                    payload = resp.json()
                    feats = _features_from_geojson(payload, category, mcoo)
                    all_features.extend(feats)
                except httpx.HTTPError as exc:
                    errors.append(f"{category}: {exc}")
                except (ValueError, KeyError) as exc:
                    errors.append(f"{category}: parse error {exc}")

        if not all_features and errors:
            self.mark("unavailable", "; ".join(errors))
            return empty_collection(
                self.id, status="unavailable",
                reason="; ".join(errors),
                bbox=bbox.as_list(), t=t,
            )

        cache.write(self.id, cache_key, {"features": all_features})
        by_cat = {c: sum(1 for f in all_features if f["properties"]["category"] == c)
                  for _, _, c, _ in LAYERS}
        status = "ok" if all_features else "partial"
        reason = ", ".join(f"{v} {k}" for k, v in by_cat.items() if v) or "no features in bbox"
        if errors:
            reason += f" (partial — {'; '.join(errors)})"
            status = "partial"
        self.mark(status, reason)
        return FeatureCollection(
            features=all_features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
                attribution="SYKE open data — Finnish Environment Institute",
            ),
        )
