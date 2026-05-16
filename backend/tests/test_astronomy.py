"""Astronomical provider — pin illumination formula and output shape."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from math import isclose

import pytest

from app.bbox import BBox
from app.providers.astronomy import (
    AstronomyProvider,
    _moon_illumination_pct,
    _night_ops_rating,
)

BBOX = BBox(min_lon=24.5, min_lat=60.0, max_lon=25.5, max_lat=60.5)


# ── Moon illumination formula ─────────────────────────────────────────────────

def test_new_moon_zero_illumination():
    assert _moon_illumination_pct(0.0) == 0.0

def test_full_moon_100_illumination():
    assert isclose(_moon_illumination_pct(14.75), 100.0, abs_tol=2.0)

def test_quarter_moon_50_pct():
    pct = _moon_illumination_pct(7.375)
    assert 45 <= pct <= 55

def test_last_quarter():
    pct = _moon_illumination_pct(22.1)
    assert 45 <= pct <= 55


# ── Night ops rating thresholds ───────────────────────────────────────────────

def test_dark_at_zero_illumination():
    assert _night_ops_rating(0.0) == "dark"

def test_dark_at_15_pct():
    assert _night_ops_rating(15.0) == "dark"

def test_partial_at_30_pct():
    assert _night_ops_rating(30.0) == "partial"

def test_bright_at_80_pct():
    assert _night_ops_rating(80.0) == "bright"


# ── Provider output shape ─────────────────────────────────────────────────────

def test_provider_returns_3_days():
    p = AstronomyProvider()
    fc = asyncio.run(p.fetch(BBOX, datetime(2026, 5, 16, 12, tzinfo=timezone.utc)))
    assert fc.meta.status == "ok"
    assert len(fc.features) == 3

def test_each_feature_has_required_fields():
    p = AstronomyProvider()
    fc = asyncio.run(p.fetch(BBOX, datetime(2026, 6, 21, tzinfo=timezone.utc)))
    for f in fc.features:
        props = f["properties"]
        assert "date" in props
        assert "moon_illumination_pct" in props
        assert "night_ops_rating" in props
        assert props["night_ops_rating"] in ("dark", "partial", "bright")
        assert 0 <= props["moon_illumination_pct"] <= 100

def test_feature_is_point_at_bbox_centroid():
    p = AstronomyProvider()
    fc = asyncio.run(p.fetch(BBOX, None))
    for f in fc.features:
        assert f["geometry"]["type"] == "Point"
        lon, lat = f["geometry"]["coordinates"]
        assert 24.5 <= lon <= 25.5
        assert 60.0 <= lat <= 60.5

def test_meta_attribution_set():
    p = AstronomyProvider()
    fc = asyncio.run(p.fetch(BBOX, None))
    assert fc.meta.attribution is not None
    assert "astral" in fc.meta.attribution.lower()
