"""Collab sessions — leader/follower SSE channel per file.

ENDPOINTS:
  POST   /api/collab/files/{file_id}/join          → { session_id, snapshot }
  POST   /api/collab/files/{file_id}/leave         → 204
  POST   /api/collab/files/{file_id}/heartbeat     → snapshot
  POST   /api/collab/files/{file_id}/takeover      → snapshot (this session becomes leader)
  POST   /api/collab/files/{file_id}/broadcast     → leader-only edit fanout
  GET    /api/collab/files/{file_id}/stream        → SSE event stream

Sessions are in-memory (single-process). First joiner becomes leader.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from .. import collab

router = APIRouter(prefix="/api/collab", tags=["collab"])


@router.post("/files/{file_id}/join", status_code=201)
async def join(file_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    # Body is accepted but ignored — the backend assigns NATO-phonetic
    # callsigns (Alpha, Bravo, …) in join order.
    _ = body
    return await collab.join(file_id)


@router.post("/files/{file_id}/leave", status_code=204)
async def leave(file_id: str, body: dict[str, Any]) -> None:
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id required")
    await collab.leave(file_id, session_id)


@router.post("/files/{file_id}/heartbeat")
async def heartbeat(file_id: str, body: dict[str, Any]) -> dict[str, Any]:
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id required")
    try:
        return await collab.heartbeat(file_id, session_id)
    except KeyError:
        raise HTTPException(404, "session not found")


@router.post("/files/{file_id}/takeover")
async def takeover(file_id: str, body: dict[str, Any]) -> dict[str, Any]:
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id required")
    try:
        return await collab.takeover(file_id, session_id)
    except KeyError:
        raise HTTPException(404, "session not found")


@router.post("/files/{file_id}/broadcast")
async def broadcast(file_id: str, body: dict[str, Any]) -> dict[str, Any]:
    session_id = body.get("session_id")
    patch = body.get("patch")
    if not session_id or patch is None:
        raise HTTPException(400, "session_id and patch required")
    try:
        return await collab.broadcast_edit(file_id, session_id, patch)
    except KeyError:
        raise HTTPException(404, "session not found")
    except PermissionError:
        raise HTTPException(403, "only the leader can broadcast")


@router.get("/files/{file_id}/stream")
async def stream(file_id: str, session_id: str = Query(...)) -> StreamingResponse:
    return StreamingResponse(
        collab.stream(file_id, session_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # nginx: disable proxy buffering
        },
    )
