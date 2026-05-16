"""Tests for plan version snapshots (learning-material feature)."""
import json
import pytest
from pathlib import Path
from unittest.mock import patch
import app.store as store_module


@pytest.fixture(autouse=True)
def tmp_store(tmp_path, monkeypatch):
    """Redirect all store paths to a temporary directory."""
    monkeypatch.setattr(store_module, "PLANS_DIR", tmp_path / "plans")
    monkeypatch.setattr(store_module, "VERSIONS_DIR", tmp_path / "plan_versions")
    monkeypatch.setattr(store_module, "OPS_DIR", tmp_path / "operations")
    (tmp_path / "plans").mkdir()
    (tmp_path / "plan_versions").mkdir()
    (tmp_path / "operations").mkdir()


def _make_plan():
    return store_module.save_plan({"name": "Test plan", "bbox": [24.0, 60.0, 25.0, 61.0]})


def test_save_version_increments():
    plan = _make_plan()
    v1 = store_module.save_plan_version(plan["id"], {"notes": "first look"}, label="Initial")
    v2 = store_module.save_plan_version(plan["id"], {"notes": "after recon"}, label="After recon")
    assert v1["version"] == 1
    assert v2["version"] == 2


def test_version_label_preserved():
    plan = _make_plan()
    v = store_module.save_plan_version(plan["id"], {}, label="Commander approved")
    assert v["label"] == "Commander approved"


def test_version_auto_label_when_empty():
    plan = _make_plan()
    v = store_module.save_plan_version(plan["id"], {})
    assert v["label"] == "Version 1"


def test_version_role_preserved():
    plan = _make_plan()
    v = store_module.save_plan_version(plan["id"], {}, role="commander")
    assert v["role"] == "commander"


def test_list_versions_oldest_first():
    plan = _make_plan()
    store_module.save_plan_version(plan["id"], {"notes": "a"}, label="A")
    store_module.save_plan_version(plan["id"], {"notes": "b"}, label="B")
    store_module.save_plan_version(plan["id"], {"notes": "c"}, label="C")
    versions = store_module.list_plan_versions(plan["id"])
    assert [v["version"] for v in versions] == [1, 2, 3]
    assert [v["label"] for v in versions] == ["A", "B", "C"]


def test_list_versions_omits_drawn_features():
    plan = _make_plan()
    store_module.save_plan_version(
        plan["id"],
        {"drawn_features": {"type": "FeatureCollection", "features": [{"x": 1}]}},
    )
    versions = store_module.list_plan_versions(plan["id"])
    assert "drawn_features" not in versions[0]


def test_get_specific_version_includes_drawn_features():
    plan = _make_plan()
    fc = {"type": "FeatureCollection", "features": [{"id": "shape1"}]}
    store_module.save_plan_version(plan["id"], {"drawn_features": fc})
    v = store_module.get_plan_version(plan["id"], 1)
    assert v["drawn_features"] == fc


def test_get_missing_version_returns_none():
    plan = _make_plan()
    assert store_module.get_plan_version(plan["id"], 99) is None


def test_conditions_snapshot_preserved():
    plan = _make_plan()
    snapshot = {"fmi": {"wind_ms": 3.0}, "astronomy": {"moon": "dark"}}
    v = store_module.save_plan_version(plan["id"], {"conditions_snapshot": snapshot})
    loaded = store_module.get_plan_version(plan["id"], 1)
    assert loaded["conditions_snapshot"] == snapshot


def test_drawn_features_defaults_to_empty_collection():
    plan = _make_plan()
    v = store_module.save_plan_version(plan["id"], {})
    assert v["drawn_features"] == {"type": "FeatureCollection", "features": []}
