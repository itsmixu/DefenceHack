"""Registry of data sources. Providers are wired in here as they come online."""
from __future__ import annotations

from dataclasses import dataclass

from .schemas import SourceInfo, SourceStatus


@dataclass(frozen=True)
class SourceSpec:
    id: str
    label: str


# Order follows the hackathon priority in AGENTS.md §7.
SOURCES: tuple[SourceSpec, ...] = (
    SourceSpec("mml", "MML — National Land Survey of Finland"),
    SourceSpec("digiroad", "Digiroad — Väylä road network"),
    SourceSpec("fmi", "FMI — Finnish Meteorological Institute"),
    SourceSpec("statfin", "Statistics Finland — Paavo demographics"),
    SourceSpec("opencellid", "OpenCelliD — cell tower locations"),
    SourceSpec("osm", "OpenStreetMap — Overpass API"),
    SourceSpec("n2yo", "N2YO — satellite overpass tracking"),
)

SOURCE_IDS: frozenset[str] = frozenset(s.id for s in SOURCES)


def default_source_info() -> list[SourceInfo]:
    return [
        SourceInfo(
            id=s.id,
            label=s.label,
            status="unknown",
            reason="not yet implemented",
        )
        for s in SOURCES
    ]
