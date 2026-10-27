"""Atributos mapeados no OSM; ausência de tag nunca vira dado inventado."""

import re

from api.maneuvers import _text

NARROW_WIDTH_M = 3.5
MAX_ROUTE_FEATURES = 4000
SPEED_BUMP_VALUES = {"bump", "hump", "table", "cushion", "raised_crossing"}


def route_features(graph, records: list[dict]) -> list[dict]:
    output, added = [], set()

    def add(kind, index, location, value=None):
        key = (kind, index, value)
        if key in added:
            return
        if len(output) >= MAX_ROUTE_FEATURES:
            raise ValueError("A rota excede o limite de elementos viários; divida o trajeto")
        added.add(key)
        output.append({"type": kind, "geometry_index": index, "location": location, **({"value": value} if value is not None else {})})

    for record in records:
        for node, index, location in ((record["u"], record["start"], record["shape"][0]), (record["v"], record["end"], record["shape"][-1])):
            tags = graph.nodes[node]
            highway = _text(tags.get("highway"))
            if highway in {"traffic_signals", "stop", "crossing"}:
                add(highway, index, location)
            calming = _text(tags.get("traffic_calming"))
            if calming in SPEED_BUMP_VALUES:
                add("speed_bump", index, location, calming)
        edge, index, location = record["edge"], record["start"], record["shape"][0]
        bridge = _text(edge.get("bridge"))
        if bridge and bridge.lower() not in {"no", "false", "0"}:
            add("bridge", index, location, bridge)
        for tag, kind in (("maxweight", "max_weight"), ("maxheight", "max_height")):
            value = _text(edge.get(tag))
            if value and value.lower() not in {"none", "default", "no"}:
                add(kind, index, location, value)
        # Só larguras explicitamente métricas; 'narrow' e medidas em pés não
        # permitem afirmar a largura útil em metros sem conversão confiável.
        width = _text(edge.get("width"))
        if width and re.fullmatch(r"\d+(?:[.,]\d+)?\s*(?:m)?", width):
            meters = float(width.rstrip("m ").replace(",", "."))
            if 0 < meters < NARROW_WIDTH_M:
                add("narrow", index, location, width)
    return sorted(output, key=lambda feature: feature["geometry_index"])
