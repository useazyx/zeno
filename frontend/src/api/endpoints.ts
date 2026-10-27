/**
 * Every backend endpoint the interface uses, grouped by entity.
 *
 * The backend wraps each answer in a named envelope (`{ units, total }`,
 * `{ occurrence }`), so the unwrapping happens here and the screens deal with
 * plain domain objects.
 */

import { api, query } from "./client"
import type {
  Closure, Coverage, Crew, EtaAccuracy, CrewRole, Dispatch, DispatchStatus, Firefighter, FirefighterStatus, HospitalOption, ModelInfo,
  Occurrence, OccurrenceNature, OccurrencePriority, OccurrenceStatisticsRow, OccurrenceStatus, Paginated, Place, Rank,
  ReferenceRoute, RoutePreview, RouteVariant, Shift, ShiftType, TimelineEntry, TrainingRun, Unit, UnitType,
  Vehicle, VehicleRecommendation, VehicleStatus, VehicleType, OperationalStatistics, WaterSource, WaterSourceStatus,
  WaterSourceType, Weather,
  PositionHistory, FleetHistory, EdgeCosts, UnitAreas, RouteWeather,
} from "./types"

interface ListParams {
  page?: number
  per_page?: number
  search?: string
}

function paginate<T>(envelope: Record<string, unknown>, key: string): Paginated<T> {
  return {
    items: (envelope[key] as T[]) ?? [],
    total: (envelope.total as number) ?? 0,
    page: (envelope.page as number) ?? 1,
    per_page: (envelope.per_page as number) ?? 20,
  }
}

// -- Units -------------------------------------------------------------------

export const units = {
  areas: (critical_mode = false) => api.get<UnitAreas>(`/units/areas${query({ critical_mode })}`),
  async list(params: ListParams & { type?: UnitType, parent_id?: string, active?: boolean } = {}): Promise<Paginated<Unit>> {
    const data = await api.get<Record<string, unknown>>(`/units${query({ ...params, per_page: params.per_page ?? 100 })}`)
    return paginate<Unit>(data, "units")
  },

  async get(id: string): Promise<Unit> {
    const data = await api.get<{ unit: Unit }>(`/units/${id}`)
    return data.unit
  },

  async create(input: Record<string, unknown>): Promise<Unit> {
    const data = await api.post<{ unit: Unit }>("/units", input)
    return data.unit
  },

  async update(id: string, input: Record<string, unknown>): Promise<Unit> {
    const data = await api.patch<{ unit: Unit }>(`/units/${id}`, input)
    return data.unit
  },

  remove: (id: string) => api.delete<{ message: string }>(`/units/${id}`),
}

// -- Firefighters ------------------------------------------------------------

export const firefighters = {
  async list(params: ListParams & { unit_id?: string, rank?: Rank, status?: FirefighterStatus } = {}): Promise<Paginated<Firefighter>> {
    const data = await api.get<Record<string, unknown>>(`/firefighters${query({ ...params })}`)
    return paginate<Firefighter>(data, "firefighters")
  },

  async get(id: string): Promise<Firefighter> {
    const data = await api.get<{ firefighter: Firefighter }>(`/firefighters/${id}`)
    return data.firefighter
  },

  async create(input: Record<string, unknown>): Promise<Firefighter> {
    const data = await api.post<{ firefighter: Firefighter }>("/firefighters", input)
    return data.firefighter
  },

  async update(id: string, input: Record<string, unknown>): Promise<Firefighter> {
    const data = await api.patch<{ firefighter: Firefighter }>(`/firefighters/${id}`, input)
    return data.firefighter
  },

  remove: (id: string) => api.delete<{ message: string }>(`/firefighters/${id}`),
}

// -- Vehicles ----------------------------------------------------------------

export const vehicles = {
  positions: (id: string, from: string, to: string) => api.get<PositionHistory>(`/vehicles/${id}/positions${query({ from, to })}`),
  history: (from: string, to: string) => api.get<FleetHistory>(`/vehicles/positions${query({ from, to })}`),
  async list(params: ListParams & { unit_id?: string, type?: VehicleType, status?: VehicleStatus } = {}): Promise<Paginated<Vehicle>> {
    const data = await api.get<Record<string, unknown>>(`/vehicles${query({ ...params })}`)
    return paginate<Vehicle>(data, "vehicles")
  },

  async get(id: string): Promise<Vehicle> {
    const data = await api.get<{ vehicle: Vehicle }>(`/vehicles/${id}`)
    return data.vehicle
  },

  async create(input: Record<string, unknown>): Promise<Vehicle> {
    const data = await api.post<{ vehicle: Vehicle }>("/vehicles", input)
    return data.vehicle
  },

  async update(id: string, input: Record<string, unknown>): Promise<Vehicle> {
    const data = await api.patch<{ vehicle: Vehicle }>(`/vehicles/${id}`, input)
    return data.vehicle
  },

  remove: (id: string) => api.delete<{ message: string }>(`/vehicles/${id}`),
}

// -- Crews -------------------------------------------------------------------

export const crews = {
  async list(params: ListParams & { unit_id?: string, vehicle_id?: string, active?: boolean } = {}): Promise<Paginated<Crew>> {
    const data = await api.get<Record<string, unknown>>(`/crews${query({ ...params })}`)
    return paginate<Crew>(data, "crews")
  },

  async get(id: string): Promise<Crew> {
    const data = await api.get<{ crew: Crew }>(`/crews/${id}`)
    return data.crew
  },

  async create(input: {
    name: string, vehicle_id: string, unit_id: string, commander_id: string,
    started_at: string, members: { firefighter_id: string, role: CrewRole }[],
  }): Promise<Crew> {
    const data = await api.post<{ crew: Crew }>("/crews", input)
    return data.crew
  },

  async update(id: string, input: Record<string, unknown>): Promise<Crew> {
    const data = await api.patch<{ crew: Crew }>(`/crews/${id}`, input)
    return data.crew
  },

  remove: (id: string) => api.delete<{ message: string }>(`/crews/${id}`),
}

// -- Shifts ------------------------------------------------------------------

export const shifts = {
  async list(params: ListParams & { firefighter_id?: string, unit_id?: string, type?: ShiftType, from?: string, to?: string } = {}): Promise<Paginated<Shift>> {
    const data = await api.get<Record<string, unknown>>(`/shifts${query({ ...params })}`)
    return paginate<Shift>(data, "shifts")
  },

  async create(input: Record<string, unknown>): Promise<Shift> {
    const data = await api.post<{ shift: Shift }>("/shifts", input)
    return data.shift
  },

  async update(id: string, input: Record<string, unknown>): Promise<Shift> {
    const data = await api.patch<{ shift: Shift }>(`/shifts/${id}`, input)
    return data.shift
  },

  remove: (id: string) => api.delete<{ message: string }>(`/shifts/${id}`),
}

// -- Occurrences -------------------------------------------------------------

export type OccurrenceListParams = ListParams & {
  unit_id?: string
  status?: OccurrenceStatus
  nature?: OccurrenceNature
  priority?: OccurrencePriority
  from?: string
  to?: string
  /**
   * `recent` is the default: newest incidents first. `queue` must be requested
   * explicitly for a priority-ordered operational queue.
   */
  sort?: "queue" | "recent"
}

export const occurrences = {
  async list(params: OccurrenceListParams = {}): Promise<Paginated<Occurrence>> {
    const data = await api.get<Record<string, unknown>>(`/occurrences${query({ sort: "recent", ...params })}`)
    return paginate<Occurrence>(data, "occurrences")
  },

  async get(id: string): Promise<Occurrence> {
    const data = await api.get<{ occurrence: Occurrence }>(`/occurrences/${id}`)
    return data.occurrence
  },

  async statistics(params: Pick<
    OccurrenceListParams,
    "status" | "nature" | "priority" | "from" | "to"
  > = {}): Promise<{ items: OccurrenceStatisticsRow[], total: number, operational?: OperationalStatistics }> {
    const data = await api.get<{ occurrences: OccurrenceStatisticsRow[], total: number, operational?: OperationalStatistics }>(
      `/occurrences/statistics${query(params)}`,
    )
    return { items: data.occurrences, total: data.total, operational: data.operational }
  },

  async operationalRecords(params: Pick<OccurrenceListParams, "status" | "nature" | "priority" | "from" | "to"> & {
    unit_id?: string; search?: string; route_recorded?: "yes" | "no"; page?: number;
  }) {
    return api.get<{ items: OperationalStatistics["ledger"]; total: number; page: number; per_page: number }>(
      `/occurrences/statistics/dispatches${query(params)}`,
    )
  },

  async create(input: {
    nature: OccurrenceNature, priority: OccurrencePriority, description: string,
    address: string, latitude: number, longitude: number, unit_id: string,
    caller_name?: string, caller_phone?: string,
  }): Promise<Occurrence> {
    const data = await api.post<{ occurrence: Occurrence }>("/occurrences", input)
    return data.occurrence
  },

  async update(id: string, input: Record<string, unknown>): Promise<Occurrence> {
    const data = await api.patch<{ occurrence: Occurrence }>(`/occurrences/${id}`, input)
    return data.occurrence
  },

  async timeline(id: string): Promise<TimelineEntry[]> {
    const data = await api.get<{ events: TimelineEntry[] }>(`/occurrences/${id}/timeline`)
    return data.events
  },

  addNote: (id: string, input: { message: string, dispatch_id?: string }) =>
    api.post<{ event: TimelineEntry }>(`/occurrences/${id}/notes`, input),

  /** Available vehicles ranked by predicted arrival; nothing is written. */
  recommendations: (id: string, input: { critical_mode?: boolean, closures?: Closure[], limit?: number } = {}) =>
    api.post<{
      occurrence_id: string,
      nature: OccurrenceNature,
      suitable_types: VehicleType[],
      critical_mode: boolean,
      recommendations: VehicleRecommendation[],
    }>(`/occurrences/${id}/recommendations`, input),

  async hospitals(id: string, criticalMode = false): Promise<HospitalOption[]> {
    const data = await api.get<{ hospitals: HospitalOption[] }>(
      `/occurrences/${id}/hospitals${query({ critical_mode: criticalMode || undefined })}`,
    )
    return data.hospitals
  },

  async waterSources(id: string, limit = 5): Promise<WaterSource[]> {
    const data = await api.get<{ water_sources: WaterSource[] }>(`/occurrences/${id}/water-sources${query({ limit })}`)
    return data.water_sources
  },

  /**
   * Every occurrence matching the filters, not just the first page.
   *
   * The statistics screen counts and maps the whole set, and the list endpoint
   * caps a page at 100 rows. The remaining pages are fetched at once and
   * concatenated. `maxPages` is a deliberate ceiling rather than a loop until
   * exhaustion: past a few thousand incidents the honest answer is an
   * aggregation endpoint on the backend, not a browser holding the whole
   * history in memory — and `truncated` says out loud when that line is
   * crossed, so the screen can admit it instead of quietly under-reporting.
   */
  async listAll(
    params: OccurrenceListParams = {},
    maxPages = 10,
  ): Promise<{ items: Occurrence[], total: number, truncated: boolean }> {
    // Newest first, because when the ceiling truncates the set the screen says
    // it kept the most recent — under the default order it would have kept the
    // most serious instead, and said the wrong thing.
    const query = { sort: "recent" as const, ...params, per_page: 100 }

    const first = await occurrences.list({ ...query, page: 1 })

    const pages = Math.min(Math.ceil(first.total / 100), maxPages)
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
        occurrences.list({ ...query, page: index + 2 })),
    )

    const items = [...first.items, ...rest.flatMap((page) => page.items)]

    return { items, total: first.total, truncated: items.length < first.total }
  },
}

// -- Dispatches --------------------------------------------------------------

export const dispatches = {
  async list(params: ListParams & {
    occurrence_id?: string, vehicle_id?: string, status?: DispatchStatus, open?: boolean,
  } = {}): Promise<Paginated<Dispatch>> {
    const data = await api.get<Record<string, unknown>>(`/dispatches${query({ ...params })}`)
    return paginate<Dispatch>(data, "dispatches")
  },

  async get(id: string): Promise<Dispatch> {
    const data = await api.get<{ dispatch: Dispatch }>(`/dispatches/${id}`)
    return data.dispatch
  },

  /**
   * Creating a dispatch answers 201 even when the AI is down: `routes` comes
   * back empty and `message` explains why. Sending a vehicle must never depend
   * on the model being up, so the caller has to tolerate the empty list.
   */
  create: (input: {
    occurrence_id: string,
    vehicle_id: string,
    crew_id?: string,
    critical_mode?: boolean,
  }) =>
    api.post<{ dispatch: Dispatch, routes: RouteVariant[], message?: string }>("/dispatches", input),

  async updateStatus(id: string, status: DispatchStatus): Promise<Dispatch> {
    const data = await api.patch<{ dispatch: Dispatch }>(`/dispatches/${id}`, { status })
    return data.dispatch
  },

  /**
   * Every dispatch, for the statistics screen to join against its incidents.
   *
   * There is no date filter on this endpoint, so the whole set comes back and
   * the screen keeps only the dispatches whose incident survived its own
   * filters. That is affordable while a dispatch is roughly one per incident
   * and the incident ceiling is a thousand; the moment either stops being true
   * the response time belongs in an aggregation on the backend.
   */
  async listAll(maxPages = 10): Promise<{ items: Dispatch[], truncated: boolean }> {
    const first = await dispatches.list({ page: 1, per_page: 100 })

    const pages = Math.min(Math.ceil(first.total / 100), maxPages)
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
        dispatches.list({ page: index + 2, per_page: 100 })),
    )

    const items = [...first.items, ...rest.flatMap((page) => page.items)]

    return { items, truncated: items.length < first.total }
  },
}

// -- AI ----------------------------------------------------------------------

export const ai = {
  async model(): Promise<ModelInfo> {
    const data = await api.get<{ model: ModelInfo }>("/ai/model")
    return data.model
  },

  /**
   * Without `dispatch_id` the answer is exploratory: both variants come back
   * and nothing is written to the database.
   */
  calculateRoute: (input: {
    origin_unit_id?: string, origin_latitude?: number, origin_longitude?: number,
    destination_latitude: number, destination_longitude: number, dispatch_id?: string,
    critical_mode?: boolean, closures?: Closure[], trace?: boolean,
  }) => api.post<{
    routes: RouteVariant[] | null,
    neural: RoutePreview,
    critical: RoutePreview | null,
    shortest: RoutePreview,
    critical_mode: boolean,
    closures: { count: number, blocked_edges: number },
    weather?: RouteWeather | null,
  }>("/ai/routes", input),

  etaAccuracy: (limit = 1000) => api.get<EtaAccuracy>(`/ai/eta-accuracy${query({ limit })}`),
  edgeCosts: (bbox?: string) => api.get<EdgeCosts>(`/ai/edge-costs${query({ bbox })}`),

  /** Isochrones of the stations and how much recent demand they reach. */
  coverage: (input: {
    minutes?: number[],
    critical_mode?: boolean,
    unit_ids?: string[],
    extra_stations?: { latitude: number, longitude: number, label?: string }[],
    sample_size?: number,
  } = {}) => api.post<Coverage>("/ai/coverage", input),

  async startTraining(epochs: number): Promise<TrainingRun> {
    const data = await api.post<{ run: TrainingRun }>("/ai/training", { epochs })
    return data.run
  },

  async getTraining(id: string): Promise<TrainingRun> {
    const data = await api.get<{ run: TrainingRun }>(`/ai/training/${id}`)
    return data.run
  },

  async listTrainings(params: ListParams = {}): Promise<Paginated<TrainingRun>> {
    const data = await api.get<Record<string, unknown>>(`/ai/training${query({ ...params })}`)
    return paginate<TrainingRun>(data, "runs")
  },
}

// -- Geo ---------------------------------------------------------------------

export const geo = {
  async search(text: string, signal?: AbortSignal): Promise<Place[]> {
    const data = await api.get<{ places: Place[] }>(`/geo/search${query({ q: text })}`, signal)
    return data.places
  },

  async reverse(latitude: number, longitude: number): Promise<Place | null> {
    const data = await api.get<{ place: Place | null }>(`/geo/reverse${query({ latitude, longitude })}`)
    return data.place
  },

  async referenceRoute(origin: [number, number], destination: [number, number]): Promise<ReferenceRoute | null> {
    const data = await api.get<{ route: ReferenceRoute | null }>(`/geo/reference-route${query({
      origin_latitude: origin[0],
      origin_longitude: origin[1],
      destination_latitude: destination[0],
      destination_longitude: destination[1],
    })}`)
    return data.route
  },

  async weather(latitude: number, longitude: number): Promise<Weather> {
    const data = await api.get<{ weather: Weather }>(`/geo/weather${query({ latitude, longitude })}`)
    return data.weather
  },
}

// -- Water sources -----------------------------------------------------------

export const waterSources = {
  async list(params: { unit_id?: string, status?: WaterSourceStatus, type?: WaterSourceType } = {}): Promise<WaterSource[]> {
    const data = await api.get<{ water_sources: WaterSource[] }>(`/water-sources${query(params)}`)
    return data.water_sources
  },

  async create(input: Record<string, unknown>): Promise<WaterSource> {
    const data = await api.post<{ water_source: WaterSource }>("/water-sources", input)
    return data.water_source
  },

  async update(id: string, input: Record<string, unknown>): Promise<WaterSource> {
    const data = await api.patch<{ water_source: WaterSource }>(`/water-sources/${id}`, input)
    return data.water_source
  },

  remove: (id: string) => api.delete<void>(`/water-sources/${id}`),
}
