"""CRS reprojection helpers. All API responses are EPSG:4326 (AGENTS.md §5).

Many Finnish authority datasets (MML, Digiroad, Paavo) ship in EPSG:3067
(ETRS-TM35FIN). Reprojection happens here, in the backend, before the
GeoJSON ever crosses the wire.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from pyproj import Transformer

WGS84 = "EPSG:4326"


@lru_cache(maxsize=16)
def _transformer(src_crs: str, dst_crs: str) -> Transformer:
    # always_xy=True forces lon/lat output regardless of CRS axis convention.
    return Transformer.from_crs(src_crs, dst_crs, always_xy=True)


def _transform_coords(coords: Any, tx: Transformer) -> Any:
    """Recursively walk a GeoJSON `coordinates` value, transforming each (x, y)."""
    if not coords:
        return coords
    first = coords[0]
    # Position: [x, y] or [x, y, z]
    if isinstance(first, (int, float)):
        x, y = tx.transform(coords[0], coords[1])
        return [x, y] if len(coords) == 2 else [x, y, coords[2]]
    return [_transform_coords(c, tx) for c in coords]


def reproject_geometry(geom: dict, src_crs: str, dst_crs: str = WGS84) -> dict:
    if geom is None or src_crs == dst_crs:
        return geom
    if geom.get("type") == "GeometryCollection":
        return {
            "type": "GeometryCollection",
            "geometries": [
                reproject_geometry(g, src_crs, dst_crs) for g in geom.get("geometries", [])
            ],
        }
    tx = _transformer(src_crs, dst_crs)
    return {
        "type": geom["type"],
        "coordinates": _transform_coords(geom.get("coordinates"), tx),
    }


def reproject_bbox(
    bbox: tuple[float, float, float, float],
    src_crs: str,
    dst_crs: str,
) -> tuple[float, float, float, float]:
    """Transform a (minX, minY, maxX, maxY) bbox between CRSes."""
    tx = _transformer(src_crs, dst_crs)
    xs, ys = tx.transform([bbox[0], bbox[2]], [bbox[1], bbox[3]])
    return min(xs), min(ys), max(xs), max(ys)
