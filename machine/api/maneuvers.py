"""
What a computed path means to the people using it.

`shortest_path` returns a list of intersections. The driver needs a list of
manoeuvres ("turn right onto Avenida X in 300 m"), and the dispatcher reviewing
the neural route needs to see where the model expects the vehicle to be fast or
slow. Both are derived here from the same walk over the edges the router
picked, so the steps, the coloured segments and the drawn line always agree.

The output is structured (type + modifier + street), not prose: wording is the
client's job, which keeps the language of the interface out of the engine.
"""

import math

from api.geometry import bearing
from src.neural.path_network import PathNetwork
from src.pathfinding.pathfinder import edge_between, edge_shape

# Grouping used by the "composition" summary. Mirrors the five one-hot groups
# the network is trained on, so the explanation speaks the model's language.
HIGHWAY_CLASS: dict[str, str] = {
    "motorway": "highway", "motorway_link": "highway",
    "trunk": "highway", "trunk_link": "highway",
    "primary": "primary", "primary_link": "primary",
    "secondary": "secondary", "secondary_link": "secondary",
    "tertiary": "tertiary", "tertiary_link": "tertiary",
}


def _first(value):
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _text(value) -> str | None:
    value = _first(value)
    if value is None:
        return None
    # OSMnx fills missing tags with NaN when it builds the graph from a frame.
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip()
    return text or None


def street_name(edge: dict) -> str | None:
    return _text(edge.get("name")) or _text(edge.get("ref"))


def highway_type(edge: dict) -> str:
    return _text(edge.get("highway")) or "unclassified"


def highway_class(edge: dict) -> str:
    return HIGHWAY_CLASS.get(highway_type(edge), "local")


def _is_roundabout(edge: dict) -> bool:
    return (_text(edge.get("junction")) or "").lower() in {"roundabout", "circular"}


def _distinct_end(shape: list[list[float]], from_start: bool) -> tuple[list[float], list[float]]:
    """
    Two points far enough apart to give a stable bearing at one end of a shape.

    The last vertices of an OSM way are often a few centimetres apart, which
    would make the bearing of the final segment pure noise.
    """
    points = shape if from_start else shape[::-1]
    anchor = points[0]
    for point in points[1:]:
        if abs(point[0] - anchor[0]) + abs(point[1] - anchor[1]) > 2e-5:
            return (anchor, point) if from_start else (point, anchor)
    other = points[-1]
    return (anchor, other) if from_start else (other, anchor)


def turn_modifier(incoming: float, outgoing: float) -> str:
    """Classify the change of heading between two bearings."""
    delta = (outgoing - incoming + 540.0) % 360.0 - 180.0
    side = "right" if delta > 0 else "left"
    magnitude = abs(delta)

    if magnitude <= 20:
        return "straight"
    if magnitude <= 50:
        return f"slight_{side}"
    if magnitude <= 125:
        return side
    if magnitude <= 165:
        return f"sharp_{side}"
    return "uturn"


def walk(graph, path: list, weight: str, time_weight: str) -> list[dict]:
    """
    One record per traversed edge, with its slice of the drawn geometry.

    `start`/`end` index into the polyline built by `path_geometry`, which starts
    with the first node and appends every shape without its first point.
    """
    records = []
    index = 0

    for u, v in zip(path, path[1:]):
        edge = edge_between(graph, u, v, weight)
        shape = edge_shape(graph, u, v, edge)
        length = float(edge.get("length", 0.0))
        time_s = float(edge.get(time_weight, edge.get("neural_cost", 0.0)))
        highway = highway_type(edge)

        records.append({
            "u": u,
            "v": v,
            "edge": edge,
            "shape": shape,
            "start": index,
            "end": index + len(shape) - 1,
            "length": length,
            "time": time_s,
            "highway": highway,
            "name": street_name(edge),
            "roundabout": _is_roundabout(edge),
        })
        index += len(shape) - 1

    return records


def segments(records: list[dict]) -> list[dict]:
    """
    Predicted speed against the posted limit for every edge of the route.

    This is the explanation of the neural route: where it is green the model
    expects the vehicle to flow near the limit; where it is red it expects
    intersections, narrow lanes or context to hold it back.
    """
    output = []
    for record in records:
        edge = record["edge"]
        speed = record["length"] / record["time"] * 3.6 if record["time"] > 0 else 0.0
        limit = PathNetwork._parse_speed(edge.get("maxspeed"), record["highway"])
        output.append({
            "start": record["start"],
            "end": record["end"],
            "length_meters": round(record["length"], 1),
            "time_seconds": round(record["time"], 2),
            "speed_kmh": round(speed, 1),
            "limit_kmh": round(limit, 1),
            "highway": record["highway"],
            "street": record["name"],
            "counterflow": bool(edge.get("critical_reverse")),
            "shoulder": bool(edge.get("critical_uses_shoulder")),
            **({"incline": _text(edge["incline"])} if _text(edge.get("incline")) else {}),
        })
    return output


def composition(records: list[dict]) -> dict[str, int]:
    """Metres travelled on each class of road."""
    totals = {"highway": 0.0, "primary": 0.0, "secondary": 0.0, "tertiary": 0.0, "local": 0.0}
    for record in records:
        totals[HIGHWAY_CLASS.get(record["highway"], "local")] += record["length"]
    return {key: round(value) for key, value in totals.items()}


def steps(records: list[dict]) -> list[dict]:
    """
    Turn-by-turn instructions.

    A new step starts when the street changes, when the vehicle enters a
    roundabout, or when it turns hard while keeping the same street name (a
    corner where the same avenue bends 90 degrees is still a manoeuvre).
    """
    if not records:
        return []

    output: list[dict] = []

    def open_step(kind: str, modifier: str | None, record: dict) -> dict:
        step = {
            "type": kind,
            "modifier": modifier,
            "street": record["name"],
            "highway": record["highway"],
            "distance_meters": 0.0,
            "time_seconds": 0.0,
            "location": record["shape"][0],
            "geometry_index": record["start"],
        }
        output.append(step)
        return step

    current = open_step("depart", None, records[0])
    current["bearing"] = round(bearing(*_distinct_end(records[0]["shape"], True)))

    for previous, record in zip([None] + records[:-1], records):
        if previous is not None:
            incoming = bearing(*_distinct_end(previous["shape"], False))
            outgoing = bearing(*_distinct_end(record["shape"], True))
            modifier = turn_modifier(incoming, outgoing)

            if record["roundabout"] and not previous["roundabout"]:
                current = open_step("roundabout", None, record)
            elif previous["roundabout"] and not record["roundabout"]:
                # Leaving the roundabout: the step that entered it is named
                # after the street it leads to, which is what a driver reads.
                if current["type"] == "roundabout":
                    current["street"] = record["name"]
                    current["exit_bearing"] = round(outgoing)
                current = open_step("continue", "straight", record)
            elif record["roundabout"]:
                pass
            elif record["name"] != previous["name"]:
                current = open_step("turn", modifier, record)
            elif modifier not in {"straight", "slight_left", "slight_right"}:
                current = open_step("turn", modifier, record)

        current["distance_meters"] += record["length"]
        current["time_seconds"] += record["time"]

    last = records[-1]
    output.append({
        "type": "arrive",
        "modifier": None,
        "street": last["name"],
        "highway": last["highway"],
        "distance_meters": 0.0,
        "time_seconds": 0.0,
        "location": last["shape"][-1],
        "geometry_index": last["end"],
    })

    # A "continue" right after a roundabout with no length of its own adds
    # nothing for the driver; neither does a zero-length step from an OSM
    # artefact. Both are dropped.
    cleaned: list[dict] = []
    for step in output:
        if (
            cleaned
            and step["type"] in {"turn", "continue"}
            and step["distance_meters"] < 1.0
        ):
            continue
        cleaned.append(step)

    for step in cleaned:
        step["distance_meters"] = round(step["distance_meters"])
        step["time_seconds"] = round(step["time_seconds"], 1)

    return cleaned
