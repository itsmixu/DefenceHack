"""bbox query parameter parsing. Format: minLon,minLat,maxLon,maxLat (EPSG:4326)."""
from __future__ import annotations

from fastapi import HTTPException, Query


class BBox:
    __slots__ = ("min_lon", "min_lat", "max_lon", "max_lat")

    def __init__(self, min_lon: float, min_lat: float, max_lon: float, max_lat: float):
        self.min_lon = min_lon
        self.min_lat = min_lat
        self.max_lon = max_lon
        self.max_lat = max_lat

    def as_list(self) -> list[float]:
        return [self.min_lon, self.min_lat, self.max_lon, self.max_lat]

    def __repr__(self) -> str:
        return f"BBox({self.min_lon},{self.min_lat},{self.max_lon},{self.max_lat})"


def parse_bbox(
    bbox: str = Query(
        ...,
        description="EPSG:4326 bbox as minLon,minLat,maxLon,maxLat",
        examples=["24.5,60.1,25.3,60.4"],
    ),
) -> BBox:
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(400, "bbox must be minLon,minLat,maxLon,maxLat")
    try:
        min_lon, min_lat, max_lon, max_lat = (float(p) for p in parts)
    except ValueError as e:
        raise HTTPException(400, f"bbox values must be numeric: {e}") from None
    if not (-180 <= min_lon <= 180 and -180 <= max_lon <= 180):
        raise HTTPException(400, "longitude out of range [-180, 180]")
    if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
        raise HTTPException(400, "latitude out of range [-90, 90]")
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(400, "bbox min must be less than max")
    return BBox(min_lon, min_lat, max_lon, max_lat)
