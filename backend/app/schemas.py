"""Shared response schemas. GeoJSON FeatureCollection per AGENTS.md §5."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

SourceStatus = Literal["ok", "unavailable", "partial", "unknown"]


class SourceInfo(BaseModel):
    id: str
    label: str
    status: SourceStatus = "unknown"
    last_checked: datetime | None = None
    reason: str | None = None


class LayerMeta(BaseModel):
    source: str
    status: SourceStatus
    reason: str | None = None
    bbox: list[float] | None = None
    t: datetime | None = None
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # Free-form doctrinal / data-source attribution surfaced in the UI.
    # Analysis endpoints set this to "ATP 2-41.1 Appendix B" so the legend
    # and source-status panel can show which doctrine drove the rating.
    attribution: str | None = None


class FeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[dict[str, Any]] = Field(default_factory=list)
    meta: LayerMeta


def empty_collection(
    source: str,
    *,
    status: SourceStatus = "unavailable",
    reason: str | None = None,
    bbox: list[float] | None = None,
    t: datetime | None = None,
) -> FeatureCollection:
    return FeatureCollection(
        features=[],
        meta=LayerMeta(source=source, status=status, reason=reason, bbox=bbox, t=t),
    )
