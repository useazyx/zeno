"""
Emergency destinations taken from OpenStreetMap.

A rescue unit (UR) that reaches a victim still has a second leg to drive: to a
hospital or emergency care unit that can receive the patient. OSM tags every
clinic, dentist and dialysis centre as healthcare too, so the list is narrowed
to places that take emergencies: an explicit `emergency=yes`, or a hospital
whose name says it is one. Anything tagged `emergency=no` is out.

The download happens once, on the first request, and OSMnx keeps the HTTP
response in its cache folder, so a restart does not hit Overpass again.
"""

import math
import re
import threading

import osmnx as ox

EMERGENCY_NAME = re.compile(r"hospital|pronto[ -]atendimento|\bupa\b|santa casa|pronto[ -]socorro", re.IGNORECASE)


def _text(value) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    return text or None


def is_emergency_destination(tags: dict) -> bool:
    name = _text(tags.get("name"))
    emergency = (_text(tags.get("emergency")) or "").lower()
    amenity = (_text(tags.get("amenity")) or "").lower()

    if emergency == "no" or name is None:
        return False
    if emergency == "yes":
        return True
    return amenity == "hospital" and bool(EMERGENCY_NAME.search(name))


class HospitalDirectory:
    def __init__(self, place: str) -> None:
        self._place = place
        self._lock = threading.Lock()
        self._hospitals: list[dict] | None = None

    def all(self) -> list[dict]:
        with self._lock:
            if self._hospitals is None:
                self._hospitals = self._download()
            return self._hospitals

    def _download(self) -> list[dict]:
        features = ox.features_from_place(
            self._place,
            {"amenity": ["hospital", "clinic"], "healthcare": ["hospital", "emergency"]},
        )

        hospitals = []
        for (element, osm_id), row in features.iterrows():
            tags = row.to_dict()
            if not is_emergency_destination(tags):
                continue
            point = row.geometry.centroid if row.geometry.geom_type != "Point" else row.geometry
            hospitals.append({
                "id": f"{element}/{osm_id}",
                "name": _text(tags.get("name")),
                "latitude": round(point.y, 7),
                "longitude": round(point.x, 7),
                "emergency": (_text(tags.get("emergency")) or "").lower() == "yes",
                "phone": _text(tags.get("phone")) or _text(tags.get("contact:phone")),
            })

        hospitals.sort(key=lambda hospital: hospital["name"])
        return hospitals
