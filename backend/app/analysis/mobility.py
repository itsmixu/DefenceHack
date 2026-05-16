"""Force mobility analysis — speed surface by vehicle class.

WHY THIS EXISTS:
MCOO classifies terrain as go / slow-go / no-go.  That's a binary
tactical picture.  The mobility analysis translates those classes into
*quantified planning speeds* (km/h) per vehicle class using ATP 2-41.1
Appendix B Tables B-7/B-8, so planners can estimate time-distance and
compare route options.

A tank and a wheeled APC both see the same MCOO colour, but:
  Tank in swamp (slow-go):   8 km/h → easily ambushed, avoid
  APC  in swamp (slow-go):  12 km/h → better but still restricted
  Foot in swamp (slow-go):   1.6 km/h → extremely slow

Bridge passability (Table B-16 width + recorded Digiroad load capacity)
adds another vehicle-specific filter:  a 60-tonne weight-limit bridge is
a "go" for wheeled APCs (26 t) but "no-go" for tanks (68 t).

SYKE flood polygons override terrain classification to "no-go"
regardless of the MML terrain type beneath them (flooded = impassable).

OUTPUT (GeoJSON FeatureCollection):
Each feature from MML terrain + Digiroad roads + SYKE flood zones carries:
  speed_kmh            — planning speed for the requested vehicle class
  passable             — false only for bridges below vehicle weight limit
  mcoo_class           — go / slow-go / no-go
  vehicle_class        — as requested
  limiting_factor      — human-readable reason for any restriction
  cite                 — ATP 2-41.1 Appendix B table reference
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from .. import doctrine
from ..bbox import BBox
from ..registry import PROVIDERS
from ..schemas import FeatureCollection, LayerMeta

VALID_VEHICLE_CLASSES = frozenset(doctrine.VEHICLE_CLASSES)


def _iter_lonlat(coords: Any):
    if isinstance(coords, (list, tuple)):
        if len(coords) == 2 and all(isinstance(v, (int, float)) for v in coords):
            yield float(coords[0]), float(coords[1])
            return
        for item in coords:
            yield from _iter_lonlat(item)


def _geometry_bbox(geometry: Any) -> tuple[float, float, float, float] | None:
    if not isinstance(geometry, dict):
        return None
    coords = geometry.get("coordinates")
    if coords is None:
        return None
    pts = list(_iter_lonlat(coords))
    if not pts:
        return None
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    return (min(lons), min(lats), max(lons), max(lats))


def _bbox_intersects(a: tuple[float, float, float, float],
                     b: tuple[float, float, float, float]) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


async def build_mobility(
    bbox: BBox, t: datetime | None, vehicle_class: str
) -> FeatureCollection:
    if vehicle_class not in VALID_VEHICLE_CLASSES:
        vehicle_class = "wheeled"

    vehicle_profile = doctrine.VEHICLE_CLASSES[vehicle_class]
    sources = ["mml", "digiroad", "syke", "exposure"]
    results = await asyncio.gather(
        *[PROVIDERS[s].fetch(bbox, t) for s in sources if s in PROVIDERS],
        return_exceptions=True,
    )
    by_source: dict[str, list[dict[str, Any]]] = {}
    source_status: dict[str, str] = {}
    for src, res in zip(sources, results):
        if isinstance(res, Exception):
            source_status[src] = "error"
            by_source[src] = []
        else:
            source_status[src] = res.meta.status
            by_source[src] = res.features

    flood_features = [
        f for f in by_source.get("syke", [])
        if (f.get("properties") or {}).get("category") == "flood_risk"
    ]
    flood_bboxes = [
        fb for fb in (_geometry_bbox(f.get("geometry")) for f in flood_features)
        if fb is not None
    ]

    features: list[dict[str, Any]] = []

    # ── Terrain polygons (MML) ───────────────────────────────────────────────
    for f in by_source.get("mml", []):
        props = f.get("properties") or {}
        terrain = props.get("terrain_type")
        classification = doctrine.classify_terrain(terrain)
        mcoo_class = classification["class"]

        terrain_bbox = _geometry_bbox(f.get("geometry"))
        in_flood_zone = (
            terrain_bbox is not None
            and any(_bbox_intersects(terrain_bbox, fb) for fb in flood_bboxes)
        )

        if in_flood_zone and mcoo_class != "no-go":
            mcoo_class = "no-go"
            classification = {
                "class": "no-go",
                "cite": "SYKE/HQ100",
                "reason": "flood-risk overlap (SYKE HQ100) — impassable",
            }

        speed = doctrine.speed_for_class(vehicle_class, mcoo_class, is_road=False)
        features.append({
            **f,
            "properties": {
                **props,
                "vehicle_class": vehicle_class,
                "vehicle_label": vehicle_profile["label"],
                "mcoo_class": mcoo_class,
                "speed_kmh": speed,
                "passable": speed > 0,
                "limiting_factor": (
                    classification["reason"]
                    if speed == 0 else
                    f"{classification['reason']} → {speed:.0f} km/h"
                ),
                "cite": classification["cite"],
                "doctrine": "ATP 2-41.1 Appendix B",
            },
        })

    # ── Road segments (Digiroad) ─────────────────────────────────────────────
    for f in by_source.get("digiroad", []):
        props = f.get("properties") or {}
        is_bridge = bool(props.get("is_bridge"))
        load_cap_raw = props.get("load_capacity_tonnes")
        try:
            load_cap = float(load_cap_raw) if load_cap_raw is not None else None
        except (TypeError, ValueError):
            load_cap = None
        func_class = props.get("functional_class") or props.get("TOIMINNALLINEN_LUOKKA")

        road_info = doctrine.classify_road(func_class, is_bridge)
        passable = doctrine.bridge_passable(vehicle_class, load_cap) if is_bridge else True

        if not passable:
            speed = 0.0
            mcoo_class = "no-go"
            limiting = (
                f"bridge load limit {load_cap:.0f} t < vehicle weight "
                f"{vehicle_profile['max_load_tonnes']:.0f} t (B-16)"
            )
        else:
            speed = doctrine.speed_for_class(vehicle_class, "go", is_road=True)
            mcoo_class = "go"
            limiting = road_info["reason"]

        features.append({
            **f,
            "properties": {
                **props,
                "vehicle_class": vehicle_class,
                "vehicle_label": vehicle_profile["label"],
                "mcoo_class": mcoo_class,
                "mcoo_role": road_info.get("role", "mobility_corridor"),
                "speed_kmh": speed,
                "passable": passable,
                "limiting_factor": limiting,
                "cite": road_info["cite"],
                "doctrine": "ATP 2-41.1 Appendix B",
            },
        })

    # ── SYKE flood zones as explicit no-go overlays ──────────────────────────
    for f in flood_features:
        props = f.get("properties") or {}
        features.append({
            **f,
            "properties": {
                **props,
                "vehicle_class": vehicle_class,
                "vehicle_label": vehicle_profile["label"],
                "mcoo_class": "no-go",
                "speed_kmh": 0.0,
                "passable": False,
                "limiting_factor": "flood risk zone (SYKE HQ100) — impassable",
                "cite": "SYKE paikkatieto",
                "doctrine": "ATP 2-41.1 Appendix B",
            },
        })

    status = "ok" if features else "partial"
    reason = (
        f"{len(features)} features, vehicle class '{vehicle_class}' "
        f"({vehicle_profile['label']}), "
        f"road speed {vehicle_profile['road_day']:.0f} km/h / "
        f"cross-country go {vehicle_profile['cross_unrestricted']:.0f} km/h"
    )
    return FeatureCollection(
        features=features,
        meta=LayerMeta(
            source="mobility",
            status=status,
            reason=reason,
            bbox=bbox.as_list(),
            t=t,
            attribution=(
                f"Vehicle speeds from ATP 2-41.1 Appendix B — {vehicle_profile['label']}"
            ),
        ),
    )
