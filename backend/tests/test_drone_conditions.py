"""Drone conditions — pin rating thresholds and output shape."""
from __future__ import annotations

import asyncio
from datetime import datetime

import pytest

from app import doctrine
from app.analysis import drone_conditions as dc_module
from app.analysis.drone_conditions import build_drone_conditions
from app.bbox import BBox
from app.schemas import FeatureCollection, LayerMeta


class _Stub:
    def __init__(self, sid, feats):
        self.id = sid; self.feats = feats
    async def fetch(self, bbox, t):
        return FeatureCollection(features=self.feats,
            meta=LayerMeta(source=self.id, status="ok", reason="stub",
                           bbox=bbox.as_list(), t=t))


BBOX = BBox(min_lon=24.0, min_lat=60.0, max_lon=25.0, max_lat=61.0)

FMI_CALM = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [24.5, 60.5]},
             "properties": {"source": "fmi", "time": "2026-05-16T12:00:00Z",
                            "measurements": {"windspeedms": 3.0, "temperature": 10.0,
                                             "visibility": 8000.0, "precipitation1h": 0.0}}}
FMI_WINDY = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [24.5, 60.5]},
              "properties": {"source": "fmi", "time": "2026-05-16T12:00:00Z",
                             "measurements": {"windspeedms": 15.0, "temperature": 8.0,
                                              "visibility": 5000.0, "precipitation1h": 0.5}}}


@pytest.fixture
def stubs_calm(monkeypatch):
    p = {"fmi": _Stub("fmi", [FMI_CALM]), "fmi_forecast": _Stub("fmi_forecast", [])}
    monkeypatch.setattr(dc_module, "PROVIDERS", p)
    return p

@pytest.fixture
def stubs_windy(monkeypatch):
    p = {"fmi": _Stub("fmi", [FMI_WINDY]), "fmi_forecast": _Stub("fmi_forecast", [])}
    monkeypatch.setattr(dc_module, "PROVIDERS", p)
    return p


# ── doctrine.rate_drone threshold checks ─────────────────────────────────────

def test_calm_weather_is_go():
    r, s, f = doctrine.rate_drone(3.0, None, 10.0, 8000.0, None, 0.0)
    assert r == "go"
    assert not f

def test_high_wind_is_no_go():
    r, _, flags = doctrine.rate_drone(15.0, None, 10.0, 5000.0, None, 0.0)
    assert r == "no-go"
    assert any("wind" in fl for fl in flags)

def test_gust_alone_causes_marginal():
    r, _, flags = doctrine.rate_drone(6.0, 11.0, 10.0, 8000.0, None, 0.0)
    assert r == "marginal"
    assert any("gust" in fl for fl in flags)

def test_cold_temp_is_marginal():
    r, _, flags = doctrine.rate_drone(3.0, None, -5.0, 8000.0, None, 0.0)
    assert r == "marginal"
    assert any("temp" in fl for fl in flags)

def test_extreme_cold_is_no_go():
    r, _, _ = doctrine.rate_drone(3.0, None, -20.0, 8000.0, None, 0.0)
    assert r == "no-go"

def test_low_visibility_is_no_go():
    r, _, _ = doctrine.rate_drone(3.0, None, 10.0, 500.0, None, 0.0)
    assert r == "no-go"

def test_low_ceiling_is_no_go():
    r, _, _ = doctrine.rate_drone(3.0, None, 10.0, 8000.0, 80.0, 0.0)
    assert r == "no-go"

def test_heavy_precip_is_no_go():
    r, _, _ = doctrine.rate_drone(3.0, None, 10.0, 8000.0, None, 6.0)
    assert r == "no-go"

def test_two_marginal_factors_still_marginal():
    # gust marginal + light precip marginal
    r, _, _ = doctrine.rate_drone(6.0, 11.0, 10.0, 8000.0, None, 3.0)
    assert r == "marginal"

def test_no_obs_returns_go_with_empty_flags():
    r, _, f = doctrine.rate_drone(None, None, None, None, None, None)
    assert r == "go"
    assert not f


# ── End-to-end drone conditions build ────────────────────────────────────────

def test_calm_station_rated_go(stubs_calm):
    result = asyncio.run(build_drone_conditions(BBOX, datetime(2026, 5, 16)))
    assert result["summary"]["current_rating"] == "go"
    assert result["summary"]["station_count"] == 1
    feat = result["station_features"][0]
    assert feat["properties"]["drone_rating"] == "go"

def test_windy_station_rated_no_go(stubs_windy):
    result = asyncio.run(build_drone_conditions(BBOX, None))
    assert result["summary"]["current_rating"] == "no-go"

def test_result_has_thresholds(stubs_calm):
    result = asyncio.run(build_drone_conditions(BBOX, None))
    assert "thresholds" in result
    assert "wind_no_go_ms" in result["thresholds"]

def test_result_has_forecast_timeline(stubs_calm):
    result = asyncio.run(build_drone_conditions(BBOX, None))
    assert "forecast_timeline" in result
    assert isinstance(result["forecast_timeline"], list)


def test_forecast_timeline_reads_cloudbase_key(monkeypatch):
    forecast_feature = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [24.5, 60.5]},
        "properties": {
            "source": "fmi_forecast",
            "time": "2026-05-16T12:00:00Z",
            "drone_rating": "go",
            "drone_summary": "ok",
            "forecast": {
                "WindSpeedMS": 4.0,
                "WindGust": 6.0,
                "Temperature": 10.0,
                "Visibility": 8000.0,
                "CloudBase": 320.0,
                "TotalCloudCover": 55.0,
                "PrecipitationAmount": 0.2,
            },
        },
    }
    providers = {
        "fmi": _Stub("fmi", [FMI_CALM]),
        "fmi_forecast": _Stub("fmi_forecast", [forecast_feature]),
    }
    monkeypatch.setattr(dc_module, "PROVIDERS", providers)

    result = asyncio.run(build_drone_conditions(BBOX, None))
    assert result["forecast_timeline"]
    assert result["forecast_timeline"][0]["ceiling_m"] == 320.0
