import networkx as nx
import pytest
import os
from shapely.geometry import LineString, shape

from tests.conftest import build_city, node_id, node_point


def test_edge_costs_use_actual_graph_costs_and_geojson_coordinates(city_engine):
    result = city_engine.edge_costs()
    assert result["type"] == "FeatureCollection"
    assert len(result["features"]) == city_engine._graph.number_of_edges()
    assert result["model_version"] == "test"
    for feature, (u, v, key, edge) in zip(result["features"], city_engine._graph.edges(keys=True, data=True)):
        assert feature["properties"]["cost_seconds"] == edge["neural_cost"]
        assert feature["geometry"]["coordinates"][0] == list(reversed(node_point(u // 7, u % 7)))
        assert feature["geometry"]["type"] == "LineString"


def test_edge_costs_filter_bbox_and_invalidate_on_graph_install(city_engine):
    bbox = (-45.5601, -23.0301, -45.5589, -23.0299)
    whole = city_engine.edge_costs()
    first = city_engine.edge_costs(bbox)
    assert 0 < len(first["features"]) < len(whole["features"])
    assert city_engine.edge_costs(bbox) is first
    city_engine.use_graph(build_city(), "new-model")
    assert city_engine.edge_costs(bbox)["model_version"] == "new-model"
    assert city_engine.edge_costs(bbox) is not first


@pytest.mark.parametrize("start,end", [(0, 48), (7, 13), (3, 3), (42, 6), (15, 37)])
def test_traced_search_is_identical_to_networkx_including_ties(city_engine, start, end):
    from api.search import traced_shortest_path
    for weight in ("length", "neural_cost", "critical_cost"):
        graph = city_engine._critical_graph if weight == "critical_cost" else city_engine._graph
        path, explored = traced_shortest_path(graph, start, end, weight)
        assert path == nx.shortest_path(graph, start, end, weight=weight)
        assert explored[0] == start
        assert end in explored


def test_trace_is_opt_in_bounded_and_leaves_route_unchanged(city_engine):
    origin, destination = node_point(1, 0), node_point(5, 6)
    original = city_engine.calculate(origin, destination, critical_mode=True)
    traced = city_engine.calculate(origin, destination, critical_mode=True, trace=True)
    for variant in ("neural", "shortest", "critical"):
        exploration = traced[variant].pop("exploration")
        assert 0 < len(exploration) <= 4000
        assert all(len(point) == 2 for point in exploration)
        assert traced[variant] == original[variant]


def test_route_features_use_correct_index_on_curved_geometry(city_engine):
    graph = build_city()
    u, v = node_id(0, 0), node_id(0, 1)
    a, b = node_point(0, 0), node_point(0, 1)
    curve = LineString([(a[1], a[0]), ((a[1] + b[1]) / 2, a[0] + .00005), (b[1], b[0])])
    graph[u][v][0].update(geometry=curve, bridge="yes", maxweight="12", maxheight="4.2", width="3")
    graph.nodes[v].update(highway="traffic_signals", traffic_calming="hump")
    city_engine.use_graph(graph, "features")
    result = city_engine.calculate(a, node_point(0, 2))["neural"]
    features = result["route_features"]
    signal = next(feature for feature in features if feature["type"] == "traffic_signals")
    assert signal["geometry_index"] == 2
    assert signal["location"] == list(b) == result["geometry"][2]
    assert {feature["type"] for feature in features} >= {"traffic_signals", "speed_bump", "bridge", "max_weight", "max_height", "narrow"}


def test_multisource_areas_assign_nodes_to_fastest_station(city_engine):
    from api.coverage import station_ownership
    graph = city_engine._graph
    sources = [node_id(0, 0), node_id(6, 6)]
    owners = station_ownership(graph, sources, "neural_cost")
    distances = [nx.single_source_dijkstra_path_length(graph, source, weight="neural_cost") for source in sources]
    for node, owner in owners.items():
        assert distances[owner][node] == min(distance[node] for distance in distances)
    result = city_engine.unit_areas([node_point(0, 0), node_point(6, 6)])
    assert sum(area["reached_nodes"] for area in result["areas"]) == graph.number_of_nodes()
    assert len(result["areas"]) == 2
    assert all(shape(area["area"]).is_valid for area in result["areas"])
    assert city_engine.unit_areas([node_point(0, 0), node_point(6, 6)]) is result


def test_station_outside_network_is_reported_without_fabricated_area(city_engine):
    result = city_engine.unit_areas([node_point(0, 0), (-10, -40)])
    assert result["skipped_origins"] == [1]
    assert result["areas"][1] == {"origin_index": 1, "area": None, "reached_nodes": 0}


def test_exploration_sampling_preserves_first_and_last_and_stays_bounded():
    from api.search import exploration_points
    graph = nx.DiGraph()
    for index in range(9000):
        graph.add_node(index, x=float(index), y=-23.0)
    result = exploration_points(graph, list(graph.nodes))
    assert len(result) == 4000
    assert result[0] == [-23.0, 0.0]
    assert result[-1] == [-23.0, 8999.0]


def test_edge_cost_response_limit_is_explicit(city_engine, monkeypatch):
    import api.edge_costs as module
    monkeypatch.setattr(module, "MAX_EDGE_FEATURES", 2)
    with pytest.raises(ValueError, match="bbox menor"):
        city_engine.edge_costs()


@pytest.mark.skipif(os.environ.get("RUN_REAL_GRAPH_TESTS") != "1", reason="Requer checkpoint e cache OSM locais; RUN_REAL_GRAPH_TESTS=1")
def test_real_taubate_route_keeps_networkx_path_and_cost():
    from api.engine import RouteEngine
    from api.search import traced_shortest_path
    from src.pathfinding.pathfinder import edge_between
    engine = RouteEngine()
    engine.load()
    graph = engine._graph
    connected = max(nx.strongly_connected_components(graph), key=len)
    nodes = sorted(connected)
    origin, destination = nodes[0], nodes[-1]
    for weight in ("neural_cost", "length", "critical_cost"):
        current = engine._critical_graph if weight == "critical_cost" else graph
        expected = nx.shortest_path(current, origin, destination, weight=weight)
        actual, _ = traced_shortest_path(current, origin, destination, weight)
        assert actual == expected
        assert sum(edge_between(current, u, v, weight)[weight] for u, v in zip(actual, actual[1:])) == sum(edge_between(current, u, v, weight)[weight] for u, v in zip(expected, expected[1:]))
