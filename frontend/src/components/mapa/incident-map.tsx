/**
 * The incident map.
 *
 * Where the route map draws one journey, this one draws the whole record — and
 * it draws it four ways, because "where do the calls come from" is really four
 * questions:
 *
 *  - **Calor** — where the calls concentrate, as a density surface. Answers
 *    "which part of the city keeps us busy".
 *  - **Pontos** — every call as its own dot, coloured by priority and clickable
 *    through to the record. Answers "which call was that".
 *  - **Cobertura** — every call in the colour of the post that answered it,
 *    which draws each post's real territory rather than the one on paper.
 *  - **Recorrências** — only the addresses that came back, sized by how often.
 *    Answers "what do we keep going back to".
 *
 * They are modes rather than layers stacked together, because a heat wash under
 * three hundred dots reads as neither. Stations ride along on all four: the
 * useful version of "the north-east calls the most" is "the north-east calls
 * the most and the nearest post is across the river".
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Flame, Layers, MapPin, Maximize, Minimize, Repeat, LocateFixed } from "lucide-react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

import type { Dispatch, GraphBounds, OccurrencePriority } from "@/api/types"
import { OperationMapControls } from "@/components/operational/operation-map-controls"
import { NATURE_LABEL, PRIORITY_LABEL } from "@/api/labels"
import { PRIORITY_COLOR } from "./constants/incident-palette"
import { mapStyle } from "./constants/constants"
import { fitBoundsOf, observeMapToolbar } from "./map/helpers"
import { set3DEnvironment, setBuildingLayersVisibility } from "./map/layers"
import { createStationMarker } from "./map/markers"
import { syncVehicleMarkers } from "./map/vehicle-markers"
import type { LiveVehicle } from "./map/vehicle-markers"
import type { MapStation } from "./route-map"
import { cn } from "@/lib/utils"

import "./mapa.css"

/** Taubaté's centre, for the moment before the coverage rectangle arrives. */
const FALLBACK_CENTER: [number, number] = [-45.5551, -23.0264]

const POINT_SOURCE = "src-incidents"
const SPATIAL_SOURCE = "src-spatial-clusters"
const SPATIAL_CIRCLES = "incidents-spatial-clusters"
const SPATIAL_LABELS = "incidents-spatial-labels"
const CLUSTER_SOURCE = "src-recurrences"
const HEAT_GLOW_LAYER = "incidents-heat-glow"
const HEAT_LAYER = "incidents-heat"
const HEAT_HOTSPOT_LAYER = "incidents-heat-hotspots"
const HEAT_HOTSPOT_LABEL = "incidents-heat-hotspot-label"
const POINT_HALO_LAYER = "incidents-point-halo"
const POINT_LAYER = "incidents-point"
const UNIT_AREA_LAYER = "incidents-unit-area"
const UNIT_LAYER = "incidents-unit"
const CLUSTER_HALO_LAYER = "recurrences-halo"
const CLUSTER_LAYER = "recurrences-circle"
const CLUSTER_LABEL = "recurrences-label"

/**
 * The four priorities are an ordered severity scale, so they wear the status
 * palette — good, warning, serious, critical — never a categorical one. The
 * legend names every step, so colour is never the only thing carrying it.
 */
export interface IncidentPoint {
  id: string
  protocol: string
  nature: keyof typeof NATURE_LABEL
  priority: OccurrencePriority
  address: string
  openedAt: string
  latitude: number
  longitude: number
  /** Which post answered, and the colour it was given. */
  unitLabel: string
  unitColor: string
}

export interface RecurrenceCluster {
  id: string
  label: string
  latitude: number
  longitude: number
  count: number
}

export type IncidentMapMode = "heat" | "points" | "coverage" | "recurrence"

export interface IncidentMapProps {
  incidents: IncidentPoint[]
  clusters?: RecurrenceCluster[]
  stations?: MapStation[]
  coverage?: GraphBounds | null
  mode: IncidentMapMode
  onModeChange: (mode: IncidentMapMode) => void
  /** Opening an incident from its popup. */
  onOpen?: (id: string) => void
  /** Live vehicle positions, drawn as prefix chips (the wallboard's fleet). */
  vehicles?: LiveVehicle[]
  unlocatedVehicles?: string[]
  dispatches?: Dispatch[]
  operational?: boolean
  wallboard?: boolean
  historicalAt?: number
  replayTrails?: GeoJSON.FeatureCollection
  className?: string
}

type View = "inline" | "full"

function featuresOf(incidents: IncidentPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: incidents.map((incident) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [incident.longitude, incident.latitude] },
      properties: {
        id: incident.id,
        protocol: incident.protocol,
        nature: incident.nature,
        priority: incident.priority,
        address: incident.address,
        openedAt: incident.openedAt,
        unitLabel: incident.unitLabel,
        unitColor: incident.unitColor,
      },
    })),
  }
}

function clusterFeatures(clusters: RecurrenceCluster[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: clusters.map((cluster) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [cluster.longitude, cluster.latitude] },
      properties: { id: cluster.id, label: cluster.label, count: cluster.count },
    })),
  }
}

type Coordinate = [number, number]

const MODES: { value: IncidentMapMode, label: string, Icon: React.ElementType, title: string }[] = [
  { value: "heat", label: "Calor", Icon: Flame, title: "Concentração de ocorrências" },
  { value: "points", label: "Pontos", Icon: MapPin, title: "Cada ocorrência como um ponto, clicável" },
  { value: "coverage", label: "Cobertura", Icon: Layers, title: "Cada ocorrência na cor do quartel responsável" },
  { value: "recurrence", label: "Recorrências", Icon: Repeat, title: "Endereços que voltaram mais de uma vez" },
]

export default function IncidentMap({
  incidents, clusters, stations, coverage, mode, onModeChange, onOpen, vehicles, unlocatedVehicles, className,
  dispatches, operational = false, wallboard, historicalAt, replayTrails,
}: IncidentMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const stationMarkers = useRef(new Map<string, maplibregl.Marker>())
  const vehicleMarkers = useRef(new Map<string, maplibregl.Marker>())

  const [ready, setReady] = useState(false)
  const [operationalMap, setOperationalMap] = useState<maplibregl.Map | null>(null)
  const [heatTime, setHeatTime] = useState<number | null>(null)
  const [loadingSlow, setLoadingSlow] = useState(false)
  const [view, setView] = useState<View>("inline")
  const [selectedUnit, setSelectedUnit] = useState("")
  const hasFramedIncidents = useRef(false)
  const respondingUnits = useMemo(() => [...new Set(incidents.map((point) => point.unitLabel))].sort(), [incidents])
  const activeUnit = respondingUnits.includes(selectedUnit) ? selectedUnit : ""

  const filteredIncidents = useMemo(() => mode === 'heat' && heatTime !== null ? incidents.filter((point) => {
    const opened = Date.parse(point.openedAt)
    return opened >= heatTime - 3600000 && opened < heatTime
  }) : incidents, [incidents, mode, heatTime])
  const data = useMemo(() => featuresOf(filteredIncidents), [filteredIncidents])
  const clusterData = useMemo(() => clusterFeatures(clusters ?? []), [clusters])

  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])
  const clusterRef = useRef(clusterData)
  useEffect(() => { clusterRef.current = clusterData }, [clusterData])
  const coverageRef = useRef(coverage)
  useEffect(() => { coverageRef.current = coverage }, [coverage])
  const openRef = useRef(onOpen)
  useEffect(() => { openRef.current = onOpen }, [onOpen])

  // -- lifecycle -------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(),
      center: FALLBACK_CENTER,
      zoom: 11.5,
      pitch: 0,
      bearing: 0,
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
    })

    mapRef.current = map
    const releaseToolbar = observeMapToolbar(wrapRef.current!, toolbarRef.current!, map)
    const loadingTimer = window.setTimeout(() => setLoadingSlow(true), 15_000)
    map.getCanvas().setAttribute("aria-label", "Distribuição geográfica de ocorrências. Use as setas para mover e mais ou menos para ajustar o zoom.")
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left")

    // Captured now: the cleanup must clear the collection this map filled, not
    // whatever the ref happens to hold at teardown.
    const markers = stationMarkers.current
    const fleetMarkers = vehicleMarkers.current

    map.on("load", () => {
      window.clearTimeout(loadingTimer)
      setLoadingSlow(false)
      set3DEnvironment(map, false)
      setBuildingLayersVisibility(map, false)

      map.addSource(POINT_SOURCE, { type: "geojson", data: dataRef.current })
      map.addSource(SPATIAL_SOURCE, { type: "geojson", data: dataRef.current, cluster: true, clusterRadius: 38, clusterMaxZoom: 14 })
      map.addLayer({ id: SPATIAL_CIRCLES, type: "circle", source: SPATIAL_SOURCE,
        filter: ["has", "point_count"], layout: { visibility: "none" },
        paint: { "circle-radius": ["step", ["get", "point_count"], 16, 100, 21, 1000, 27],
          "circle-color": "#284F65", "circle-stroke-color": "#F1F4F2", "circle-stroke-width": 2 } })
      map.addLayer({ id: SPATIAL_LABELS, type: "symbol", source: SPATIAL_SOURCE,
        filter: ["has", "point_count"], layout: { visibility: "none", "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 12 },
        paint: { "text-color": "#F4F7F5" } })
      map.addSource(CLUSTER_SOURCE, { type: "geojson", data: clusterRef.current })

      map.addLayer({
        id: HEAT_GLOW_LAYER,
        type: "heatmap",
        source: POINT_SOURCE,
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.38, 13, 0.7, 17, 1.2],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 38, 13, 62, 17, 92],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.24, 14, 0.3, 18, 0.16],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(14,116,144,0)",
            0.25, "rgba(56,189,248,0.18)",
            0.55, "rgba(14,116,144,0.3)",
            1, "rgba(124,29,22,0.38)",
          ],
        },
      })

      map.addLayer({
        id: HEAT_LAYER,
        type: "heatmap",
        source: POINT_SOURCE,
        paint: {
          // Every incident counts the same. Weighting by priority would answer
          // "where are the bad ones", which is a different question and one the
          // point view already answers by colour.
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.35, 13, 0.8, 17, 1.8],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 12, 13, 22, 17, 38],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.72, 15, 0.9, 18, 0.64],
          // A perceptual operational ramp: cool colours show background
          // activity, warm colours call out the true concentration cores.
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(8,31,50,0)",
            0.12, "rgba(102,151,157,0.22)",
            0.3, "#91B9B7",
            0.5, "#E5CE8C",
            0.68, "#D99C48",
            0.84, "#B85835",
            1, "#7C1D16",
          ],
        },
      })

      map.addLayer({
        id: HEAT_HOTSPOT_LAYER,
        type: "circle",
        source: CLUSTER_SOURCE,
        layout: { visibility: "none" },
        filter: [">=", ["get", "count"], 8],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["sqrt", ["get", "count"]],
            2.8, 5,
            8, 13,
          ],
          "circle-color": "#FFFFFF",
          "circle-opacity": 0.9,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#7C1D16",
          "circle-stroke-opacity": 0.88,
        },
      })

      map.addLayer({
        id: HEAT_HOTSPOT_LABEL,
        type: "symbol",
        source: CLUSTER_SOURCE,
        layout: {
          visibility: "none",
          "text-field": ["to-string", ["get", "count"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        filter: [">=", ["get", "count"], 8],
        paint: {
          "text-color": "#7C1D16",
          "text-halo-color": "#FFFFFF",
          "text-halo-width": 1.5,
        },
      })

      map.addLayer({
        id: POINT_HALO_LAYER,
        type: "circle",
        source: SPATIAL_SOURCE,
        filter: ["!", ["has", "point_count"]],
        layout: {
          visibility: "none",
          "circle-sort-key": [
            "match", ["get", "priority"],
            "CRITICA", 4,
            "ALTA", 3,
            "MEDIA", 2,
            "BAIXA", 1,
            0,
          ],
        },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 12, 6, 16, 14],
          "circle-color": [
            "match", ["get", "priority"],
            "BAIXA", PRIORITY_COLOR.BAIXA,
            "MEDIA", PRIORITY_COLOR.MEDIA,
            "ALTA", PRIORITY_COLOR.ALTA,
            "CRITICA", PRIORITY_COLOR.CRITICA,
            "#55636F",
          ],
          "circle-opacity": 0.18,
          "circle-blur": 0.45,
        },
      })

      map.addLayer({
        id: POINT_LAYER,
        type: "circle",
        source: SPATIAL_SOURCE,
        filter: ["!", ["has", "point_count"]],
        layout: {
          visibility: "none",
          "circle-sort-key": [
            "match", ["get", "priority"],
            "CRITICA", 4,
            "ALTA", 3,
            "MEDIA", 2,
            "BAIXA", 1,
            0,
          ],
        },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.2, 12, 3.6, 16, 8.5],
          "circle-color": [
            "match", ["get", "priority"],
            "BAIXA", PRIORITY_COLOR.BAIXA,
            "MEDIA", PRIORITY_COLOR.MEDIA,
            "ALTA", PRIORITY_COLOR.ALTA,
            "CRITICA", PRIORITY_COLOR.CRITICA,
            "#55636F",
          ],
          // The 2px surface ring keeps overlapping incidents legible.
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.7, 13, 1.3, 16, 2],
          "circle-stroke-color": "#FFFFFF",
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.68, 12, 0.82, 16, 0.94],
        },
      })

      map.addLayer({
        id: UNIT_AREA_LAYER,
        type: "circle",
        source: POINT_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 13, 13, 19, 16, 28],
          "circle-color": ["get", "unitColor"],
          "circle-opacity": 0.13,
          "circle-blur": 0.72,
        },
      })

      map.addLayer({
        id: UNIT_LAYER,
        type: "circle",
        source: POINT_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 13, 3, 16, 6],
          // The colour travels inside the feature rather than in a `match`
          // built from the current unit list, so a filter that drops one post
          // cannot shuffle the colours of the ones that remain.
          "circle-color": ["get", "unitColor"],
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 0.3, 16, 1.2],
          "circle-stroke-color": "#FFFFFF",
          "circle-opacity": 0.78,
        },
      })

      map.addLayer({
        id: CLUSTER_HALO_LAYER,
        type: "circle",
        source: CLUSTER_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["sqrt", ["get", "count"]],
            1, 14,
            5, 42,
          ],
          "circle-color": "#C9362B",
          "circle-opacity": 0.16,
          "circle-blur": 0.55,
        },
      })

      map.addLayer({
        id: CLUSTER_LAYER,
        type: "circle",
        source: CLUSTER_SOURCE,
        layout: { visibility: "none" },
        paint: {
          // The square root of the count drives the radius, so it is the
          // circle's *area* that tracks the number. Mapping the count straight
          // onto the radius would show four times the ink for twice the calls.
          "circle-radius": [
            "interpolate", ["linear"], ["sqrt", ["get", "count"]],
            1, 9,
            5, 32,
          ],
          "circle-color": [
            "interpolate", ["linear"], ["get", "count"],
            3, "#D97706",
            8, "#C9362B",
            20, "#7C1D16",
          ],
          "circle-opacity": 0.74,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#FFFFFF",
        },
      })

      map.addLayer({
        id: CLUSTER_LABEL,
        type: "symbol",
        source: CLUSTER_SOURCE,
        layout: {
          visibility: "none",
          "text-field": ["to-string", ["get", "count"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#FFFFFF",
          "text-halo-color": "#7C1D16",
          "text-halo-width": 1.2,
        },
      })

      if (coverageRef.current) fitBoundsOf(map, coverageRef.current)

      setReady(true)
      setOperationalMap(map)
    })

    const openPopup = (
      event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
      kind: "incident" | "cluster",
    ) => {
      const feature = event.features?.[0]
      if (!feature) return

      const properties = feature.properties as Record<string, string>

      popupRef.current?.remove()

      // Built as DOM rather than an HTML string: the protocol and the address
      // are user input and must never be parsed as markup.
      const node = document.createElement("div")
      node.style.cssText = "font:13px/1.45 system-ui,sans-serif;color:var(--map-ink);min-width:190px"

      if (kind === "cluster") {
        const count = document.createElement("p")
        count.style.cssText = "font-weight:700;margin:0 0 2px"
        count.textContent = `${properties.count} ocorrências neste endereço`

        const label = document.createElement("p")
        label.style.cssText = "margin:0;color:var(--map-muted)"
        label.textContent = properties.label

        node.append(count, label)
      } else {
        const protocol = document.createElement("p")
        protocol.style.cssText = "font-weight:700;margin:0 0 2px"
        protocol.textContent = properties.protocol

        const nature = document.createElement("p")
        nature.style.cssText = "margin:0"
        nature.textContent = NATURE_LABEL[properties.nature as keyof typeof NATURE_LABEL]
          ?? properties.nature

        const address = document.createElement("p")
        address.style.cssText = "margin:0;color:var(--map-muted)"
        address.textContent = properties.address

        const meta = document.createElement("p")
        meta.style.cssText = "margin:4px 0 0;font-weight:600"
        meta.style.color = PRIORITY_COLOR[properties.priority as OccurrencePriority] ?? "var(--map-muted)"
        meta.textContent =
          `Prioridade ${PRIORITY_LABEL[properties.priority as OccurrencePriority] ?? "—"}`

        const unit = document.createElement("p")
        unit.style.cssText = "margin:0;color:var(--map-muted)"
        unit.textContent = `Posto responsável: ${properties.unitLabel}`

        node.append(protocol, nature, address, meta, unit)

        if (openRef.current) {
          const button = document.createElement("button")
          button.type = "button"
          button.style.cssText =
            "margin-top:8px;font-weight:700;color:var(--color-accent);text-decoration:underline;"
            + "cursor:pointer;background:none;border:none;padding:0"
          button.textContent = "Abrir a ocorrência"
          button.addEventListener("click", () => openRef.current?.(properties.id))
          node.append(button)
        }
      }

      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
        .setLngLat(event.lngLat)
        .setDOMContent(node)
        .addTo(map)
    }

    map.on("click", SPATIAL_CIRCLES, async (event) => {
      const feature = event.features?.[0]
      if (!feature || feature.geometry.type !== "Point") return
      const source = map.getSource(SPATIAL_SOURCE) as maplibregl.GeoJSONSource
      const id = Number(feature.properties.cluster_id)
      try {
        const [zoom, leaves] = await Promise.all([source.getClusterExpansionZoom(id), source.getClusterLeaves(id, 50, 0)])
        if (mapRef.current !== map) return
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        map.easeTo({ center: feature.geometry.coordinates as Coordinate, zoom, duration: reduced ? 0 : 300 })
        if (reduced || document.hidden) return
        map.once('moveend', () => {
          if (mapRef.current !== map || feature.geometry.type !== 'Point') return
          const origin = map.project(feature.geometry.coordinates as Coordinate)
          const children = leaves.flatMap((leaf) => {
            if (leaf.geometry.type !== 'Point') return []
            const target = map.project(leaf.geometry.coordinates as Coordinate)
            const element = document.createElement('div')
            const dot = document.createElement('div'); dot.className = 'op-cluster-child'
            dot.style.setProperty('--op-from-x', `${origin.x - target.x}px`)
            dot.style.setProperty('--op-from-y', `${origin.y - target.y}px`)
            dot.style.setProperty('--op-priority', PRIORITY_COLOR[leaf.properties?.priority as OccurrencePriority] ?? '#24668c')
            element.append(dot)
            return [new maplibregl.Marker({ element }).setLngLat(leaf.geometry.coordinates as Coordinate).addTo(map)]
          })
          const clear = () => children.forEach((marker) => marker.remove())
          const timer = window.setTimeout(clear, 320)
          map.once('remove', () => { clearTimeout(timer); clear() })
        })
      } catch { /* A source replacement can invalidate a cluster between click and expansion. */ }
    })
    map.on("click", POINT_LAYER, (event) => openPopup(event, "incident"))
    map.on("click", UNIT_LAYER, (event) => openPopup(event, "incident"))
    map.on("click", CLUSTER_LAYER, (event) => openPopup(event, "cluster"))
    map.on("click", HEAT_HOTSPOT_LAYER, (event) => openPopup(event, "cluster"))

    for (const layer of [SPATIAL_CIRCLES, POINT_LAYER, UNIT_LAYER, CLUSTER_LAYER, HEAT_HOTSPOT_LAYER]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer" })
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = "" })
    }

    return () => {
      window.clearTimeout(loadingTimer)
      releaseToolbar()
      popupRef.current?.remove()
      popupRef.current = null
      markers.clear()
      fleetMarkers.forEach((marker) => marker.remove())
      fleetMarkers.clear()
      setReady(false)
      setOperationalMap(null)
      map.remove()
      mapRef.current = null
      hasFramedIncidents.current = false
    }
  }, [])

  // -- data ------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const source = map.getSource(POINT_SOURCE) as maplibregl.GeoJSONSource | undefined
    source?.setData(data)
    ;(map.getSource(SPATIAL_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(data)
    // Keep long historical periods from turning into a single saturated stain.
    const weight = Math.min(1, Math.sqrt(800 / Math.max(1, data.features.length)))
    map.setPaintProperty(HEAT_LAYER, "heatmap-weight", weight)
    map.setPaintProperty(HEAT_GLOW_LAYER, "heatmap-weight", weight)
    if (!hasFramedIncidents.current && data.features.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      data.features.forEach((feature) => {
        if (feature.geometry.type === "Point") bounds.extend(feature.geometry.coordinates as Coordinate)
      })
      map.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 0 })
      hasFramedIncidents.current = true
    }
  }, [data, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const source = map.getSource(CLUSTER_SOURCE) as maplibregl.GeoJSONSource | undefined
    source?.setData(clusterData)
  }, [clusterData, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    if (coverage && !hasFramedIncidents.current) fitBoundsOf(map, coverage)
  }, [coverage, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const id of [UNIT_LAYER, UNIT_AREA_LAYER]) {
      map.setFilter(id, activeUnit ? ["==", ["get", "unitLabel"], activeUnit] : null)
    }
  }, [activeUnit, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const shown: Record<IncidentMapMode, string[]> = {
      heat: [HEAT_GLOW_LAYER, HEAT_LAYER, HEAT_HOTSPOT_LAYER, HEAT_HOTSPOT_LABEL],
      points: [SPATIAL_CIRCLES, SPATIAL_LABELS, POINT_HALO_LAYER, POINT_LAYER],
      coverage: [UNIT_LAYER],
      recurrence: [CLUSTER_HALO_LAYER, CLUSTER_LAYER, CLUSTER_LABEL],
    }

    for (const layer of [
      HEAT_GLOW_LAYER, HEAT_LAYER, HEAT_HOTSPOT_LAYER, HEAT_HOTSPOT_LABEL,
      SPATIAL_CIRCLES, SPATIAL_LABELS, POINT_HALO_LAYER, POINT_LAYER,
      UNIT_AREA_LAYER, UNIT_LAYER,
      CLUSTER_HALO_LAYER, CLUSTER_LAYER, CLUSTER_LABEL,
    ]) {
      map.setLayoutProperty(layer, "visibility", shown[mode].includes(layer) ? "visible" : "none")
    }

    // A popup describing a dot that is no longer drawn is a ghost.
    popupRef.current?.remove()
  }, [mode, ready])

  const stationSignature = (stations ?? [])
    .map((station) => `${station.id}:${station.latitude}:${station.longitude}`)
    .join("|")

  const stationsRef = useRef(stations)
  useEffect(() => { stationsRef.current = stations }, [stations])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const markers = stationMarkers.current

    for (const station of stationsRef.current ?? []) {
      markers.set(
        station.id,
        createStationMarker(map, [station.longitude, station.latitude], station),
      )
    }

    return () => {
      markers.forEach((marker) => marker.remove())
      markers.clear()
    }
  }, [stationSignature, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    syncVehicleMarkers(map, vehicleMarkers.current, vehicles ?? [], historicalAt)
  }, [vehicles, ready, historicalAt])

  // -- size ------------------------------------------------------------------

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const observer = new ResizeObserver(() => mapRef.current?.resize())
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement !== wrapRef.current) {
        setView((current) => (current === "full" ? "inline" : current))
      }
    }

    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const toggleFullscreen = () => {
    const wrap = wrapRef.current
    if (!wrap) return

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }

    wrap.requestFullscreen().then(() => setView("full")).catch(() => undefined)
  }

  const empty = mode === "recurrence"
    ? (clusters?.length ?? 0) === 0
    : incidents.length === 0
  const modeMeta = MODES.find((option) => option.value === mode)
  const shownCount = mode === "recurrence" ? (clusters?.length ?? 0)
    : mode === "coverage" && activeUnit ? incidents.filter((point) => point.unitLabel === activeUnit).length : incidents.length

  return (
    <div ref={wrapRef} className={cn("map-wrap incident-map border", className)}>
      <div ref={containerRef} className="map" />
      {operational && operationalMap && <OperationMapControls map={operationalMap} incidents={incidents} vehicles={vehicles} dispatches={dispatches} stations={stations} mode={mode} onModeChange={onModeChange} onHeatTime={setHeatTime} wallboard={wallboard} historical={historicalAt !== undefined} replayTrails={replayTrails} />}
      {!!unlocatedVehicles?.length && <details className="map-no-signal"><summary>Sem posição · {unlocatedVehicles.length}</summary><p>{unlocatedVehicles.join(' · ')}</p></details>}

      <div ref={toolbarRef} className="top-controls">
        <div className="map-toolbar-title"><span>ANÁLISE TERRITORIAL</span><strong>{modeMeta?.title}</strong></div>
        <div className="map-toolbar-actions">
        <div className="toggle-wrap incident-modes" role="group" aria-label="Visualização das ocorrências">
          {MODES.map((option) => (
            <button
              type="button"
              key={option.value}
              aria-label={option.title}
              aria-pressed={mode === option.value}
              className={mode === option.value ? "active" : ""}
              onClick={() => onModeChange(option.value)}
              title={option.title}
            >
              <option.Icon size={14} />
              <span className="incident-mode-label">{option.label}</span>
            </button>
          ))}
        </div>

        {mode === "coverage" && (
          <label className="map-unit-filter">
            <span>Quartel</span>
            <select value={activeUnit} onChange={(event) => setSelectedUnit(event.target.value)}>
              <option value="">Todos os quartéis</option>
              {respondingUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </label>
        )}

        <div className="toggle-wrap">
          <button type="button" disabled={!ready || empty} title="Enquadrar ocorrências do recorte" aria-label="Enquadrar ocorrências do recorte" onClick={() => {
            const map = mapRef.current
            if (!map) return
            const points = mode === "recurrence" ? clusters ?? [] : mode === "coverage" && activeUnit ? incidents.filter((point) => point.unitLabel === activeUnit) : incidents
            if (points.length === 0) return
            const bounds = new maplibregl.LngLatBounds()
            points.forEach((point) => bounds.extend([point.longitude, point.latitude]))
            map.fitBounds(bounds, { padding: 65, maxZoom: 15, duration: 500 })
          }}><LocateFixed size={15} /></button>
        </div>
        {/* No theater button here: this map already spans the page, so there is
            nowhere left in the page for it to expand into. */}
        <div className="toggle-wrap">
          <button
            type="button"
            aria-label={view === "full" ? "Sair da tela cheia" : "Abrir em tela cheia"}
            aria-pressed={view === "full"}
            className={cn("view", view === "full" && "active")}
            onClick={toggleFullscreen}
            title={view === "full" ? "Sair da tela cheia" : "Abrir em tela cheia"}
          >
            {view === "full" ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </div>
        </div>
      </div>

      {!ready && <div className="map-loading" role="status"><Layers size={25} /><strong>{loadingSlow ? "A cartografia está demorando a responder" : "Carregando território"}</strong><span>{loadingSlow ? "Verifique a conexão com o serviço de mapas." : "Preparando a distribuição das ocorrências…"}</span></div>}
      {ready && !empty && (
        <div className="incident-summary" role="status">
          <strong>{shownCount.toLocaleString("pt-BR")}</strong>
          <div><span>{mode === "recurrence" ? "locais recorrentes" : "ocorrências no recorte"}</span><small>{mode === "coverage" && activeUnit ? activeUnit : modeMeta?.title}</small></div>
        </div>
      )}

      {ready && empty && (
        <p className="map-hint">
          {mode === "recurrence"
            ? "Nenhum endereço repetido no período filtrado"
            : "Nenhuma ocorrência no período filtrado"}
        </p>
      )}
    </div>
  )
}

/** The legend belongs to the page, not inside the map, so it can wrap freely. */
export function IncidentLegend({ mode, units }: {
  mode: IncidentMapMode
  units?: { label: string, color: string }[]
}) {
  if (mode === "heat") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-muted">
        <span>Densidade relativa · menos</span>
        <span
          className="h-3 w-24 border border-line"
          style={{ background: "linear-gradient(90deg,#91B9B7,#E5CE8C,#D99C48,#B85835,#7C1D16)" }}
        />
        <span>Mais ocorrências</span>
        <span className="hidden h-4 w-px bg-line sm:block" />
        <span className="flex items-center gap-1.5">
          <span className="grid h-5 min-w-5 place-items-center rounded-full border-2 border-[#7C1D16] bg-white px-1 text-[9px] font-bold text-[#7C1D16]">
            8+
          </span>
          núcleo recorrente
        </span>
      </div>
    )
  }

  if (mode === "recurrence") {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
        <span>Recorrência</span>
        <span className="h-3 w-3 rounded-full border border-white bg-[#D97706] ring-1 ring-neutral-300" />
        <span>3+</span>
        <span className="h-4 w-4 rounded-full border border-white bg-[#C9362B] ring-1 ring-neutral-300" />
        <span>8+</span>
        <span className="h-5 w-5 rounded-full border border-white bg-[#7C1D16] ring-1 ring-neutral-300" />
        <span>20+ chamados</span>
      </div>
    )
  }

  if (mode === "coverage") {
    return (
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
        {(units ?? []).map((unit) => (
          <li key={unit.label} className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-full border-2 border-white ring-1 ring-neutral-300"
              style={{ background: unit.color }}
            />
            {unit.label}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
      {(Object.keys(PRIORITY_COLOR) as OccurrencePriority[]).map((priority) => (
        <li key={priority} className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-full border-2 border-white ring-1 ring-neutral-300"
            style={{ background: PRIORITY_COLOR[priority] }}
          />
          {PRIORITY_LABEL[priority]}
        </li>
      ))}
    </ul>
  )
}
