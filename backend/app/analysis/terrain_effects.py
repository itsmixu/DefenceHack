"""Terrain Effects Matrix — structured tactical assessment.

WHY THIS EXISTS:
Per IPB doctrine the Terrain Effects Matrix is a "tabular output of how
terrain affects each warfighting function" (maneuver, fires, intelligence,
sustainment, protection). It's the doctrinal companion to the MCOO and a
direct AI hook flagged in the 61N source material.

Unlike layer endpoints this returns structured JSON, not GeoJSON. The
frontend renders it as a side-panel matrix or briefing card.

OUTPUT SHAPE:
{
  "bbox": [...],
  "summary": "overall one-line tactical read",
  "functions": {
    "maneuver":   { "rating": "restricted", "rationale": "...", "key_factors": [...] },
    "fires":      { ... },
    "intelligence": { ... },
    "sustainment":{ ... },
    "protection": { ... }
  },
  "source_status": { "mml": "ok", "digiroad": "unavailable", ... }
}

The five functions follow the US Army warfighting functions doctrine
(ADP 3-0) that the 61N material aligns with.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from ..bbox import BBox
from ..registry import PROVIDERS

# Coarse rating ladder used by every function — keeps frontend rendering simple.
RATINGS = ("unrestricted", "restricted", "severely_restricted")


def _rate(impassable_pct: float, restricted_pct: float) -> str:
    if impassable_pct >= 40:
        return "severely_restricted"
    if impassable_pct + restricted_pct >= 50:
        return "restricted"
    return "unrestricted"


async def build_terrain_effects(bbox: BBox, t: datetime | None) -> dict[str, Any]:
    sources = ["mml", "digiroad", "osm", "fmi", "exposure"]
    results = await asyncio.gather(
        *[PROVIDERS[s].fetch(bbox, t) for s in sources if s in PROVIDERS],
        return_exceptions=True,
    )
    by_source: dict[str, Any] = {}
    status: dict[str, str] = {}
    for src, res in zip(sources, results):
        if isinstance(res, Exception):
            status[src] = "error"
            by_source[src] = []
        else:
            status[src] = res.meta.status
            by_source[src] = res.features

    # ── Aggregate terrain composition from MML ─────────────────────────────
    mml = by_source.get("mml", [])
    terrain_counts: dict[str, int] = {}
    for f in mml:
        tt = (f.get("properties") or {}).get("terrain_type")
        if tt:
            terrain_counts[tt] = terrain_counts.get(tt, 0) + 1
    total_terrain = sum(terrain_counts.values()) or 1
    impassable = sum(terrain_counts.get(k, 0) for k in ("Jarvi", "Virtavesialue", "Meriaalue"))
    restricted = sum(terrain_counts.get(k, 0) for k in ("Suo", "KallioAlue", "HiekkaSoraAlue"))
    impassable_pct = 100 * impassable / total_terrain if total_terrain else 0
    restricted_pct = 100 * restricted / total_terrain if total_terrain else 0

    # ── Mobility corridors and chokepoints from Digiroad ───────────────────
    roads = by_source.get("digiroad", [])
    bridge_count = sum(1 for f in roads if (f.get("properties") or {}).get("is_bridge"))
    road_count = len(roads) - bridge_count

    # ── Infrastructure for sustainment from OSM ────────────────────────────
    osm = by_source.get("osm", [])
    infra: dict[str, int] = {}
    for f in osm:
        cat = (f.get("properties") or {}).get("category")
        if cat:
            infra[cat] = infra.get(cat, 0) + 1

    # ── Weather observations for fires / aviation ──────────────────────────
    fmi = by_source.get("fmi", [])
    weather_summary = ""
    if fmi:
        temps = [
            m.get("temperature")
            for f in fmi
            for m in [f.get("properties", {}).get("measurements", {})]
            if m.get("temperature") is not None
        ]
        winds = [
            m.get("windspeedms")
            for f in fmi
            for m in [f.get("properties", {}).get("measurements", {})]
            if m.get("windspeedms") is not None
        ]
        if temps and winds:
            weather_summary = (
                f"avg temp {sum(temps)/len(temps):.1f}°C, "
                f"avg wind {sum(winds)/len(winds):.1f} m/s "
                f"across {len(fmi)} stations"
            )

    # ── Exposure spread for protection ─────────────────────────────────────
    exposure = by_source.get("exposure", [])
    danger_levels = [(f.get("properties") or {}).get("danger_level", 3) for f in exposure]
    avg_danger = sum(danger_levels) / len(danger_levels) if danger_levels else None

    # ── Build the matrix ───────────────────────────────────────────────────
    maneuver_rating = _rate(impassable_pct, restricted_pct)
    matrix: dict[str, dict[str, Any]] = {
        "maneuver": {
            "rating": maneuver_rating,
            "rationale": (
                f"{impassable_pct:.0f}% impassable, {restricted_pct:.0f}% restricted "
                f"terrain across {total_terrain} polygons"
            ) if total_terrain > 1 else "insufficient terrain data",
            "key_factors": [
                f"{bridge_count} bridge chokepoint(s)" if bridge_count else "no bridges identified",
                f"{road_count} road segment(s)" if road_count else "no roads in bbox",
            ],
        },
        "fires": {
            "rating": (
                "restricted" if avg_danger and avg_danger >= 4
                else ("unrestricted" if avg_danger and avg_danger <= 2 else "restricted")
            ) if avg_danger is not None else "unknown",
            "rationale": (
                f"avg exposure score {avg_danger:.1f}/5 — "
                f"{'open fields of fire' if avg_danger and avg_danger >= 4 else 'concealment likely'}"
            ) if avg_danger is not None else "exposure data unavailable",
            "key_factors": [weather_summary] if weather_summary else ["weather data unavailable"],
        },
        "intelligence": {
            "rating": "unrestricted" if osm or terrain_counts else "restricted",
            "rationale": (
                f"{len(osm)} OSM POI(s), {total_terrain} terrain polygon(s), "
                f"{len(by_source.get('opencellid', []))} cell features"
            ),
            "key_factors": [
                f"comms: {len(by_source.get('opencellid', []))} cell features",
                f"weather stations: {len(fmi)}",
            ],
        },
        "sustainment": {
            "rating": "unrestricted" if (infra.get("hospital", 0) + infra.get("fuel", 0)) > 0
                      else "restricted",
            "rationale": (
                f"{infra.get('hospital', 0)} hospital(s), "
                f"{infra.get('fuel', 0)} fuel station(s), "
                f"{infra.get('power_plant', 0) + infra.get('power_substation', 0)} power site(s)"
            ),
            "key_factors": [f"road network: {road_count} link(s)"],
        },
        "protection": {
            "rating": (
                "unrestricted" if avg_danger and avg_danger <= 2
                else ("restricted" if avg_danger and avg_danger <= 3.5 else "severely_restricted")
            ) if avg_danger is not None else "unknown",
            "rationale": (
                f"avg cover score {avg_danger:.1f}/5 (lower = more cover); "
                f"{restricted}× swamp/bedrock providing partial cover"
            ) if avg_danger is not None else "exposure scoring unavailable",
            "key_factors": [
                f"satellites overhead: {len(by_source.get('n2yo', []))}"
                if by_source.get("n2yo") else "no satellite-overhead data",
            ],
        },
    }

    one_liner = (
        f"Terrain {maneuver_rating.replace('_', ' ')}, "
        f"{bridge_count} chokepoint(s), "
        f"{infra.get('hospital', 0) + infra.get('fuel', 0)} key facility(ies)."
    )

    return {
        "bbox": bbox.as_list(),
        "t": t.isoformat() if t else None,
        "summary": one_liner,
        "functions": matrix,
        "source_status": status,
    }
