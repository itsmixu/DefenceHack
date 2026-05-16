"""Digiroad provider — Finnish road network from Väylä.

Pulls road link LineStrings from Väylä's Digiroad WFS in EPSG:3067 and
reprojects to EPSG:4326. Endpoint and layer name are env-overridable
because Väylä occasionally renames the published layers; the default
points at the public Avoin API endpoint.

Keep the response bounded — country-wide queries would return millions
of links. The WFS `count` parameter caps each response.
"""
from __future__ import annotations

import os
from datetime import datetime

import httpx

from .. import cache
from ..bbox import BBox
from ..geo import reproject_bbox, reproject_geometry
from ..http_client import get_client
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

DEFAULT_WFS_URL = "https://avoinapi.vaylapilvi.fi/vaylatiedot/digiroad/ows"
DEFAULT_LAYER = "digiroad:dr_tielinkki_toim_lk"
SRC_CRS = "EPSG:3067"
MAX_FEATURES = 2000
CACHE_TTL_SECONDS = 24 * 60 * 60  # 1 day — road network changes slowly

# Common Digiroad link attributes worth surfacing for IPB. Anything not
# present in the response simply drops out of the trimmed dict.
PROPERTIES_KEEP: tuple[str, ...] = (
    "LINK_ID", "link_id",
    "TOIMINNALLINEN_LUOKKA", "functional_class",
    "LINKKITYYPPI", "link_type",
    "TIENIMI_SU", "TIENIMI_RU", "road_name",
    "TIENUMERO", "road_number",
    "AJOSUUNTA", "direction",
    "PITUUS", "length_m",
    "NOPEUSRAJOITUS", "speed_limit",
    "PAALLYSTETTY", "surface",
    "SILTA_ALIKULKU", "bridge_underpass",   # bridge / underpass flag
    "SUURIN_SALLITTU_MASSA", "load_capacity_t",  # max permitted mass in tonnes
    "LEVEYS", "width_m",                    # road / bridge width in metres
)


def _env_or_default(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    return value or default


def _trim_properties(props: dict) -> dict:
    out = {k: props[k] for k in PROPERTIES_KEEP if k in props}
    out["source"] = "digiroad"
    # Normalised bridge flag.
    bu = props.get("SILTA_ALIKULKU") or props.get("bridge_underpass")
    if bu is not None:
        out["is_bridge"] = str(bu).lower() in {"1", "silta", "bridge", "true"}
    # Bridge / road load capacity in tonnes — critical for tank/heavy vehicle routing.
    # Digiroad field SUURIN_SALLITTU_MASSA = "greatest permitted mass" in tonnes.
    mass = props.get("SUURIN_SALLITTU_MASSA") or props.get("load_capacity_t")
    if mass is not None:
        try:
            out["load_capacity_tonnes"] = float(mass)
        except (TypeError, ValueError):
            pass
    return out


class DigiroadProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="digiroad", label="Digiroad — Väylä road network")
        self.wfs_url = _env_or_default("DIGIROAD_WFS_URL", DEFAULT_WFS_URL)
        self.layer = _env_or_default("DIGIROAD_LAYER", DEFAULT_LAYER)

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        src_bbox = reproject_bbox(
            (bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat),
            "EPSG:4326",
            SRC_CRS,
        )

        cache_key = {"bbox": bbox.as_list(), "layer": self.layer, "url": self.wfs_url}
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

        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": self.layer,
            "outputFormat": "application/json",
            "srsName": SRC_CRS,
            "count": str(MAX_FEATURES),
            "bbox": f"{src_bbox[0]},{src_bbox[1]},{src_bbox[2]},{src_bbox[3]},{SRC_CRS}",
        }

        try:
            client = get_client()
            resp = await client.get(self.wfs_url, params=params, timeout=60.0)
            resp.raise_for_status()
            payload = resp.json()
        except httpx.HTTPError as e:
            self.mark("unavailable", f"Digiroad WFS error: {e}")
            return empty_collection(
                self.id, status="unavailable", reason=f"Digiroad WFS error: {e}",
                bbox=bbox.as_list(), t=t,
            )
        except ValueError as e:
            self.mark("unavailable", f"Digiroad response not JSON: {e}")
            return empty_collection(
                self.id, status="unavailable",
                reason=f"Digiroad response not JSON: {e}",
                bbox=bbox.as_list(), t=t,
            )

        features: list[dict] = []
        for raw in payload.get("features", []):
            geom = raw.get("geometry")
            if geom is None:
                continue
            features.append({
                "type": "Feature",
                "id": raw.get("id"),
                "geometry": reproject_geometry(geom, SRC_CRS),
                "properties": _trim_properties(raw.get("properties") or {}),
            })

        truncated = len(features) >= MAX_FEATURES
        cache.write(self.id, cache_key, {"features": features})
        status = "ok" if features else "partial"
        if truncated:
            reason = f"{len(features)} links (capped at {MAX_FEATURES}; zoom in for full detail)"
            status = "partial"
        elif features:
            reason = f"{len(features)} links"
        else:
            reason = "no links in bbox"
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
            ),
        )
