"""GET /api/sources — provider status list (AGENTS.md §5)."""
from __future__ import annotations

from fastapi import APIRouter

from ..registry import default_source_info
from ..schemas import SourceInfo

router = APIRouter(prefix="/api", tags=["sources"])


@router.get("/sources", response_model=list[SourceInfo])
def list_sources() -> list[SourceInfo]:
    # In later steps each provider reports its own live status here.
    return default_source_info()
