"""FMI weather provider via the Finnish Meteorological Institute Open Data WFS.

Uses the `fmi::observations::weather::simple` stored query, which returns one
GML element per (station, time, parameter). We group these by station+time and
emit one GeoJSON Point feature per observation with all parameter values in
`properties.measurements`. No API key required for this stored query.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

import httpx

from .. import cache
from ..bbox import BBox
from ..http_client import get_client
from ..schemas import FeatureCollection, LayerMeta, empty_collection
from .base import Provider

WFS_URL = "https://opendata.fmi.fi/wfs"
STORED_QUERY = "fmi::observations::weather::simple"
DEFAULT_PARAMETERS: tuple[str, ...] = (
    "temperature",
    "windspeedms",
    "winddirection",
    "humidity",
    "pressure",
    "precipitation1h",
    "visibility",
)
CACHE_TTL_SECONDS = 30 * 60  # 30 min — observations update ~10 min

NS = {
    "wfs": "http://www.opengis.net/wfs/2.0",
    "BsWfs": "http://xml.fmi.fi/schema/wfs/2.0",
    "gml": "http://www.opengis.net/gml/3.2",
}


def _time_window(t: datetime | None) -> tuple[datetime, datetime]:
    """Return (start, end) covering the most recent hour up to t (default: now)."""
    end = (t or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return end - timedelta(hours=1), end


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_response(xml_text: str) -> list[dict]:
    """Group BsWfsElement records by (lat, lon, time) and return GeoJSON features."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f"invalid FMI XML response: {e}") from e

    # key: (lat, lon, time-iso) -> dict of parameter -> value
    grouped: dict[tuple[float, float, str], dict[str, float]] = defaultdict(dict)
    station_names: dict[tuple[float, float], str | None] = {}

    for elem in root.iter(f"{{{NS['BsWfs']}}}BsWfsElement"):
        pos_node = elem.find(".//gml:pos", NS)
        time_node = elem.find("BsWfs:Time", NS)
        name_node = elem.find("BsWfs:ParameterName", NS)
        value_node = elem.find("BsWfs:ParameterValue", NS)
        if pos_node is None or time_node is None or name_node is None or value_node is None:
            continue
        pos_text = (pos_node.text or "").strip().split()
        if len(pos_text) != 2:
            continue
        # FMI uses lat lon axis order for EPSG:4326 in WFS 2.0 GML output.
        try:
            lat = float(pos_text[0])
            lon = float(pos_text[1])
            value = float(value_node.text or "nan")
        except ValueError:
            continue
        # NaN values mean "no observation" — skip rather than emit junk.
        if value != value:  # NaN check
            continue
        key = (lat, lon, (time_node.text or "").strip())
        grouped[key][name_node.text or "unknown"] = value
        station_names.setdefault((lat, lon), None)

    features: list[dict] = []
    for (lat, lon, time_iso), measurements in grouped.items():
        if not measurements:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "source": "fmi",
                "time": time_iso,
                "measurements": measurements,
            },
        })
    return features


class FMIProvider(Provider):
    def __init__(self) -> None:
        super().__init__(id="fmi", label="FMI — Finnish Meteorological Institute")

    async def fetch(self, bbox: BBox, t: datetime | None) -> FeatureCollection:
        start, end = _time_window(t)
        # Round the cache key to the hour so concurrent requests share results.
        cache_key = {
            "bbox": bbox.as_list(),
            "start": _iso(start.replace(minute=0, second=0, microsecond=0)),
            "end": _iso(end.replace(minute=0, second=0, microsecond=0)),
            "params": list(DEFAULT_PARAMETERS),
        }

        cached = cache.read(self.id, cache_key, CACHE_TTL_SECONDS)
        if cached is not None:
            self.mark("ok", "served from cache")
            return FeatureCollection(
                features=cached.get("features", []),
                meta=LayerMeta(
                    source=self.id, status="ok", reason="served from cache",
                    bbox=bbox.as_list(), t=t,
                ),
            )

        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "getFeature",
            "storedquery_id": STORED_QUERY,
            # FMI WFS expects bbox as lon,lat,lon,lat with explicit CRS suffix.
            "bbox": f"{bbox.min_lon},{bbox.min_lat},{bbox.max_lon},{bbox.max_lat},EPSG::4326",
            "starttime": _iso(start),
            "endtime": _iso(end),
            "parameters": ",".join(DEFAULT_PARAMETERS),
        }

        try:
            client = get_client()
            resp = await client.get(WFS_URL, params=params, timeout=30.0)
            resp.raise_for_status()
            xml_text = resp.text
        except httpx.HTTPError as e:
            self.mark("unavailable", f"FMI WFS error: {e}")
            return empty_collection(
                self.id, status="unavailable", reason=f"FMI WFS error: {e}",
                bbox=bbox.as_list(), t=t,
            )

        try:
            features = _parse_response(xml_text)
        except ValueError as e:
            self.mark("unavailable", str(e))
            return empty_collection(
                self.id, status="unavailable", reason=str(e),
                bbox=bbox.as_list(), t=t,
            )

        cache.write(self.id, cache_key, {"features": features})
        status = "ok" if features else "partial"
        reason = f"{len(features)} observations" if features else "no observations in window"
        self.mark(status, reason)
        return FeatureCollection(
            features=features,
            meta=LayerMeta(
                source=self.id, status=status, reason=reason,
                bbox=bbox.as_list(), t=t,
            ),
        )
