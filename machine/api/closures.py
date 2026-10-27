"""
Road closures reported by the dispatcher.

A closure is a point and a radius: a collapsed wall, a flooded underpass, a
crash blocking an avenue. Every edge whose drawn street passes inside the
circle is hidden from the router for that request only, so the graph the model
weighted is never modified and a closure cannot leak into the next dispatch.
"""

import networkx as nx
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from api.geometry import LocalProjection
from src.pathfinding.pathfinder import edge_shape


class ClosureIndex:
    """Spatial index over the edges of one graph, in metres."""

    def __init__(self, graph, projection: LocalProjection) -> None:
        self._projection = projection
        self._keys: list[tuple] = []
        lines = []

        for u, v, key, edge in graph.edges(keys=True, data=True):
            shape = edge_shape(graph, u, v, edge)
            lines.append(LineString([projection.to_xy(lon, lat) for lat, lon in shape]))
            self._keys.append((u, v, key))

        self._tree = STRtree(lines)

    def blocked_edges(self, closures: list[dict]) -> set[tuple]:
        blocked: set[tuple] = set()
        for closure in closures:
            x, y = self._projection.to_xy(closure["longitude"], closure["latitude"])
            circle = Point(x, y).buffer(closure["radius_m"], quad_segs=4)
            for index in self._tree.query(circle, predicate="intersects"):
                blocked.add(self._keys[int(index)])
        return blocked


def without(graph, blocked: set[tuple]):
    """A read-only view of the graph with the blocked edges hidden."""
    if not blocked:
        return graph
    return nx.restricted_view(graph, [], list(blocked))
