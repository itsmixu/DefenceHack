"""Plans and operations endpoints.

WHY THESE EXIST:
Implements the "history past A.K.A. predictions vs real life" feature
from the whiteboard. Two resources:

  /api/plans — saved map states (drawn shapes + active layers + notes).
    Miko: use POST /api/plans when the user clicks "Save plan", and
    GET /api/plans to populate a "Saved plans" sidebar list.

  /api/operations — operation records linking a prediction to an actual
    outcome. The workflow is:
      1. Before the op: POST /api/operations with prediction filled in.
      2. After the op: PATCH /api/operations/{id}/actual with what happened.
      3. GET /api/operations to list all records for the "history" view.

All data lives as JSON files under data/plans/ and data/operations/
(gitignored, local to the demo machine). No database required.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from .. import store

router = APIRouter(prefix="/api", tags=["planning"])


# ── Plans ─────────────────────────────────────────────────────────────────

@router.post("/plans", status_code=201)
def create_plan(body: dict[str, Any]) -> dict[str, Any]:
    return store.save_plan(body)


@router.get("/plans")
def list_plans() -> list[dict[str, Any]]:
    return store.list_plans()


@router.get("/plans/{plan_id}")
def get_plan(plan_id: str) -> dict[str, Any]:
    plan = store.get_plan(plan_id)
    if plan is None:
        raise HTTPException(404, f"plan '{plan_id}' not found")
    return plan


@router.put("/plans/{plan_id}")
def update_plan(plan_id: str, body: dict[str, Any]) -> dict[str, Any]:
    existing = store.get_plan(plan_id)
    if existing is None:
        raise HTTPException(404, f"plan '{plan_id}' not found")
    return store.save_plan({**existing, **body, "id": plan_id})


@router.delete("/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: str) -> None:
    if not store.delete_plan(plan_id):
        raise HTTPException(404, f"plan '{plan_id}' not found")


# ── Operations ────────────────────────────────────────────────────────────

@router.post("/operations", status_code=201)
def create_operation(body: dict[str, Any]) -> dict[str, Any]:
    return store.save_operation(body)


@router.get("/operations")
def list_operations(plan_id: str | None = None) -> list[dict[str, Any]]:
    return store.list_operations(plan_id=plan_id)


@router.get("/operations/{op_id}")
def get_operation(op_id: str) -> dict[str, Any]:
    op = store.get_operation(op_id)
    if op is None:
        raise HTTPException(404, f"operation '{op_id}' not found")
    return op


@router.patch("/operations/{op_id}/actual")
def record_actual(op_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """
    Fill in what actually happened after the operation completes.
    Body: { notes, outcome, recorded_at? }
    """
    op = store.update_operation_actual(op_id, body)
    if op is None:
        raise HTTPException(404, f"operation '{op_id}' not found")
    return op
