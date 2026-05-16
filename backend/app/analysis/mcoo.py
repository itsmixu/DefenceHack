"""MCOO — Modified Combined Obstacle Overlay.

WHY THIS EXISTS:
Per US Army / NATO IPB doctrine, the MCOO is "the primary output product
and foundation of the entire terrain analysis workflow" — the synthesised
overlay that fuses all KOCOA factors into a single classified map.

This module composes layers we already produce (MML terrain, OSM landuse
via exposure, Digiroad mobility) into a unified GeoJSON FeatureCollection
where every feature carries an `mcoo_class`:

  go        — unrestricted; trafficable for mounted forces
  slow-go   — restricted; cover/concealment present, mobility reduced
  no-go     — severely restricted; impassable to mounted, marginal foot

This is the single layer Miko should render as the headline tactical
overlay. Frontend styling: green = go, yellow = slow-go, red = no-go.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from ..bbox import BBox
from ..registry import PROVIDERS
from ..schemas import FeatureCollection, LayerMeta

# Doctrinal classification by source terrain type. Maps every feature we
# might emit to one of the three MCOO classes.
MCOO_BY_TERRAIN: dict[str, str] = {
    # MML
    "Suo":            "slow-go",   # swamp — passable on foot, restricted vehicles
    "Jarvi":          "no-go",
    "Virtavesialue":  "no-go",
    "Meriaalue":      "no-go",
    "KallioAlue":     "slow-go",
    "HiekkaSoraAlue": "slow-go",
    # OSM
    "forest":         "slow-go",
    "wood":           "slow-go",
    "scrub":          "slow-go",
    "wetland":        "slow-go",
    "farmland":       "go",
    "meadow":         "go",
    "grass":          "go",
    "grassland":      "go",
    "residential":    "slow-go",
    "commercial":     "slow-go",
    "industrial":     "slow-go",
    "retail":         "slow-go",
    "military":       "slow-go",
    "beach":          "slow-go",
    "sand":           "slow-go",
    "cliff":          "no-go",
    "building":       "no-go",
}


def _classify(props: dict) -> str:
    terrain = props.get("terrain_type") or props.get("category") or ""
    return MCOO_BY_TERRAIN.get(terrain, "go")


async def build_mcoo(bbox: BBox, t: datetime | None) -> FeatureCollection:
    """Fetch terrain + mobility sources in parallel and synthesize MCOO."""
    sources = ["exposure", "mml", "digiroad"]
    results = await asyncio.gather(
        *[PROVIDERS[s].fetch(bbox, t) for s in sources if s in PROVIDERS],
        return_exceptions=True,
    )

    features: list[dict[str, Any]] = []
    source_status: dict[str, str] = {}

    for src, result in zip(sources, results):
        if isinstance(result, Exception):
            source_status[src] = "error"
            continue
        source_status[src] = result.meta.status
        for f in result.features:
            props = f.get("properties") or {}
            # Roads are always "go" corridors regardless of underlying terrain.
            if props.get("source") == "digiroad":
                mcoo_class = "go"
                role = "mobility_corridor"
                # Bridges are critical chokepoints.
                if props.get("is_bridge"):
                    role = "chokepoint_bridge"
            else:
                mcoo_class = _classify(props)
                role = "terrain"
            features.append({
                **f,
                "properties": {
                    **props,
                    "mcoo_class": mcoo_class,
                    "mcoo_role": role,
                },
            })

    status = "ok" if features else "partial"
    reason = (
        f"{len(features)} features synthesized from {', '.join(source_status)}"
        if features else "no MCOO features available for bbox"
    )
    return FeatureCollection(
        features=features,
        meta=LayerMeta(
            source="mcoo", status=status, reason=reason,
            bbox=bbox.as_list(), t=t,
        ),
    )
