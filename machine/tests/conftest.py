"""
A small synthetic city for the engine tests.

A 7x7 grid of intersections about 110 m apart, two-way residential streets,
and one fast avenue along the southern edge. Travel times are length over a
fixed speed per class, standing in for the network's prediction, so a test can
reason about which route must win without loading torch weights or
downloading Taubate.
"""

import networkx as nx
import pytest

from api.engine import RouteEngine

ORIGIN_LAT = -23.03
ORIGIN_LON = -45.56
STEP = 0.001
SIZE = 7

SPEED_MS = {"primary": 60 / 3.6, "residential": 25 / 3.6}


def node_id(row: int, col: int) -> int:
    return row * SIZE + col


def node_point(row: int, col: int) -> tuple[float, float]:
    """[latitude, longitude] of a grid intersection; row grows north, col east."""
    return (ORIGIN_LAT + row * STEP, ORIGIN_LON + col * STEP)


def _add_street(graph, a, b, highway, name):
    from api.geometry import haversine_m

    pa = (graph.nodes[a]["y"], graph.nodes[a]["x"])
    pb = (graph.nodes[b]["y"], graph.nodes[b]["x"])
    length = haversine_m(list(pa), list(pb))
    for u, v in ((a, b), (b, a)):
        graph.add_edge(
            u, v,
            length=length,
            highway=highway,
            name=name,
            oneway=False,
            lanes="2" if highway == "primary" else "1",
            neural_cost=length / SPEED_MS[highway],
        )


def build_city():
    graph = nx.MultiDiGraph(crs="epsg:4326")
    for row in range(SIZE):
        for col in range(SIZE):
            latitude, longitude = node_point(row, col)
            graph.add_node(node_id(row, col), y=latitude, x=longitude)

    for row in range(SIZE):
        for col in range(SIZE):
            if col + 1 < SIZE:
                highway = "primary" if row == 0 else "residential"
                name = "Avenida Sul" if row == 0 else f"Rua Linha {row}"
                _add_street(graph, node_id(row, col), node_id(row, col + 1), highway, name)
            if row + 1 < SIZE:
                _add_street(graph, node_id(row, col), node_id(row + 1, col), "residential", f"Rua Coluna {col}")

    return graph


@pytest.fixture()
def city_engine():
    engine = RouteEngine()
    engine.use_graph(build_city(), "test")
    return engine
