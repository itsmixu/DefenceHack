"""Tests for N2YO satellite footprint geometry."""
import math
import pytest
from app.providers.n2yo import _footprint_radius_km, _footprint_polygon

_EARTH_R = 6371.0


def test_footprint_iss_altitude():
    r = _footprint_radius_km(400.0)
    # arccos(6371/6771) * 6371 ≈ 2215 km
    expected = _EARTH_R * math.acos(_EARTH_R / (_EARTH_R + 400.0))
    assert abs(r - expected) < 1.0


def test_footprint_increases_with_altitude():
    r_low = _footprint_radius_km(300.0)
    r_mid = _footprint_radius_km(600.0)
    r_high = _footprint_radius_km(1200.0)
    assert r_low < r_mid < r_high


def test_footprint_zero_altitude():
    assert _footprint_radius_km(0.0) == 0.0


def test_footprint_negative_altitude():
    assert _footprint_radius_km(-100.0) == 0.0


def test_footprint_geo_orbit():
    # Geostationary at ~35786 km should give ~arccos(6371/42157)*6371 ≈ 8600 km
    r = _footprint_radius_km(35786.0)
    assert r > 8000.0


def test_footprint_polygon_is_closed():
    poly = _footprint_polygon(25.0, 60.0, 2000.0)
    ring = poly["coordinates"][0]
    assert ring[0] == ring[-1]


def test_footprint_polygon_vertex_count():
    from app.providers.n2yo import _FOOTPRINT_VERTICES
    poly = _footprint_polygon(25.0, 60.0, 2000.0)
    ring = poly["coordinates"][0]
    # N vertices + closing vertex
    assert len(ring) == _FOOTPRINT_VERTICES + 1


def test_footprint_polygon_type():
    poly = _footprint_polygon(25.0, 60.0, 2000.0)
    assert poly["type"] == "Polygon"
