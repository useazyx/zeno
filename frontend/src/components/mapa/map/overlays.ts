/**
 * Layers that annotate a route rather than draw it.
 *
 * The explanation layer paints each edge of the IA route by the speed the
 * network predicts for it; the closures layer shows the circles the dispatcher
 * marked as blocked. Both are created lazily on first use and only ever have
 * their data replaced, so toggling them never rebuilds the map.
 */

import maplibregl from "maplibre-gl"

import type { Closure, RouteSegment } from "@/api/types"
import { SPEED_BAND_COLOR, speedBand } from "@/lib/route-language"
import { CRITICAL_COLOR } from "../constants/constants"

const SPEED_SOURCE = "speed-overlay"
const SPEED_CASING = "speed-overlay-casing"
const SPEED_LINE = "speed-overlay-line"
const CLOSURE_SOURCE = "closures"
const CLOSURE_FILL = "closures-fill"
const CLOSURE_LINE = "closures-line"
const CLOSURE_CENTER = "closures-center"

/** The vehicle layers must stay above any annotation. */
function firstVehicleLayer(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.id.startsWith("layer-route-firetruck"))?.id
}

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] })

/**
 * Paint the route by predicted speed. `geometry` is the route as the API sends
 * it ([latitude, longitude]); `segments` index into it.
 */
export function setSpeedOverlay(
  map: maplibregl.Map,
  geometry: [number, number][] | null | undefined,
  segments: RouteSegment[] | null | undefined,
) {
  const data = empty()

  if (geometry && segments) {
    for (const segment of segments) {
      const slice = geometry.slice(segment.start, segment.end + 1)
      if (slice.length < 2) continue
      data.features.push({
        type: "Feature",
        properties: { color: SPEED_BAND_COLOR[speedBand(segment)], exceptional: segment.counterflow || segment.shoulder,
          label: segment.counterflow ? 'Modo crítico · contramão autorizada' : segment.shoulder ? 'Modo crítico · acostamento' : `${Math.round(segment.speed_kmh)} km/h previstos · limite ${segment.limit_kmh} km/h` },
        geometry: { type: "LineString", coordinates: slice.map(([latitude, longitude]) => [longitude, latitude]) },
      })
    }
  }

  const source = map.getSource(SPEED_SOURCE) as maplibregl.GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }

  map.addSource(SPEED_SOURCE, { type: "geojson", data })
  const before = firstVehicleLayer(map)
  map.addLayer({
    id: SPEED_CASING,
    type: "line",
    source: SPEED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#0F1720", "line-width": 9, "line-opacity": 0.55 },
  }, before)
  map.addLayer({
    id: SPEED_LINE,
    type: "line",
    source: SPEED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 6 },
  }, before)
  map.addLayer({ id: 'speed-critical-chevron', type: 'symbol', source: SPEED_SOURCE,
    filter: ['==', ['get', 'exceptional'], true],
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 44, 'text-field': '›', 'text-font': ['Noto Sans Regular'], 'text-size': 20, 'text-rotation-alignment': 'map', 'text-allow-overlap': true },
    paint: { 'text-color': '#EDF0E8', 'text-halo-color': '#4D302A', 'text-halo-width': 1 } }, before)
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
  map.on('mouseenter', SPEED_LINE, (event) => {
    const label = event.features?.[0]?.properties?.label
    if (label) popup.setLngLat(event.lngLat).setText(String(label)).addTo(map)
  })
  map.on('mouseleave', SPEED_LINE, () => popup.remove())
  map.once('remove', () => popup.remove())
}

/** A circle as a 48-sided polygon, in metres around its centre. */
export function circlePolygon(closure: Closure, sides = 48): [number, number][] {
  const metersPerDegreeLat = 111_320
  const metersPerDegreeLon = 111_320 * Math.cos((closure.latitude * Math.PI) / 180)
  const ring: [number, number][] = []
  for (let index = 0; index <= sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2
    ring.push([
      closure.longitude + (Math.cos(angle) * closure.radius_m) / metersPerDegreeLon,
      closure.latitude + (Math.sin(angle) * closure.radius_m) / metersPerDegreeLat,
    ])
  }
  return ring
}

export function setClosures(map: maplibregl.Map, closures: Closure[] | null | undefined) {
  const data = empty()

  for (const closure of closures ?? []) {
    data.features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [circlePolygon(closure)] },
    })
    data.features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [closure.longitude, closure.latitude] },
    })
  }

  const source = map.getSource(CLOSURE_SOURCE) as maplibregl.GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }

  map.addSource(CLOSURE_SOURCE, { type: "geojson", data })
  addHatchPattern(map, 'closure-hatch', [180, 94, 82])
  const before = firstVehicleLayer(map)
  map.addLayer({
    id: CLOSURE_FILL,
    type: "fill",
    source: CLOSURE_SOURCE,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-pattern": 'closure-hatch', "fill-opacity": 0.45 },
  }, before)
  map.addLayer({
    id: CLOSURE_LINE,
    type: "line",
    source: CLOSURE_SOURCE,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "line-color": CRITICAL_COLOR, "line-width": 2, "line-dasharray": [2, 1.5] },
  }, before)
  map.addLayer({
    id: CLOSURE_CENTER,
    type: "circle",
    source: CLOSURE_SOURCE,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5,
      "circle-color": CRITICAL_COLOR,
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 2,
    },
  }, before)
  map.addLayer({ id: 'closures-sign', type: 'symbol', source: CLOSURE_SOURCE,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'text-field': '×', 'text-font': ['Noto Sans Regular'], 'text-size': 23, 'text-allow-overlap': true },
    paint: { 'text-color': '#F3E8E0', 'text-halo-color': '#743B32', 'text-halo-width': 2 } }, before)
}

export function addHatchPattern(map: maplibregl.Map, id: string, color: [number, number, number]) {
  if (map.hasImage(id)) return
  const size = 12
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4
    data.set([...color, (x + y) % size < 2 ? 190 : 0], offset)
  }
  map.addImage(id, { width: size, height: size, data })
}
