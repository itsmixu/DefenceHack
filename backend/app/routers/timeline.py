"""Timeline API — historical and time-aware data for Miko's time scrubber.

WHY THIS EXISTS:
The frontend time scrubber lets users drag to any past date and see what
the world looked like then — weather observations, OSM infrastructure
state, satellite positions, astronomical conditions. This router provides
two endpoints that are the main contract for that feature:

  GET /api/timeline/capabilities
      Returns a static manifest of which sources respond to the ?t=
      parameter, what their earliest available date is, and the minimum
      time step that produces meaningfully different data.
      Miko uses this to decide which layer toggle buttons are greyed-out
      when a past date is selected, and what date range to allow on the
      scrubber.

  GET /api/timeline/snapshot?bbox=…&t=…&sources=fmi,osm,astronomy
      Fetches all requested time-aware sources at the given t in a single
      parallel request and returns them as a single JSON object keyed by
      source ID. One API call per scrub event — Miko does not need to
      orchestrate parallel layer requests himself.

      Response shape:
      {
        "t":    "2025-06-01T12:00:00Z",
        "bbox": [west, south, east, north],
        "layers": {
          "fmi":       { <GeoJSON FeatureCollection> },
          "osm":       { <GeoJSON FeatureCollection> },
          "astronomy": { <GeoJSON FeatureCollection> }
        },
        "source_status": {
          "fmi": "ok",
          "osm": "ok",
          "astronomy": "ok"
        },
        "meta": {
          "fetch_ms": 842,
          "sources_requested": ["fmi", "osm", "astronomy"],
          "sources_time_aware": ["fmi", "osm", "astronomy"]
        }
      }

WHICH SOURCES ARE TIME-AWARE:

  fmi          ✅  Historical observations since ~2010. Resolution: 1 hour.
                    Fetches the observation window that ends at t.

  osm          ✅  Full history since 2007-10-08 (OSM global history start).
                    Resolution: seconds (Overpass [date:...] syntax).
                    Shows which hospitals, roads, etc. existed at that moment.

  astronomy    ✅  Any date — computed locally from orbital mechanics.
                    Resolution: seconds. Perfect for timeline scrubbing.

  fmi_forecast ❌  Only produces data for future t. For past t, returns
                    empty with status="unavailable" and an explanation.
                    Miko should hide the forecast layer when t is in the past.

  starlink     ❌  Real-time only. TLE propagation produces current position only.

  mml          ❌  Static terrain — no historical API, same data for all t.

  digiroad     ❌  Current road network snapshot only.

  syke         ❌  Current flood risk assessment only.

  exposure     ❌  Derived from terrain — same as mml.

  statfin      ⚠️  Annual census data. Meaningful resolution = 1 year.
                    Returns the same data for all t within the same calendar
                    year. Useful for decade-scale demographic trends.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..bbox import BBox, parse_bbox
from ..registry import PROVIDERS

router = APIRouter(prefix="/api/timeline", tags=["timeline"])

# Sources that genuinely respond to t with different data.
# Order matters: fmi first (fastest), then osm (external), then astronomy (local).
TIME_AWARE_SOURCES: list[str] = ["fmi", "osm", "astronomy"]

# All sources, with their time-awareness metadata.
CAPABILITIES: dict[str, dict[str, Any]] = {
    "fmi": {
        "time_aware": True,
        "min_date": "2010-01-01",
        "max_date": "now",
        "resolution": "1h",
        "note": "FMI weather station observations. Returns the 1-hour window ending at t.",
    },
    "osm": {
        "time_aware": True,
        "min_date": "2007-10-08",
        "max_date": "now",
        "resolution": "1s",
        "note": (
            "OpenStreetMap infrastructure via Overpass [date:] filter. "
            "Shows which hospitals, roads, bridges, airfields existed at t."
        ),
    },
    "astronomy": {
        "time_aware": True,
        "min_date": "1900-01-01",
        "max_date": "2100-12-31",
        "resolution": "1s",
        "note": "Sun/moon/twilight — computed locally from orbital mechanics, any date.",
    },
    "fmi_forecast": {
        "time_aware": False,
        "reason": "HARMONIE NWP only produces future forecasts. Use fmi for past data.",
    },
    "starlink": {
        "time_aware": False,
        "reason": "TLE propagation gives current position only; historical not supported.",
    },
    "mml": {
        "time_aware": False,
        "reason": "Static Finnish terrain polygons — no historical API.",
    },
    "mml_contours": {
        "time_aware": False,
        "reason": "Static elevation contours — no historical API.",
    },
    "digiroad": {
        "time_aware": False,
        "reason": "Current road network snapshot only.",
    },
    "syke": {
        "time_aware": False,
        "reason": "Current flood risk assessment only.",
    },
    "exposure": {
        "time_aware": False,
        "reason": "Derived from terrain — same as mml.",
    },
    "opencellid": {
        "time_aware": False,
        "reason": "Cell tower database — no historical API.",
    },
    "statfin": {
        "time_aware": True,
        "min_date": "2010-01-01",
        "max_date": "now",
        "resolution": "1y",
        "note": "Annual census data — same data for all t within a calendar year.",
    },
}


@router.get("/capabilities")
def capabilities() -> dict[str, Any]:
    """Return the time-awareness manifest for all data sources.

    Miko uses this to:
    - Enable/disable layer toggles based on whether the source supports t.
    - Set the scrubber's minimum date to the oldest supported source.
    - Show tooltips explaining why a layer is greyed out.
    """
    time_aware = [sid for sid, cap in CAPABILITIES.items() if cap.get("time_aware")]
    return {
        "time_aware_sources": time_aware,
        "snapshot_sources": TIME_AWARE_SOURCES,
        "oldest_supported_date": "2007-10-08",  # OSM history start
        "sources": CAPABILITIES,
    }


@router.get("/snapshot")
async def snapshot(
    bbox: BBox = Depends(parse_bbox),
    t: datetime = Query(
        ...,
        description="ISO 8601 UTC timestamp to fetch data at, e.g. 2025-06-01T12:00:00Z",
    ),
    sources: str = Query(
        ",".join(TIME_AWARE_SOURCES),
        description=f"Comma-separated source IDs to include. "
                    f"Must be time-aware. Defaults: {','.join(TIME_AWARE_SOURCES)}",
    ),
) -> JSONResponse:
    """Fetch all requested time-aware sources at t in a single parallel call.

    This is the main endpoint for the timeline scrubber. One call per scrub
    event instead of N parallel layer requests. Returns all layers together
    so Miko can update the map atomically.

    Only time-aware sources (listed in /api/timeline/capabilities) are
    accepted. Non-time-aware sources are silently skipped — their current
    state is always available via /api/layers/{source}.
    """
    t_utc = t.astimezone(timezone.utc)
    requested = [s.strip() for s in sources.split(",") if s.strip()]
    valid = [s for s in requested if CAPABILITIES.get(s, {}).get("time_aware")]

    t0 = time.monotonic()

    results = await asyncio.gather(
        *[PROVIDERS[s].fetch(bbox, t_utc) for s in valid if s in PROVIDERS],
        return_exceptions=True,
    )

    layers: dict[str, Any] = {}
    source_status: dict[str, str] = {}

    for src, res in zip(valid, results):
        if isinstance(res, Exception):
            source_status[src] = "error"
            layers[src] = {
                "type": "FeatureCollection",
                "features": [],
                "meta": {"source": src, "status": "error", "reason": str(res)},
            }
        else:
            source_status[src] = res.meta.status
            layers[src] = res.model_dump(mode="json")

    elapsed_ms = round((time.monotonic() - t0) * 1000)

    return JSONResponse({
        "t": t_utc.isoformat(),
        "bbox": bbox.as_list(),
        "layers": layers,
        "source_status": source_status,
        "meta": {
            "fetch_ms": elapsed_ms,
            "sources_requested": requested,
            "sources_fetched": valid,
            "sources_skipped": [s for s in requested if s not in valid],
        },
    })
