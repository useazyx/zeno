import { env } from "../../config/env.js";
import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } from "../../errors/index.js";
import { MAX_OVERLAY_RESPONSE_BYTES } from "./routing-overlay-cache.js";

/// One manoeuvre of the turn-by-turn list. Structured rather than worded, so
/// the interface decides how to say "turn left" in its own language.
export type RouteStep = {
  type: "depart" | "turn" | "continue" | "roundabout" | "arrive",
  modifier: string | null,
  street: string | null,
  highway: string,
  distance_meters: number,
  time_seconds: number,
  location: [number, number],
  geometry_index: number
}

/// Predicted speed of one edge of the route, against its posted limit.
/// `start`/`end` index into the variant's geometry.
export type RouteSegment = {
  start: number,
  end: number,
  length_meters: number,
  time_seconds: number,
  speed_kmh: number,
  limit_kmh: number,
  highway: string,
  street: string | null,
  counterflow: boolean,
  shoulder: boolean
  incline?: string
}

export interface RouteFeature {
  type: "traffic_signals" | "stop" | "crossing" | "speed_bump" | "bridge" | "max_weight" | "max_height" | "narrow"
  geometry_index: number
  location: [number, number]
  value?: string
}

export interface RouteVariant {
  distance_meters: number,
  estimated_time_seconds: number,
  node_count: number,
  geometry: [number, number][],
  steps: RouteStep[],
  segments: RouteSegment[],
  route_features?: RouteFeature[],
  exploration?: [number, number][],
  /// Metres driven on each class of road.
  composition: Record<"highway" | "primary" | "secondary" | "tertiary" | "local", number>,
  /// Neural variant only: share of its distance on the same streets as the shortest.
  shared_with_shortest?: number,
  critical_maneuvers?: {
    counterflow_segments: number,
    shoulder_segments: number
  }
}

export interface RouteResponse {
  neural: RouteVariant,
  critical: RouteVariant | null,
  shortest: RouteVariant,
  critical_mode: boolean,
  closures: { count: number, blocked_edges: number },
  model_version: string | null
}

export interface GeoPoint {
  latitude: number,
  longitude: number
}

/// A street blocked by the dispatcher: every edge inside the circle is
/// avoided for that one calculation.
export interface Closure extends GeoPoint {
  radius_m: number
}

export interface Isochrone {
  minutes: number,
  area_km2: number,
  reached_nodes: number,
  geometry: { type: "MultiPolygon", coordinates: number[][][][] } | null
}

export interface IsochroneResponse {
  critical_mode: boolean,
  model_version: string | null,
  /// Indexes of the origins that fall outside the street network.
  skipped_origins: number[],
  isochrones: Isochrone[],
  points?: {
    total: number,
    times_seconds: (number | null)[],
    covered: Record<string, number>
  }
}

export interface EdgeCostsResponse {
  type: "FeatureCollection"
  model_version: string | null
  features: {
    type: "Feature", id: string,
    geometry: { type: "LineString", coordinates: [number, number][] },
    properties: { cost_seconds: number, speed_kmh: number, limit_kmh: number, highway: string, street: string | null }
  }[]
}

export interface UnitAreasResponse {
  model_version: string | null
  critical_mode: boolean
  skipped_origins: number[]
  areas: { origin_index: number, area: Isochrone["geometry"], reached_nodes: number }[]
}

export interface TravelTime {
  reachable: boolean,
  time_seconds: number | null,
  distance_meters: number | null,
  snap_distance_meters: number
}

export interface Hospital {
  id: string,
  name: string,
  latitude: number,
  longitude: number,
  emergency: boolean,
  phone: string | null
}

/// One line of the trainer's progress table.
///
/// Declared as a type alias rather than an interface so it can be handed to
/// Prisma's `Json` column: only an alias gets the implicit index signature
/// that `InputJsonValue` demands.
export type TrainingPoint = {
  epoch: number,
  train_loss: number | null,
  validation_loss: number | null,
  best_validation_loss: number | null
  learning_rate?: number | null
}

export interface TrainingJob {
  job_id: string,
  status: "PENDENTE" | "EXECUTANDO" | "CONCLUIDO" | "FALHOU",
  epochs: number,
  /// Last epoch the trainer reported. It moves in steps of 50, which is how
  /// often the trainer prints, and stops early when the run does.
  current_epoch: number | null,
  /// Every reported epoch, in order, so the client can draw the loss curve
  /// rather than a single final number.
  history: TrainingPoint[],
  train_loss: number | null,
  validation_loss: number | null,
  best_validation_loss: number | null,
  started_at: string | null,
  finished_at: string | null,
  error_message: string | null,
  model_path: string | null
}

/// The rectangle the street network spans. A point inside the city but far
/// from any mapped road is still refused, so the client needs the real extent
/// to warn before sending rather than after.
export interface GraphBounds {
  min_latitude: number,
  max_latitude: number,
  min_longitude: number,
  max_longitude: number,
  max_snap_distance_m: number
}

export interface ModelInfo {
  loaded: boolean,
  model_version: string | null,
  city: string,
  graph_nodes: number,
  graph_edges: number,
  bounds: GraphBounds | null
}

/// Thin HTTP client for the Python (FastAPI) side. Every network failure is
/// translated to ServiceUnavailableError so callers never leak fetch details,
/// and a 4xx from the AI service becomes a BadRequestError because it means
/// the coordinates we sent were rejected, not that the service is down.
export class AiClient {

  private async request<T>(method: string, path: string, body?: unknown, maxBytes?: number): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), env.AI_SERVICE_TIMEOUT_MS)

    let response: Response

    try {
      response = await fetch(`${env.AI_SERVICE_URL}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      })
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError"
        ? `did not answer within ${env.AI_SERVICE_TIMEOUT_MS}ms`
        : "is unreachable"
      throw new ServiceUnavailableError(`The AI service ${reason} (${env.AI_SERVICE_URL})`)
    } finally {
      clearTimeout(timeout)
    }

    const text = maxBytes ? await this.readLimitedResponse(response, maxBytes) : await response.text()
    const payload = text ? JSON.parse(text) : null

    // FastAPI answers a validation failure with an array of field errors, so
    // the detail is not always a string and cannot go straight into a message.
    const detail: string | null = typeof payload?.detail === "string"
      ? payload.detail
      : payload?.detail
        ? JSON.stringify(payload.detail)
        : null

    // A 404 and a 409 carry meaning the caller has to act on: the job the
    // service knew about is gone, or a training is already running there.
    // Collapsing both into a 400 would hide that.
    if (response.status === 404) {
      throw new NotFoundError(detail ?? "The AI service does not know this resource")
    }

    if (response.status === 409) {
      throw new ConflictError(detail ?? "The AI service refused a conflicting request")
    }

    if (response.status >= 400 && response.status < 500) {
      throw new BadRequestError(detail ?? "The AI service rejected the request")
    }

    if (!response.ok) {
      throw new ServiceUnavailableError(detail ?? `The AI service failed with status ${response.status}`)
    }

    return payload as T
  }

  // Interrompe a leitura antes de carregar uma camada inteira fora do limite.
  private async readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
    const reader = response.body?.getReader()
    if (!reader) {
      const text = await response.text()
      if (Buffer.byteLength(text) > maxBytes) throw new ServiceUnavailableError("A camada de mapa excedeu o limite de resposta")
      return text
    }
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxBytes) {
          await reader.cancel()
          throw new ServiceUnavailableError("A camada de mapa excedeu o limite de resposta")
        }
        chunks.push(value)
      }
      return Buffer.concat(chunks).toString("utf8")
    } finally {
      reader.releaseLock()
    }
  }

  async calculateRoute(
    origin: { latitude: number, longitude: number },
    destination: { latitude: number, longitude: number },
    options: { critical_mode?: boolean, closures?: Closure[], trace?: boolean } = {},
  ): Promise<RouteResponse> {
    return this.request<RouteResponse>("POST", "/routes", {
      origin_latitude: origin.latitude,
      origin_longitude: origin.longitude,
      destination_latitude: destination.latitude,
      destination_longitude: destination.longitude,
      ...(options.critical_mode ? { critical_mode: true } : {}),
      ...(options.closures?.length ? { closures: options.closures } : {}),
      ...(options.trace ? { trace: true } : {}),
    })
  }

  async edgeCosts(bbox?: string): Promise<EdgeCostsResponse> {
    return this.request<EdgeCostsResponse>("GET", `/edge-costs${bbox ? `?bbox=${encodeURIComponent(bbox)}` : ""}`, undefined, MAX_OVERLAY_RESPONSE_BYTES)
  }

  async unitAreas(origins: GeoPoint[], critical_mode = false): Promise<UnitAreasResponse> {
    return this.request<UnitAreasResponse>("POST", "/unit-areas", { origins, critical_mode }, MAX_OVERLAY_RESPONSE_BYTES)
  }

  async isochrones(
    origins: GeoPoint[],
    minutes: number[],
    options: { critical_mode?: boolean, points?: GeoPoint[] } = {},
  ): Promise<IsochroneResponse> {
    return this.request<IsochroneResponse>("POST", "/isochrones", {
      origins,
      minutes,
      critical_mode: options.critical_mode ?? false,
      ...(options.points ? { points: options.points } : {}),
    })
  }

  async travelTimes(
    anchor: GeoPoint,
    points: GeoPoint[],
    options: { direction?: "to_anchor" | "from_anchor", critical_mode?: boolean, closures?: Closure[] } = {},
  ): Promise<TravelTime[]> {
    const response = await this.request<{ results: TravelTime[] }>("POST", "/travel-times", {
      anchor,
      points,
      direction: options.direction ?? "to_anchor",
      critical_mode: options.critical_mode ?? false,
      ...(options.closures?.length ? { closures: options.closures } : {}),
    })
    return response.results
  }

  async hospitals(): Promise<Hospital[]> {
    const response = await this.request<{ hospitals: Hospital[] }>("GET", "/places/hospitals")
    return response.hospitals
  }

  async startTraining(epochs: number): Promise<TrainingJob> {
    return this.request<TrainingJob>("POST", "/training", { epochs })
  }

  async getTraining(jobId: string): Promise<TrainingJob> {
    return this.request<TrainingJob>("GET", `/training/${jobId}`)
  }

  async getModelInfo(): Promise<ModelInfo> {
    return this.request<ModelInfo>("GET", "/model")
  }
}
