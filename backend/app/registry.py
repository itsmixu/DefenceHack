"""Registry of data providers. Providers are wired in here as they come online."""
from __future__ import annotations

from dataclasses import dataclass

from .providers.base import Provider
from .providers.digiroad import DigiroadProvider
from .providers.exposure import ExposureProvider
from .providers.fmi import FMIProvider
from .providers.mml import MMLProvider
from .providers.mml_contours import MMLContoursProvider
from .providers.n2yo import N2YOProvider
from .providers.opencellid import OpenCelliDProvider
from .providers.osm import OSMProvider
from .providers.statfin import StatFinProvider
from .schemas import SourceInfo


@dataclass(frozen=True)
class SourceSpec:
    id: str
    label: str


# Original 7 data sources from AGENTS.md §7, plus 2 derived/computed sources
# added to support the "topographical data" and "danger zones" features.
SOURCES: tuple[SourceSpec, ...] = (
    SourceSpec("mml",          "MML — National Land Survey of Finland"),
    SourceSpec("mml_contours", "MML — elevation contour lines"),
    SourceSpec("digiroad",     "Digiroad — Väylä road network"),
    SourceSpec("fmi",          "FMI — Finnish Meteorological Institute"),
    SourceSpec("statfin",      "Statistics Finland — Paavo demographics"),
    SourceSpec("opencellid",   "OpenCelliD — cell tower locations"),
    SourceSpec("osm",          "OpenStreetMap — Overpass API"),
    SourceSpec("n2yo",         "N2YO — satellite overpass tracking"),
    SourceSpec("exposure",     "Terrain exposure — danger zone scoring"),
)

SOURCE_IDS: frozenset[str] = frozenset(s.id for s in SOURCES)

PROVIDERS: dict[str, Provider] = {
    "mml":          MMLProvider(),
    "mml_contours": MMLContoursProvider(),
    "osm":          OSMProvider(),
    "fmi":          FMIProvider(),
    "statfin":      StatFinProvider(),
    "digiroad":     DigiroadProvider(),
    "opencellid":   OpenCelliDProvider(),
    "n2yo":         N2YOProvider(),
    "exposure":     ExposureProvider(),
}


def list_source_info() -> list[SourceInfo]:
    out: list[SourceInfo] = []
    for spec in SOURCES:
        provider = PROVIDERS.get(spec.id)
        if provider is None:
            out.append(SourceInfo(
                id=spec.id, label=spec.label,
                status="unknown", reason="not yet implemented",
            ))
        else:
            out.append(SourceInfo(
                id=spec.id, label=spec.label,
                status=provider.status.status,
                last_checked=provider.status.last_checked,
                reason=provider.status.reason,
            ))
    return out
