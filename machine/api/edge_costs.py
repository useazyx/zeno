"""GeoJSON limitado e simplificado em metros para inspecionar os custos reais."""

from shapely.geometry import LineString, box

from api.maneuvers import highway_type, street_name
from src.neural.path_network import PathNetwork
from src.pathfinding.pathfinder import edge_shape

EDGE_SIMPLIFY_M = 2.0
MAX_EDGE_FEATURES = 50000
MAX_EDGE_COORDINATES = 200000


def edge_costs(graph, projection, model_version, bbox=None):
    bounds = box(*bbox) if bbox else None
    features, coordinate_count = [], 0
    for u, v, key, edge in graph.edges(keys=True, data=True):
        points = edge_shape(graph, u, v, edge)
        geographic = LineString([(lon, lat) for lat, lon in points])
        if bounds is not None and not geographic.intersects(bounds):
            continue
        line = LineString([projection.to_xy(lon, lat) for lat, lon in points]).simplify(EDGE_SIMPLIFY_M)
        coordinates = [list(projection.to_lonlat(x, y)) for x, y in line.coords]
        coordinate_count += len(coordinates)
        if len(features) >= MAX_EDGE_FEATURES or coordinate_count > MAX_EDGE_COORDINATES:
            raise ValueError("Muitas ruas na área solicitada; informe um bbox menor")
        cost = float(edge["neural_cost"])
        highway = highway_type(edge)
        features.append({
            "type": "Feature", "id": f"{u}:{v}:{key}",
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "properties": {
                "cost_seconds": cost,
                "attention_1": edge.get("attention_1"),
                "attention_2": edge.get("attention_2"),
                "speed_kmh": round(float(edge.get("length", 0)) / cost * 3.6, 1) if cost > 0 else 0,
                "limit_kmh": PathNetwork._parse_speed(edge.get("maxspeed"), highway),
                "highway": highway, "street": street_name(edge),
            },
        })
    return {"type": "FeatureCollection", "model_version": model_version, "features": features}
