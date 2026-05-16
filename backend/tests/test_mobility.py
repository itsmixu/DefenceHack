"""Mobility analysis — pin vehicle speeds and bridge passability."""
from __future__ import annotations

import asyncio
from datetime import datetime

import pytest

from app import doctrine
from app.analysis import mobility as mob_module
from app.analysis.mobility import build_mobility
from app.bbox import BBox
from app.schemas import FeatureCollection, LayerMeta


class _Stub:
    def __init__(self, sid, feats):
        self.id = sid; self.feats = feats
    async def fetch(self, bbox, t):
        return FeatureCollection(features=self.feats,
            meta=LayerMeta(source=self.id, status="ok", reason="stub",
                           bbox=bbox.as_list(), t=t))


@pytest.fixture
def stubs(monkeypatch):
    providers = {
        "mml": _Stub("mml", [
            {"type": "Feature", "geometry": {}, "properties": {"terrain_type": "farmland"}},
            {"type": "Feature", "geometry": {}, "properties": {"terrain_type": "Suo"}},
            {"type": "Feature", "geometry": {}, "properties": {"terrain_type": "Jarvi"}},
        ]),
        "digiroad": _Stub("digiroad", [
            {"type": "Feature", "geometry": {}, "properties": {
                "source": "digiroad", "functional_class": 1, "is_bridge": False,
                "length_m": 1000, "load_capacity_tonnes": None}},
            {"type": "Feature", "geometry": {}, "properties": {
                "source": "digiroad", "functional_class": 3, "is_bridge": True,
                "length_m": 100, "load_capacity_tonnes": 60.0}},
        ]),
        "syke": _Stub("syke", []),
        "exposure": _Stub("exposure", []),
    }
    monkeypatch.setattr(mob_module, "PROVIDERS", providers)
    return providers


BBOX = BBox(min_lon=24.0, min_lat=60.0, max_lon=25.0, max_lat=61.0)


# ── Speed table spot-checks (doctrine) ────────────────────────────────────────

def test_tank_road_is_40():
    assert doctrine.speed_for_class("tank", "go", is_road=True) == 40.0

def test_tank_swamp_is_8():
    assert doctrine.speed_for_class("tank", "slow-go", is_road=False) == 8.0

def test_tank_water_is_zero():
    assert doctrine.speed_for_class("tank", "no-go", is_road=False) == 0.0

def test_foot_road_is_5():
    assert doctrine.speed_for_class("foot", "go", is_road=True) == 5.0

def test_foot_cross_restricted_is_1pt6():
    assert doctrine.speed_for_class("foot", "slow-go") == 1.6

def test_wheeled_faster_than_tank_offroad():
    assert (doctrine.speed_for_class("wheeled", "slow-go") >
            doctrine.speed_for_class("tank", "slow-go"))


# ── Bridge passability ─────────────────────────────────────────────────────────

def test_unknown_capacity_is_passable_for_tank():
    assert doctrine.bridge_passable("tank", None) is True

def test_60t_bridge_fails_for_68t_tank():
    assert doctrine.bridge_passable("tank", 60.0) is False

def test_60t_bridge_passes_for_wheeled_26t():
    assert doctrine.bridge_passable("wheeled", 60.0) is True

def test_20t_bridge_blocks_armour_but_not_foot():
    # 20t limit blocks all armoured vehicles (tank 68t, tracked 30t, wheeled 26t)
    assert doctrine.bridge_passable("tank",    20.0) is False
    assert doctrine.bridge_passable("tracked", 20.0) is False
    assert doctrine.bridge_passable("wheeled", 20.0) is False
    # Foot troops carry ~0 t — 20t limit imposes no restriction
    assert doctrine.bridge_passable("foot",    20.0) is True


# ── End-to-end mobility build ─────────────────────────────────────────────────

def test_mobility_features_have_speed(stubs):
    fc = asyncio.run(build_mobility(BBOX, datetime(2026, 5, 16), "tank"))
    assert fc.meta.status == "ok"
    for f in fc.features:
        p = f["properties"]
        assert "speed_kmh" in p
        assert "passable" in p
        assert "mcoo_class" in p
        assert p["vehicle_class"] == "tank"
        assert p["cite"]

def test_farmland_is_fast_for_all_vehicles(stubs):
    for vc in ("tank", "wheeled", "foot"):
        fc = asyncio.run(build_mobility(BBOX, None, vc))
        farmland = [f for f in fc.features
                    if (f.get("properties") or {}).get("terrain_type") == "farmland"]
        assert farmland, f"no farmland for {vc}"
        assert all(f["properties"]["passable"] for f in farmland)
        assert all(f["properties"]["speed_kmh"] > 0 for f in farmland)

def test_water_is_no_go_for_all_vehicles(stubs):
    for vc in ("tank", "wheeled", "foot"):
        fc = asyncio.run(build_mobility(BBOX, None, vc))
        water = [f for f in fc.features
                 if (f.get("properties") or {}).get("terrain_type") == "Jarvi"]
        assert all(f["properties"]["speed_kmh"] == 0 for f in water)

def test_bridge_passable_for_wheeled_not_tank_at_60t(stubs):
    # The 60-tonne bridge blocks tanks (68t) but passes wheeled (26t)
    tank_fc = asyncio.run(build_mobility(BBOX, None, "tank"))
    wheel_fc = asyncio.run(build_mobility(BBOX, None, "wheeled"))
    tank_bridges = [f for f in tank_fc.features
                    if (f.get("properties") or {}).get("mcoo_role") == "chokepoint_bridge"
                    or (f.get("properties") or {}).get("is_bridge")]
    # Digiroad bridge at 60t → impassable for tank
    blocked = [f for f in tank_bridges if not f["properties"]["passable"]]
    assert blocked, "60t bridge should block 68t tank"
    # Same bridge should be fine for wheeled (26t)
    wheel_bridges = [f for f in wheel_fc.features
                     if (f.get("properties") or {}).get("is_bridge")]
    passable = [f for f in wheel_bridges if f["properties"]["passable"]]
    assert passable, "60t bridge should pass 26t wheeled APC"

def test_unknown_vehicle_class_defaults_to_wheeled(stubs):
    fc = asyncio.run(build_mobility(BBOX, None, "unicorn"))
    for f in fc.features:
        assert f["properties"]["vehicle_class"] == "wheeled"


def test_flood_zone_overrides_overlapping_terrain(monkeypatch):
    providers = {
        "mml": _Stub("mml", [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[24.1, 60.1], [24.4, 60.1], [24.4, 60.4], [24.1, 60.4], [24.1, 60.1]]],
                },
                "properties": {"terrain_type": "farmland"},
            },
        ]),
        "digiroad": _Stub("digiroad", []),
        "syke": _Stub("syke", [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[24.2, 60.2], [24.5, 60.2], [24.5, 60.5], [24.2, 60.5], [24.2, 60.2]]],
                },
                "properties": {"category": "flood_risk"},
            },
        ]),
        "exposure": _Stub("exposure", []),
    }
    monkeypatch.setattr(mob_module, "PROVIDERS", providers)

    fc = asyncio.run(build_mobility(BBOX, None, "wheeled"))
    terrain = [
        f for f in fc.features
        if (f.get("properties") or {}).get("terrain_type") == "farmland"
    ]
    assert terrain
    assert terrain[0]["properties"]["mcoo_class"] == "no-go"
    assert terrain[0]["properties"]["speed_kmh"] == 0.0
