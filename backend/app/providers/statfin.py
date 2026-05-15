"""Statistics Finland Paavo provider — postal-area demographics as polygons.

Paavo (Postinumeroalueittainen avoin tieto) ships postal-area polygons with
population, age-cohort, employment and income statistics already attached.
Served by Statistics Finland's GeoServer as a WFS in EPSG:3067; we reproject
to EPSG:4326 before responding. No API key required.

Layer name carries the data year (e.g. `postialue:pno_tilasto_2024`). Override
with the STATFIN_PAAVO_LAYER env var if a newer release is available.
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

WFS_URL = "https://geo.stat.fi/geoserver/postialue/wfs"
DEFAULT_LAYER = "postialue:pno_tilasto_2024"
SRC_CRS = "EPSG:3067"
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # 1 week — demographics update yearly

# IPB-relevant Paavo attributes. Keep the payload tight; the frontend can
# request more if needed by extending this list. See:
# https://www.stat.fi/tup/paavo/paavon_aineistokuvaukset.html
PROPERTIES_KEEP: tuple[str, ...] = (
    "posti_alue",   # postal code
    "nimi",         # area name (Finnish)
    "namn",         # area name (Swedish)
    "kunta",        # municipality code
    "kunta_nimi",   # municipality name
    "pinta_ala",    # area, m²
    "he_vakiy",     # total population
    "he_miehet",    # men
    "he_naiset",    # women
    "he_kika",      # mean age
    "he_0_14",      # ages 0-14
    "he_15_64",     # ages 15-64 (military / working age)
    "he_65_",       # ages 65+
    "pt_tyolli",    # employed
    "pt_tyott",     # unemployed
    "tr_ktu",       # median income
    "ra_asunn",     # dwellings
)


def _trim_properties(props: dict) -> dict:
    out = {k: props.get(k) for k in PROPERTIES_KEEP if k in props}
    out["source"] = "statfin"
    return out


class StatFinProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="statfin", label="Statistics Finland — Paavo demographics")
        self.layer = os.getenv("STATFIN_PAAVO_LAYER", DEFAULT_LAYER)

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        # Paavo's BBOX filter must be in the layer's native CRS.
        src_bbox = reproject_bbox(
            (bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat),
            "EPSG:4326",
            SRC_CRS,
        )

        cache_key = {"bbox": bbox.as_list(), "layer": self.layer}
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
            "bbox": f"{src_bbox[0]},{src_bbox[1]},{src_bbox[2]},{src_bbox[3]},{SRC_CRS}",
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.get(
                    WFS_URL, params=params,
                    headers={"User-Agent": "DefenceHack-IPB/0.1"},
                )
                resp.raise_for_status()
                payload = resp.json()
        except httpx.HTTPError as e:
            self.mark("unavailable", f"Paavo WFS error: {e}")
            return empty_collection(
                self.id, status="unavailable", reason=f"Paavo WFS error: {e}",
                bbox=bbox.as_list(), t=t,
            )
        except ValueError as e:
            self.mark("unavailable", f"Paavo response not JSON: {e}")
            return empty_collection(
                self.id, status="unavailable",
                reason=f"Paavo response not JSON: {e}",
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

        cache.write(self.id, cache_key, {"features": features})
        status = "ok" if features else "partial"
        reason = f"{len(features)} postal areas" if features else "no postal areas in bbox"
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
            ),
        )
