"""Provider base class and shared status tracking."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..bbox import BBox
from ..schemas import FeatureCollection, SourceStatus


@dataclass
class ProviderStatus:
    status: SourceStatus = "unknown"
    last_checked: datetime | None = None
    reason: str | None = None


@dataclass
class Provider(ABC):
    id: str
    label: str
    status: ProviderStatus = field(default_factory=ProviderStatus)

    @abstractmethod
    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection: ...

    def mark(self, status: SourceStatus, reason: str | None = None) -> None:
        self.status.status = status
        self.status.last_checked = datetime.now(timezone.utc)
        self.status.reason = reason
