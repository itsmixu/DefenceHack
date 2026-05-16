"""File-based JSON persistence for plans and operations.

WHY THIS EXISTS:
The "history past A.K.A. predictions vs real life" feature from the
whiteboard needs somewhere to save data between sessions. This module
provides that without requiring a database — everything lives as JSON
files under data/plans/ and data/operations/ which are gitignored.

Plans store what the user drew and configured (AOI, active layers,
notes). Operations link a plan to its predicted and actual outcomes so
teams can compare their pre-operation assessment against what happened.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_ROOT = Path(__file__).resolve().parents[2] / "data"
PLANS_DIR = DATA_ROOT / "plans"
VERSIONS_DIR = DATA_ROOT / "plan_versions"
OPS_DIR = DATA_ROOT / "operations"

for _d in (PLANS_DIR, VERSIONS_DIR, OPS_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


# ── Plans ────────────────────────────────────────────────────────────────────

def save_plan(data: dict[str, Any]) -> dict[str, Any]:
    plan_id = data.get("id") or _new_id()
    now = _now()
    plan = {
        "id": plan_id,
        "name": data.get("name", "Untitled plan"),
        "created_at": data.get("created_at", now),
        "updated_at": now,
        "bbox": data.get("bbox"),
        # GeoJSON FeatureCollection of shapes drawn by the user on the map.
        # Each feature should set properties.feature_type to one of:
        #   "AOI" — Area of Operations / Area of Interest boundary
        #   "NAI" — Named Area of Interest (intelligence collection target)
        #   "TAI" — Target Area of Interest (action / engagement zone)
        #   "DP"  — Decision Point (condition-triggered branch on the map)
        #   "annotation" — freeform note shape, no doctrinal meaning
        # Frontend colour-codes these (AOI/NAI/TAI/DP convention from IPB
        # doctrine: AOI thick black, NAI dashed blue, TAI dashed red, DP
        # diamond marker). Other shapes default to "annotation".
        "drawn_features": data.get("drawn_features", {"type": "FeatureCollection", "features": []}),
        # Which layer toggles were active when the plan was saved.
        "active_layers": data.get("active_layers", []),
        "notes": data.get("notes", ""),
        "role": data.get("role"),  # which user role saved this plan
    }
    (PLANS_DIR / f"{plan_id}.json").write_text(json.dumps(plan))
    return plan


def get_plan(plan_id: str) -> dict[str, Any] | None:
    p = PLANS_DIR / f"{plan_id}.json"
    return json.loads(p.read_text()) if p.exists() else None


def list_plans() -> list[dict[str, Any]]:
    plans = []
    for p in sorted(PLANS_DIR.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
        try:
            plan = json.loads(p.read_text())
            # Return summary only (omit drawn_features to keep list response small).
            plans.append({k: v for k, v in plan.items() if k != "drawn_features"})
        except (json.JSONDecodeError, OSError):
            continue
    return plans


def delete_plan(plan_id: str) -> bool:
    p = PLANS_DIR / f"{plan_id}.json"
    if p.exists():
        p.unlink()
        return True
    return False


# ── Plan versions ─────────────────────────────────────────────────────────────
#
# Each plan can have multiple version snapshots, saved explicitly by the user
# (e.g. "Initial planning", "After recon", "Final approved"). Versions are
# immutable once written — they're the historical record trainees learn from.
#
# File layout:  data/plan_versions/<plan_id>/<version_number>.json
#   version_number is a 1-based integer, auto-incremented.

def _versions_dir(plan_id: str) -> Path:
    d = VERSIONS_DIR / plan_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_plan_version(
    plan_id: str,
    data: dict[str, Any],
    label: str = "",
    role: str | None = None,
) -> dict[str, Any]:
    """Snapshot the current plan state as a new immutable version.

    `label` is a human name like "Initial planning" or "After recon".
    `role`  is the author role (e.g. "commander", "trainee").
    `data`  should be the full plan body (bbox, drawn_features, active_layers,
            notes, conditions_snapshot — whatever the frontend wants to preserve).
    """
    d = _versions_dir(plan_id)
    existing = sorted(d.glob("*.json"), key=lambda f: int(f.stem))
    next_num = len(existing) + 1
    version: dict[str, Any] = {
        "plan_id": plan_id,
        "version": next_num,
        "label": label or f"Version {next_num}",
        "role": role,
        "saved_at": _now(),
        "bbox": data.get("bbox"),
        "drawn_features": data.get("drawn_features", {"type": "FeatureCollection", "features": []}),
        "active_layers": data.get("active_layers", []),
        "notes": data.get("notes", ""),
        # Optional field: a conditions snapshot captured at save time.
        # Frontend should include {"fmi": {...}, "astronomy": {...}, ...} if available.
        "conditions_snapshot": data.get("conditions_snapshot"),
    }
    (d / f"{next_num}.json").write_text(json.dumps(version))
    return version


def list_plan_versions(plan_id: str) -> list[dict[str, Any]]:
    """Return all versions for a plan, oldest first, omitting drawn_features."""
    d = _versions_dir(plan_id)
    versions = []
    for p in sorted(d.glob("*.json"), key=lambda f: int(f.stem)):
        try:
            v = json.loads(p.read_text())
            versions.append({k: val for k, val in v.items() if k != "drawn_features"})
        except (json.JSONDecodeError, OSError):
            continue
    return versions


def get_plan_version(plan_id: str, version: int) -> dict[str, Any] | None:
    p = _versions_dir(plan_id) / f"{version}.json"
    return json.loads(p.read_text()) if p.exists() else None


# ── Operations ───────────────────────────────────────────────────────────────

def save_operation(data: dict[str, Any]) -> dict[str, Any]:
    op_id = data.get("id") or _new_id()
    now = _now()
    operation = {
        "id": op_id,
        "name": data.get("name", "Untitled operation"),
        "plan_id": data.get("plan_id"),   # optional link to a saved plan
        "created_at": data.get("created_at", now),
        "updated_at": now,
        "bbox": data.get("bbox"),
        # What the team predicted before the operation.
        "prediction": {
            "notes": data.get("prediction", {}).get("notes", ""),
            "threat_assessment": data.get("prediction", {}).get("threat_assessment", ""),
            "expected_outcome": data.get("prediction", {}).get("expected_outcome", ""),
            "recorded_at": data.get("prediction", {}).get("recorded_at", now),
        },
        # What actually happened — filled in after the operation.
        "actual": {
            "notes": data.get("actual", {}).get("notes", ""),
            "outcome": data.get("actual", {}).get("outcome", ""),
            "recorded_at": data.get("actual", {}).get("recorded_at"),
        },
        "tags": data.get("tags", []),  # free-form tags, e.g. ["recon", "night"]
    }
    (OPS_DIR / f"{op_id}.json").write_text(json.dumps(operation))
    return operation


def get_operation(op_id: str) -> dict[str, Any] | None:
    p = OPS_DIR / f"{op_id}.json"
    return json.loads(p.read_text()) if p.exists() else None


def list_operations(plan_id: str | None = None) -> list[dict[str, Any]]:
    ops = []
    for p in sorted(OPS_DIR.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
        try:
            op = json.loads(p.read_text())
            if plan_id and op.get("plan_id") != plan_id:
                continue
            ops.append(op)
        except (json.JSONDecodeError, OSError):
            continue
    return ops


def update_operation_actual(op_id: str, actual: dict[str, Any]) -> dict[str, Any] | None:
    """Fill in the 'actual' outcome after an operation completes."""
    op = get_operation(op_id)
    if op is None:
        return None
    op["actual"] = {
        "notes": actual.get("notes", ""),
        "outcome": actual.get("outcome", ""),
        "recorded_at": actual.get("recorded_at", _now()),
    }
    op["updated_at"] = _now()
    (OPS_DIR / f"{op_id}.json").write_text(json.dumps(op))
    return op
