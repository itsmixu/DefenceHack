"""Registry of data providers. Providers are wired in here as they come online."""
from __future__ import annotations

from dataclasses import dataclass

from .providers.base import Provider
from .providers.fmi import FMIProvider
from .providers.osm import OSMProvider
from .providers.statfin import StatFinProvider
from .schemas import SourceInfo


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


# Live provider instances. Sources not yet implemented are absent here and
# reported as "unknown / not yet implemented" by the /api/sources endpoint.
PROVIDERS: dict[str, Provider] = {
    "osm": OSMProvider(),
    "fmi": FMIProvider(),
    "statfin": StatFinProvider(),
}


def list_source_info() -> list[SourceInfo]:
    out: list[SourceInfo] = []
    for spec in SOURCES:
        provider = PROVIDERS.get(spec.id)
        if provider is None:
            out.append(
                SourceInfo(
                    id=spec.id,
                    label=spec.label,
                    status="unknown",
                    reason="not yet implemented",
                )
            )
        else:
            out.append(
                SourceInfo(
                    id=spec.id,
                    label=spec.label,
                    status=provider.status.status,
                    last_checked=provider.status.last_checked,
                    reason=provider.status.reason,
                )
            )
    return out
