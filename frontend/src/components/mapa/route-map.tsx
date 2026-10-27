/**
 * The route map.
 *
 * Operational 2D/3D map with route playback and synchronized vehicle comparison.
 * Geometry comes from the API for the incident on screen.
 *
 * The API sends coordinates as `[latitude, longitude]` and MapLibre wants
 * `[longitude, latitude]`. `toMapCoords` performs that swap once, here.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Box, Globe, LocateFixed, Map as MapIcon, MapPinOff, Maximize, Maximize2, Minimize,
  Minimize2, Navigation, Pause, Play, Square,
} from "lucide-react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

import type { Closure, GraphBounds, RouteFeature, RouteSegment, RouteStep, OccurrenceNature, OccurrencePriority, Vehicle, WaterSource } from "@/api/types"
import { waterSources } from '@/api/endpoints'
import { ARRIVAL_DURATION_SECONDS } from "./map/arrival-scenes"
import { setSceneContext, setStationDeparture } from './map/scene-context'
import { setEnvironmentPlayback } from './map/environment'
import type { CamMode } from "./types/types"
import { mapStyle, WAZE_PITCH, WAZE_ZOOM } from "./constants/constants"
import { bearingBetween, measureRoute, toMapCoords } from "./routes/utils"
import type { LngLat, RouteMetrics } from "./routes/utils"
import {
  addArrowLayer, addComparisonVehicleLayer, createMarker, createStationMarker, moveArrow, moveComparisonVehicle, showArrow, showComparisonVehicle, setVehicleGhost, setMapVehicleVisual, setArrivalFrame,
} from "./map/markers"
import {
  addCoverageLayer, addRouteLayers, set3DEnvironment, setBuildingLayersVisibility,
  setComparisonVisibility, setLayerVisibility, updateCoverageData, updateRouteData,
} from "./map/layers"
import { startComparisonPlayback } from "./map/comparison-playback"
import { navigationState, readSimulationCamera, saveSimulationCamera, type SimulationCamera } from "./routes/navigation-policy"
import { clearNavigationManeuver, setNavigationManeuver, setRoadContext, terrainGradeAlert } from "./map/navigation-overlay"
import { addAlternativeMarkers, type RouteKind } from './map/alternative-markers'
import { roadFeatureAlerts, destinationSide } from './routes/route-context'
import { ElevationProfile, SimulationRecorder } from './simulation-tools'
import { setBuildingContext, setBuildingOcclusion } from "./map/building-context"
import { setRouteProgress } from "./map/route-effects"
import { fitBoundsOf, observeMapToolbar } from "./map/helpers"
import { setClosures, setSpeedOverlay } from "./map/overlays"
import { formatDistance } from "@/lib/format"
import { cn } from "@/lib/utils"

import "./mapa.css"
import "./simulation.css"

/** Taubaté's centre, used until there is a route or a coverage rectangle. */
const FALLBACK_CENTER: LngLat = [-45.5551, -23.0264]
const clockLabel = (seconds: number) => `${Math.floor(Math.max(0, Math.ceil(seconds)) / 60)}:${String(Math.max(0, Math.ceil(seconds)) % 60).padStart(2, '0')}`

/**
 * Whether the browser's own fullscreen is engaged.
 *
 * Theater is deliberately *not* here. A map that floats over the page is a
 * different thing from a map that is simply given the room — and the room is
 * what a dispatcher actually wants, laid out like the statistics screen, with
 * the page still readable around it. Only the page knows how to give that up,
 * so theater is the page's state and arrives as a prop; this component just
 * asks for it.
 */
type MapView = "inline" | "full"

/** A station as the map needs it: a name to show and a point to show it at. */
export interface MapStation {
  id: string
  acronym: string
  name: string
  latitude: number
  longitude: number
}

export interface RouteMapProps {
  /** Main route, as the API sends it: `[latitude, longitude]` pairs. */
  route: [number, number][] | null | undefined
  /** Standard/baseline route used for comparison. */
  comparison?: [number, number][] | null
  /** Optional emergency-operational route, drawn as a third distinct path. */
  critical?: [number, number][] | null
  originLabel?: string
  destinationLabel?: string
  /** Tailwind height/width for the frame; the map fills it absolutely. */
  className?: string
  emptyMessage?: string
  /**
   * Extent of the street network. Drawn as an outline so it is obvious where a
   * point may be dropped — the graph stops at the city, and a rejection after
   * the fact is a worse way to learn that.
   */
  coverage?: GraphBounds | null
  /** When given, the map is interactive even with no route and reports clicks. */
  onPick?: (latitude: number, longitude: number) => void
  /** A standalone pin, e.g. the destination chosen before any route exists. */
  pin?: { latitude: number, longitude: number, label?: string } | null
  /**
   * Stations to plot whether or not there is a route.
   *
   * Seeing every station at once is the point: which one is closest to an
   * address is a question the map answers instantly and a list of coordinates
   * never does.
   */
  stations?: MapStation[]
  /** Drawn in the accent, like the route that leaves from it. */
  selectedStationId?: string | null
  /** Drawn in teal, as the suggestion it is. */
  nearestStationId?: string | null
  /** When given, station pins are clickable. */
  onStationSelect?: (id: string) => void
  /**
   * Whether the page has widened the map. Passing `onTheaterToggle` is what
   * puts the button on the map at all — a map with nowhere to expand to, like
   * the one inside a modal, simply does not offer it.
   */
  theater?: boolean
  onTheaterToggle?: () => void
  /** Increment to replay the primary route from its beginning. */
  simulationRequest?: number
  /** Increment to compare all available route variants on one clock. */
  comparisonSimulationRequest?: number
  /** Real estimated times; only their ratio is preserved in the compressed comparison playback. */
  comparisonSimulationTimes?: { primarySeconds: number, comparisonSeconds: number, criticalSeconds?: number }
  routeSeconds?: number
  criticalMode?: boolean
  routeSteps?: RouteStep[] | null
  comparisonSteps?: RouteStep[] | null
  criticalSteps?: RouteStep[] | null
  routeSegments?: RouteSegment[] | null
  comparisonSegments?: RouteSegment[] | null
  criticalSegments?: RouteSegment[] | null
  sharedWithComparison?: number
  /**
   * Edges of the primary route with their predicted speed. When given, the
   * route is painted by how freely the network expects traffic to flow.
   */
  speedSegments?: RouteSegment[] | null
  /** Circles the dispatcher marked as blocked. */
  closures?: Closure[]
  /** Change `key` to fly the camera to the point (e.g. a manoeuvre picked from the list). */
  focus?: { latitude: number, longitude: number, key: number } | null
  /** Where the vehicle is now (GPS or simulation), drawn as its own marker. */
  livePosition?: { latitude: number, longitude: number, label: string } | null
  routeFeatures?: RouteFeature[]
  destinationPoint?: { latitude: number; longitude: number } | null
  onAlternativeSelect?: (kind: RouteKind) => void
  occurrenceNature?: OccurrenceNature
  occurrencePriority?: OccurrencePriority
  vehicleVisual?: Pick<Vehicle, 'type' | 'prefix' | 'appearance'> & { unit_acronym?: string }
  presentationStep?: string | null
}

/**
 * Runs a camera animation and calls `done` once it settles.
 *
 * The obvious `map.flyTo(...); map.once("moveend", done)` silently fails on a
 * machine with system animations turned off: the browser reports
 * `prefers-reduced-motion`, MapLibre skips the animation, and `moveend` fires
 * synchronously *inside* `flyTo` — before the listener on the next line
 * exists. The orbit and the route playback then never start until some later,
 * unrelated movement happens to trigger the orphaned listener.
 *
 * So the listener goes first, `essential: true` tells MapLibre the movement
 * carries meaning and must play anyway, and `map.stop()` flushes the `moveend`
 * of any animation already in flight before the listener can catch it.
 */
function cameraThen(
  map: maplibregl.Map,
  durationMs: number,
  move: () => void,
  done: () => void,
): () => void {
  map.stop()

  let settled = false

  const settle = () => {
    if (settled) return
    settled = true
    map.off("moveend", settle)
    window.clearTimeout(timer)
    done()
  }

  // An interrupted movement may never emit its own `moveend`, so the duration
  // doubles as a deadline.
  const timer = window.setTimeout(settle, durationMs + 400)

  map.on("moveend", settle)
  move()

  return () => {
    settled = true
    map.off("moveend", settle)
    window.clearTimeout(timer)
  }
}

function dampBearing(current: number, target: number, deltaMs: number, responseMs: number): number {
  const delta = ((target - current + 540) % 360) - 180
  const amount = 1 - Math.exp(-Math.max(0, deltaMs) / responseMs)
  return current + delta * amount
}

export default function RouteMap({
  route,
  comparison,
  critical,
  originLabel = "Origem",
  destinationLabel = "Destino",
  className,
  emptyMessage = "Nenhuma rota para exibir",
  coverage,
  onPick,
  pin,
  stations,
  selectedStationId,
  nearestStationId,
  onStationSelect,
  theater,
  onTheaterToggle,
  simulationRequest = 0,
  comparisonSimulationRequest = 0,
  comparisonSimulationTimes,
  routeSeconds,
  criticalMode = false,
  routeSteps,
  comparisonSteps,
  criticalSteps,
  routeSegments,
  comparisonSegments,
  criticalSegments,
  sharedWithComparison,
  speedSegments,
  closures,
  focus,
  livePosition,
  routeFeatures,
  destinationPoint,
  onAlternativeSelect, occurrenceNature, occurrencePriority, vehicleVisual, presentationStep,
}: RouteMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const followTriggerRef = useRef<HTMLButtonElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const originMarker = useRef<maplibregl.Marker | null>(null)
  const destinationMarker = useRef<maplibregl.Marker | null>(null)
  const pinMarker = useRef<maplibregl.Marker | null>(null)
  const liveMarker = useRef<maplibregl.Marker | null>(null)
  const stationMarkers = useRef(new Map<string, maplibregl.Marker>())

  const cancelOrbit = useRef<(() => void) | null>(null)

  const cancelFollow = useRef<(() => void) | null>(null)
  const followRAF = useRef<number | null>(null)
  const followStart = useRef<number | null>(null)
  const followBearing = useRef<number | null>(null)
  const followCameraBearing = useRef<number | null>(null)
  const followFrameTime = useRef<number | null>(null)
  const followElapsed = useRef(0)
  const followPausedRef = useRef(false)
  const pauseFollow = useRef<((paused: boolean) => void) | null>(null)
  const followProgressRef = useRef<HTMLProgressElement>(null)
  const followDistanceRef = useRef<HTMLSpanElement>(null)
  const followSpeedReadoutRef = useRef<HTMLSpanElement>(null)
  const followLimitRef = useRef<HTMLSpanElement>(null)
  const followClockRef = useRef<HTMLOutputElement>(null)
  const followSliderRef = useRef<HTMLInputElement>(null)
  const followAlertRef = useRef<HTMLParagraphElement>(null)
  const seekFollow = useRef<((seconds: number) => void) | null>(null)
  const refreshFollow = useRef<(() => void) | null>(null)
  const [followSpeed, setFollowSpeed] = useState(1)
  const followSpeedRef = useRef(1)
  const [followCamera, setFollowCamera] = useState<SimulationCamera>(readSimulationCamera)
  const followCameraRef = useRef(followCamera)

  const cancelComparison = useRef<(() => void) | null>(null)
  const presentationPaused = useRef(false)

  const [mapMode, setMapMode] = useState<"2d" | "3d">("2d")
  const [camMode, setCamMode] = useState<CamMode>("free")
  const [playback, setPlayback] = useState<"idle" | "follow" | "comparison">("idle")
  const [followPaused, setFollowPaused] = useState(false)
  const [loadingSlow, setLoadingSlow] = useState(false)
  const [arrivalEnabled, setArrivalEnabled] = useState(() => { try { return localStorage.getItem('zeno.arrival') !== 'off' } catch { return true } })
  const [arrivalActive, setArrivalActive] = useState(false)
  const skipArrival = useRef<(() => void) | null>(null)
  const [isolation, setIsolation] = useState(false)
  const [water, setWater] = useState<WaterSource[]>([])
  const [contextWarning, setContextWarning] = useState('')
  const [ghost, setGhost] = useState(false)
  const ghostRef = useRef(false)
  const [showComparison, setShowComparison] = useState(true)
  const [view, setView] = useState<MapView>("inline")

  /**
   * Whether the style has finished loading and the layers exist.
   *
   * This is state and not a ref on purpose. As a ref it never re-rendered, so
   * anything that arrived while the style was still downloading — the coverage
   * rectangle, the stations, a route fetched faster than the basemap — found
   * the map "not ready", returned early, and was never drawn: nothing ever ran
   * those effects again. As state, `load` re-runs every one of them.
   */
  const [ready, setReady] = useState(false)
  const [loadedMap, setLoadedMap] = useState<maplibregl.Map | null>(null)

  const coords = useMemo(() => toMapCoords(route), [route])
  const comparisonCoords = useMemo(() => toMapCoords(comparison), [comparison])
  const criticalCoords = useMemo(() => toMapCoords(critical), [critical])
  const metrics = useMemo(() => measureRoute(coords, routeSegments ?? speedSegments, routeSeconds ?? comparisonSimulationTimes?.primarySeconds), [coords, routeSegments, speedSegments, routeSeconds, comparisonSimulationTimes?.primarySeconds])
  const comparisonMetrics = useMemo(() => measureRoute(comparisonCoords, comparisonSegments, comparisonSimulationTimes?.comparisonSeconds), [comparisonCoords, comparisonSegments, comparisonSimulationTimes?.comparisonSeconds])

  // The map is built once and then fed; the animations read the current route
  // through refs so they never close over stale geometry.
  const metricsRef = useRef<RouteMetrics>(metrics)
  useEffect(() => { metricsRef.current = metrics }, [metrics])
  const comparisonMetricsRef = useRef<RouteMetrics>(comparisonMetrics)

  useEffect(() => {
    comparisonMetricsRef.current = comparisonMetrics
  }, [comparisonMetrics])

  // Clicks are handed to the latest callback without rebuilding the map.
  const pickRef = useRef(onPick)
  useEffect(() => { pickRef.current = onPick }, [onPick])

  // Read by the `load` handler, which runs long after the effect that built the
  // map captured its props.
  const coverageRef = useRef(coverage)
  useEffect(() => { coverageRef.current = coverage }, [coverage])

  const stationsRef = useRef(stations)
  useEffect(() => { stationsRef.current = stations }, [stations])

  const selectStationRef = useRef(onStationSelect)
  useEffect(() => { selectStationRef.current = onStationSelect }, [onStationSelect])

  const hasRoute = coords.length > 1
  const interactive = Boolean(onPick)
  const hasStations = (stations?.length ?? 0) > 0

  // A picking map, or one with stations to show, has to exist before there is
  // anything else to draw on it; a read-only one with nothing on it is not
  // worth a style download until there is a route.
  const showMap = hasRoute || interactive || hasStations

  // -- Camera control --------------------------------------------------------

  const enableFreeCamera = (map: maplibregl.Map) => {
    map.dragPan.enable()
    map.scrollZoom.enable()
    map.dragRotate.enable()
    map.keyboard.enable()
    map.touchZoomRotate.enable()
  }

  const disableFreeCamera = (map: maplibregl.Map) => {
    map.dragPan.disable()
    map.scrollZoom.disable()
    map.dragRotate.disable()
    map.keyboard.disable()
    map.touchZoomRotate.disable()
  }

  const stopOrbit = () => {
    cancelOrbit.current?.()
    cancelOrbit.current = null

  }

  const syncMarkers = (map: maplibregl.Map, at: LngLat[]) => {
    if (at.length === 0) {
      originMarker.current?.remove()
      destinationMarker.current?.remove()
      originMarker.current = null
      destinationMarker.current = null
      return
    }

    if (!originMarker.current) {
      originMarker.current = createMarker(map, at[0], "#0B63A5", "B", originLabel)
    }
    if (!destinationMarker.current) {
      destinationMarker.current = createMarker(
        map, at[at.length - 1], "#A32A20", "!", destinationLabel,
      )
    }

    originMarker.current.setLngLat(at[0])
    destinationMarker.current.setLngLat(at[at.length - 1])
  }

  const fitDisplayedRoutes = (
    map: maplibregl.Map,
    primary: LngLat[],
    secondary: LngLat[] = [],
    criticalRoute: LngLat[] = [],
  ) => {
    const visible = [
      ...primary,
      ...(showComparison ? secondary : []),
      ...criticalRoute,
    ]
    if (visible.length === 0) return

    const bounds = new maplibregl.LngLatBounds()
    visible.forEach((point) => bounds.extend(point))

    map.fitBounds(bounds, {
      padding: { top: 54, right: 54, bottom: 54, left: 54 },
      maxZoom: 15.5,
      duration: 650,
      essential: false,
    })
  }

  const stopFollow = () => {
    if (document.activeElement && wrapRef.current?.querySelector(".follow-hud")?.contains(document.activeElement)) followTriggerRef.current?.focus()
    setArrivalActive(false)
    skipArrival.current = null
    if (mapRef.current) setArrivalFrame(mapRef.current, "primary", "OUTROS", null)
    cancelFollow.current?.()
    cancelFollow.current = null
    pauseFollow.current = null
    seekFollow.current = null
    refreshFollow.current = null
    if (mapRef.current) {
      showComparisonVehicle(mapRef.current, false)
      setVehicleGhost(mapRef.current, false)
      clearNavigationManeuver(mapRef.current)
      setBuildingOcclusion(mapRef.current, null)
      setRouteProgress(mapRef.current, 'ai', 0)
    }
    mapRef.current?.stop()
    if (mapRef.current) mapRef.current.setPadding({ top: 0, bottom: 0, left: 0, right: 0 })

    if (followRAF.current !== null) {
      cancelAnimationFrame(followRAF.current)
      followRAF.current = null
    }
    followStart.current = null
    followBearing.current = null
    followCameraBearing.current = null
    followFrameTime.current = null
    followElapsed.current = 0
    followPausedRef.current = false
    setFollowPaused(false)
    setPlayback((current) => current === "follow" ? "idle" : current)
  }

  const stopComparisonSimulation = () => {
    cancelComparison.current?.()
    cancelComparison.current = null
    setPlayback((current) => current === "comparison" ? "idle" : current)
  }

  // -- Map lifecycle ---------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !showMap) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(),
      center: metricsRef.current.coords.length > 0 ? metricsRef.current.center : FALLBACK_CENTER,
      zoom: 13.5,
      pitch: 0,
      bearing: 0,
      canvasContextAttributes: { antialias: true },
      // Tracking is a continuously moving 3D view, so cap render resolution.
      pixelRatio: 1,
    })

    mapRef.current = map
    const releaseToolbar = observeMapToolbar(wrapRef.current!, toolbarRef.current!, map)
    const loadingTimer = window.setTimeout(() => setLoadingSlow(true), 15_000)
    map.getCanvas().setAttribute("aria-label", "Mapa de rotas. Use as setas para mover e mais ou menos para ajustar o zoom.")
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right")
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left")

    // Captured now: reading `stationMarkers.current` inside the cleanup would
    // read whatever it holds at teardown, not the collection this map filled.
    const markers = stationMarkers.current

    map.on("load", () => {
      window.clearTimeout(loadingTimer)
      setLoadingSlow(false)
      const live = metricsRef.current

      addCoverageLayer(map, coverageRef.current)
      addRouteLayers(map, live.coords, comparisonCoords, criticalCoords)
      addArrowLayer(map, live.coords[0] ?? FALLBACK_CENTER)

      map.setMaxPitch(0)
      map.setMinZoom(9)
      map.setMaxZoom(16)

      set3DEnvironment(map, false)
      setBuildingLayersVisibility(map, false)
      syncMarkers(map, live.coords)

      if (live.coords.length > 0) {
        fitDisplayedRoutes(map, live.coords, comparisonCoords, criticalCoords)
      } else if (coverageRef.current) {
        fitBoundsOf(map, coverageRef.current)
      }

      setReady(true)
      setLoadedMap(map)
    })

    if (interactive) {
      map.getCanvas().style.cursor = "crosshair"
      map.on("click", (event) => {
        pickRef.current?.(event.lngLat.lat, event.lngLat.lng)
      })
    }

    return () => {
      window.clearTimeout(loadingTimer)
      releaseToolbar()
      stopOrbit()
      stopFollow()
      stopComparisonSimulation()
      setReady(false)
      setLoadedMap(null)
      originMarker.current = null
      destinationMarker.current = null
      pinMarker.current = null
      liveMarker.current = null
      markers.clear()
      map.remove()
      mapRef.current = null
    }
    // The map is intentionally built once; route changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap])

  // A new route replaces the geometry in place rather than rebuilding the map,
  // which would cost a full style download on every incident selected.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    stopFollow()
    stopComparisonSimulation()
    showArrow(map, false)
    showComparisonVehicle(map, false)
    setCamMode("free")
    enableFreeCamera(map)

    updateRouteData(map, coords, comparisonCoords, criticalCoords)
    syncMarkers(map, coords)

    if (coords.length > 0) fitDisplayedRoutes(map, coords, comparisonCoords, criticalCoords)
    // Labels are captured on creation; a route change is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, comparisonCoords, criticalCoords, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    setComparisonVisibility(map, showComparison && comparisonCoords.length > 1)
  }, [showComparison, comparisonCoords, ready, mapMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    updateCoverageData(map, coverage)
  }, [coverage, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    setSpeedOverlay(map, speedSegments ? route : null, speedSegments)
  }, [route, speedSegments, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    setClosures(map, closures)
  }, [closures, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || playback !== 'idle' || !onAlternativeSelect) return
    return addAlternativeMarkers(map, [
      { kind: 'ai', label: 'IA', metrics },
      { kind: 'standard', label: 'Padrão', metrics: comparisonMetrics },
      { kind: 'critical', label: 'Crítico', metrics: measureRoute(criticalCoords, criticalSegments, comparisonSimulationTimes?.criticalSeconds) },
    ], onAlternativeSelect)
  }, [ready, playback, metrics, comparisonMetrics, criticalCoords, criticalSegments, comparisonSimulationTimes?.criticalSeconds, onAlternativeSelect])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (!livePosition) {
      liveMarker.current?.remove()
      liveMarker.current = null
      return
    }
    const at: LngLat = [livePosition.longitude, livePosition.latitude]
    if (!liveMarker.current) {
      liveMarker.current = createMarker(map, at, "#0E6E75", "▲", livePosition.label)
    } else {
      liveMarker.current.setLngLat(at)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePosition?.latitude, livePosition?.longitude, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !focus) return
    map.flyTo({ center: [focus.longitude, focus.latitude], zoom: Math.max(map.getZoom(), 16), duration: 700, essential: false })
    // Only a new key means a new request; the coordinates alone may repeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, ready])

  // The picked point gets its own pin so the click has visible feedback before
  // any route is calculated.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    if (!pin) {
      pinMarker.current?.remove()
      pinMarker.current = null
      return
    }

    const at: LngLat = [pin.longitude, pin.latitude]

    if (!pinMarker.current) {
      pinMarker.current = createMarker(map, at, "#A32A20", "!", pin.label ?? "Destino")
    } else {
      pinMarker.current.setLngLat(at)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.latitude, pin?.longitude, pin?.label, ready])

  /**
   * Station pins, rebuilt whenever the list or the highlight changes.
   *
   * The signature is what the effect actually watches: a caller that rebuilds
   * its station array on every render would otherwise re-add every marker on
   * every keystroke, and making each screen memoise correctly is a rule nobody
   * remembers. The array itself is read through a ref.
   */
  const stationSignature = (stations ?? [])
    .map((station) => `${station.id}:${station.latitude}:${station.longitude}:${station.acronym}`)
    .join("|")

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const markers = stationMarkers.current

    for (const station of stationsRef.current ?? []) {
      const marker = createStationMarker(
        map,
        [station.longitude, station.latitude],
        station,
        {
          selected: station.id === selectedStationId,
          nearest: station.id !== selectedStationId && station.id === nearestStationId,
          onClick: selectStationRef.current
            ? () => selectStationRef.current?.(station.id)
            : undefined,
        },
      )

      markers.set(station.id, marker)
    }

    return () => {
      markers.forEach((marker) => marker.remove())
      markers.clear()
    }
  }, [stationSignature, selectedStationId, nearestStationId, ready])

  useEffect(() => {
    if (!ready || mapMode !== '3d') return
    let cancelled = false
    waterSources.list().then((rows) => { if (!cancelled) { setWater(rows); setContextWarning('') } }).catch(() => { if (!cancelled) setContextWarning('Pontos de água indisponíveis') })
    return () => { cancelled = true }
  }, [ready, mapMode])

  const destinationLatitude = destinationPoint?.latitude
  const destinationLongitude = destinationPoint?.longitude
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    setSceneContext(map, { destination: destinationLongitude !== undefined && destinationLatitude !== undefined ? [destinationLongitude, destinationLatitude] : coords.at(-1) ?? null, priority: occurrencePriority,
      stations: stations ?? [], selectedStationId, water, isolation, active: playback !== 'idle' })
  }, [ready, coords, destinationLatitude, destinationLongitude, occurrencePriority, stations, selectedStationId, water, isolation, playback])

  useEffect(() => {
    if (mapRef.current && ready) setMapVehicleVisual(mapRef.current, vehicleVisual)
  }, [ready, vehicleVisual])

  // -- Size ------------------------------------------------------------------

  /**
   * MapLibre measures its container once and never looks again, so every way
   * the box can change size has to tell it: theater, fullscreen, the browser
   * window, and the responsive grid collapsing a column underneath it.
   */
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !showMap) return

    const observer = new ResizeObserver(() => mapRef.current?.resize())
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [showMap])

  // Leaving fullscreen with Escape or the browser's own control never goes
  // through our button, so the state is read back from the document.
  useEffect(() => {
    const onChange = () => {
      const wrap = wrapRef.current
      if (document.fullscreenElement !== wrap) {
        setView((current) => (current === "full" ? "inline" : current))
      }
    }

    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  // Theater belongs to the page, but its Escape is still expected to work.
  useEffect(() => {
    if (!theater || !onTheaterToggle) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onTheaterToggle()
    }

    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [theater, onTheaterToggle])

  const toggleFullscreen = () => {
    const wrap = wrapRef.current
    if (!wrap) return

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }

    // Fullscreen can be refused — an iframe without the permission, a browser
    // that never implemented it. Widening the map in the page is the
    // consolation prize, and it is close enough that the click still does
    // something like what it looked like it would.
    wrap.requestFullscreen()
      .then(() => setView("full"))
      .catch(() => onTheaterToggle?.())
  }

  // -- 3D overview -----------------------------------------------------------

  const startOrbit = (map: maplibregl.Map) => {
    stopOrbit()
    setCamMode("free")
    enableFreeCamera(map)
    map.easeTo({ pitch: 52, bearing: -18, duration: 650 })
  }

  // -- Route playback --------------------------------------------------------

  const startFollow = (map: maplibregl.Map, arrivalPreview = false) => {
    stopFollow()
    stopComparisonSimulation()

    const live = metricsRef.current
    if (live.coords.length < 2) return

    // Starting Waze tracking always selects its forward-facing chase camera.
    // A previous top-down/flyover selection must not carry into a new drive.
    followCameraRef.current = 'chase'
    setFollowCamera('chase')
    saveSimulationCamera('chase')
    setPlayback("follow")
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")
    let reducedMotion = motionPreference.matches
    followPausedRef.current = reducedMotion
    if (presentationStep) followPausedRef.current = reducedMotion || presentationPaused.current
    setFollowPaused(followPausedRef.current)

    disableFreeCamera(map)
    // The navigation camera needs perspective, not costly DEM terrain meshes.
    // Keep buildings initially; restore the original terrain on exit.
    setEnvironmentPlayback(map, true)
    followStart.current = null

    // The layer may not exist yet if the icon was still decoding when the map
    // loaded, and the 2D/3D toggle hides it — so it is re-asserted here.
    addArrowLayer(map, live.coords[0])
    const standard = comparisonMetricsRef.current
    if (standard.coords.length > 1) addComparisonVehicleLayer(map, standard.coords[0])
    setVehicleGhost(map, ghostRef.current)
    showComparisonVehicle(map, ghostRef.current && standard.coords.length > 1)
    showArrow(map, true)
    setRouteProgress(map, 'ai', 0)
    setBuildingContext(map, live.coords[live.coords.length - 1])

    followElapsed.current = arrivalPreview ? Math.max(0, live.followDurationMs - 1500) : 0
    const initialDistance = live.distanceAtSeconds(followElapsed.current / Math.max(1, live.followDurationMs) * live.totalSeconds)
    const initialPosition = live.pointAtDist(initialDistance)
    const initialBearing = bearingBetween(initialPosition, live.pointAtDist(initialDistance + 20))
    moveArrow(map, initialPosition, initialBearing)
    followBearing.current = initialBearing
    followCameraBearing.current = initialBearing
    followFrameTime.current = null

    let cancelled = false
    let hudPadding = 0
    let lastHudMeasure = -Infinity
    let appliedPadding = -1
    let slowFrames = 0
    let lightweightBuildings = false
    let arrivalElapsed: number | null = null
    let frame: ((timestamp: number, scrub?: boolean) => void) | null = null
    const cancelFrame = () => {
      if (followRAF.current !== null) cancelAnimationFrame(followRAF.current)
      followRAF.current = null
      followFrameTime.current = null
    }
    const scheduleFrame = () => {
      if (!cancelled && frame && (!followPausedRef.current || (followCameraRef.current === 'orbit' && !reducedMotion)) && !document.hidden && followRAF.current === null) {
        followRAF.current = requestAnimationFrame(frame)
      }
    }
    pauseFollow.current = (paused) => {
      if (!paused && followCameraRef.current === 'orbit') {
        followCameraRef.current = 'chase'
        setFollowCamera('chase')
        saveSimulationCamera('chase')
      }
      followPausedRef.current = paused
      setFollowPaused(paused)
      if (paused) {
        cancelFrame()
        map.stop()
      } else {
        scheduleFrame()
      }
      if (paused && followCameraRef.current === 'orbit') scheduleFrame()
    }
    refreshFollow.current = () => {
      cancelFrame()
      frame?.(performance.now(), true)
    }
    skipArrival.current = () => {
      arrivalElapsed = ARRIVAL_DURATION_SECONDS
      setArrivalFrame(map, 'primary', occurrenceNature ?? 'OUTROS', ARRIVAL_DURATION_SECONDS, arrivalEnabled)
      setArrivalActive(false)
      pauseFollow.current?.(true)
    }
    seekFollow.current = (seconds) => {
      arrivalElapsed = null
      setArrivalActive(false)
      setArrivalFrame(map, 'primary', occurrenceNature ?? 'OUTROS', null)
      followElapsed.current = Math.min(live.totalSeconds, Math.max(0, seconds)) / Math.max(1, live.totalSeconds) * live.followDurationMs
      refreshFollow.current?.()
    }
    const chooseCamera = (camera: SimulationCamera) => {
      followCameraRef.current = camera
      setFollowCamera(camera)
      saveSimulationCamera(camera)
      if (camera === 'orbit') pauseFollow.current?.(true)
      refreshFollow.current?.()
    }
    const onCameraKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      const camera = ({ '1': 'chase', '2': 'top', '3': 'orbit' } as const)[event.key as '1' | '2' | '3']
      if (camera) { event.preventDefault(); chooseCamera(camera) }
    }
    wrapRef.current?.addEventListener('keydown', onCameraKey)
    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelFrame()
        map.stop()
      } else {
        scheduleFrame()
      }
    }
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      if (!reducedMotion) return
      pauseFollow.current?.(true)
      map.jumpTo({ pitch: 0, bearing: 0 })
      fitDisplayedRoutes(map, live.coords)
    }
    motionPreference.addEventListener("change", onMotionChange)
    document.addEventListener("visibilitychange", onVisibilityChange)
    const cancelCamera = cameraThen(
      map,
      1200,
      () => map.flyTo({
        center: initialPosition,
        zoom: reducedMotion ? map.getZoom() : WAZE_ZOOM,
        pitch: reducedMotion ? 0 : WAZE_PITCH,
        bearing: reducedMotion ? 0 : initialBearing,
        duration: reducedMotion ? 0 : 1200,
        easing: (t) => 1 - Math.pow(1 - t, 3),
      }),
      () => {
        if (reducedMotion) fitDisplayedRoutes(map, live.coords)
        followStart.current = null
        showArrow(map, true)
        let lastReadout = -Infinity
        let lastGradeReadout = -Infinity
        let gradeAlert: { text: string; distance: number } | null = null

        let navigation = navigationState(live, routeSteps ?? [], 0)
        frame = (timestamp: number, scrub = false) => {
          followRAF.current = null
          if (cancelled || (!scrub && followPausedRef.current && (followCameraRef.current !== 'orbit' || reducedMotion)) || document.hidden) {
            followFrameTime.current = null
            return
          }
          const { totalMeters, followDurationMs, pointAtDist, distanceAtSeconds, totalSeconds } = metricsRef.current
          // Advance by actual wall time: clamping the SIMULATION to 100 ms per
          // frame makes a 1 FPS browser move just 0.1 s per real second.
          const clockDeltaMs = followFrameTime.current === null ? 0 : Math.min(1500, Math.max(0, timestamp - followFrameTime.current))
          const deltaMs = Math.min(100, clockDeltaMs) // only clamp visual damping
          followFrameTime.current = timestamp
          // Adapt when frame times consistently exceed a tenth of a second.
          // Low-end GPUs get a flatter but responsive map, not a frozen truck.
          if (!scrub && !lightweightBuildings) {
            slowFrames = clockDeltaMs >= 110 ? slowFrames + 1 : Math.max(0, slowFrames - 1)
            if (slowFrames >= 5) {
              lightweightBuildings = true
              setBuildingOcclusion(map, null)
              setBuildingLayersVisibility(map, false)
            }
          }
          if (!scrub && !followPausedRef.current && followCameraRef.current !== 'orbit') followElapsed.current += clockDeltaMs * followSpeedRef.current
          const simulatedSeconds = Math.min(totalSeconds, followElapsed.current / Math.max(1, followDurationMs) * totalSeconds)
          const travelled = distanceAtSeconds((followElapsed.current / Math.max(1, followDurationMs)) * totalSeconds)
          if (scrub || timestamp - lastReadout > 180) {
            lastReadout = timestamp
            navigation = navigationState(live, routeSteps ?? [], travelled)
            if (scrub || timestamp - lastGradeReadout >= 1000) {
              gradeAlert = terrainGradeAlert(map, live, travelled)
              lastGradeReadout = timestamp
            }
            if (followProgressRef.current) followProgressRef.current.value = totalMeters > 0 ? travelled / totalMeters : 1
            if (followDistanceRef.current) followDistanceRef.current.textContent = `${formatDistance(Math.max(0, totalMeters - travelled))} · ETA ${clockLabel(totalSeconds - simulatedSeconds)}`
            if (followSpeedReadoutRef.current) followSpeedReadoutRef.current.textContent = `${Math.round(live.speedAtSeconds(simulatedSeconds))} km/h previstos${criticalMode || navigation.emergency ? ' · modo crítico' : ''}`
            if (followLimitRef.current) {
              followLimitRef.current.textContent = navigation.limitKmh ? String(navigation.limitKmh) : '—'
              followLimitRef.current.title = navigation.limitKmh ? `Limite informado: ${navigation.limitKmh} km/h` : 'Limite não informado'
            }
            if (followClockRef.current) followClockRef.current.textContent = `${clockLabel(simulatedSeconds)} / ${clockLabel(totalSeconds)}`
            if (followSliderRef.current) followSliderRef.current.value = String(simulatedSeconds)
            const featureAlert = roadFeatureAlerts(routeFeatures ?? [], live.cumulative, travelled)[0]
            const alert = [gradeAlert, navigation.alert, featureAlert].filter((entry): entry is { text: string; distance: number } => !!entry).sort((a, b) => a.distance - b.distance)[0]
            if (followAlertRef.current) followAlertRef.current.textContent = alert ? `${alert.text} · ${formatDistance(alert.distance)}` : ''
            setNavigationManeuver(map, live, navigation.maneuver?.meters ?? null, travelled)
            setRoadContext(map, live, routeFeatures ?? [], travelled, navigation.maneuver?.meters ?? null)
            setRouteProgress(map, 'ai', totalMeters > 0 ? travelled / totalMeters : 1)
            map.fire('zeno:progress', { fraction: totalMeters > 0 ? travelled / totalMeters : 1 })
          }

          if (travelled >= totalMeters) {
            if (scrub || reducedMotion || !arrivalEnabled) {
              setArrivalFrame(map, 'primary', occurrenceNature ?? 'OUTROS', ARRIVAL_DURATION_SECONDS, false)
              if (!followPausedRef.current) pauseFollow.current?.(true)
            } else if (arrivalElapsed === null || arrivalElapsed < ARRIVAL_DURATION_SECONDS) {
              if (arrivalElapsed === null) { arrivalElapsed = 0; setArrivalActive(true) }
              arrivalElapsed = Math.min(ARRIVAL_DURATION_SECONDS, arrivalElapsed + deltaMs / 1000)
              setArrivalFrame(map, 'primary', occurrenceNature ?? 'OUTROS', arrivalElapsed)
              if (arrivalElapsed >= ARRIVAL_DURATION_SECONDS) { setArrivalActive(false); pauseFollow.current?.(true) }
            }
          }

          const position = pointAtDist(travelled)

          // Estimate the road tangent across the corner instead of looking at
          // only one forward segment. This lets the truck begin rotating before
          // the vertex and finish the turn after it, avoiding the rigid snap.
          const behind = pointAtDist(Math.max(0, travelled - 16))
          const ahead = pointAtDist(Math.min(travelled + 30, totalMeters))
          const targetBearing = bearingBetween(behind, ahead)

          const bearing = dampBearing(
            followBearing.current ?? targetBearing,
            targetBearing,
            deltaMs,
            145,
          )
          followBearing.current = bearing

          // The camera follows the same curve with a slower response, so the
          // truck turns visibly inside a stable navigation view instead of the
          // whole scene snapping together.
          const cameraTarget = bearingBetween(
            pointAtDist(Math.max(0, travelled - 8)),
            pointAtDist(Math.min(travelled + 42, totalMeters)),
          )
          const cameraBearing = dampBearing(
            followCameraBearing.current ?? cameraTarget,
            cameraTarget,
            deltaMs,
            260,
          )
          followCameraBearing.current = cameraBearing

          // Centering slightly ahead keeps the vehicle below centre and leaves
          // more road visible in the direction of travel, like a navigation HUD.
          const cameraCenter = pointAtDist(Math.min(travelled + 26, totalMeters))

          moveArrow(map, position, bearing)
          setStationDeparture(map, selectedStationId, followElapsed.current / 1000)
          if (ghostRef.current && standard.coords.length > 1) {
            const ghostDistance = standard.distanceAtSeconds(simulatedSeconds)
            moveComparisonVehicle(map, standard.pointAtDist(ghostDistance), bearingBetween(standard.pointAtDist(ghostDistance - 10), standard.pointAtDist(ghostDistance + 10)), 3)
          }
          if (!lightweightBuildings) setBuildingOcclusion(map, position)
          const camera = followCameraRef.current
          // The replay controls cover the lower map. Keep the truck in the
          // unobstructed viewport instead of hiding it behind the HUD.
          if (scrub || timestamp - lastHudMeasure > 250) {
            lastHudMeasure = timestamp
            const hudHeight = wrapRef.current?.querySelector<HTMLElement>('.follow-hud')?.offsetHeight ?? 0
            const mapHeight = map.getContainer().clientHeight
            hudPadding = Math.min(Math.max(0, mapHeight - 120), hudHeight + 40)
          }
          // Changing padding is expensive in MapLibre; only apply it when the
          // controls actually change size or when the user switches camera.
          const desiredPadding = camera === 'chase' ? hudPadding : 0
          if (!reducedMotion && desiredPadding !== appliedPadding) {
            appliedPadding = desiredPadding
            map.setPadding({ top: 0, bottom: desiredPadding, left: 0, right: 0 })
          }
          const cameraBlend = scrub ? 1 : 1 - Math.exp(-Math.max(deltaMs, 16) / 240)
          if (!reducedMotion) map.jumpTo({
            center: camera === 'chase' ? cameraCenter : position,
            bearing: arrivalElapsed !== null ? map.getBearing() + deltaMs * .025 : camera === 'top' ? 0 : camera === 'orbit' ? map.getBearing() + deltaMs * 0.006 : cameraBearing,
            pitch: map.getPitch() + ((camera === 'top' ? 0 : navigation.pitch) - map.getPitch()) * cameraBlend,
            zoom: map.getZoom() + ((camera === 'top' ? 16.5 : navigation.zoom) - map.getZoom()) * cameraBlend,
          })

          scheduleFrame()
        }

        frame(performance.now(), true)
      },
    )
    cancelFollow.current = () => {
      cancelled = true
      cancelFrame()
      cancelCamera()
      motionPreference.removeEventListener("change", onMotionChange)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      wrapRef.current?.removeEventListener('keydown', onCameraKey)
      setEnvironmentPlayback(map, false)
      if (lightweightBuildings) setBuildingLayersVisibility(map, true)
    }
  }

  const startComparisonSimulation = (map: maplibregl.Map) => {
    stopFollow()
    stopComparisonSimulation()
    const primary = metricsRef.current
    const secondary = comparisonMetricsRef.current
    const emergency = measureRoute(criticalCoords, criticalSegments, comparisonSimulationTimes?.criticalSeconds)
    if (primary.coords.length < 2 || secondary.coords.length < 2 || !wrapRef.current) return
    setMapMode("3d")
    setCamMode("follow")
    setPlayback("comparison")
    setShowComparison(true)
    setLayerVisibility(map, true)
    set3DEnvironment(map, true)
    setBuildingLayersVisibility(map, true)
    map.setMaxPitch(70)
    map.setMaxZoom(20)
    disableFreeCamera(map)
    showArrow(map, false)
    const participants = [
      { metrics: primary, seconds: primary.totalSeconds, kind: "ai" as const, sharedWithStandard: sharedWithComparison, steps: routeSteps },
      { metrics: secondary, seconds: secondary.totalSeconds, kind: "standard" as const, steps: comparisonSteps },
      ...(emergency.coords.length > 1 ? [{ metrics: emergency, seconds: emergency.totalSeconds, kind: "critical" as const, steps: criticalSteps }] : []),
    ]
    cancelComparison.current = startComparisonPlayback(map, wrapRef.current, participants, () => {
      setCamMode("free")
      setPlayback("idle")
      enableFreeCamera(map)
    }, { nature: occurrenceNature ?? "OUTROS", enabled: arrivalEnabled, stationId: selectedStationId })
  }

  const handleCamModeChange = (next: CamMode) => {
    const map = mapRef.current
    if (!map) return

    if (next === camMode) return

    setCamMode(next)

    if (next === "free") {
      stopFollow()
      stopComparisonSimulation()
      showArrow(map, false)
      showComparisonVehicle(map, false)
      enableFreeCamera(map)
    } else {
      stopComparisonSimulation()
      setMapMode("3d")
      setLayerVisibility(map, true)
      set3DEnvironment(map, true)
      setBuildingLayersVisibility(map, true)
      map.setMaxPitch(70)
      map.setMaxZoom(20)
      showComparisonVehicle(map, false)
      setCamMode("follow")
      startFollow(map)
    }
  }

  const handleToggle = () => {
    const map = mapRef.current
    if (!map) return

    if (mapMode === "2d") {
      setMapMode("3d")
      setCamMode("free")

      setLayerVisibility(map, true)
      set3DEnvironment(map, true)

      map.setMaxPitch(85)
      map.setMinZoom(9)
      map.setMaxZoom(20)

      setBuildingLayersVisibility(map, true)
      startOrbit(map)
    } else {
      setMapMode("2d")
      setCamMode("free")

      stopOrbit()
      stopFollow()
      stopComparisonSimulation()
      showArrow(map, false)
      showComparisonVehicle(map, false)

      setLayerVisibility(map, false)
      set3DEnvironment(map, false)

      map.setMaxPitch(0)
      map.setMaxZoom(16)

      setBuildingLayersVisibility(map, false)
      enableFreeCamera(map)

      cancelOrbit.current = cameraThen(
        map,
        800,
        () => map.easeTo({
          pitch: 0,
          bearing: 0,
          duration: 800,
          essential: false,
          easing: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
        }),
        () => {
          const live = metricsRef.current
          if (live.coords.length > 0) fitDisplayedRoutes(map, live.coords, comparisonCoords, criticalCoords)
          else if (coverageRef.current) fitBoundsOf(map, coverageRef.current)
        },
      )
    }
  }

  useEffect(() => {
    if (!ready || simulationRequest <= 0) return

    const map = mapRef.current
    if (!map || metricsRef.current.coords.length < 2) return

    stopOrbit()
    stopComparisonSimulation()
    setMapMode("3d")
    setCamMode("follow")
    setLayerVisibility(map, true)
    set3DEnvironment(map, true)
    setBuildingLayersVisibility(map, true)
    map.setMaxPitch(85)
    map.setMinZoom(9)
    map.setMaxZoom(20)
    startFollow(map)
    // Triggered intentionally only by the replay signal and readiness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationRequest, ready])

  useEffect(() => {
    if (!ready || comparisonSimulationRequest <= 0) return

    const map = mapRef.current
    if (!map) return

    stopOrbit()
    startComparisonSimulation(map)
    // Triggered intentionally only by the comparison signal and readiness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonSimulationRequest, ready])

  useEffect(() => {
    const control = (event: Event) => {
      const detail = (event as CustomEvent<{ step: string; paused: boolean }>).detail
      if (!detail || detail.step !== presentationStep) return
      const paused = detail.paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      presentationPaused.current = paused
      pauseFollow.current?.(paused)
      mapRef.current?.fire('zeno:pause', { paused })
    }
    window.addEventListener('zeno:presentation', control)
    return () => window.removeEventListener('zeno:presentation', control)
  }, [presentationStep])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !hasRoute || !['route', 'comparison', 'arrival'].includes(presentationStep ?? '')) return
    wrapRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
    stopOrbit()
    if (presentationStep === 'comparison') {
      startComparisonSimulation(map)
      map.fire('zeno:pause', { paused: presentationPaused.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches })
    } else {
      setMapMode('3d'); setCamMode('follow')
      setLayerVisibility(map, true); set3DEnvironment(map, true); setBuildingLayersVisibility(map, true)
      map.setMaxPitch(85); map.setMaxZoom(20)
      startFollow(map, presentationStep === 'arrival')
    }
    return () => { stopFollow(); stopComparisonSimulation() }
    // A tour step starts once after its real geometry and style are ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationStep, ready, hasRoute])

  if (!showMap) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-3 border bg-surface", className)}>
        <MapPinOff className="h-12 w-12 text-ink-soft" />
        <p className="text-ink-muted">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={cn("map-wrap border", playback !== "idle" && "map-playing", playback === "follow" && "map-following", className)} onKeyDown={(event) => { if (event.key === "Escape" && playback === "follow") { event.preventDefault(); if (arrivalActive) skipArrival.current?.(); else handleCamModeChange("free") } }}>
      <div ref={containerRef} className="map" />
      <div ref={toolbarRef} className="top-controls">
        <div className="map-toolbar-title"><span>MAPA OPERACIONAL</span><strong>{playback === "comparison" ? "Comparação de percursos" : playback === "follow" ? "Acompanhamento da rota" : "Visão do território"}</strong></div>
        <div className="map-toolbar-actions">
          <div className="toggle-wrap" role="group" aria-label="Dimensão do mapa">
            <button type="button" disabled={!ready} aria-pressed={mapMode === "2d"} className={mapMode === "2d" ? "active" : ""} onClick={() => mapMode !== "2d" && handleToggle()}><MapIcon size={14} />2D</button>
            <button type="button" disabled={!ready} aria-pressed={mapMode === "3d"} className={mapMode === "3d" ? "active" : ""} onClick={() => mapMode !== "3d" && handleToggle()}><Box size={14} />3D</button>
          </div>
          {comparisonCoords.length > 1 && (
            <div className="toggle-wrap">
              <button type="button" disabled={!ready || playback === "comparison"} aria-pressed={showComparison} className={cn("compare", showComparison && "active")} onClick={() => setShowComparison((value) => !value)} title="Mostrar ou ocultar o traçado da rota padrão"><span className="compare-swatch" />Padrão</button>
            </div>
          )}
          {hasRoute && (
            <div className="toggle-wrap">
              <button ref={followTriggerRef} type="button" disabled={!ready || playback === "comparison"} aria-pressed={playback === "follow"} className={playback === "follow" ? "active" : ""} onClick={() => handleCamModeChange(playback === "follow" ? "free" : "follow")}>
                {playback === "follow" ? <Globe size={14} /> : <Navigation size={14} />}{playback === "follow" ? "Câmera livre" : "Seguir rota"}
              </button>
            </div>
          )}
          {hasRoute && <div className="toggle-wrap"><button type="button" aria-pressed={isolation} onClick={() => setIsolation((value) => !value)}>Isolamento</button></div>}
          <div className="toggle-wrap map-view-controls" role="group" aria-label="Enquadramento do mapa">
            <button type="button" disabled={!ready || playback !== "idle"} className="view" aria-label="Enquadrar rotas e unidades" title="Enquadrar rotas e unidades" onClick={() => {
              const map = mapRef.current
              if (!map) return
              if (coords.length) fitDisplayedRoutes(map, coords, comparisonCoords, criticalCoords)
              else if (coverage) fitBoundsOf(map, coverage)
              else if (stations?.length) {
                const bounds = new maplibregl.LngLatBounds()
                stations.forEach((station) => bounds.extend([station.longitude, station.latitude]))
                map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 500 })
              }
            }}><LocateFixed size={15} /></button>
            {onTheaterToggle && <button type="button" className={cn("view", theater && "active")} aria-label={theater ? "Recolher mapa" : "Expandir mapa na página"} aria-pressed={Boolean(theater)} onClick={onTheaterToggle} title="Expandir mapa na página">{theater ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>}
            <button type="button" className={cn("view", view === "full" && "active")} aria-label={view === "full" ? "Sair da tela cheia" : "Abrir em tela cheia"} aria-pressed={view === "full"} onClick={toggleFullscreen} title={view === "full" ? "Sair da tela cheia" : "Abrir em tela cheia"}>{view === "full" ? <Minimize size={15} /> : <Maximize size={15} />}</button>
          </div>
        </div>
      </div>
      {contextWarning && mapMode === "3d" && <p className="map-context-warning" role="status">{contextWarning}</p>}
      {!ready && <div className="map-loading" role="status"><MapIcon size={25} /><strong>{loadingSlow ? "A cartografia está demorando a responder" : "Carregando cartografia"}</strong><span>{loadingSlow ? "Verifique a conexão com o serviço de mapas." : "Preparando vias e referências do território…"}</span></div>}
      {ready && playback === "idle" && hasRoute && (
        <div className="map-route-caption"><Navigation size={15} /><div><strong>{originLabel} <span aria-hidden="true">→</span> {destinationLabel}</strong><span>{formatDistance(metrics.totalMeters)} de traçado · {mapMode === "3d" ? "Perspectiva 3D" : "Vista superior"}{destinationPoint && destinationSide(coords, [destinationPoint.longitude, destinationPoint.latitude]) ? ` · destino à ${destinationSide(coords, [destinationPoint.longitude, destinationPoint.latitude])}` : ''}</span></div></div>
      )}
      {playback === "follow" && (
        <div className="follow-hud">
          <div className="follow-heading"><div><span className="map-kicker">REPRODUÇÃO DO PERCURSO</span><strong>{followPaused ? "Reprodução pausada" : "Seguindo a rota"}</strong></div><div className="follow-actions">
            <select className="simulation-camera" aria-label="Câmera de acompanhamento" value={followCamera} onChange={(event) => {
              const camera = event.target.value as SimulationCamera
              followCameraRef.current = camera; setFollowCamera(camera); saveSimulationCamera(camera)
              if (camera === 'orbit') pauseFollow.current?.(true)
              refreshFollow.current?.()
            }}><option value="chase">1 · Perseguição</option><option value="top">2 · De cima</option><option value="orbit">3 · Órbita parada</option></select>
            <button type="button" aria-label={`Velocidade do replay: ${followSpeed} vezes`} onClick={() => { const next = followSpeed === 1 ? 2 : followSpeed === 2 ? 4 : 1; followSpeedRef.current = next; setFollowSpeed(next) }}>{followSpeed}×</button>
            <button type="button" onClick={() => seekFollow.current?.(0)}>Rever</button>
            <button type="button" aria-pressed={followPaused} onClick={() => pauseFollow.current?.(!followPausedRef.current)}>{followPaused ? <Play size={14} /> : <Pause size={14} />}{followPaused ? "Continuar" : "Pausar"}</button>
            <button type="button" onClick={() => handleCamModeChange("free")}><Square size={12} />Encerrar</button>
          </div></div>
          {arrivalActive && <div className="simulation-arrival" role="status"><span>Cena ilustrativa de chegada · nenhum status operacional é alterado</span><button type="button" onClick={() => skipArrival.current?.()}>Pular · Esc</button></div>}
          <div className="follow-readout"><span ref={followDistanceRef}>{formatDistance(metrics.totalMeters)} · ETA {clockLabel(metrics.totalSeconds)}</span><span className="simulation-speed"><span ref={followLimitRef} className="simulation-limit" title="Limite informado">—</span><span ref={followSpeedReadoutRef}>Velocidade estimada por trecho</span></span><span>Posição simulada</span></div>
          <p className="simulation-alert" ref={followAlertRef} role="status" />
          <label className="simulation-ghost"><input type="checkbox" checked={arrivalEnabled} onChange={(event) => { setArrivalEnabled(event.target.checked); try { localStorage.setItem('zeno.arrival', event.target.checked ? 'on' : 'off') } catch { /* Optional storage. */ } }} />Animações ilustrativas de chegada (próximo replay)</label>
          {comparisonMetrics.coords.length > 1 && <label className="simulation-ghost"><input type="checkbox" checked={ghost} onChange={(event) => {
            const enabled = event.target.checked; setGhost(enabled); ghostRef.current = enabled
            if (mapRef.current) { setVehicleGhost(mapRef.current, enabled); showComparisonVehicle(mapRef.current, enabled); refreshFollow.current?.() }
          }} />Fantasma da rota padrão · mesmo relógio</label>}
          {loadedMap && <div className="simulation-tools"><ElevationProfile map={loadedMap} route={metrics} /><SimulationRecorder map={loadedMap} flyover={() => { followCameraRef.current = 'top'; setFollowCamera('top'); seekFollow.current?.(0); pauseFollow.current?.(false) }} /></div>}
          <div className="simulation-timeline"><output ref={followClockRef}>0:00 / {clockLabel(metrics.totalSeconds)}</output><input ref={followSliderRef} type="range" min={0} max={metrics.totalSeconds} step={0.1} defaultValue={0} aria-label="Tempo do percurso" onChange={(event) => seekFollow.current?.(Number(event.target.value))} />
            <div className="simulation-milestones"><button type="button" onClick={() => seekFollow.current?.(0)}>Saída</button>{(routeSteps ?? []).filter((step) => step.type === 'turn' || step.type === 'roundabout').map((step, index) => <button key={`${step.geometry_index}-${index}`} type="button" onClick={() => seekFollow.current?.(metrics.secondsAtDistance(metrics.cumulative[step.geometry_index] ?? 0))}>{step.type === 'roundabout' ? 'Rotatória' : step.street ?? 'Conversão'}</button>)}<button type="button" onClick={() => seekFollow.current?.(metrics.totalSeconds)}>Chegada</button></div>
          </div>
          <progress ref={followProgressRef} max={1} value={0} aria-label="Progresso do percurso" />
        </div>
      )}
      {ready && interactive && !hasRoute && <p className="map-hint"><Navigation size={14} />{pin ? "Destino marcado · calcule a rota para continuar" : "Selecione uma unidade e marque o destino no mapa"}</p>}
    </div>
  )
}

export type { LngLat }
