"""GET /api/sources — provider status list (AGENTS.md §5)."""
from __future__ import annotations

from fastapi import APIRouter

from ..registry import list_source_info
from ..schemas import SourceInfo

router = APIRouter(prefix="/api", tags=["sources"])


@router.get("/sources", response_model=list[SourceInfo])
def list_sources() -> list[SourceInfo]:
    return list_source_info()
