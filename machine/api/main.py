"""
FastAPI service that exposes the AI to the Node backend.

The Node side owns all business logic and persistence; this service only
answers two questions: "what is the best route between these points" and
"what is the state of the model".
"""

import os
import sys
import math
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from starlette.middleware.gzip import GZipMiddleware

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.engine import CITY, engine
from api.places import HospitalDirectory
from api.training import manager

hospitals = HospitalDirectory(CITY)
GZIP_MINIMUM_BYTES = 1000
MAX_AREA_ORIGINS = 50


class Point(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class Closure(Point):
    radius_m: float = Field(default=40, ge=5, le=500)


class RouteRequest(BaseModel):
    origin_latitude: float = Field(ge=-90, le=90)
    origin_longitude: float = Field(ge=-180, le=180)
    destination_latitude: float = Field(ge=-90, le=90)
    destination_longitude: float = Field(ge=-180, le=180)
    critical_mode: bool = False
    trace: bool = False
    closures: list[Closure] = Field(default_factory=list, max_length=50)


class IsochroneRequest(BaseModel):
    origins: list[Point] = Field(min_length=1, max_length=50)
    minutes: list[int] = Field(default=[4, 8, 12], min_length=1, max_length=6)
    critical_mode: bool = False
    # Optional sample of occurrence coordinates to count against each area.
    points: list[Point] | None = Field(default=None, max_length=20000)


class TravelTimeRequest(BaseModel):
    anchor: Point
    points: list[Point] = Field(min_length=1, max_length=500)
    direction: Literal["to_anchor", "from_anchor"] = "to_anchor"
    critical_mode: bool = False
    closures: list[Closure] = Field(default_factory=list, max_length=50)


class TrainingRequest(BaseModel):
    epochs: int = Field(default=800, ge=10, le=5000)


class UnitAreaRequest(BaseModel):
    origins: list[Point] = Field(min_length=1, max_length=MAX_AREA_ORIGINS)
    critical_mode: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Loading here rather than lazily means the first dispatch of the day is
    # as fast as the rest. A missing model is logged, not fatal: the training
    # endpoint has to stay reachable so the model can be produced.
    try:
        engine.load()
        nodes, edges = engine.graph_size
        print(f"Route engine ready: {nodes} nodes, {edges} edges from {CITY}")
    except Exception as error:
        print(f"Route engine unavailable: {error}")

    yield


app = FastAPI(
    title="Fire Department Routing AI",
    description="Neural routing service backing the Node API",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=GZIP_MINIMUM_BYTES)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "engine_loaded": engine.loaded}


@app.get("/model")
def model_info() -> dict:
    nodes, edges = engine.graph_size

    return {
        "loaded": engine.loaded,
        "model_version": engine.model_version,
        "city": CITY,
        "graph_nodes": nodes,
        "graph_edges": edges,
        "bounds": engine.bounds,
    }


def _run(operation):
    """Shared error mapping for every endpoint that needs the loaded graph."""
    if not engine.loaded:
        raise HTTPException(
            status_code=503,
            detail="The route engine is not loaded. Train the model and restart the service.",
        )

    try:
        return operation()
    except ValueError as error:
        # Coordinates outside the graph or with no connecting path: the caller
        # sent something unusable, so this is a 400, not a server failure.
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error))


@app.post("/routes")
def calculate_route(request: RouteRequest) -> dict:
    return _run(lambda: engine.calculate(
        (request.origin_latitude, request.origin_longitude),
        (request.destination_latitude, request.destination_longitude),
        critical_mode=request.critical_mode,
        trace=request.trace,
        closures=[closure.model_dump() for closure in request.closures],
    ))


@app.get("/edge-costs")
def get_edge_costs(bbox: str | None = None) -> dict:
    bounds = None
    if bbox is not None:
        try:
            bounds = tuple(float(value) for value in bbox.split(","))
            if len(bounds) != 4 or not all(math.isfinite(value) for value in bounds):
                raise ValueError()
            west, south, east, north = bounds
            if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                raise ValueError()
        except ValueError:
            raise HTTPException(status_code=422, detail="bbox must be minLon,minLat,maxLon,maxLat")
    return _run(lambda: engine.edge_costs(bounds))


@app.post("/unit-areas")
def calculate_unit_areas(request: UnitAreaRequest) -> dict:
    return _run(lambda: engine.unit_areas(
        [(origin.latitude, origin.longitude) for origin in request.origins], request.critical_mode,
    ))


@app.post("/isochrones")
def calculate_isochrones(request: IsochroneRequest) -> dict:
    if any(minute < 1 or minute > 30 for minute in request.minutes):
        raise HTTPException(status_code=422, detail="Each threshold must be between 1 and 30 minutes")

    return _run(lambda: engine.isochrones(
        [(origin.latitude, origin.longitude) for origin in request.origins],
        request.minutes,
        critical_mode=request.critical_mode,
        points=None if request.points is None else [(point.latitude, point.longitude) for point in request.points],
    ))


@app.post("/travel-times")
def calculate_travel_times(request: TravelTimeRequest) -> dict:
    results = _run(lambda: engine.travel_times(
        (request.anchor.latitude, request.anchor.longitude),
        [(point.latitude, point.longitude) for point in request.points],
        direction=request.direction,
        critical_mode=request.critical_mode,
        closures=[closure.model_dump() for closure in request.closures],
    ))
    return {
        "direction": request.direction,
        "critical_mode": request.critical_mode,
        "model_version": engine.model_version,
        "results": results,
    }


@app.get("/places/hospitals")
def list_hospitals() -> dict:
    try:
        return {"hospitals": hospitals.all()}
    except Exception as error:
        # Overpass being down must not look like "there are no hospitals".
        raise HTTPException(status_code=503, detail=f"Hospital directory unavailable: {error}")


@app.post("/training", status_code=202)
def start_training(request: TrainingRequest) -> dict:
    try:
        job = manager.start(request.epochs, on_finish=engine.reload)
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error))

    return job.to_dict()


@app.get("/training/{job_id}")
def get_training(job_id: str) -> dict:
    job = manager.get(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail="Training job not found")

    return job.to_dict()
