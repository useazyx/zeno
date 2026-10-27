/**
 * Origin/destination pins and the real 3D fire truck used by route playback.
 *
 * The Waze vehicle is a MapLibre custom 3D layer backed by Three.js. Route
 * playback still owns position and bearing; this module only renders them.
 */

import maplibregl from "maplibre-gl"
import type { CustomLayerInterface, CustomRenderMethodInput } from "maplibre-gl"
import * as THREE from "three"

import type { OccurrenceNature } from "../../../api/types"
import { createArrivalScene, updateArrivalScene, disposeArrivalScene } from "./arrival-scenes"
import type { VehicleModelOptions } from "./vehicle-models"
import { sunPosition } from "./environment"
import type { LngLat } from "@/components/mapa/routes/utils"
import { createFireTruckModel, disposeFireTruckModel, updateFireTruckSignals } from "./firetruck-3d"

export function createMarker(
  map: maplibregl.Map,
  coords: LngLat,
  color: string,
  label: string,
  title: string,
): maplibregl.Marker {
  const element = document.createElement("div")
  element.className = "map-route-marker"

  element.style.cssText = `
    width:30px;height:32px;border-radius:2px;background:${color};border:2px solid #edf1ef;
    box-shadow:0 2px 5px rgba(20,38,48,.26);
    display:flex;align-items:center;justify-content:center;
    font:700 13px/1 system-ui,sans-serif;color:#f4f6f5;cursor:default;
  `

  element.textContent = label
  element.title = title
  element.setAttribute("role", "img")
  element.setAttribute("aria-label", title)

  return new maplibregl.Marker({ element }).setLngLat(coords).addTo(map)
}

/**
 * A fire station carries its acronym so origins can be compared at a glance.
 *
 * Choosing where a vehicle leaves from means comparing stations, and comparing
 * dots means hovering each one to find out which is which. The acronym travels
 * with the pin, and the selected station wears the same accent as the route it
 * is the origin of; the nearest suggestion wears teal, so the two never read as
 * the same choice.
 */
export function createStationMarker(
  map: maplibregl.Map,
  coords: LngLat,
  station: { acronym: string, name: string },
  options: { selected?: boolean, nearest?: boolean, onClick?: () => void } = {},
): maplibregl.Marker {
  const element = document.createElement(options.onClick ? "button" : "div")
  element.className = "map-station-marker"
  if (element instanceof HTMLButtonElement) {
    element.type = "button"
    element.setAttribute("aria-pressed", String(Boolean(options.selected)))
  }

  const background = options.selected ? "#0B63A5" : options.nearest ? "#0E6E75" : "#293F4E"

  element.style.cssText = `
    display:flex;align-items:center;gap:6px;min-height:30px;margin:0;appearance:none;
    padding:5px 9px 5px 7px;border-radius:2px;
    background:${background};border:2px solid #eaf0ed;
    box-shadow:0 2px 5px rgba(20,38,48,.26);
    font:700 11px/1 system-ui,sans-serif;color:#f4f6f5;
    letter-spacing:.3px;white-space:nowrap;
    cursor:${options.onClick ? "pointer" : "default"};
  `

  element.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M10 21v-6h4v6"/>
    </svg>
    <span></span>
  `

  // The acronym is written as text, never as markup: it comes from the unit
  // registry, which is user input.
  const label = element.querySelector("span")
  if (label) label.textContent = station.acronym

  element.title = options.nearest
    ? `${station.name} — o mais próximo do destino`
    : station.name
  element.setAttribute("aria-label", element.title)

  if (options.onClick) {
    element.addEventListener("click", (event) => {
      // Without this the click also lands on the map, which on the routes
      // screen would move the destination to the station just picked.
      event.stopPropagation()
      options.onClick?.()
    })
  }

  return new maplibregl.Marker({ element }).setLngLat(coords).addTo(map)
}

const PRIMARY_VEHICLE_LAYER = "layer-route-firetruck"
const COMPARISON_AI_VEHICLE_LAYER = "layer-route-firetruck-comparison-ai"
const COMPARISON_VEHICLE_LAYER = "layer-route-firetruck-comparison-standard"
const VEHICLE_VISUAL_SCALE = 3.3
const VEHICLE_ALTITUDE_METERS = 0.3

type VehicleVariant = "primary" | "comparisonAi" | "comparison" | "critical"

interface VehicleState {
  coords: LngLat
  bearing: number
  visible: boolean
  lateralOffsetMeters: number
  movedAt: number
  ghost?: boolean
  distanceMeters: number
  visual?: Partial<VehicleModelOptions>
  arrival?: { nature: OccurrenceNature; seconds: number; characters: boolean }
  visualKey?: string
}

interface VehicleRegistry {
  primary?: VehicleState
  comparisonAi?: VehicleState
  comparison?: VehicleState
  critical?: VehicleState
}

const vehicleStates = new WeakMap<maplibregl.Map, VehicleRegistry>()
const visualOptions = new WeakMap<maplibregl.Map, Partial<VehicleModelOptions>>()
const renderers = new WeakMap<maplibregl.Map, { renderer: THREE.WebGLRenderer; users: number }>()

function registryFor(map: maplibregl.Map): VehicleRegistry {
  const existing = vehicleStates.get(map)
  if (existing) return existing

  const registry: VehicleRegistry = {}
  vehicleStates.set(map, registry)
  return registry
}

function vehicleState(map: maplibregl.Map, start: LngLat, variant: VehicleVariant): VehicleState {
  const registry = registryFor(map)
  const existing = registry[variant]
  if (existing) return existing

  const state: VehicleState = {
    coords: start,
    bearing: 0,
    visible: false,
    lateralOffsetMeters: 0,
    movedAt: -Infinity,
    distanceMeters: 0,
    visual: visualOptions.get(map),
  }
  registry[variant] = state
  return state
}

class FireTruckNavigationLayer implements CustomLayerInterface {
  readonly type = "custom" as const
  readonly renderingMode = "3d" as const

  readonly id: string

  private readonly camera = new THREE.Camera()
  private readonly scene = new THREE.Scene()
  private renderer: THREE.WebGLRenderer | null = null
  private truck: THREE.Group | null = null
  private readonly state: VehicleState
  private readonly variant: VehicleVariant
  private map: maplibregl.Map | null = null
  private readonly projection = new THREE.Matrix4()
  private readonly transform = new THREE.Matrix4()
  private readonly rotation = new THREE.Matrix4()
  private readonly translation = new THREE.Matrix4()
  private readonly scaleVector = new THREE.Vector3()
  private arrival: THREE.Group | null = null
  private arrivalKey = ""
  private previousTime: number | null = null
  private previousDistance = 0
  private previousBearing = 0
  private previousSpeed = 0
  private visualKey = ""
  private motionPreference: MediaQueryList | null = null
  private readonly onMotionChange = () => this.map?.triggerRepaint()

  constructor(id: string, state: VehicleState, variant: VehicleVariant) {
    this.id = id
    this.state = state
    this.variant = variant
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")
    this.motionPreference.addEventListener("change", this.onMotionChange)
    this.truck = createFireTruckModel(
      this.variant === "primary" || this.variant === "critical"
        ? "normal"
        : this.variant === "comparisonAi"
          ? "ai"
          : "distance",
      this.state.visual,
    )
    this.visualKey = JSON.stringify(this.state.visual ?? {})
    this.scene.add(this.truck)

    const sky = new THREE.HemisphereLight(0xeaf4ff, 0x29343a, 1.8)
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(-4, 6, 10)

    const fill = new THREE.DirectionalLight(0xffe9dc, 0.7)
    fill.position.set(5, -4, 6)

    this.scene.add(sky, key, fill)

    let shared = renderers.get(map)
    if (!shared) {
      shared = { renderer: new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl }), users: 0 }
      renderers.set(map, shared)
    }
    shared.users++
    this.renderer = shared.renderer
    this.renderer.autoClear = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
  }

  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    options: CustomRenderMethodInput,
  ) {
    if (!this.renderer || !this.truck || !this.state.visible) return

    const key = JSON.stringify(this.state.visual ?? {})
    if (key !== this.visualKey) {
      this.scene.remove(this.truck); disposeFireTruckModel(this.truck)
      this.truck = createFireTruckModel(this.variant === 'comparisonAi' ? 'ai' : this.variant === 'comparison' ? 'distance' : 'normal', this.state.visual)
      this.scene.add(this.truck); this.visualKey = key
    }
    const now = performance.now()
    const deltaSeconds = this.previousTime === null ? 0 : Math.min(.15, Math.max(0, (now - this.previousTime) / 1000))
    const distanceMeters = Math.max(0, this.state.distanceMeters - this.previousDistance)
    const speed = deltaSeconds > .001 ? distanceMeters / deltaSeconds : 0
    const turnRate = deltaSeconds > .001 ? ((this.state.bearing - this.previousBearing + 540) % 360 - 180) / deltaSeconds : 0
    const arrivalKey = this.state.arrival ? `${this.state.arrival.nature}:${this.state.arrival.characters}` : ''
    if (this.arrival && this.arrivalKey !== arrivalKey) { this.scene.remove(this.arrival); disposeArrivalScene(this.arrival); this.arrival = null }
    if (!this.arrival && this.state.arrival) { this.arrival = createArrivalScene(this.state.arrival.nature, { characters: this.state.arrival.characters }); this.scene.add(this.arrival); this.arrivalKey = arrivalKey }
    if (this.arrival && this.state.arrival) updateArrivalScene(this.arrival, this.state.arrival.seconds, { reducedMotion: this.motionPreference?.matches })
    const solar = sunPosition(new Date(), this.state.coords[1], this.state.coords[0])
    updateFireTruckSignals(this.truck, now / 1000, now - this.state.movedAt < 150, this.motionPreference?.matches ?? false, {
      deltaSeconds, distanceMeters, speedMps: speed, turnRate, arrived: !!this.state.arrival, braking: this.state.arrival ? this.state.arrival.seconds < 1 : speed < this.previousSpeed - .5, doors: (this.state.arrival?.seconds ?? 0) > .6, ladder: this.state.arrival?.nature === "CAPTURA_ANIMAL", night: solar.night, zoom: this.map?.getZoom?.() ?? 17,
    })
    this.previousTime = now; this.previousDistance = this.state.distanceMeters; this.previousBearing = this.state.bearing; this.previousSpeed = speed
    if (this.truck.userData.ghost !== !!this.state.ghost) {
      this.truck.userData.ghost = !!this.state.ghost
      this.truck.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          material.userData.originalOpacity ??= material.opacity
          material.opacity = this.state.ghost ? Math.min(0.28, material.userData.originalOpacity) : material.userData.originalOpacity
          material.transparent = material.opacity < 1
          material.needsUpdate = true
        }
      })
    }
    const mercator = maplibregl.MercatorCoordinate.fromLngLat(
      this.state.coords,
      (this.map?.queryTerrainElevation(this.state.coords) ?? 0) + VEHICLE_ALTITUDE_METERS,
    )
    const scale = mercator.meterInMercatorCoordinateUnits() * VEHICLE_VISUAL_SCALE
    const bearing = THREE.MathUtils.degToRad(this.state.bearing)

    const projection = this.projection.fromArray(options.defaultProjectionData.mainMatrix)
    const transform = this.transform
      .makeTranslation(mercator.x, mercator.y, mercator.z)
      .scale(this.scaleVector.set(scale, -scale, scale))
      .multiply(this.rotation.makeRotationZ(-bearing))
      .multiply(this.translation.makeTranslation(
        this.state.lateralOffsetMeters / VEHICLE_VISUAL_SCALE,
        0,
        0,
      ))

    this.camera.projectionMatrix = projection.multiply(transform)

    this.renderer.resetState()
    // Navigation symbols must remain readable behind buildings and overlapping routes.
    // Retain depth within each model, but not depth left by the cartography.
    this.renderer.clearDepth()
    this.renderer.render(this.scene, this.camera)
    this.renderer.resetState()
  }

  onRemove() {
    this.motionPreference?.removeEventListener("change", this.onMotionChange)
    this.motionPreference = null
    if (this.truck) {
      this.scene.remove(this.truck)
      disposeFireTruckModel(this.truck)
      this.truck = null
    }
    if (this.arrival) { disposeArrivalScene(this.arrival); this.arrival = null }
    this.scene.clear()

    const shared = this.map ? renderers.get(this.map) : undefined
    if (shared && --shared.users === 0) {
      shared.renderer.dispose()
      renderers.delete(this.map!)
    }
    this.map = null
    this.renderer = null
  }
}

function addVehicleLayer(map: maplibregl.Map, start: LngLat, variant: VehicleVariant) {
  const id = variant === "primary"
    ? PRIMARY_VEHICLE_LAYER
    : variant === "comparisonAi"
      ? COMPARISON_AI_VEHICLE_LAYER
      : variant === "critical" ? "layer-route-firetruck-critical" : COMPARISON_VEHICLE_LAYER
  const state = vehicleState(map, start, variant)
  state.coords = start
  state.bearing = 0
  state.lateralOffsetMeters = 0
  state.movedAt = -Infinity
  state.distanceMeters = 0

  if (!map.getLayer(id)) {
    map.addLayer(new FireTruckNavigationLayer(id, state, variant))
  }
}

function showVehicle(map: maplibregl.Map, variant: VehicleVariant, visible: boolean) {
  const state = registryFor(map)[variant]
  if (!state) return

  state.visible = visible
  map.triggerRepaint()
}

function moveVehicle(
  map: maplibregl.Map,
  variant: VehicleVariant,
  coords: LngLat,
  bearing: number,
  lateralOffsetMeters = 0,
) {
  const state = registryFor(map)[variant]
  if (!state) return

  const changed = state.coords[0] !== coords[0] || state.coords[1] !== coords[1]
  if (changed) {
    const distance = Math.hypot((coords[0] - state.coords[0]) * Math.cos(coords[1] * Math.PI / 180), coords[1] - state.coords[1]) * 111320
    if (distance < 150) state.distanceMeters += distance
    state.movedAt = performance.now()
  }
  const needsRepaint = changed || state.bearing !== bearing || state.lateralOffsetMeters !== lateralOffsetMeters
  state.coords = coords
  state.bearing = bearing
  state.lateralOffsetMeters = lateralOffsetMeters

  if (state.visible && needsRepaint) map.triggerRepaint()
}

/** Primary vehicle: the route selected by the operational AI. */
export function addArrowLayer(map: maplibregl.Map, start: LngLat) {
  addVehicleLayer(map, start, "primary")
}

export function showArrow(map: maplibregl.Map, visible: boolean) {
  showVehicle(map, "primary", visible)
}

export function moveArrow(map: maplibregl.Map, coords: LngLat, bearing: number) {
  moveVehicle(map, "primary", coords, bearing)
}

/** Blue vehicle: AI route in the side-by-side comparison. */
export function addComparisonAiVehicleLayer(map: maplibregl.Map, start: LngLat) {
  addVehicleLayer(map, start, "comparisonAi")
}

export function showComparisonAiVehicle(map: maplibregl.Map, visible: boolean) {
  showVehicle(map, "comparisonAi", visible)
}

export function moveComparisonAiVehicle(
  map: maplibregl.Map,
  coords: LngLat,
  bearing: number,
  lateralOffsetMeters = 0,
) {
  moveVehicle(map, "comparisonAi", coords, bearing, lateralOffsetMeters)
}

/** Amber vehicle: standard shortest-distance route in the comparison. */
export function addComparisonVehicleLayer(map: maplibregl.Map, start: LngLat) {
  addVehicleLayer(map, start, "comparison")
}

export function showComparisonVehicle(map: maplibregl.Map, visible: boolean) {
  showVehicle(map, "comparison", visible)
}

export function setVehicleGhost(map: maplibregl.Map, ghost: boolean) {
  const state = registryFor(map).comparison
  if (state) { state.ghost = ghost; map.triggerRepaint() }
}

export function moveComparisonVehicle(
  map: maplibregl.Map,
  coords: LngLat,
  bearing: number,
  lateralOffsetMeters = 0,
) {
  moveVehicle(map, "comparison", coords, bearing, lateralOffsetMeters)
}

export function addCriticalVehicleLayer(map: maplibregl.Map, start: LngLat) {
  addVehicleLayer(map, start, "critical")
}

export function showCriticalVehicle(map: maplibregl.Map, visible: boolean) {
  showVehicle(map, "critical", visible)
}

export function moveCriticalVehicle(map: maplibregl.Map, coords: LngLat, bearing: number, offset = 0) {
  moveVehicle(map, "critical", coords, bearing, offset)
}

/** The same registered assembly and livery are used by navigation and the garage. */
export function setMapVehicleVisual(map: maplibregl.Map, options?: Partial<VehicleModelOptions>) {
  if (options) visualOptions.set(map, options)
  else visualOptions.delete(map)
  for (const state of Object.values(registryFor(map))) if (state) state.visual = options
  map.triggerRepaint()
}

export function setArrivalFrame(map: maplibregl.Map, variant: VehicleVariant, nature: OccurrenceNature, seconds: number | null, characters = true) {
  const state = registryFor(map)[variant]
  if (!state) return
  state.arrival = seconds === null ? undefined : { nature, seconds, characters }
  map.triggerRepaint()
}
