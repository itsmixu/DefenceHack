"""Pin the Appendix B thresholds so doctrine changes are deliberate."""
from __future__ import annotations

import math

from app import doctrine


# ── Table B-1 — horizon range ────────────────────────────────────────────────

def test_horizon_range_zero_height_is_zero():
    assert doctrine.horizon_range_km(0) == 0.0


def test_horizon_range_2m_observer():
    # d = 3.57 · √2 ≈ 5.05 km
    assert math.isclose(doctrine.horizon_range_km(2.0), 5.05, abs_tol=0.02)


def test_horizon_range_100m_tower():
    # d = 3.57 · √100 = 35.7 km
    assert math.isclose(doctrine.horizon_range_km(100.0), 35.7, abs_tol=0.05)


# ── Table B-2 — terrain profiles ─────────────────────────────────────────────

def test_water_is_no_go():
    for code in ("Jarvi", "Virtavesialue", "Meriaalue"):
        info = doctrine.classify_terrain(code)
        assert info["class"] == "no-go", code
        assert info["cite"].startswith("B-")


def test_swamp_cites_b2_or_b8():
    info = doctrine.classify_terrain("Suo")
    assert info["class"] == "slow-go"
    assert "B-2" in info["cite"] or "B-8" in info["cite"]


def test_open_farmland_is_go():
    info = doctrine.classify_terrain("farmland")
    assert info["class"] == "go"


def test_forest_cites_concealment_table():
    info = doctrine.classify_terrain("forest")
    assert info["class"] == "slow-go"
    assert "B-3" in info["cite"] or "B-4" in info["cite"]


def test_unknown_terrain_defaults_to_go_with_b2_cite():
    info = doctrine.classify_terrain("Atlantis")
    assert info["class"] == "go"
    assert info["cite"] == "B-2"


# ── Table B-16/B-17 — road flow ──────────────────────────────────────────────

def test_motorway_is_two_track():
    info = doctrine.classify_road(1, is_bridge=False)
    assert info["flow"] == "two_track"
    assert info["role"] == "mobility_corridor"


def test_minor_road_is_single_wheel():
    info = doctrine.classify_road(6, is_bridge=False)
    assert info["flow"] == "single_wheel"


def test_bridge_is_chokepoint_regardless_of_class():
    info = doctrine.classify_road(1, is_bridge=True)
    assert info["role"] == "chokepoint_bridge"
    assert info["class"] == "go"


def test_unknown_road_class_defaults_to_local():
    info = doctrine.classify_road(None, is_bridge=False)
    assert info["flow"] == "two_wheel"


# ── Maneuver rating thresholds ───────────────────────────────────────────────

def test_maneuver_unrestricted_when_open():
    rating, reason = doctrine.rate_maneuver(impassable_pct=5, restricted_pct=10)
    assert rating == "unrestricted"
    assert "below" in reason


def test_maneuver_restricted_when_combined_over_50():
    rating, _ = doctrine.rate_maneuver(impassable_pct=10, restricted_pct=45)
    assert rating == "restricted"


def test_maneuver_severely_restricted_above_40_pct_no_go():
    rating, reason = doctrine.rate_maneuver(impassable_pct=45, restricted_pct=10)
    assert rating == "severely_restricted"
    assert "40%" in reason


# ── Environmental & aviation ratings (Table B-12) ────────────────────────────

def test_environment_unknown_with_no_obs():
    rating, _ = doctrine.rate_environment(None, None)
    assert rating == "unknown"


def test_environment_unrestricted_in_normal_weather():
    rating, _ = doctrine.rate_environment(temp_c=5.0, wind_ms=4.0)
    assert rating == "unrestricted"


def test_environment_restricted_in_extreme_cold():
    rating, reason = doctrine.rate_environment(temp_c=-25.0, wind_ms=4.0)
    assert rating == "restricted"
    assert "cold limit" in reason


def test_environment_severely_restricted_when_cold_and_windy():
    rating, _ = doctrine.rate_environment(temp_c=-25.0, wind_ms=30.0)
    assert rating == "severely_restricted"


def test_aviation_grounded_in_high_wind():
    rating, reason = doctrine.rate_aviation(wind_ms=20.0)  # ≈ 39 kt
    assert rating == "severely_restricted"
    assert "rotary-wing" in reason


def test_aviation_unrestricted_in_calm():
    rating, _ = doctrine.rate_aviation(wind_ms=5.0)
    assert rating == "unrestricted"


# ── Weighted mobility aggregation ────────────────────────────────────────────

def test_weighted_mobility_empty():
    out = doctrine.weighted_mobility([])
    assert out["total_length_km"] == 0
    assert out["bridge_count"] == 0
    assert out["total_capacity_vph"] == 0


def test_weighted_mobility_aggregates_lengths_and_bridges():
    out = doctrine.weighted_mobility([
        {"properties": {"length_m": 2000, "functional_class": 1, "is_bridge": False}},
        {"properties": {"length_m": 1500, "functional_class": 5, "is_bridge": False}},
        {"properties": {"length_m":  500, "functional_class": 3, "is_bridge": True}},
    ])
    assert out["total_length_km"] == 4.0
    assert out["bridge_count"] == 1
    # Motorway + local + regional = two_track + two_wheel + two_track
    assert out["by_flow_class"] == {"two_track": 2, "two_wheel": 1}
    # Capacity = 1200 + 600 + 1200
    assert out["total_capacity_vph"] == 3000
