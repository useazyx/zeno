/**
 * Types mirroring the backend domain. They are written by hand rather than
 * generated because the frontend only consumes a subset of each model, and a
 * generated client would drag the whole Prisma surface into the bundle.
 */

export type UnitType =
  | "COMANDO_GERAL" | "COMANDO_REGIONAL" | "GRUPAMENTO" | "SUBGRUPAMENTO" | "POSTO"

export type Rank =
  | "CORONEL" | "TENENTE_CORONEL" | "MAJOR" | "CAPITAO" | "PRIMEIRO_TENENTE"
  | "SEGUNDO_TENENTE" | "ASPIRANTE_OFICIAL" | "SUBTENENTE" | "PRIMEIRO_SARGENTO"
  | "SEGUNDO_SARGENTO" | "TERCEIRO_SARGENTO" | "CABO"
  | "SOLDADO_PRIMEIRA_CLASSE" | "SOLDADO_SEGUNDA_CLASSE"

export type FirefighterStatus = "ATIVO" | "FERIAS" | "AFASTADO" | "INATIVO"

export type VehicleType =
  | "ABT" | "ABTF" | "ABTR" | "AT" | "ASE" | "AEM" | "APM" | "UR" | "MOB" | "ABRESC" | "AV"

export type VehicleStatus = "DISPONIVEL" | "EMPENHADA" | "MANUTENCAO" | "INDISPONIVEL"

export type VehicleColor = "vermelho_bombeiro" | "branco" | "amarelo_refletivo" | "grafite"
export interface VehicleAppearance {
  variant: "default" | VehicleType
  body_color: VehicleColor
  stripe_color: VehicleColor
  show_prefix: boolean
  unit_badge: boolean
}

export interface VehiclePosition {
  id: string
  vehicle_id: string
  latitude: string | number
  longitude: string | number
  heading: number | null
  dispatch_id: string | null
  recorded_at: string
}
export interface PositionHistory {
  from: string
  to: string
  total: number
  sampled: boolean
  positions: VehiclePosition[]
}
export interface FleetHistory extends Omit<PositionHistory, "positions"> {
  vehicles: { vehicle_id: string; positions: VehiclePosition[] }[]
}
export interface VehicleAlert {
  vehicle_id: string
  prefix: string
  dispatch_id: string
  kind: "sem_sinal" | "parada"
  since: string
  latitude?: string | number | null
  longitude?: string | number | null
}

export type CrewRole = "COMANDANTE" | "MOTORISTA" | "COMBATENTE" | "SOCORRISTA"

export type ShiftType = "PLANTAO_24X72" | "PLANTAO_12X36" | "EXPEDIENTE"

export type OccurrenceNature =
  | "INCENDIO_EDIFICACAO" | "INCENDIO_VEGETACAO" | "INCENDIO_VEICULO" | "SALVAMENTO"
  | "ATENDIMENTO_PRE_HOSPITALAR" | "PRODUTOS_PERIGOSOS" | "AFOGAMENTO"
  | "CAPTURA_ANIMAL" | "VISTORIA" | "OUTROS"

export type OccurrencePriority = "BAIXA" | "MEDIA" | "ALTA" | "CRITICA"

export type OccurrenceStatus =
  | "ABERTA" | "DESPACHADA" | "EM_ATENDIMENTO" | "ENCERRADA" | "CANCELADA"

export type DispatchStatus =
  | "DESPACHADO" | "A_CAMINHO" | "NO_LOCAL" | "RETORNANDO" | "FINALIZADO" | "CANCELADO"

export type RouteAlgorithm = "NEURAL" | "CRITICAL" | "DIJKSTRA"

export type TrainingStatus = "PENDENTE" | "EXECUTANDO" | "CONCLUIDO" | "FALHOU"

export interface Unit {
  id: string
  name: string
  acronym: string
  type: UnitType
  address: string
  city: string
  state: string
  phone?: string | null
  latitude: string | number
  longitude: string | number
  active: boolean
  parent_id?: string | null
  parent?: Pick<Unit, "id" | "name" | "acronym" | "type"> | null
}

export interface Firefighter {
  id: string
  name: string
  war_name: string
  military_id: string
  cpf: string
  rank: Rank
  status: FirefighterStatus
  phone: string
  email?: string | null
  admission_date: string
  unit_id: string
  unit?: Pick<Unit, "id" | "name" | "acronym"> | null
}

export interface Vehicle {
  id: string
  prefix: string
  type: VehicleType
  plate: string
  model: string
  year: number
  water_capacity_liters?: number | null
  crew_capacity: number
  status: VehicleStatus
  current_latitude?: string | number | null
  current_longitude?: string | number | null
  last_position_at?: string | null
  appearance?: VehicleAppearance | null
  unit_id: string
  unit?: Pick<Unit, "id" | "name" | "acronym"> | null
}

export interface CrewMember {
  id: string
  role: CrewRole
  firefighter_id: string
  firefighter?: Pick<Firefighter, "id" | "war_name" | "rank"> | null
}

export interface Crew {
  id: string
  name: string
  active: boolean
  started_at: string
  ended_at?: string | null
  unit_id: string
  vehicle_id: string
  commander_id: string
  vehicle?: Pick<Vehicle, "id" | "prefix" | "type"> | null
  commander?: Pick<Firefighter, "id" | "war_name" | "rank"> | null
  members?: CrewMember[]
}

export interface Shift {
  id: string
  type: ShiftType
  start_at: string
  end_at: string
  firefighter_id: string
  unit_id: string
  firefighter?: Pick<Firefighter, "id" | "war_name" | "rank"> | null
  unit?: Pick<Unit, "id" | "acronym"> | null
}

export interface Occurrence {
  id: string
  protocol: string
  nature: OccurrenceNature
  priority: OccurrencePriority
  status: OccurrenceStatus
  description: string
  address: string
  latitude: string | number
  longitude: string | number
  caller_name?: string | null
  caller_phone?: string | null
  opened_at: string
  closed_at?: string | null
  unit_id: string
  unit?: Pick<Unit, "id" | "name" | "acronym"> | null
  dispatches?: Dispatch[]
}

export interface OccurrenceStatisticsRow {
  id: string
  protocol: string
  nature: OccurrenceNature
  priority: OccurrencePriority
  status: OccurrenceStatus
  address: string
  latitude: string | number
  longitude: string | number
  opened_at: string
  closed_at?: string | null
  first_arrived_at?: string | null
  unit?: Pick<Unit, "id" | "acronym"> | null
}

export interface OperationalStatistics {
  dispatched_incidents: number
  joint_operations: number
  without_dispatch: number
  units: {
    id: string; acronym: string; responsible: number; incidents: number; deployments: number;
    cancelled: number; arrived: number; critical: number; vehicles: number; crews: number; joint_operations: number;
    response_seconds: number | null; response_samples: number; response_p90_seconds: number | null;
    travel_seconds: number | null; commitment_seconds: number | null; commitment_samples: number;
    recorded_routes: number; distance_meters: number; estimated_seconds: number | null;
    algorithms: Record<string, number>; natures: { nature: string; count: number }[];
  }[]
  cooperation: { units: string[]; incidents: number }[]
  ledger_limit: number
  ledger: {
    id: string; occurrence_id: string; protocol: string; nature: string; unit_id: string; unit: string;
    participants: string[]; vehicle: string; status: string; critical_mode: boolean;
    dispatched_at: string; arrived_at: string | null; finished_at: string | null; travel_seconds: number | null;
    route: { id: string; algorithm: string; distance_meters: number; estimated_time_seconds: number; model_version: string | null } | null;
  }[]
}

export interface RouteVariant {
  id: string
  algorithm: RouteAlgorithm
  origin_latitude: string | number
  origin_longitude: string | number
  destination_latitude: string | number
  destination_longitude: string | number
  distance_meters: number
  estimated_time_seconds: number
  node_count: number
  /** Coordinate pairs as [latitude, longitude] — the axis order MapLibre does not use. */
  geometry: [number, number][]
  /** Null on routes stored before the AI returned them. */
  steps?: RouteStep[] | null
  segments?: RouteSegment[] | null
  route_features?: RouteFeature[]
  exploration?: [number, number][]
  model_version?: string | null
  dispatch_id?: string | null
  created_at: string
}

export interface Dispatch {
  id: string
  status: DispatchStatus
  dispatched_at: string
  arrived_at?: string | null
  finished_at?: string | null
  critical_mode?: boolean
  occurrence_id: string
  vehicle_id: string
  crew_id?: string | null
  occurrence?: Pick<Occurrence, "id" | "protocol" | "nature" | "priority" | "status" | "address" | "latitude" | "longitude"> | null
  vehicle?: Pick<Vehicle, "id" | "prefix" | "type" | "status"> | null
  crew?: Crew | null
  routes?: RouteVariant[]
  used_route_id?: string | null
  used_route?: RouteVariant | null
}

/** Both variants as the AI service returns them, before persistence. */
export interface RoutePreview {
  distance_meters: number
  estimated_time_seconds: number
  node_count: number
  geometry: [number, number][]
  steps: RouteStep[]
  segments: RouteSegment[]
  route_features?: RouteFeature[]
  exploration?: [number, number][]
  /** Metres driven on each class of road. */
  composition: Record<RoadClass, number>
  /** Neural variant only: share of its distance on the shortest route's streets. */
  shared_with_shortest?: number
  critical_maneuvers?: {
    counterflow_segments: number
    shoulder_segments: number
  }
}

/**
 * The rectangle the street network spans.
 *
 * The place polygon and the drivable network are not the same thing: the rural
 * north of the municipality has almost no mapped roads, so a point can be
 * inside Taubaté and still be refused. `max_snap_distance_m` is how far from a
 * mapped street the AI still accepts a point.
 */
export interface GraphBounds {
  min_latitude: number
  max_latitude: number
  min_longitude: number
  max_longitude: number
  max_snap_distance_m: number
}

export interface ModelInfo {
  loaded: boolean
  model_version: string | null
  city: string
  graph_nodes: number
  graph_edges: number
  bounds: GraphBounds | null
}

/**
 * One line of the trainer's progress table.
 *
 * The Python trainer prints every 50 epochs; each of those lines becomes one
 * of these, and the whole series is stored on the run as JSON so the screen can
 * draw the curve instead of only the final numbers.
 */
export interface TrainingPoint {
  epoch: number
  train_loss: number | null
  validation_loss: number | null
  best_validation_loss: number | null
  learning_rate?: number | null
}

export interface TrainingRun {
  id: string
  status: TrainingStatus
  epochs: number
  /** Last epoch the trainer reported; it advances in steps of 50. */
  current_epoch: number | null
  /** Null for runs that finished before the progress was recorded. */
  history: TrainingPoint[] | null
  train_loss: number | null
  validation_loss: number | null
  best_validation_loss: number | null
  started_at: string | null
  finished_at: string | null
  error_message: string | null
  model_path: string | null
  external_job_id: string | null
  created_at: string
}

export interface Paginated<T> {
  total: number
  page: number
  per_page: number
  items: T[]
}

// -- Route analysis ----------------------------------------------------------

/** One manoeuvre of the turn-by-turn list, as the AI structures it. */
export interface RouteStep {
  type: "depart" | "turn" | "continue" | "roundabout" | "arrive"
  modifier: string | null
  street: string | null
  highway: string
  distance_meters: number
  time_seconds: number
  /** [latitude, longitude] of the point where the manoeuvre happens. */
  location: [number, number]
  geometry_index: number
  /** Depart step only: initial compass heading. */
  bearing?: number
}

/** Predicted speed on one edge; `start`/`end` index into the geometry. */
export interface RouteSegment {
  start: number
  end: number
  length_meters: number
  time_seconds: number
  speed_kmh: number
  limit_kmh: number
  highway: string
  street: string | null
  counterflow: boolean
  shoulder: boolean
  incline?: string
}

export interface RouteFeature {
  type: "traffic_signals" | "stop" | "crossing" | "speed_bump" | "bridge" | "max_weight" | "max_height" | "narrow"
  geometry_index: number
  location: [number, number]
  value?: string
}
export interface RouteWeather { precipitation_mm: number; weather_code: number; advisory: string | null }
export interface EdgeCosts extends GeoJSON.FeatureCollection<GeoJSON.LineString> { model_version: string | null }
export interface UnitAreas {
  model_version: string | null
  critical_mode: boolean
  areas: { unit_id: string; acronym: string; area: GeoJSON.MultiPolygon | null; reached_nodes: number; in_network: boolean }[]
}

export type RoadClass = "highway" | "primary" | "secondary" | "tertiary" | "local"

/** A street the dispatcher reported blocked, avoided for one calculation. */
export interface Closure {
  latitude: number
  longitude: number
  radius_m: number
}

// -- Occurrence support ------------------------------------------------------

export type OccurrenceEventType =
  | "ABERTURA" | "STATUS" | "PRIORIDADE" | "DESPACHO" | "DESPACHO_STATUS" | "ROTA" | "NOTA"

export interface TimelineEntry {
  id: string
  type: OccurrenceEventType
  at: string
  message: string | null
  from_value: string | null
  to_value: string | null
  dispatch_id: string | null
  vehicle_prefix: string | null
  derived: boolean
}

export interface VehicleRecommendation {
  rank: number
  vehicle: { id: string, prefix: string, type: VehicleType, model: string, water_capacity_liters: number | null }
  unit: { id: string, acronym: string, name: string }
  crew: { id: string, name: string, members: number, commander: string | null } | null
  origin: { latitude: number, longitude: number, source: "current_position" | "station" }
  suitable: boolean
  ready: boolean
  reachable: boolean
  eta_seconds: number | null
  distance_meters: number | null
}

export interface HospitalOption {
  id: string
  name: string
  latitude: number
  longitude: number
  emergency: boolean
  phone: string | null
  reachable: boolean
  eta_seconds: number | null
  distance_meters: number | null
}

export type WaterSourceType =
  | "HIDRANTE_COLUNA" | "HIDRANTE_SUBTERRANEO" | "CISTERNA" | "RESERVATORIO" | "PONTO_CAPTACAO"

export type WaterSourceStatus = "OPERANTE" | "INOPERANTE" | "NAO_VERIFICADO"

export interface WaterSource {
  id: string
  code: string
  type: WaterSourceType
  status: WaterSourceStatus
  address: string
  latitude: string | number
  longitude: string | number
  flow_lpm: number | null
  notes: string | null
  last_inspection_at: string | null
  unit_id: string
  unit?: Pick<Unit, "id" | "acronym" | "name"> | null
  /** Only on the nearest-to-occurrence list. */
  distance_meters?: number
}

export interface Place {
  label: string
  street: string | null
  number: string | null
  district: string | null
  city: string | null
  postcode: string | null
  kind: string | null
  latitude: number
  longitude: number
}

export interface Weather {
  observed_at: string
  temperature_c: number
  humidity_percent: number
  precipitation_mm: number
  wind_speed_kmh: number
  wind_gusts_kmh: number
  /** Where the wind comes from, in degrees. */
  wind_direction_deg: number
  weather_code: number
}

/** The same trip through OSRM, an outside engine used as a yardstick. */
export interface ReferenceRoute {
  source: "OSRM"
  distance_meters: number
  duration_seconds: number
  geometry: [number, number][]
}

// -- Coverage ----------------------------------------------------------------

export interface CoverageStation {
  id: string
  acronym: string
  name: string
  latitude: number
  longitude: number
  hypothetical: boolean
  in_network: boolean
}

export interface CoverageArea {
  minutes: number
  area_km2: number
  reached_nodes: number
  geometry: { type: "MultiPolygon", coordinates: number[][][][] } | null
}

export interface CoveragePoint {
  id: string
  latitude: number
  longitude: number
  priority: OccurrencePriority
  nature: OccurrenceNature
  time_seconds: number | null
}

export interface Coverage {
  critical_mode: boolean
  minutes: number[]
  model_version: string | null
  stations: CoverageStation[]
  isochrones: CoverageArea[]
  demand: { sample_size: number, covered: Record<string, number>, points: CoveragePoint[] } | null
}

export interface EtaSummary {
  count: number
  mae_seconds: number
  /** Mean of actual minus predicted: positive means crews take longer. */
  bias_seconds: number
  mape: number
  p90_abs_error_seconds: number
  within_60s: number
}

export interface EtaAccuracy {
  summary: EtaSummary | null
  live_summary: EtaSummary | null
  demo_share: number
  samples: {
    dispatch_id: string
    occurrence_id: string
    protocol: string
    algorithm: string
    predicted_seconds: number
    actual_seconds: number
    dispatched_at: string
    demo: boolean
  }[]
}
