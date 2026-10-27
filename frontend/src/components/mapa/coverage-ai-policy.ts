import type { CoveragePoint, CoverageStation } from "@/api/types"

// The existing /ai/coverage contract accepts at most six bands.
const MAX_COVERAGE_BANDS = 6

export function coverageBands(target: number): number[] {
  const bands = new Set([4, 8, 12, target])
  for (let minute = 2; minute <= target && bands.size < MAX_COVERAGE_BANDS; minute += 2) bands.add(minute)
  return [...bands].sort((a, b) => a - b)
}

export interface HypotheticalStation { label: string; latitude: number; longitude: number }

/** Draft locations remain editable while their coverage is being recalculated. */
export function coverageStations(stations: CoverageStation[], extras: HypotheticalStation[]): CoverageStation[] {
  return [
    ...stations.filter(station => !station.hypothetical),
    ...extras.map(point => ({
      id: point.label,
      acronym: point.label,
      name: point.label,
      latitude: point.latitude,
      longitude: point.longitude,
      hypothetical: true,
      in_network: stations.find(station => station.hypothetical && station.acronym === point.label)?.in_network ?? false,
    })),
  ]
}

/** Fixed planning sectors, not inferred polygons of unserved territory. */
export function coverageGaps(points: Pick<CoveragePoint, "latitude" | "longitude" | "time_seconds">[], target: number): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const step = 0.0045
  const cells = new Map<string, { x: number; y: number; count: number }>()
  for (const point of points) {
    if (point.time_seconds === null || !Number.isFinite(point.time_seconds) || point.time_seconds <= target * 60) continue
    const x = Math.floor(point.longitude / step), y = Math.floor(point.latitude / step)
    const key = `${x}:${y}`
    const cell = cells.get(key) ?? { x, y, count: 0 }
    cell.count++
    cells.set(key, cell)
  }
  return { type: "FeatureCollection", features: [...cells.values()].map(({ x, y, count }) => ({
    type: "Feature", properties: { count }, geometry: { type: "Polygon", coordinates: [[
      [x * step, y * step], [(x + 1) * step, y * step], [(x + 1) * step, (y + 1) * step], [x * step, (y + 1) * step], [x * step, y * step],
    ]] },
  })) }
}

type StreetFeature = GeoJSON.Feature<GeoJSON.LineString>
export interface StreetGraphNode { id: string; longitude: number; latitude: number; depth: number }
export interface StreetGraphEdge { index: number; from: string; to: string; cost: number | null; street: string; coordinates: number[][]; attention: [number | null, number | null] }

/** Breadth-first geographic crop from actual street endpoints; no synthetic edges. */
export function localStreetGraph(features: StreetFeature[], limit = 30): { nodes: StreetGraphNode[]; edges: StreetGraphEdge[] } {
  const key = (p: number[]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`
  const nodes = new Map<string, StreetGraphNode>()
  const adjacency = new Map<string, number[]>()
  const edges: StreetGraphEdge[] = []
  features.forEach((feature, index) => {
    const coords = feature.geometry.coordinates
    if (coords.length < 2 || coords.some(point => point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return
    const from = key(coords[0]), to = key(coords[coords.length - 1])
    if (from === to) return
    for (const p of [coords[0], coords[coords.length - 1]]) nodes.set(key(p), { id: key(p), longitude: p[0], latitude: p[1], depth: 0 })
    const properties = feature.properties ?? {}
    const cost = typeof properties.cost_seconds === "number" && Number.isFinite(properties.cost_seconds) ? properties.cost_seconds : null
    const attention = [properties.attention_1, properties.attention_2].map(value => typeof value === "number" && Number.isFinite(value) ? value : null) as [number | null, number | null]
    const edge = { index, from, to, cost, coordinates: coords, street: String(properties.street || "Via sem nome"), attention }
    const edgeIndex = edges.push(edge) - 1
    for (const id of [from, to]) adjacency.set(id, [...(adjacency.get(id) ?? []), edgeIndex])
  })
  const first = [...nodes.values()].sort((a, b) => Math.hypot(a.longitude + 45.5551, a.latitude + 23.0264) - Math.hypot(b.longitude + 45.5551, b.latitude + 23.0264))[0]
  if (!first) return { nodes: [], edges: [] }
  const chosen = new Map([[first.id, first]])
  const queue = [first]
  for (let cursor = 0; cursor < queue.length && chosen.size < limit; cursor++) {
    const node = queue[cursor]
    for (const index of adjacency.get(node.id) ?? []) {
      const edge = edges[index], id = edge.from === node.id ? edge.to : edge.from
      if (chosen.has(id) || chosen.size >= limit) continue
      const next = { ...nodes.get(id)!, depth: node.depth + 1 }
      chosen.set(id, next)
      queue.push(next)
    }
  }
  return { nodes: [...chosen.values()], edges: edges.filter(edge => chosen.has(edge.from) && chosen.has(edge.to)) }
}

export function explorationFeatures(trace: [number, number][], progress: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const count = Math.floor(trace.length * Math.max(0, Math.min(1, progress)))
  return { type: "FeatureCollection", features: trace.slice(0, count).map(([latitude, longitude], index) => ({
    type: "Feature", properties: { frontier: index >= count - 20 }, geometry: { type: "Point", coordinates: [longitude, latitude] },
  })) }
}

export function learningRates(points: { epoch: number; learning_rate?: number | null }[]): { epoch: number; rate: number }[] {
  return points.flatMap(point => typeof point.learning_rate === "number" && Number.isFinite(point.learning_rate) && point.learning_rate > 0
    ? [{ epoch: point.epoch, rate: point.learning_rate }] : [])
}
