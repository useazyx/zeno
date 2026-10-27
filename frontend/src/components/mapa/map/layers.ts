/**
 * The route layers.
 *
 * Two stacks are drawn from the same data: a flat one for the 2D view and one
 * lifted to `ROUTE_ALT` metres for the 3D view, toggled by visibility so a
 * mode change costs nothing.
 *
 * A second, dimmer line carries the comparison route. Showing the neural route
 * and the shortest-in-metres route side by side is the whole point of the
 * project, and on a map the difference has to be visible, not tabulated.
 */

import maplibregl from "maplibre-gl"
import { configureEnvironment } from "./environment"
import { drawRoute } from "./route-effects"
import { setRouteRibbons } from "./route-ribbon"
import type { Feature, LineString } from "geojson"

import { COMPARISON_COLOR, CRITICAL_COLOR, ROUTE_ALT, ROUTE_COLOR } from "@/components/mapa/constants/constants"
import type { LngLat } from "@/components/mapa/routes/utils"
import type { GraphBounds } from "@/api/types"

const COMPARISON_DARK = "#7C3F08"
const CRITICAL_DARK = "#721C17"

const FLAT_SOURCE = "src-flat"
const LIFTED_SOURCE = "src-lifted"
const COMPARISON_SOURCE = "src-comparison"
const COMPARISON_LIFTED_SOURCE = "src-comparison-lifted"
const CRITICAL_SOURCE = "src-critical"
const CRITICAL_LIFTED_SOURCE = "src-critical-lifted"
const COVERAGE_SOURCE = "src-coverage"

const COMPARISON_LAYERS_2D = ["comparison-casing-2d", "comparison-glow-2d", "comparison-2d"]
const COMPARISON_LAYERS_3D = ["comparison-casing-3d", "comparison-glow-3d", "comparison-3d"]
const CRITICAL_LAYERS_2D = ["critical-casing-2d", "critical-glow-2d", "critical-2d"]
const CRITICAL_LAYERS_3D = ["critical-casing-3d", "critical-glow-3d", "critical-3d"]
const LAYERS_2D = [
  ...COMPARISON_LAYERS_2D,
  ...CRITICAL_LAYERS_2D,
  "glow-2d", "line-2d", "dash-2d",
]
const LAYERS_3D = [
  ...COMPARISON_LAYERS_3D,
  ...CRITICAL_LAYERS_3D,
  "shadow-3d", "casing-3d", "glow-3d", "line-3d", "dash-3d",
]

function lineFeature(coords: number[][]): Feature<LineString> {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: {},
  }
}

const lift = (coords: LngLat[]) =>
  coords.map(([lng, lat]) => [lng, lat, ROUTE_ALT])

export function addRouteLayers(
  map: maplibregl.Map,
  coords: LngLat[],
  comparison: LngLat[],
  critical: LngLat[] = [],
) {
  map.addSource(FLAT_SOURCE, { type: "geojson", lineMetrics: true, data: lineFeature(coords) })
  map.addSource(LIFTED_SOURCE, { type: "geojson", lineMetrics: true, data: lineFeature(lift(coords)) })
  map.addSource(COMPARISON_SOURCE, { type: "geojson", lineMetrics: true, data: lineFeature(comparison) })
  map.addSource(COMPARISON_LIFTED_SOURCE, {
    type: "geojson",
    lineMetrics: true,
    data: lineFeature(lift(comparison)),
  })
  map.addSource(CRITICAL_SOURCE, { type: "geojson", lineMetrics: true, data: lineFeature(critical) })
  map.addSource(CRITICAL_LIFTED_SOURCE, {
    type: "geojson",
    lineMetrics: true,
    data: lineFeature(lift(critical)),
  })

  // The baseline is a full-colour route of its own. It is deliberately
  // solid: colour, not a dash pattern, is what distinguishes the two options.
  map.addLayer({
    id: "comparison-casing-2d",
    type: "line",
    source: COMPARISON_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COMPARISON_DARK,
      "line-width": 10,
      "line-opacity": 0.9,
      "line-offset": -4,
    },
  })

  map.addLayer({
    id: "comparison-glow-2d",
    type: "line",
    source: COMPARISON_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COMPARISON_COLOR,
      "line-width": 18,
      "line-opacity": 0.2,
      "line-blur": 4,
      "line-offset": -4,
    },
  })

  map.addLayer({
    id: "comparison-2d",
    type: "line",
    source: COMPARISON_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COMPARISON_COLOR,
      "line-width": 6,
      "line-opacity": 1,
      "line-offset": -4,
    },
  })

  map.addLayer({
    id: "critical-casing-2d",
    type: "line",
    source: CRITICAL_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": CRITICAL_DARK,
      "line-width": 10,
      "line-opacity": 0.92,
      "line-offset": 4,
    },
  })

  map.addLayer({
    id: "critical-glow-2d",
    type: "line",
    source: CRITICAL_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": CRITICAL_COLOR,
      "line-width": 18,
      "line-opacity": 0.2,
      "line-blur": 4,
      "line-offset": 4,
    },
  })

  map.addLayer({
    id: "critical-2d",
    type: "line",
    source: CRITICAL_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": CRITICAL_COLOR,
      "line-width": 6,
      "line-opacity": 1,
      "line-offset": 4,
    },
  })

  map.addLayer({
    id: "glow-2d",
    type: "line",
    source: FLAT_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ROUTE_COLOR, "line-width": 18, "line-opacity": 0.18, "line-blur": 4 },
  })

  map.addLayer({
    id: "line-2d",
    type: "line",
    source: FLAT_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ROUTE_COLOR, "line-width": 6, "line-opacity": 1 },
  })

  map.addLayer({
    id: "dash-2d",
    type: "line",
    source: FLAT_SOURCE,
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": "#fff", "line-width": 1.5, "line-dasharray": [4, 6], "line-opacity": 0.35 },
  })

  map.addLayer({
    id: "comparison-casing-3d",
    type: "line",
    source: COMPARISON_LIFTED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: {
      "line-color": COMPARISON_DARK,
      "line-width": 13,
      "line-opacity": 0.94,
      "line-offset": -4,
    },
  })

  map.addLayer({
    id: "comparison-glow-3d",
    type: "line",
    source: COMPARISON_LIFTED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: {
      "line-color": COMPARISON_COLOR,
      "line-width": 31,
      "line-opacity": 0.25,
      "line-blur": 9,
      "line-offset": -4,
    },
  })

  map.addLayer({
    id: "comparison-3d",
    type: "line",
    source: COMPARISON_LIFTED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: {
      "line-color": COMPARISON_COLOR,
      "line-width": 7.5,
      "line-opacity": 1,
      "line-offset": -4,
    },
  })

  map.addLayer({
    id: "critical-casing-3d",
    type: "line",
    source: CRITICAL_LIFTED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: {
      "line-color": CRITICAL_DARK,
      "line-width": 13,
      "line-opacity": 0.94,
      "line-offset": 4,
    },
  })

  map.addLayer({
    id: "critical-glow-3d",
    type: "line",
    source: CRITICAL_LIFTED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: {
      "line-color": CRITICAL_COLOR,
      "line-width": 31,
      "line-opacity": 0.25,
      "line-blur": 9,
      "line-offset": 4,
    },
  })

  map.addLayer({
    id: "critical-3d",
    type: "line",
    source: CRITICAL_LIFTED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: {
      "line-color": CRITICAL_COLOR,
      "line-width": 7.5,
      "line-opacity": 1,
      "line-offset": 4,
    },
  })

  map.addLayer({
    id: "shadow-3d",
    type: "line",
    source: FLAT_SOURCE,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: {
      "line-color": "#07131E",
      "line-width": 18,
      "line-opacity": 0.28,
      "line-blur": 7,
      "line-translate": [0, 7],
      "line-translate-anchor": "viewport",
    },
  })

  map.addLayer({
    id: "casing-3d",
    type: "line",
    source: LIFTED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: { "line-color": "#082B47", "line-width": 12, "line-opacity": 0.9 },
  })

  map.addLayer({
    id: "glow-3d",
    type: "line",
    source: LIFTED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: { "line-color": ROUTE_COLOR, "line-width": 30, "line-opacity": 0.24, "line-blur": 9 },
  })

  map.addLayer({
    id: "line-3d",
    type: "line",
    source: LIFTED_SOURCE,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: { "line-color": ROUTE_COLOR, "line-width": 7.5, "line-opacity": 1 },
  })

  map.addLayer({
    id: "dash-3d",
    type: "line",
    source: LIFTED_SOURCE,
    layout: { "line-cap": "butt", "line-join": "round", visibility: "none" },
    paint: { "line-color": "#F7FBFF", "line-width": 1.8, "line-dasharray": [3, 5], "line-opacity": 0.62 },
  })

  // Keep the street network legible at city scale; add weight as the operator zooms in.
  for (const id of [...LAYERS_2D, ...LAYERS_3D]) {
    const layer = map.getStyle().layers.find((entry) => entry.id === id)
    if (layer?.type !== "line") continue
    const width = layer.paint?.["line-width"]
    if (typeof width === "number") {
      map.setPaintProperty(id, "line-width", ["interpolate", ["linear"], ["zoom"], 10, width * 0.42, 14, width * 0.72, 18, width])
    }
    if (id.includes("glow")) {
      map.setPaintProperty(id, "line-opacity", 0.1)
      map.setPaintProperty(id, "line-blur", 3)
    }
  }
  if (typeof document !== "undefined") setRouteRibbons(map, [coords, comparison, critical])
  drawRoute(map)
}

/**
 * The rectangle the street network spans, drawn as a faint outline.
 *
 * The AI refuses any point more than two kilometres from a mapped street, and
 * the only way a dispatcher could find that out was by getting the request
 * rejected. Showing the boundary turns that into something visible before the
 * click.
 */
function coverageFeature(bounds: GraphBounds | null | undefined): Feature<LineString> {
  if (!bounds) return lineFeature([])

  const { min_latitude, max_latitude, min_longitude, max_longitude } = bounds

  return lineFeature([
    [min_longitude, min_latitude],
    [max_longitude, min_latitude],
    [max_longitude, max_latitude],
    [min_longitude, max_latitude],
    [min_longitude, min_latitude],
  ])
}

export function addCoverageLayer(map: maplibregl.Map, bounds: GraphBounds | null | undefined) {
  if (map.getSource(COVERAGE_SOURCE)) return

  map.addSource(COVERAGE_SOURCE, { type: "geojson", data: coverageFeature(bounds) })

  map.addLayer({
    id: "coverage-outline",
    type: "line",
    source: COVERAGE_SOURCE,
    layout: { "line-cap": "square", "line-join": "miter" },
    paint: {
      "line-color": "#55636F",
      "line-width": 2,
      "line-opacity": 0.55,
      "line-dasharray": [4, 3],
    },
  })
}

export function updateCoverageData(map: maplibregl.Map, bounds: GraphBounds | null | undefined) {
  const source = map.getSource(COVERAGE_SOURCE) as maplibregl.GeoJSONSource | undefined
  source?.setData(coverageFeature(bounds))
}

/** Redraws both stacks when a new route arrives, without rebuilding the map. */
export function updateRouteData(
  map: maplibregl.Map,
  coords: LngLat[],
  comparison: LngLat[],
  critical: LngLat[] = [],
) {
  const flat = map.getSource(FLAT_SOURCE) as maplibregl.GeoJSONSource | undefined
  const lifted = map.getSource(LIFTED_SOURCE) as maplibregl.GeoJSONSource | undefined
  const other = map.getSource(COMPARISON_SOURCE) as maplibregl.GeoJSONSource | undefined
  const otherLifted = map.getSource(COMPARISON_LIFTED_SOURCE) as maplibregl.GeoJSONSource | undefined
  const criticalSource = map.getSource(CRITICAL_SOURCE) as maplibregl.GeoJSONSource | undefined
  const criticalLifted = map.getSource(CRITICAL_LIFTED_SOURCE) as maplibregl.GeoJSONSource | undefined

  flat?.setData(lineFeature(coords))
  lifted?.setData(lineFeature(lift(coords)))
  other?.setData(lineFeature(comparison))
  otherLifted?.setData(lineFeature(lift(comparison)))
  criticalSource?.setData(lineFeature(critical))
  criticalLifted?.setData(lineFeature(lift(critical)))
  if (typeof document !== "undefined") setRouteRibbons(map, [coords, comparison, critical])
  drawRoute(map)
}

export function setComparisonVisibility(map: maplibregl.Map, visible: boolean) {
  const in3D = map.getLayer("line-3d")
    && map.getLayoutProperty("line-3d", "visibility") === "visible"

  COMPARISON_LAYERS_2D.forEach((id) => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", visible && !in3D ? "visible" : "none")
    }
  })

  COMPARISON_LAYERS_3D.forEach((id) => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", visible && Boolean(in3D) ? "visible" : "none")
    }
  })
}

export function setLayerVisibility(map: maplibregl.Map, show3d: boolean) {
  if (map.getLayer("zeno-route-ribbons")) map.setLayoutProperty("zeno-route-ribbons", "visibility", show3d ? "visible" : "none")
  const flatVisibility = show3d ? "none" : "visible"
  const liftedVisibility = show3d ? "visible" : "none"

  LAYERS_2D.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", flatVisibility)
  })

  LAYERS_3D.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", liftedVisibility)
  })
}

export function set3DEnvironment(map: maplibregl.Map, visible: boolean) {
  configureEnvironment(map, visible)
}

export function setBuildingLayersVisibility(map: maplibregl.Map, visible: boolean) {
  map.getStyle().layers.forEach((layer) => {
    if (!layer.id.toLowerCase().includes("building")) return
    const isVolume = layer.type === "fill-extrusion"
    map.setLayoutProperty(layer.id, "visibility", isVolume && !visible ? "none" : "visible")
    if (layer.type === "fill") {
      map.setLayerZoomRange(layer.id, 13, 24)
      map.setPaintProperty(layer.id, "fill-color", typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "#BDCACD" : "#263A48")
      map.setPaintProperty(layer.id, "fill-outline-color", "#3A5060")
    }

    if (visible && layer.type === "fill-extrusion") {
      map.setLayerZoomRange(layer.id, 13, 24)
      map.setPaintProperty(layer.id, "fill-extrusion-opacity", 0.88)
      map.setPaintProperty(layer.id, "fill-extrusion-base", ["coalesce", ["get", "render_min_height"], 0])
      map.setPaintProperty(layer.id, "fill-extrusion-vertical-gradient", true)
      map.setPaintProperty(layer.id, "fill-extrusion-color", [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "render_height"], 0],
        0, typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "#BDCACD" : "#304656",
        12, "#3E586B",
        35, "#587082",
        80, "#728A9B",
      ])
    }
  })
}
