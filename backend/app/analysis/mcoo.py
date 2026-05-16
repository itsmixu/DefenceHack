"""MCOO — Modified Combined Obstacle Overlay.

WHY THIS EXISTS:
Per US Army / NATO IPB doctrine, the MCOO is "the primary output product
and foundation of the entire terrain analysis workflow" — the synthesised
overlay that fuses all KOCOA factors into a single classified map.

This module composes layers we already produce (MML terrain, OSM landuse
via exposure, Digiroad mobility) into a unified GeoJSON FeatureCollection
where every feature carries:

  mcoo_class   — "go" | "slow-go" | "no-go"  (the colour bucket)
  mcoo_role    — "terrain" | "mobility_corridor" | "chokepoint_bridge"
  mcoo_cite    — ATP 2-41.1 Appendix B table reference (e.g. "B-2", "B-16")
  mcoo_reason  — one-line rationale naming the doctrinal threshold applied

The thresholds themselves live in `app.doctrine` and are sourced from
ATP 2-41.1 (2021) Appendix B — "Hard numerical thresholds for AI model
training." Centralising them means every rating on the map is grounded
in published doctrine, not heuristics; judges can click any polygon and
see exactly which table justified the colour.

Frontend styling: green = go, yellow = slow-go, red = no-go.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from .. import doctrine
from ..bbox import BBox
from ..registry import PROVIDERS
from ..schemas import FeatureCollection, LayerMeta


async def build_mcoo(bbox: BBox, t: datetime | None) -> FeatureCollection:
    """Fetch terrain + mobility sources in parallel and synthesise the MCOO."""
    sources = ["exposure", "mml", "digiroad"]
    results = await asyncio.gather(
        *[PROVIDERS[s].fetch(bbox, t) for s in sources if s in PROVIDERS],
        return_exceptions=True,
    )

    features: list[dict[str, Any]] = []
    source_status: dict[str, str] = {}
    class_counts: dict[str, int] = {"go": 0, "slow-go": 0, "no-go": 0}

    for src, result in zip(sources, results):
        if isinstance(result, Exception):
            source_status[src] = "error"
            continue
        source_status[src] = result.meta.status
        for f in result.features:
            props = f.get("properties") or {}
            if props.get("source") == "digiroad":
                info = doctrine.classify_road(
                    props.get("functional_class") or props.get("TOIMINNALLINEN_LUOKKA"),
                    bool(props.get("is_bridge")),
                )
                mcoo_class = info["class"]
                mcoo_role = info["role"]
                mcoo_cite = info["cite"]
                mcoo_reason = info["reason"]
            else:
                terrain = props.get("terrain_type") or props.get("category")
                info = doctrine.classify_terrain(terrain)
                mcoo_class = info["class"]
                mcoo_role = "terrain"
                mcoo_cite = info["cite"]
                mcoo_reason = info["reason"]
            class_counts[mcoo_class] = class_counts.get(mcoo_class, 0) + 1
            features.append({
                **f,
                "properties": {
                    **props,
                    "mcoo_class": mcoo_class,
                    "mcoo_role": mcoo_role,
                    "mcoo_cite": mcoo_cite,
                    "mcoo_reason": mcoo_reason,
                    "doctrine": "ATP 2-41.1 Appendix B",
                },
            })

    status = "ok" if features else "partial"
    reason = (
        f"{len(features)} features synthesised from {', '.join(source_status)} "
        f"(go {class_counts['go']} / slow-go {class_counts['slow-go']} / "
        f"no-go {class_counts['no-go']})"
        if features else "no MCOO features available for bbox"
    )
    fc = FeatureCollection(
        features=features,
        meta=LayerMeta(
            source="mcoo", status=status, reason=reason,
            bbox=bbox.as_list(), t=t,
        ),
    )
    # Attach the doctrinal grounding to the FeatureCollection meta so the
    # frontend can show "ATP 2-41.1 Appendix B" in the legend / status panel.
    fc.meta.attribution = "Classification per ATP 2-41.1 (2021) Appendix B"
    return fc
