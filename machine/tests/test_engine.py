import pytest

from api.geometry import haversine_m
from api.maneuvers import turn_modifier
from api.places import is_emergency_destination
from tests.conftest import node_point


def test_neural_route_takes_the_avenue_and_explains_the_turns(city_engine):
    result = city_engine.calculate(node_point(1, 0), node_point(1, 6))
    neural = result["neural"]
    shortest = result["shortest"]

    streets = [step["street"] for step in neural["steps"]]
    assert streets == ["Rua Coluna 0", "Avenida Sul", "Rua Coluna 6", "Rua Coluna 6"]
    assert [step["type"] for step in neural["steps"]] == ["depart", "turn", "turn", "arrive"]
    assert [step["modifier"] for step in neural["steps"][1:3]] == ["left", "left"]

    # The straight street is shorter in metres but slower; the comparison
    # the project exists to show must come out of the same request.
    assert shortest["distance_meters"] < neural["distance_meters"]
    assert neural["estimated_time_seconds"] < shortest["estimated_time_seconds"] * 0.9
    assert neural["shared_with_shortest"] == 0
    assert neural["composition"]["primary"] == pytest.approx(612, abs=15)


def test_steps_segments_and_geometry_describe_the_same_walk(city_engine):
    neural = city_engine.calculate(node_point(1, 0), node_point(5, 6))["neural"]

    assert sum(step["distance_meters"] for step in neural["steps"]) == pytest.approx(
        neural["distance_meters"], abs=len(neural["steps"])
    )
    assert len(neural["segments"]) == neural["node_count"] - 1
    assert neural["segments"][0]["start"] == 0
    assert neural["segments"][-1]["end"] == len(neural["geometry"]) - 1
    for previous, current in zip(neural["segments"], neural["segments"][1:]):
        assert current["start"] == previous["end"]

    avenue = [segment for segment in neural["segments"] if segment["highway"] == "primary"]
    assert avenue and all(segment["speed_kmh"] == pytest.approx(60, abs=0.5) for segment in avenue)


@pytest.mark.parametrize("destination", [(1, 6), (5, 6), (0, 6)])
def test_shared_streets_have_the_same_time_in_normal_and_neural_routes(city_engine, destination):
    result = city_engine.calculate(node_point(1, 0), node_point(*destination))

    def edge_times(route):
        return {
            tuple(tuple(point) for point in route["geometry"][segment["start"]:segment["end"] + 1]): segment["time_seconds"]
            for segment in route["segments"]
        }

    normal = edge_times(result["shortest"])
    neural = edge_times(result["neural"])
    shared = normal.keys() & neural.keys()
    if destination != (1, 6):
        assert shared
    for edge in shared:
        assert normal[edge] == neural[edge]


def test_identical_routes_arrive_at_the_same_time(city_engine):
    result = city_engine.calculate(node_point(0, 0), node_point(0, 6))
    assert result["neural"]["geometry"] == result["shortest"]["geometry"]
    assert result["neural"]["estimated_time_seconds"] == result["shortest"]["estimated_time_seconds"]
    assert result["neural"]["segments"] == result["shortest"]["segments"]


def test_a_closure_moves_the_route_off_the_blocked_street(city_engine):
    blocked = node_point(0, 3)
    closures = [{"latitude": blocked[0], "longitude": blocked[1], "radius_m": 30}]

    result = city_engine.calculate(node_point(1, 0), node_point(1, 6), closures=closures)

    assert result["closures"]["blocked_edges"] > 0
    for variant in ("neural", "shortest"):
        for point in result[variant]["geometry"]:
            assert haversine_m(point, list(blocked)) > 30


def test_closures_that_seal_the_destination_are_reported(city_engine):
    corner = node_point(6, 6)
    closures = [{"latitude": corner[0], "longitude": corner[1], "radius_m": 60}]

    with pytest.raises(ValueError, match="closures"):
        city_engine.calculate(node_point(0, 0), corner, closures=closures)


def test_isochrones_grow_with_time_and_count_points_by_travel_time(city_engine):
    centre = node_point(3, 3)
    result = city_engine.isochrones(
        [centre],
        [2, 1],
        points=[centre, node_point(6, 6), (centre[0] + 1, centre[1])],
    )

    one, two = result["isochrones"]
    assert (one["minutes"], two["minutes"]) == (1, 2)
    assert 0 < one["area_km2"] < two["area_km2"]
    assert one["reached_nodes"] < two["reached_nodes"]
    assert two["geometry"]["type"] == "MultiPolygon"

    points = result["points"]
    assert points["times_seconds"][0] == 0
    assert points["times_seconds"][2] is None
    assert points["covered"] == {"1": 1, "2": 2}


def test_isochrones_are_cached_until_the_graph_changes(city_engine):
    first = city_engine.isochrones([node_point(3, 3)], [1])
    second = city_engine.isochrones([node_point(3, 3)], [1])
    assert first["isochrones"] is second["isochrones"]


def test_travel_times_rank_points_against_one_anchor(city_engine):
    anchor = node_point(3, 3)
    results = city_engine.travel_times(
        anchor,
        [node_point(3, 4), node_point(6, 6), (anchor[0] + 1, anchor[1])],
        direction="to_anchor",
    )

    near, far, outside = results
    assert near["reachable"] and far["reachable"]
    assert near["time_seconds"] < far["time_seconds"]
    assert near["distance_meters"] == pytest.approx(102, abs=5)
    assert outside == {
        "reachable": False,
        "time_seconds": None,
        "distance_meters": None,
        "snap_distance_meters": outside["snap_distance_meters"],
    }


@pytest.mark.parametrize(
    ("incoming", "outgoing", "expected"),
    [
        (0, 0, "straight"),
        (0, 90, "right"),
        (0, 270, "left"),
        (350, 30, "slight_right"),
        (90, 240, "sharp_right"),
        (0, 180, "uturn"),
    ],
)
def test_turn_modifier(incoming, outgoing, expected):
    assert turn_modifier(incoming, outgoing) == expected


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"name": "UPA Central", "amenity": "hospital", "emergency": "yes"}, True),
        ({"name": "Hospital Regional", "amenity": "hospital"}, True),
        ({"name": "Unimed - Pronto Atendimento", "amenity": "hospital"}, True),
        ({"name": "Hospital de Custódia", "amenity": "hospital", "emergency": "no"}, False),
        ({"name": "Edra Odontologia", "amenity": "clinic"}, False),
        ({"name": "Davita hemodiálise", "amenity": "hospital"}, False),
        ({"amenity": "hospital", "emergency": "yes"}, False),
    ],
)
def test_only_emergency_destinations_are_listed(tags, expected):
    assert is_emergency_destination(tags) is expected


def test_isochrones_skip_origins_outside_the_network(city_engine):
    far_away = (-23.55, -46.63)
    result = city_engine.isochrones([far_away, node_point(3, 3)], [1])
    assert result["skipped_origins"] == [0]
    assert result["isochrones"][0]["area_km2"] > 0

    with pytest.raises(ValueError, match="None of the origins"):
        city_engine.isochrones([far_away], [1])
