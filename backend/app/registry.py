"""Registry of data providers. Providers are wired in here as they come online."""
from __future__ import annotations

from dataclasses import dataclass

from .providers.astronomy import AstronomyProvider
from .providers.base import Provider
from .providers.digiroad import DigiroadProvider
from .providers.exposure import ExposureProvider
from .providers.fmi import FMIProvider
from .providers.fmi_forecast import FMIForecastProvider
from .providers.mml import MMLProvider
from .providers.mml_contours import MMLContoursProvider
from .providers.n2yo import N2YOProvider
from .providers.opencellid import OpenCelliDProvider
from .providers.osm import OSMProvider
from .providers.statfin import StatFinProvider
from .providers.syke import SYKEProvider
from .schemas import SourceInfo


@dataclass(frozen=True)
class SourceSpec:
    id: str
    label: str


SOURCES: tuple[SourceSpec, ...] = (
    # Finnish authority datasets
    SourceSpec("mml",          "MML — National Land Survey of Finland"),
    SourceSpec("mml_contours", "MML — elevation contour lines"),
    SourceSpec("digiroad",     "Digiroad — Väylä road network (incl. bridge load capacity)"),
    SourceSpec("fmi",          "FMI — Finnish Meteorological Institute (observations)"),
    SourceSpec("fmi_forecast", "FMI HARMONIE — 48-h NWP forecast (clouds, rain, ceiling)"),
    SourceSpec("statfin",      "Statistics Finland — Paavo demographics"),
    SourceSpec("syke",         "SYKE — flood risk zones & Natura 2000 protected areas"),
    # Global open data
    SourceSpec("osm",          "OpenStreetMap — infrastructure (hospitals, airfields, rail, rivers)"),
    SourceSpec("opencellid",   "OpenCelliD — cell tower locations & coverage"),
    SourceSpec("n2yo",         "N2YO — satellite overpass tracking"),
    # Derived / computed
    SourceSpec("exposure",     "Terrain exposure — danger zone scoring"),
    SourceSpec("astronomy",    "Astronomical — sun/moon/twilight (no API, local computation)"),
)

SOURCE_IDS: frozenset[str] = frozenset(s.id for s in SOURCES)

PROVIDERS: dict[str, Provider] = {
    "mml":          MMLProvider(),
    "mml_contours": MMLContoursProvider(),
    "osm":          OSMProvider(),
    "fmi":          FMIProvider(),
    "fmi_forecast": FMIForecastProvider(),
    "statfin":      StatFinProvider(),
    "digiroad":     DigiroadProvider(),
    "opencellid":   OpenCelliDProvider(),
    "n2yo":         N2YOProvider(),
    "exposure":     ExposureProvider(),
    "syke":         SYKEProvider(),
    "astronomy":    AstronomyProvider(),
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
