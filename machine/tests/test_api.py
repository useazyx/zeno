import pytest
from fastapi.testclient import TestClient

import api.main as service
from tests.conftest import build_city, node_point

# Without the context manager the lifespan hook never runs, so the real
# Taubate graph is not downloaded: the synthetic city is installed instead.
client = TestClient(service.app)


@pytest.fixture(autouse=True)
def synthetic_city():
    service.engine.use_graph(build_city(), "test")
    yield


def route_body(**extra):
    origin, destination = node_point(1, 0), node_point(1, 6)
    return {
        "origin_latitude": origin[0],
        "origin_longitude": origin[1],
        "destination_latitude": destination[0],
        "destination_longitude": destination[1],
        **extra,
    }


def test_routes_returns_all_variants_with_steps():
    response = client.post("/routes", json=route_body(critical_mode=True))

    assert response.status_code == 200
    body = response.json()
    assert body["model_version"] == "test"
    for variant in ("neural", "critical", "shortest"):
        assert body[variant]["steps"][0]["type"] == "depart"
        assert body[variant]["steps"][-1]["type"] == "arrive"
    assert body["closures"] == {"count": 0, "blocked_edges": 0}


def test_routes_validates_closure_radius():
    closure = {"latitude": -23.03, "longitude": -45.557, "radius_m": 5000}
    response = client.post("/routes", json=route_body(closures=[closure]))
    assert response.status_code == 422


def test_routes_outside_the_city_is_a_client_error():
    response = client.post("/routes", json=route_body(destination_latitude=-22.0))
    assert response.status_code == 400
    assert "outside the area" in response.json()["detail"]


def test_isochrones_reject_thresholds_beyond_half_an_hour():
    origin = node_point(3, 3)
    response = client.post("/isochrones", json={
        "origins": [{"latitude": origin[0], "longitude": origin[1]}],
        "minutes": [4, 45],
    })
    assert response.status_code == 422


def test_isochrones_return_geojson():
    origin = node_point(3, 3)
    response = client.post("/isochrones", json={
        "origins": [{"latitude": origin[0], "longitude": origin[1]}],
        "minutes": [1, 2],
    })
    assert response.status_code == 200
    areas = response.json()["isochrones"]
    assert [area["minutes"] for area in areas] == [1, 2]
    assert areas[0]["geometry"]["type"] == "MultiPolygon"


def test_travel_times_keep_the_order_of_the_points():
    anchor, near, far = node_point(3, 3), node_point(3, 4), node_point(6, 6)
    response = client.post("/travel-times", json={
        "anchor": {"latitude": anchor[0], "longitude": anchor[1]},
        "points": [
            {"latitude": far[0], "longitude": far[1]},
            {"latitude": near[0], "longitude": near[1]},
        ],
    })
    assert response.status_code == 200
    first, second = response.json()["results"]
    assert first["time_seconds"] > second["time_seconds"]


def test_engine_not_loaded_is_unavailable(monkeypatch):
    monkeypatch.setattr(service.engine, "_loaded", False)
    response = client.post("/routes", json=route_body())
    assert response.status_code == 503


def test_edge_costs_validates_bbox_and_compresses_the_real_geojson():
    response = client.get("/edge-costs", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert len(response.json()["features"]) == service.engine.graph_size[1]
    for invalid in ("1,2,3", "nan,0,1,2", "0,0,181,1", "1,1,0,0"):
        assert client.get("/edge-costs", params={"bbox": invalid}).status_code == 422


def test_trace_only_appears_when_requested():
    assert "exploration" not in client.post("/routes", json=route_body()).json()["neural"]
    response = client.post("/routes", json=route_body(trace=True))
    assert response.status_code == 200
    assert response.json()["neural"]["exploration"]


def test_unit_areas_validates_and_keeps_origin_order():
    origins = [node_point(0, 0), node_point(6, 6)]
    response = client.post("/unit-areas", json={
        "origins": [{"latitude": lat, "longitude": lon} for lat, lon in origins],
        "critical_mode": True,
    })
    assert response.status_code == 200
    assert response.json()["critical_mode"] is True
    assert [area["origin_index"] for area in response.json()["areas"]] == [0, 1]
    assert client.post("/unit-areas", json={"origins": []}).status_code == 422
