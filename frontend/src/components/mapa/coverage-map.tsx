/**
 * Response-time coverage on the map.
 *
 * Nested isochrones (darkest is the fastest band), the stations they leave
 * from, and recent occurrences coloured by whether the network says they were
 * reachable inside the target time. A click places a hypothetical station when
 * the page asks for one.
 */

import { useEffect, useRef, useState } from "react"
import { Pause, Play, RotateCcw } from "lucide-react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

import type { CoverageArea, CoveragePoint, CoverageStation, WaterSource } from "@/api/types"
import { mapStyle } from "./constants/constants"
import { createMarker, createStationMarker } from "./map/markers"
import { set3DEnvironment, setBuildingLayersVisibility } from "./map/layers"
import { cn } from "@/lib/utils"
import { POINT_COLOR, pointClass } from "./coverage-palette"
import { coverageGaps } from "./coverage-ai-policy"
import { useVisualMotion } from "@/hooks/use-visual-motion"

import "./mapa.css"
import "./coverage-ai.css"

const CENTER: [number, number] = [-45.5551, -23.0264]

/** Fastest band darkest; the palette is the console's accent, never a rainbow. */
const BAND_FILL = ["#276F9D", "#4086AF", "#629EBF", "#80AFCA", "#A0C0D3", "#B7CFDC"]


const WATER_COLOR: Record<WaterSource["status"], string> = {
  OPERANTE: "#7DC4A1",
  NAO_VERIFICADO: "#E6BD70",
  INOPERANTE: "#EF8C87",
}

export default function CoverageMap({ areas, stations, points, targetMinutes, waterSources, onPick, onMoveStation, className }: {
  areas: CoverageArea[]
  stations: CoverageStation[]
  points: CoveragePoint[]
  targetMinutes: number
  waterSources?: WaterSource[]
  onPick?: (latitude: number, longitude: number) => void
  onMoveStation?: (acronym: string, latitude: number, longitude: number) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])
  const pickRef = useRef(onPick)
  const moveRef = useRef(onMoveStation)
  const [ready, setReady] = useState(false)
  const fitted = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [minute, setMinute] = useState(targetMinutes)
  const elapsed = useRef(0)
  const motion = useVisualMotion()
  const [gapCount, setGapCount] = useState<number | null>(null)
  const dragTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const presentation = (event: Event) => {
      const detail = (event as CustomEvent<{ step: string; paused: boolean }>).detail
      if (detail?.step !== "coverage") return
      setPlaying(!detail.paused)
      if (!detail.paused) { elapsed.current = 0; setMinute(0) }
    }
    window.addEventListener("zeno:presentation", presentation)
    return () => window.removeEventListener("zeno:presentation", presentation)
  }, [])

  useEffect(() => { pickRef.current = onPick }, [onPick])
  useEffect(() => { moveRef.current = onMoveStation }, [onMoveStation])

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(),
      center: CENTER,
      zoom: 11.5,
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
    })
    mapRef.current = map
    // Capture the timer map owned by this effect so teardown never touches a newer render.
    const timers = dragTimers.current
    map.getCanvas().setAttribute("aria-label", "Mapa de cobertura por tempo de resposta")
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left")

    map.on("load", () => {
      set3DEnvironment(map, false)
      setBuildingLayersVisibility(map, false)
      map.addSource("coverage-areas", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      map.addSource("coverage-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      map.addSource("water-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      map.addSource("coverage-gaps", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      const pattern = new Uint8Array(8 * 8 * 4)
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const offset = (y * 8 + x) * 4
        pattern.set([163, 112, 35, (x + y) % 8 < 2 ? 180 : 0], offset)
      }
      map.addImage("coverage-hatch", { width: 8, height: 8, data: pattern })
      map.addLayer({
        id: "coverage-fill",
        type: "fill",
        source: "coverage-areas",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.32 },
      })
      map.addLayer({
        id: "coverage-outline",
        type: "line",
        source: "coverage-areas",
        paint: { "line-color": "#86B8D3", "line-width": ["get", "width"], "line-opacity": 0.75 },
      })
      map.addLayer({
        id: "coverage-gaps", type: "fill", source: "coverage-gaps",
        paint: { "fill-pattern": "coverage-hatch", "fill-opacity": 0.7 },
      })
      map.addLayer({
        id: "coverage-points",
        type: "circle",
        source: "coverage-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 14, 4],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.85,
        },
      })
      map.addLayer({
        id: "water-points",
        type: "circle",
        source: "water-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 15, 6],
          "circle-color": "#FFFFFF",
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 2,
        },
      })
      setReady(true)
    })
    map.on("mousemove", "coverage-gaps", (event) => setGapCount(Number(event.features?.[0]?.properties?.count ?? 0)))
    map.on("mouseleave", "coverage-gaps", () => setGapCount(null))

    map.on("click", (event) => {
      if (!pickRef.current) return
      pickRef.current(event.lngLat.lat, event.lngLat.lng)
    })

    const pickCenter = (event: KeyboardEvent) => {
      if (!pickRef.current || (event.key !== "Enter" && event.key !== " ")) return
      event.preventDefault()
      const center = map.getCenter()
      pickRef.current(center.lat, center.lng)
    }
    map.getCanvas().addEventListener("keydown", pickCenter)

    return () => {
      map.getCanvas().removeEventListener("keydown", pickCenter)
      markers.current.forEach((marker) => marker.remove())
      markers.current = []
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const canvas = map.getCanvas()
    canvas.style.cursor = onPick ? "crosshair" : ""
    canvas.setAttribute("aria-label", onPick
      ? "Posicionar posto: mova o mapa com as setas e pressione Enter para usar o ponto central."
      : "Mapa de cobertura por tempo de resposta. Use as setas para mover e mais ou menos para ajustar o zoom.")
    if (onPick) canvas.focus({ preventScroll: true })
  }, [onPick])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    // Largest first, so the faster bands paint on top of the slower ones.
    const sorted = [...areas].sort((a, b) => b.minutes - a.minutes)
    const features: GeoJSON.Feature[] = sorted.flatMap((area) => {
      if (!area.geometry) return []
      const rank = [...areas].sort((a, b) => a.minutes - b.minutes).findIndex((item) => item.minutes === area.minutes)
      return [{
        type: "Feature" as const,
        properties: { minutes: area.minutes, color: BAND_FILL[rank] ?? BAND_FILL[BAND_FILL.length - 1], width: area.minutes === targetMinutes ? 2.4 : 0.8 },
        geometry: area.geometry,
      }]
    })
    ;(map.getSource("coverage-areas") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features })

    if (!fitted.current && features.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      for (const feature of features) {
        for (const polygon of (feature.geometry as GeoJSON.MultiPolygon).coordinates) {
          for (const [longitude, latitude] of polygon[0]) bounds.extend([longitude, latitude])
        }
      }
      map.fitBounds(bounds, { padding: 30, duration: 0 })
      fitted.current = true
    }
  }, [areas, targetMinutes, ready])

  // A single clock reveals only server-supplied nested bands, at most 12.5 Hz.
  useEffect(() => {
    if (!ready || !areas.length) return
    elapsed.current = 0
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMinute(motion.reduced ? targetMinutes : 0)
    setPlaying(!motion.reduced)
  }, [areas, targetMinutes, ready, motion.reduced])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const limit = motion.reduced ? targetMinutes : minute
    const filter: maplibregl.FilterSpecification = ["<=", ["get", "minutes"], limit]
    map.setFilter("coverage-fill", filter)
    map.setFilter("coverage-outline", filter)
  }, [minute, targetMinutes, ready, motion.reduced])

  useEffect(() => {
    if (!playing || !motion.animate) return
    let frame = 0, previous = 0, painted = 0
    const duration = 4500
    const tick = (now: number) => {
      if (previous) elapsed.current += Math.min(now - previous, 100)
      previous = now
      if (now - painted >= 80 || elapsed.current >= duration) {
        setMinute(Math.min(targetMinutes, Math.floor(elapsed.current / duration * targetMinutes)))
        painted = now
      }
      if (elapsed.current >= duration) { setPlaying(false); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, motion.animate, targetMinutes])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const maxMinutes = Math.max(...areas.map((area) => area.minutes), targetMinutes)
    ;(map.getSource("coverage-points") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: points.map((point) => ({
        type: "Feature",
        properties: { color: POINT_COLOR[pointClass(point, targetMinutes, maxMinutes)] },
        geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
      })),
    })
    ;(map.getSource("coverage-gaps") as maplibregl.GeoJSONSource).setData(coverageGaps(points, targetMinutes))
  }, [points, targetMinutes, areas, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource("water-points") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (waterSources ?? []).map((source) => ({
        type: "Feature",
        properties: { color: WATER_COLOR[source.status] },
        geometry: { type: "Point", coordinates: [Number(source.longitude), Number(source.latitude)] },
      })),
    })
  }, [waterSources, ready])

  const stationSignature = stations.map((station) => `${station.id}:${station.latitude}:${station.longitude}`).join("|")

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    markers.current.forEach((marker) => marker.remove())
    markers.current = stations.filter((station) => station.in_network || station.hypothetical).map((station) => {
      if (!station.hypothetical) return createStationMarker(map, [station.longitude, station.latitude], station)
      const marker = createMarker(map, [station.longitude, station.latitude], "#8E600A", "+", station.name).setDraggable(true)
      const element = marker.getElement()
      element.tabIndex = 0
      element.setAttribute("role", "button")
      element.setAttribute("aria-label", `${station.acronym}: arraste para mover. Pelo teclado use as setas e Enter para recalcular.`)
      element.style.cursor = "grab"
      const commit = () => {
        const pending = dragTimers.current.get(station.acronym)
        if (pending) clearTimeout(pending)
        const point = marker.getLngLat()
        dragTimers.current.set(station.acronym, setTimeout(() => {
          dragTimers.current.delete(station.acronym)
          moveRef.current?.(station.acronym, point.lat, point.lng)
        }, 300))
      }
      marker.on("dragend", commit)
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); commit(); return }
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        const point = map.project(marker.getLngLat()), step = event.shiftKey ? 30 : 8
        point.x += event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0
        point.y += event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0
        marker.setLngLat(map.unproject(point))
      })
      return marker
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationSignature, ready])

  return (
    <div className={cn("map-wrap coverage-map relative overflow-hidden", className)}>
      <div ref={containerRef} className="absolute inset-0" />
      <div className="coverage-playback" aria-label="Reprodução das faixas de cobertura">
        <button type="button" disabled={!areas.length || motion.reduced} aria-label={playing ? "Pausar cobertura" : "Reproduzir cobertura"} onClick={() => {
          if (!playing && minute >= targetMinutes) { elapsed.current = 0; setMinute(0) }
          setPlaying(value => !value)
        }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button type="button" aria-label="Mostrar cobertura final" onClick={() => { setPlaying(false); setMinute(targetMinutes); elapsed.current = 4500 }}><RotateCcw size={16} /></button>
        <span>{motion.reduced ? targetMinutes : minute} / {targetMinutes} min</span>
        {motion.reduced && <small>Movimento reduzido</small>}
      </div>
      {gapCount !== null && <p className="coverage-gap-tooltip" role="status">{gapCount} ocorrência(s) além de {targetMinutes} min neste setor</p>}
      {onPick && <>
        <span className="coverage-pick-target" aria-hidden />
        <p role="status" className="coverage-pick-hint">Clique no local ou mova o mapa com as setas e pressione Enter para posicionar no centro.</p>
      </>}
    </div>
  )
}
