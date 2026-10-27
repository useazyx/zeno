"""
Small geodesic helpers shared by the route analysis modules.

The street graph is kept in latitude/longitude because that is what the client
draws. Buffers, areas and distances, however, only make sense in metres, so the
modules that need them go through a local equirectangular projection centred
on the city. Over a municipality-sized area the error is well under 1%.
"""

import math

EARTH_RADIUS_M = 6_371_008.8


class LocalProjection:
    """Flat metric plane tangent to the city centre."""

    def __init__(self, latitude: float, longitude: float) -> None:
        self.latitude = latitude
        self.longitude = longitude
        self._mx = math.radians(1) * EARTH_RADIUS_M * math.cos(math.radians(latitude))
        self._my = math.radians(1) * EARTH_RADIUS_M

    def to_xy(self, longitude: float, latitude: float) -> tuple[float, float]:
        return (
            (longitude - self.longitude) * self._mx,
            (latitude - self.latitude) * self._my,
        )

    def to_lonlat(self, x: float, y: float) -> tuple[float, float]:
        return (
            x / self._mx + self.longitude,
            y / self._my + self.latitude,
        )


def bearing(a: list[float], b: list[float]) -> float:
    """Initial compass bearing from a to b, both as [latitude, longitude]."""
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlon = math.radians(b[1] - a[1])
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def haversine_m(a: list[float], b: list[float]) -> float:
    """Great-circle distance in metres between two [latitude, longitude] points."""
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlat = lat2 - lat1
    dlon = math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))
