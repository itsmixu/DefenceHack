"""Smoke test the MCOO pipeline — every feature gets a doctrinal citation."""
from __future__ import annotations

import asyncio
from datetime import datetime

import pytest

from app.analysis import mcoo as mcoo_module
from app.analysis.mcoo import build_mcoo
from app.bbox import BBox
from app.schemas import FeatureCollection, LayerMeta


class _StubProvider:
    """Return a fixed FeatureCollection — no network."""

    def __init__(self, sid: str, features: list[dict]) -> None:
        self.id = sid
        self.features = features

    async def fetch(self, bbox, t):
        return FeatureCollection(
            features=self.features,
            meta=LayerMeta(source=self.id, status="ok", reason="stub",
                           bbox=bbox.as_list(), t=t),
        )


@pytest.fixture
def stub_providers(monkeypatch):
    providers = {
        "mml": _StubProvider("mml", [
            {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": []},
             "properties": {"terrain_type": "Jarvi", "source": "mml"}},
            {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": []},
             "properties": {"terrain_type": "Suo", "source": "mml"}},
            {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": []},
             "properties": {"terrain_type": "farmland", "source": "mml"}},
        ]),
        "exposure": _StubProvider("exposure", []),
        "digiroad": _StubProvider("digiroad", [
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": []},
             "properties": {"source": "digiroad", "functional_class": 1,
                            "is_bridge": False, "length_m": 1000}},
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": []},
             "properties": {"source": "digiroad", "functional_class": 4,
                            "is_bridge": True, "length_m": 100}},
        ]),
    }
    monkeypatch.setattr(mcoo_module, "PROVIDERS", providers)
    return providers


def test_mcoo_features_carry_doctrinal_citations(stub_providers):
    bbox = BBox(min_lon=24.0, min_lat=60.0, max_lon=25.0, max_lat=61.0)
    fc = asyncio.run(build_mcoo(bbox, datetime(2026, 5, 16)))
    assert fc.meta.status == "ok"
    assert fc.meta.attribution == "Classification per ATP 2-41.1 (2021) Appendix B"
    classes = {f["properties"]["mcoo_class"] for f in fc.features}
    assert classes == {"go", "slow-go", "no-go"}
    # Every feature has a citation back to Appendix B.
    for f in fc.features:
        p = f["properties"]
        assert p["doctrine"] == "ATP 2-41.1 Appendix B"
        assert p["mcoo_cite"].startswith("B-")
        assert p["mcoo_reason"]


def test_mcoo_classifies_bridge_as_chokepoint(stub_providers):
    bbox = BBox(min_lon=24.0, min_lat=60.0, max_lon=25.0, max_lat=61.0)
    fc = asyncio.run(build_mcoo(bbox, None))
    bridges = [f for f in fc.features
               if f["properties"].get("mcoo_role") == "chokepoint_bridge"]
    assert len(bridges) == 1
    assert "bridge" in bridges[0]["properties"]["mcoo_reason"].lower()
