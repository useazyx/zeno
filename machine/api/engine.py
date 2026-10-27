"""
Holds the loaded street graph and the trained network in memory.

Loading the Taubate graph from OpenStreetMap and running the GAT over every
edge takes tens of seconds. Doing that per request would make the API useless,
so it happens once at startup and every route calculation reuses the result.
"""

import os
import sys
import threading
from collections import OrderedDict

import networkx as nx
import osmnx as ox
import torch
from shapely.geometry import LineString

MACHINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, MACHINE_ROOT)

from api import coverage, maneuvers
from api.closures import ClosureIndex, without
from api.geometry import LocalProjection
from api.edge_costs import edge_costs
from api.road_features import route_features
from api.search import exploration_points, traced_shortest_path
from src.neural.path_network import PathNetwork
from src.pathfinding.pathfinder import (
    apply_neural_weights,
    get_city_graph,
    path_geometry,
)

CITY = "Taubaté, São Paulo, Brasil"
MODEL_PATH = os.path.join(MACHINE_ROOT, "models", "path_network.pth")

# A coordinate is snapped to the closest node of the street graph. Without a
# bound, a point anywhere in the country would still snap to some Taubate
# corner and produce a confident, meaningless route, so anything farther than
# this from the network is rejected as outside the covered area.
MAX_SNAP_DISTANCE_M = 2000
VISUAL_CACHE_ENTRIES = 8

CRITICAL_COST_FACTOR: dict[str, float] = {
    "motorway": 0.94, "motorway_link": 0.96,
    "trunk": 0.93, "trunk_link": 0.95,
    "primary": 0.91, "primary_link": 0.94,
    "secondary": 0.92, "secondary_link": 0.95,
    "tertiary": 0.94, "tertiary_link": 0.96,
    "residential": 0.97, "living_street": 0.99,
    "service": 0.98, "unclassified": 0.96, "road": 0.96,
}
CRITICAL_SPEED_CAP_KMH: dict[str, float] = {
    "motorway": 130.0, "motorway_link": 80.0,
    "trunk": 110.0, "trunk_link": 75.0,
    "primary": 90.0, "primary_link": 70.0,
    "secondary": 80.0, "secondary_link": 65.0,
    "tertiary": 70.0, "tertiary_link": 60.0,
    "residential": 50.0, "living_street": 35.0,
    "service": 35.0, "unclassified": 55.0, "road": 55.0,
}
CRITICAL_REVERSE_TYPES = {
    "primary", "secondary", "tertiary",
    "residential", "unclassified", "service", "road",
}
RESTRICTED_ACCESS = {"no", "private"}
SHOULDER_VALUES = {"yes", "both", "left", "right", "paved", "designated"}


def _first(value, default=None):
    if isinstance(value, list):
        return value[0] if value else default
    return value if value is not None else default


def _number(value, default: float = 0.0) -> float:
    raw = _first(value, default)
    try:
        return float(str(raw).split(";")[0].split()[0])
    except (TypeError, ValueError, AttributeError):
        return default


class RouteEngine:
    """Graph plus model, guarded by a lock so a reload cannot race a request."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._graph = None
        self._critical_graph = None
        self._model_version: str | None = None
        self._loaded = False
        self._projection: LocalProjection | None = None
        self._closures: dict[str, ClosureIndex] = {}
        # Isochrones of the fixed stations are asked for on every visit to the
        # coverage screen; they only change when the model does.
        self._isochrone_cache: OrderedDict = OrderedDict()
        self._edge_cost_cache: OrderedDict = OrderedDict()
        self._unit_area_cache: OrderedDict = OrderedDict()

    @property
    def loaded(self) -> bool:
        return self._loaded

    @property
    def model_version(self) -> str | None:
        return self._model_version

    @property
    def graph_size(self) -> tuple[int, int]:
        if not self._loaded:
            return (0, 0)
        return (self._graph.number_of_nodes(), self._graph.number_of_edges())

    @property
    def bounds(self) -> dict | None:
        """
        The rectangle the loaded street network actually spans.

        The place polygon and the drivable network are not the same thing: the
        rural north of the municipality has almost no mapped roads, so a point
        can be inside Taubate and still be far from anything routable. Exposing
        the real extent lets the interface say where a point may be dropped
        instead of leaving the dispatcher to discover it from a rejection.
        """
        if not self._loaded:
            return None

        latitudes = [data["y"] for _, data in self._graph.nodes(data=True)]
        longitudes = [data["x"] for _, data in self._graph.nodes(data=True)]

        return {
            "min_latitude": min(latitudes),
            "max_latitude": max(latitudes),
            "min_longitude": min(longitudes),
            "max_longitude": max(longitudes),
            "max_snap_distance_m": MAX_SNAP_DISTANCE_M,
        }

    @staticmethod
    def _highway(edge: dict) -> str:
        return str(_first(edge.get("highway"), "unclassified")).strip()

    @staticmethod
    def _has_shoulder(edge: dict) -> bool:
        values = [
            edge.get("shoulder"),
            edge.get("shoulder:both"),
            edge.get("shoulder:left"),
            edge.get("shoulder:right"),
        ]
        return any(str(_first(value, "")).lower() in SHOULDER_VALUES for value in values)

    def _critical_edge_cost(self, edge: dict) -> float:
        """
        Emergency-operational cost for a legal-direction edge.

        This never invents a lane or cuts across unmapped space. It only
        discounts an already drivable OSM edge, with hard speed floors so the
        route cannot imply physically absurd travel times.
        """
        highway = self._highway(edge)
        length = max(float(edge.get("length", 0.0)), 0.0)
        base = max(float(edge.get("neural_cost", 0.1)), 0.1)

        factor = CRITICAL_COST_FACTOR.get(highway, 0.96)

        lanes = max(1.0, _number(edge.get("lanes"), 1.0))
        if lanes >= 3:
            factor *= 0.93
        elif lanes >= 2:
            factor *= 0.96

        if self._has_shoulder(edge) and highway in {
            "motorway", "motorway_link", "trunk", "trunk_link",
            "primary", "primary_link", "secondary", "secondary_link",
        }:
            # A mapped usable shoulder can provide an escape corridor in a
            # critical response. The geometry remains the mapped roadway.
            factor *= 0.88
            edge["critical_uses_shoulder"] = True

        if str(_first(edge.get("emergency"), "")).lower() in {"yes", "designated"}:
            factor *= 0.92

        speed_cap = CRITICAL_SPEED_CAP_KMH.get(highway, 55.0)
        physical_floor = length / max(speed_cap / 3.6, 0.1)

        # The critical profile gets only a modest advantage on an ordinary
        # edge. The large savings should come from an actual operational
        # exception (counterflow/shoulder), otherwise every route would look
        # artificially superior even when it follows the same streets.
        return max(base * factor, physical_floor, 0.1)

    def _can_reverse_for_critical(self, edge: dict) -> bool:
        """
        Conservative counterflow eligibility.

        It is limited to lower-speed urban roads where the map describes enough
        paved width to make the maneuver representable. Highways, roundabouts,
        bridges and tunnels are deliberately excluded.
        """
        oneway = str(_first(edge.get("oneway"), False)).lower() in {"true", "yes", "1"}
        if not oneway:
            return False

        highway = self._highway(edge)
        if highway not in CRITICAL_REVERSE_TYPES:
            return False

        if str(_first(edge.get("junction"), "")).lower() == "roundabout":
            return False

        if str(_first(edge.get("bridge"), "")).lower() not in {"", "no", "false", "none"}:
            return False

        if str(_first(edge.get("tunnel"), "")).lower() not in {"", "no", "false", "none"}:
            return False

        access = str(_first(edge.get("access"), "")).lower()
        motor_vehicle = str(_first(edge.get("motor_vehicle"), "")).lower()
        vehicle = str(_first(edge.get("vehicle"), "")).lower()
        if access in RESTRICTED_ACCESS or motor_vehicle in RESTRICTED_ACCESS or vehicle in RESTRICTED_ACCESS:
            return False

        lanes = max(1.0, _number(edge.get("lanes"), 1.0))
        width = _number(edge.get("width"), _number(edge.get("est_width"), 0.0))
        mapped_speed = _number(edge.get("maxspeed"), 0.0)

        # Counterflow needs evidence of physical room. Treating every
        # one-way residential street as reversible made the critical graph
        # unrealistically permissive. A mapped multi-lane carriageway or an
        # explicit usable width is required; higher-class urban roads get a
        # slightly wider threshold.
        if highway in {"primary", "secondary"}:
            wide_enough = lanes >= 2 or width >= 6.0
        elif highway == "tertiary":
            wide_enough = lanes >= 2 or width >= 5.5
        else:
            wide_enough = lanes >= 2 or width >= 5.0

        speed_ok = mapped_speed <= 60.0 or mapped_speed == 0.0
        return wide_enough and speed_ok

    def _build_critical_graph(self, graph):
        critical = graph.copy()

        # First assign the operational weight to every normal-direction edge.
        for _, _, _, edge in critical.edges(keys=True, data=True):
            edge["critical_uses_shoulder"] = False
            edge["critical_reverse"] = False
            edge["critical_cost"] = self._critical_edge_cost(edge)

        # Then add a small, explicit set of synthetic reverse edges. These are
        # intentionally penalized so a lawful direction wins unless counterflow
        # materially shortens a critical response.
        additions = []
        for u, v, key, edge in graph.edges(keys=True, data=True):
            if not self._can_reverse_for_critical(edge):
                continue

            reversed_edge = dict(edge)
            geometry = edge.get("geometry")
            if geometry is not None:
                reversed_edge["geometry"] = LineString(list(geometry.coords)[::-1])

            reversed_edge["oneway"] = False
            reversed_edge["critical_reverse"] = True
            reversed_edge["critical_uses_shoulder"] = False
            # Counterflow cannot reuse the model's normal-direction traffic
            # estimate: that estimate contains congestion/intersection behaviour
            # for ordinary traffic and made the synthetic reverse edge too
            # expensive to ever matter. Price the maneuver from physical road
            # length and the emergency speed cap, then add a 12% caution margin.
            highway = self._highway(reversed_edge)
            reverse_length = max(float(reversed_edge.get("length", 0.0)), 0.0)
            reverse_speed = CRITICAL_SPEED_CAP_KMH.get(highway, 50.0)
            reverse_floor = reverse_length / max(reverse_speed / 3.6, 0.1)
            # Entering a road against its mapped direction is not a free
            # shortcut: slowing, checking visibility and clearing opposing
            # traffic costs time. A fixed manoeuvre penalty prevents the router
            # from chaining dozens of tiny one-way reversals just because each
            # individual edge is physically short.
            reversed_edge["critical_cost"] = max(reverse_floor * 1.12 + 8.0, 0.1)

            additions.append((v, u, f"critical-reverse-{key}", reversed_edge))

        for u, v, key, edge in additions:
            critical.add_edge(u, v, key=key, **edge)

        return critical

    def load(self) -> None:
        """Download the graph, load the checkpoint and weight every edge."""
        with self._lock:
            if not os.path.exists(MODEL_PATH):
                raise FileNotFoundError(
                    f"Trained model not found at {MODEL_PATH}. "
                    "Run: poetry run python src/pathfinding/train.py"
                )

            graph = get_city_graph(CITY)
            checkpoint = torch.load(MODEL_PATH, weights_only=True)

            model = PathNetwork(
                edge_feat_size=checkpoint["edge_feat_size"],
                node_feat_size=checkpoint["node_feat_size"],
                gat_hidden=checkpoint["gat_hidden"],
                gat_heads=checkpoint["gat_heads"],
                gat_out_dim=checkpoint["gat_out_dim"],
                mlp_hidden=checkpoint["mlp_hidden"],
            )
            model.load_state_dict(checkpoint["model_state_dict"])
            model.eval()

            apply_neural_weights(
                graph, model,
                checkpoint["nf_mean"], checkpoint["nf_std"],
                checkpoint["ef_mean"], checkpoint["ef_std"],
                checkpoint["y_mean"], checkpoint["y_std"],
            )

            self.use_graph(graph, str(checkpoint.get("version", os.path.getmtime(MODEL_PATH))))

    def use_graph(self, graph, model_version: str) -> None:
        """
        Install an already weighted graph (every edge carrying `neural_cost`).

        `load` goes through here after running the network; tests use it
        directly with a small synthetic city, so they exercise the real
        routing code without downloading Taubate or loading torch weights.
        """
        with self._lock:
            latitudes = [data["y"] for _, data in graph.nodes(data=True)]
            longitudes = [data["x"] for _, data in graph.nodes(data=True)]
            projection = LocalProjection(
                (min(latitudes) + max(latitudes)) / 2,
                (min(longitudes) + max(longitudes)) / 2,
            )
            critical = self._build_critical_graph(graph)

            self._graph = graph
            self._critical_graph = critical
            self._projection = projection
            self._closures = {
                "neural_cost": ClosureIndex(graph, projection),
                "critical_cost": ClosureIndex(critical, projection),
            }
            self._isochrone_cache.clear()
            self._edge_cost_cache.clear()
            self._unit_area_cache.clear()
            self._model_version = model_version
            self._loaded = True

    def reload(self) -> None:
        """Called after a training run replaces the .pth file."""
        self._loaded = False
        self.load()

    def _variant(self, graph, origin_node, dest_node, weight: str, trace: bool = False) -> tuple[dict, list[dict]]:
        """
        One route, with its numbers, the line that draws it and what it means.

        Distance, time, geometry, steps and segments all come from the same
        walk over the path, so they can never disagree: every one of them reads
        the edge the router picked for each pair of intersections, and the
        drawn line measures the same as the distance it reports.
        """
        if trace:
            path, explored = traced_shortest_path(graph, origin_node, dest_node, weight)
        else:
            path = nx.shortest_path(graph, origin_node, dest_node, weight=weight)
        time_weight = "critical_cost" if weight == "critical_cost" else "neural_cost"
        records = maneuvers.walk(graph, path, weight, time_weight)

        result = {
            "distance_meters": round(sum(record["length"] for record in records)),
            "estimated_time_seconds": round(sum(record["time"] for record in records), 2),
            # The number of intersections, not of drawn points: it is what the
            # interface labels "cruzamentos".
            "node_count": len(path),
            "geometry": path_geometry(graph, path, weight),
            "steps": maneuvers.steps(records),
            "segments": maneuvers.segments(records),
            "route_features": route_features(graph, records),
            **({"exploration": exploration_points(graph, explored)} if trace else {}),
            "composition": maneuvers.composition(records),
        }

        if weight == "critical_cost":
            result["critical_maneuvers"] = {
                "counterflow_segments": sum(1 for record in records if record["edge"].get("critical_reverse")),
                "shoulder_segments": sum(1 for record in records if record["edge"].get("critical_uses_shoulder")),
            }

        return result, records

    @staticmethod
    def _shared_ratio(records: list[dict], other: list[dict]) -> float:
        """Share of a route's distance that runs on the same streets as another."""
        total = sum(record["length"] for record in records)
        if total <= 0:
            return 1.0
        other_edges = {(record["u"], record["v"]) for record in other}
        shared = sum(record["length"] for record in records if (record["u"], record["v"]) in other_edges)
        return round(shared / total, 3)

    def _restricted(self, graph, weight: str, closures: list[dict] | None):
        if not closures:
            return graph, 0
        blocked = self._closures[weight].blocked_edges(closures)
        return without(graph, blocked), len(blocked)

    def _snap(self, point: tuple[float, float], label: str):
        """Map a coordinate onto the nearest graph node, refusing far-away ones."""
        node, distance_m = ox.nearest_nodes(
            self._graph, point[1], point[0], return_dist=True
        )

        if distance_m > MAX_SNAP_DISTANCE_M:
            raise ValueError(
                f"The {label} is {round(distance_m)} m away from the nearest mapped "
                f"street, outside the area covered by {CITY}"
            )

        return node

    def _snap_many(self, points: list[tuple[float, float]]) -> list[tuple]:
        """Snap many [latitude, longitude] points at once; far ones get node None."""
        if not points:
            return []
        nodes, distances = ox.nearest_nodes(
            self._graph,
            [point[1] for point in points],
            [point[0] for point in points],
            return_dist=True,
        )
        return [
            (node, float(distance)) if distance <= MAX_SNAP_DISTANCE_M else (None, float(distance))
            for node, distance in zip(nodes, distances)
        ]

    def _weighted(self, critical_mode: bool):
        if critical_mode:
            return self._critical_graph, "critical_cost"
        return self._graph, "neural_cost"

    def calculate(
        self,
        origin: tuple[float, float],
        destination: tuple[float, float],
        critical_mode: bool = False,
        closures: list[dict] | None = None,
        trace: bool = False,
    ) -> dict:
        """
        Return both routes: the neural one (weighted by predicted travel time)
        and the shortest one in metres. Returning both is what lets the client
        show the comparison this project exists to demonstrate.

        `closures` hides the edges inside each reported circle for this
        request only; the loaded graph is never modified.
        """
        with self._lock:
            if not self._loaded:
                raise RuntimeError("The route engine is still loading")

            origin_node = self._snap(origin, "origin")
            dest_node = self._snap(destination, "destination")

            graph, blocked = self._restricted(self._graph, "neural_cost", closures)

            if not nx.has_path(graph, origin_node, dest_node):
                if blocked:
                    raise ValueError("The closures leave no route between these two points")
                raise ValueError("No route exists between these two points")

            normal, normal_records = self._variant(graph, origin_node, dest_node, "neural_cost", trace)
            shortest, shortest_records = self._variant(graph, origin_node, dest_node, "length", trace)
            normal["shared_with_shortest"] = self._shared_ratio(normal_records, shortest_records)

            critical = None
            if critical_mode:
                critical_graph, _ = self._restricted(self._critical_graph, "critical_cost", closures)
                critical, _ = self._variant(critical_graph, origin_node, dest_node, "critical_cost", trace)

            return {
                "neural": normal,
                "critical": critical,
                "shortest": shortest,
                "critical_mode": critical_mode,
                "closures": {"count": len(closures or []), "blocked_edges": blocked},
                "model_version": self._model_version,
            }

    def edge_costs(self, bbox=None) -> dict:
        with self._lock:
            if not self._loaded:
                raise RuntimeError("The route engine is still loading")
            key = tuple(bbox) if bbox else None
            if key not in self._edge_cost_cache:
                self._edge_cost_cache[key] = edge_costs(self._graph, self._projection, self._model_version, bbox)
                if len(self._edge_cost_cache) > VISUAL_CACHE_ENTRIES:
                    self._edge_cost_cache.popitem(last=False)
            self._edge_cost_cache.move_to_end(key)
            return self._edge_cost_cache[key]

    def unit_areas(self, origins: list[tuple[float, float]], critical_mode: bool = False) -> dict:
        with self._lock:
            if not self._loaded:
                raise RuntimeError("The route engine is still loading")
            key = (tuple(origins), critical_mode)
            if key not in self._unit_area_cache:
                graph, weight = self._weighted(critical_mode)
                snapped = self._snap_many(origins)
                sources = [node for node, _ in snapped]
                self._unit_area_cache[key] = {
                    "model_version": self._model_version, "critical_mode": critical_mode,
                    "skipped_origins": [index for index, node in enumerate(sources) if node is None],
                    "areas": coverage.station_areas(graph, sources, weight, self._projection),
                }
                if len(self._unit_area_cache) > VISUAL_CACHE_ENTRIES:
                    self._unit_area_cache.popitem(last=False)
            self._unit_area_cache.move_to_end(key)
            return self._unit_area_cache[key]

    def isochrones(
        self,
        origins: list[tuple[float, float]],
        minutes: list[int],
        critical_mode: bool = False,
        points: list[tuple[float, float]] | None = None,
    ) -> dict:
        """
        Area reachable from the nearest of the origins within each threshold.

        With `points`, also reports how many of them fall inside each one, by
        travel time over the network rather than by testing the polygon, so a
        point across a river from a covered street is not counted.
        """
        with self._lock:
            if not self._loaded:
                raise RuntimeError("The route engine is still loading")

            graph, weight = self._weighted(critical_mode)
            # An origin outside the street network (a command post in another
            # city) is skipped rather than failing the whole map; the caller is
            # told which ones were left out.
            snapped = self._snap_many(origins)
            skipped = [index for index, (node, _) in enumerate(snapped) if node is None]
            sources = sorted({node for node, _ in snapped if node is not None}, key=str)
            if not sources:
                raise ValueError(f"None of the origins is inside the area covered by {CITY}")
            thresholds = sorted(set(minutes))
            key = (tuple(sources), tuple(thresholds), critical_mode)

            # One search serves both the polygons and the demand points. With
            # points it runs to three times the largest threshold, so the
            # client can also say how late an uncovered call is reached.
            cutoff = max(thresholds) * 60.0 * (3 if points is not None else 1)
            times = None

            areas = self._isochrone_cache.get(key)
            if areas is None:
                times = coverage.reach(graph, sources, weight, cutoff)
                areas = coverage.isochrones(graph, sources, weight, thresholds, self._projection, times)
                self._isochrone_cache[key] = areas
                if len(self._isochrone_cache) > 64:
                    self._isochrone_cache.popitem(last=False)
            else:
                self._isochrone_cache.move_to_end(key)

            result = {
                "critical_mode": critical_mode,
                "model_version": self._model_version,
                "skipped_origins": skipped,
                "isochrones": areas,
            }

            if points is not None:
                if times is None:
                    times = coverage.reach(graph, sources, weight, cutoff)
                reached = coverage.point_times(times, self._snap_many(points))
                result["points"] = {
                    "total": len(points),
                    "times_seconds": reached,
                    "covered": {
                        str(threshold): sum(
                            1 for value in reached if value is not None and value <= threshold * 60
                        )
                        for threshold in thresholds
                    },
                }

            return result

    def travel_times(
        self,
        anchor: tuple[float, float],
        points: list[tuple[float, float]],
        direction: str = "to_anchor",
        critical_mode: bool = False,
        closures: list[dict] | None = None,
    ) -> list[dict]:
        """
        Predicted time and distance between one anchor and many points.

        `to_anchor` answers "which vehicle gets to this occurrence first": one
        search over the reversed graph prices every vehicle at once.
        `from_anchor` answers "which hospital is closest from here".
        """
        with self._lock:
            if not self._loaded:
                raise RuntimeError("The route engine is still loading")

            base, weight = self._weighted(critical_mode)
            graph, _ = self._restricted(base, weight, closures)
            anchor_node = self._snap(anchor, "anchor")
            search = graph.reverse(copy=False) if direction == "to_anchor" else graph

            # Predecessors, not full paths: building the path to every node of
            # the city just to read a handful of them cost far more than the
            # search itself, all of it under the engine lock.
            predecessors, times = nx.dijkstra_predecessor_and_distance(search, anchor_node, weight=weight)
            output = []

            for node, snap_distance in self._snap_many(points):
                if node is None or node not in times:
                    output.append({
                        "reachable": False,
                        "time_seconds": None,
                        "distance_meters": None,
                        "snap_distance_meters": round(snap_distance),
                    })
                    continue

                distance = 0.0
                current = node
                while current != anchor_node:
                    previous = predecessors[current][0]
                    cheapest = min(search[previous][current].values(), key=lambda data: data.get(weight, float("inf")))
                    distance += float(cheapest.get("length", 0.0))
                    current = previous

                output.append({
                    "reachable": True,
                    "time_seconds": round(times[node] + snap_distance / coverage.LAST_MILE_SPEED_MS, 1),
                    "distance_meters": round(distance + snap_distance),
                    "snap_distance_meters": round(snap_distance),
                })

            return output


engine = RouteEngine()
