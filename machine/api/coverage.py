"""
Response-time coverage over the street graph.

An isochrone answers "where can a vehicle leaving this station be in N
minutes", using the same predicted travel times the router uses. It is the
standard planning tool for fire services (NFPA 1710 sets 4 minutes of travel
for the first engine), and here it falls out of one Dijkstra run with a cutoff:
every edge the search reaches in time is part of the area, and the edge where
time runs out contributes only the fraction the vehicle can still cover.

The reached street lines are buffered into a polygon in metres. Drawing a
convex hull instead would paint the whole valley between two avenues as
covered, which is exactly the kind of confident lie a coverage map must avoid.
"""

import networkx as nx
import shapely
from heapq import heappop, heappush
from itertools import count
from shapely.geometry import LineString, MultiPolygon, Polygon, mapping
from shapely.ops import substring, transform

from api.geometry import LocalProjection
from src.pathfinding.pathfinder import edge_shape

# How far either side of a reached street still counts as covered. Roughly a
# hose lay plus the depth of a lot, so a house set back from the road is in.
STREET_BUFFER_M = 90.0
SIMPLIFY_M = 12.0
MAX_AREA_COORDINATES = 100000

# The last metres from the snapped intersection to the actual point are not
# routed; they are priced at a slow urban speed so a far-off point is not
# counted as reached just because its nearest node is.
LAST_MILE_SPEED_MS = 25 / 3.6


def reach(graph, sources: list, weight: str, cutoff: float) -> dict:
    """Seconds from the nearest source to every node reachable within cutoff."""
    return nx.multi_source_dijkstra_path_length(graph, set(sources), cutoff=cutoff, weight=weight)


def station_ownership(graph, sources: list, weight: str) -> dict:
    # Uma única busca para todos os quartéis; guardamos só o dono de cada nó,
    # sem armazenar milhares de caminhos completos em memória.
    serial, queue, distances, owners = count(), [], {}, {}
    for index, node in enumerate(sources):
        if node is not None and node not in distances:
            distances[node] = 0.0
            heappush(queue, (0.0, next(serial), node, index))
    while queue:
        distance, _, node, owner = heappop(queue)
        if node in owners:
            continue
        owners[node] = owner
        for neighbor, edges in graph[node].items():
            cost = min(float(edge.get(weight, 1)) for edge in edges.values())
            candidate = distance + cost
            if neighbor not in owners and candidate < distances.get(neighbor, float("inf")):
                distances[neighbor] = candidate
                heappush(queue, (candidate, next(serial), neighbor, owner))
    return owners


def _buffered_area(lines):
    if not lines:
        return Polygon()
    simplified = shapely.simplify(lines, SIMPLIFY_M)
    area = shapely.union_all(shapely.buffer(simplified, STREET_BUFFER_M, quad_segs=2)).simplify(SIMPLIFY_M)
    return MultiPolygon([area]) if isinstance(area, Polygon) and not area.is_empty else area


def station_areas(graph, sources: list, weight: str, projection: LocalProjection) -> list[dict]:
    owners = station_ownership(graph, sources, weight)
    lines = [[] for _ in sources]
    counts = [0 for _ in sources]
    for node, owner in owners.items():
        counts[owner] += 1
        for neighbor, edges in graph[node].items():
            edge = min(edges.values(), key=lambda data: data.get(weight, float("inf")))
            line = LineString([projection.to_xy(lon, lat) for lat, lon in edge_shape(graph, node, neighbor, edge)])
            if line.length <= 0:
                continue
            other = owners.get(neighbor)
            if other is not None and other != owner:
                # A fronteira no trecho une as áreas dos dois nós sem pintar
                # um quarteirão inteiro só por estar dentro de um convex hull.
                lines[owner].append(substring(line, 0, .5, normalized=True))
                lines[other].append(substring(line, .5, 1, normalized=True))
            else:
                lines[owner].append(line)
    output, coordinates = [], 0
    for index, station_lines in enumerate(lines):
        area = _buffered_area(station_lines)
        coordinates += int(shapely.get_num_coordinates(area))
        if coordinates > MAX_AREA_COORDINATES:
            raise ValueError("As áreas excedem o limite de geometria da cidade")
        geographic = transform(lambda x, y, z=None: projection.to_lonlat(x, y), area) if not area.is_empty else area
        output.append({"origin_index": index, "area": mapping(geographic) if not area.is_empty else None, "reached_nodes": counts[index]})
    return output


def _reached_lines(graph, times: dict, weight: str, limit: float, projection: LocalProjection):
    lines = []
    # A two-way street is two edges with the same drawing; fully reached
    # streets are kept once.
    whole: set[frozenset] = set()
    for u, start_time in times.items():
        if start_time > limit:
            continue
        for v, edges in graph[u].items():
            # Parallel edges: the router would take the cheapest one.
            edge = min(edges.values(), key=lambda data: data.get(weight, float("inf")))
            cost = float(edge.get(weight, 0.0))
            shape = edge_shape(graph, u, v, edge)
            line = LineString([projection.to_xy(lon, lat) for lat, lon in shape])
            if line.length == 0:
                continue

            if start_time + cost <= limit or cost <= 0:
                pair = frozenset((u, v))
                if pair not in whole:
                    whole.add(pair)
                    lines.append(line)
            else:
                fraction = (limit - start_time) / cost
                if fraction > 0.02:
                    lines.append(substring(line, 0, fraction, normalized=True))
    return lines


def isochrones(
    graph,
    sources: list,
    weight: str,
    minutes: list[int],
    projection: LocalProjection,
    times: dict | None = None,
) -> list[dict]:
    """
    One GeoJSON (multi)polygon per threshold, smallest first.

    `times` may come from a search the caller already ran with a cutoff at
    least as large as the biggest threshold; every comparison below is against
    the threshold, so a longer search changes nothing in the polygons.
    """
    thresholds = sorted(set(minutes))
    if times is None:
        times = reach(graph, sources, weight, thresholds[-1] * 60.0)

    result = []
    for threshold in thresholds:
        lines = _reached_lines(graph, times, weight, threshold * 60.0, projection)
        area = _buffered_area(lines)

        geographic = transform(lambda x, y, z=None: projection.to_lonlat(x, y), area) if not area.is_empty else area

        result.append({
            "minutes": threshold,
            "area_km2": round(area.area / 1_000_000, 2),
            "reached_nodes": sum(1 for value in times.values() if value <= threshold * 60.0),
            "geometry": mapping(geographic) if not geographic.is_empty else None,
        })

    return result


def point_times(times: dict, snapped: list[tuple]) -> list[float | None]:
    """
    Travel time to each point, given the snap of every point to the graph.

    `snapped` holds (node, distance_m) pairs, with node None for points outside
    the covered area.
    """
    output = []
    for node, distance in snapped:
        if node is None or node not in times:
            output.append(None)
        else:
            output.append(round(times[node] + distance / LAST_MILE_SPEED_MS, 1))
    return output
