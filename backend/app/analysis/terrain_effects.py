"""Terrain Effects Matrix — structured tactical assessment.

WHY THIS EXISTS:
Per IPB doctrine the Terrain Effects Matrix is a "tabular output of how
terrain affects each warfighting function" (maneuver, fires, intelligence,
sustainment, protection). It's the doctrinal companion to the MCOO and
the headline AI hook flagged in the 61N source material.

Every rating in this matrix is grounded in ATP 2-41.1 (2021)
Appendix B — "Hard numerical thresholds for AI model training." The
specific table that justified each rating is returned alongside the
rating itself so the frontend can show "Rating ← Table B-8" next to the
colour and judges can audit the model's reasoning.

Unlike layer endpoints this returns structured JSON, not GeoJSON. The
frontend renders it as a side-panel matrix or briefing card.

OUTPUT SHAPE:
{
  "bbox":   [...],
  "summary": "overall one-line tactical read",
  "doctrine": "ATP 2-41.1 Appendix B",
  "functions": {
    "maneuver":     { "rating": "restricted", "cite": "B-2/B-8",
                      "rationale": "...", "key_factors": [...] },
    "fires":        { ... },
    "intelligence": { ... },
    "sustainment":  { ... },
    "protection":   { ... }
  },
  "source_status": { "mml": "ok", "digiroad": "unavailable", ... },
  "mobility": { "total_length_km": ..., "weighted_mech_speed_kmh": ...,
                "total_capacity_vph": ..., "bridge_count": ... }
}

The five functions follow the US Army warfighting functions doctrine
(ADP 3-0) that the 61N material aligns with.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from .. import doctrine
from ..bbox import BBox
from ..registry import PROVIDERS


async def build_terrain_effects(bbox: BBox, t: datetime | None) -> dict[str, Any]:
    sources = ["mml", "digiroad", "osm", "fmi", "exposure", "opencellid", "starlink"]
    results = await asyncio.gather(
        *[PROVIDERS[s].fetch(bbox, t) for s in sources if s in PROVIDERS],
        return_exceptions=True,
    )
    by_source: dict[str, list[dict[str, Any]]] = {}
    status: dict[str, str] = {}
    for src, res in zip(sources, results):
        if isinstance(res, Exception):
            status[src] = "error"
            by_source[src] = []
        else:
            status[src] = res.meta.status
            by_source[src] = res.features

    # ── Aggregate terrain composition from MML using Appendix B-2 mapping ──
    mml = by_source.get("mml", [])
    terrain_counts: dict[str, int] = {}
    no_go = slow_go = go = 0
    for f in mml:
        tt = (f.get("properties") or {}).get("terrain_type")
        if not tt:
            continue
        terrain_counts[tt] = terrain_counts.get(tt, 0) + 1
        klass = doctrine.classify_terrain(tt)["class"]
        if klass == "no-go":
            no_go += 1
        elif klass == "slow-go":
            slow_go += 1
        else:
            go += 1
    total_terrain = no_go + slow_go + go or 1
    no_go_pct = 100 * no_go / total_terrain
    slow_go_pct = 100 * slow_go / total_terrain

    # ── Mobility — weighted by Digiroad link lengths + Table B-8 speeds ────
    roads = by_source.get("digiroad", [])
    mobility = doctrine.weighted_mobility(roads)

    # ── Infrastructure for sustainment from OSM ────────────────────────────
    osm = by_source.get("osm", [])
    infra: dict[str, int] = {}
    for f in osm:
        cat = (f.get("properties") or {}).get("category")
        if cat:
            infra[cat] = infra.get(cat, 0) + 1

    # ── Weather aggregates for fires / aviation (Table B-12) ───────────────
    fmi = by_source.get("fmi", [])
    temps: list[float] = []
    winds: list[float] = []
    for f in fmi:
        m = (f.get("properties") or {}).get("measurements") or {}
        if m.get("temperature") is not None:
            temps.append(float(m["temperature"]))
        if m.get("windspeedms") is not None:
            winds.append(float(m["windspeedms"]))
    avg_temp = sum(temps) / len(temps) if temps else None
    avg_wind = sum(winds) / len(winds) if winds else None

    # ── Exposure spread for protection (no Appendix B equivalent — local) ─
    exposure = by_source.get("exposure", [])
    danger_levels = [(f.get("properties") or {}).get("danger_level", 3) for f in exposure]
    avg_danger = sum(danger_levels) / len(danger_levels) if danger_levels else None

    # ── Compute doctrinal ratings ──────────────────────────────────────────
    maneuver_rating, maneuver_reason = doctrine.rate_maneuver(no_go_pct, slow_go_pct)
    env_rating, env_reason = doctrine.rate_environment(avg_temp, avg_wind)
    avn_rating, avn_reason = doctrine.rate_aviation(avg_wind)

    # Fires rating combines weather (B-12 wind cap on artillery) and exposure.
    if avg_wind is not None and avg_wind >= doctrine.ENV_LIMITS["ground_wind_ms_max"]:
        fires_rating = "severely_restricted"
        fires_reason = (
            f"wind {avg_wind:.0f} m/s ≥ {doctrine.ENV_LIMITS['ground_wind_ms_max']} m/s — "
            "indirect-fire accuracy degraded (B-12)"
        )
    elif avg_danger is not None:
        if avg_danger >= 4:
            fires_rating = "unrestricted"
            fires_reason = f"avg exposure {avg_danger:.1f}/5 — open fields of fire"
        elif avg_danger <= 2:
            fires_rating = "restricted"
            fires_reason = f"avg exposure {avg_danger:.1f}/5 — dense cover masks fires"
        else:
            fires_rating = "restricted"
            fires_reason = f"avg exposure {avg_danger:.1f}/5 — mixed cover"
    else:
        fires_rating = "unknown"
        fires_reason = "no weather or exposure data"

    # Intelligence rating uses Appendix B-10/B-11 ID-range bands: open
    # terrain (low danger_level) gives long detection ranges; forest cover
    # collapses ID range to the inner band.
    if avg_danger is not None:
        if avg_danger >= 4:
            intel_rating = "unrestricted"
            intel_id_band = "naked-eye vehicle detect ~1.5 km (B-10)"
        elif avg_danger >= 3:
            intel_rating = "restricted"
            intel_id_band = "binocular vehicle detect ~6 km (B-10) but partial concealment"
        else:
            intel_rating = "restricted"
            intel_id_band = "≥ 75% canopy collapses ID range to thermal-band ~2.5 km (B-3/B-11)"
    else:
        intel_rating = "unrestricted" if osm or terrain_counts else "restricted"
        intel_id_band = "exposure data unavailable — ID ranges not estimable"

    # Sustainment — infrastructure presence + road network capacity (B-17).
    key_infra = infra.get("hospital", 0) + infra.get("fuel", 0)
    if key_infra > 0 and mobility["total_capacity_vph"] >= 600:
        sustainment_rating = "unrestricted"
    elif key_infra > 0 or mobility["total_capacity_vph"] >= 600:
        sustainment_rating = "restricted"
    else:
        sustainment_rating = "restricted" if (osm or roads) else "severely_restricted"

    # Protection rating — cover from terrain + exposure.
    if avg_danger is not None:
        if avg_danger <= 2:
            protection_rating = "unrestricted"
            protection_reason = (
                f"avg cover {avg_danger:.1f}/5 — dense vegetation/structures provide "
                "concealment per B-3 (≥ 75% canopy = full concealment)"
            )
        elif avg_danger <= 3.5:
            protection_rating = "restricted"
            protection_reason = (
                f"avg cover {avg_danger:.1f}/5 — partial concealment band per B-3 (25–75%)"
            )
        else:
            protection_rating = "severely_restricted"
            protection_reason = (
                f"avg cover {avg_danger:.1f}/5 — open terrain, < 25% canopy (B-3)"
            )
    else:
        protection_rating = "unknown"
        protection_reason = "exposure scoring unavailable"

    weather_summary = ""
    if avg_temp is not None and avg_wind is not None:
        weather_summary = (
            f"avg temp {avg_temp:.1f}°C, avg wind {avg_wind:.1f} m/s "
            f"across {len(fmi)} stations"
        )

    matrix: dict[str, dict[str, Any]] = {
        "maneuver": {
            "rating": maneuver_rating,
            "cite": "B-2 / B-8",
            "rationale": maneuver_reason if total_terrain > 1 else "insufficient terrain data",
            "key_factors": [
                f"{mobility['total_length_km']} km road network, weighted mech speed "
                f"{mobility['weighted_mech_speed_kmh']} km/h (B-8 road_day = 40 km/h)",
                f"{mobility['bridge_count']} bridge chokepoint(s)"
                if mobility['bridge_count']
                else "no bridges identified",
                f"network capacity {mobility['total_capacity_vph']} vph (B-17)"
                if mobility['total_capacity_vph']
                else "no road network in bbox",
            ],
        },
        "fires": {
            "rating": fires_rating,
            "cite": "B-12 (weather) / local exposure",
            "rationale": fires_reason,
            "key_factors": [
                weather_summary or "weather data unavailable",
                f"aviation: {avn_rating.replace('_', ' ')} — {avn_reason}",
            ],
        },
        "intelligence": {
            "rating": intel_rating,
            "cite": "B-10 / B-11 / B-3",
            "rationale": intel_id_band,
            "key_factors": [
                f"comms: {len(by_source.get('opencellid', []))} cell feature(s) — "
                "B-2 cyber/physical infra overlay",
                f"weather stations: {len(fmi)}",
                f"horizon at 2 m observer = "
                f"{doctrine.horizon_range_km(2.0):.1f} km (B-1)",
            ],
        },
        "sustainment": {
            "rating": sustainment_rating,
            "cite": "B-17",
            "rationale": (
                f"{infra.get('hospital', 0)} hospital(s), "
                f"{infra.get('fuel', 0)} fuel station(s), "
                f"{infra.get('power_plant', 0) + infra.get('power_substation', 0)} "
                f"power site(s); road net {mobility['total_capacity_vph']} vph capacity"
            ),
            "key_factors": [
                f"{mobility['total_length_km']} km of road across "
                f"{sum(mobility['by_flow_class'].values())} link(s)",
                f"flow mix: {mobility['by_flow_class']}",
            ],
        },
        "protection": {
            "rating": protection_rating,
            "cite": "B-3 / B-4",
            "rationale": protection_reason,
            "key_factors": [
                f"environment: {env_rating.replace('_', ' ')} — {env_reason}",
                f"starlink overhead: {len(by_source.get('starlink', []))}"
                if by_source.get("starlink") else "no satellite-overhead data",
            ],
        },
    }

    one_liner = (
        f"Maneuver {maneuver_rating.replace('_', ' ')} · "
        f"fires {fires_rating.replace('_', ' ')} · "
        f"protection {protection_rating.replace('_', ' ')} · "
        f"{mobility['bridge_count']} bridge chokepoint(s) · "
        f"{key_infra} key facility(ies)."
    )

    return {
        "bbox": bbox.as_list(),
        "t": t.isoformat() if t else None,
        "doctrine": "ATP 2-41.1 (2021) Appendix B",
        "summary": one_liner,
        "functions": matrix,
        "mobility": mobility,
        "terrain_composition": {
            "no_go_pct": round(no_go_pct, 1),
            "slow_go_pct": round(slow_go_pct, 1),
            "go_pct": round(100 - no_go_pct - slow_go_pct, 1),
            "total_polygons": total_terrain if total_terrain > 1 else 0,
        },
        "weather": {
            "avg_temp_c": round(avg_temp, 1) if avg_temp is not None else None,
            "avg_wind_ms": round(avg_wind, 1) if avg_wind is not None else None,
            "stations": len(fmi),
            "environment_rating": env_rating,
            "aviation_rating": avn_rating,
        },
        "source_status": status,
    }
