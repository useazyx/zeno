/**
 * Where the vehicle is along its route, and what the driver does next.
 *
 * Positions are [latitude, longitude] like the API's geometry. Distances use a
 * local flat projection, which is exact enough inside one city. Relative
 * imports only, so the node test runner loads it directly.
 */

export type LatLon = [number, number]

const METERS_PER_DEGREE = 111_320

function toXY(point: LatLon, cosLat: number): [number, number] {
  return [point[1] * METERS_PER_DEGREE * cosLat, point[0] * METERS_PER_DEGREE]
}

export function distanceM(a: LatLon, b: LatLon): number {
  const cosLat = Math.cos((a[0] * Math.PI) / 180)
  const [ax, ay] = toXY(a, cosLat)
  const [bx, by] = toXY(b, cosLat)
  return Math.hypot(ax - bx, ay - by)
}

/** Distance from the start of the line to each of its vertices. */
export function cumulative(line: LatLon[]): number[] {
  const out = [0]
  for (let index = 1; index < line.length; index += 1) {
    out.push(out[index - 1] + distanceM(line[index - 1], line[index]))
  }
  return out
}

/**
 * The closest point of the route to a position: how far along the route it
 * is, the segment it falls on, and how far off the route the position is.
 */
export function locateOnRoute(line: LatLon[], position: LatLon, along = cumulative(line)) {
  let best = { along: 0, segment: 0, offRouteM: Infinity }
  if (line.length === 0) return best
  if (line.length === 1) return { along: 0, segment: 0, offRouteM: distanceM(line[0], position) }

  const cosLat = Math.cos((position[0] * Math.PI) / 180)
  const [px, py] = toXY(position, cosLat)

  for (let index = 0; index < line.length - 1; index += 1) {
    const [ax, ay] = toXY(line[index], cosLat)
    const [bx, by] = toXY(line[index + 1], cosLat)
    const dx = bx - ax
    const dy = by - ay
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
    const offRoute = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    if (offRoute < best.offRouteM) {
      best = { along: along[index] + t * (along[index + 1] - along[index]), segment: index, offRouteM: offRoute }
    }
  }
  return best
}

/** The point at a given distance along the route; the end when past it. */
export function pointAlong(line: LatLon[], meters: number, along = cumulative(line)): LatLon {
  if (line.length === 0) return [0, 0]
  if (meters <= 0) return line[0]
  const total = along[along.length - 1]
  if (meters >= total) return line[line.length - 1]

  let index = 1
  while (along[index] < meters) index += 1
  const span = along[index] - along[index - 1]
  const t = span === 0 ? 0 : (meters - along[index - 1]) / span
  const [aLat, aLon] = line[index - 1]
  const [bLat, bLon] = line[index]
  return [aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t]
}

export interface StepAnchor {
  geometry_index: number
}

/**
 * The next manoeuvre ahead of a position `metersAlong` the route, and how far
 * away it is. The depart step is never "next": the vehicle has already left.
 */
export function nextStep<T extends StepAnchor>(steps: T[], metersAlong: number, along: number[]): { step: T, index: number, inM: number } | null {
  for (let index = 1; index < steps.length; index += 1) {
    const at = along[Math.min(steps[index].geometry_index, along.length - 1)] ?? 0
    if (at > metersAlong + 1) return { step: steps[index], index, inM: at - metersAlong }
  }
  return null
}

/** "Em 250 metros", rounded the way a navigator says it. */
export function spokenDistance(meters: number): string {
  if (meters < 30) return "Agora"
  if (meters < 1000) return `Em ${Math.round(meters / 50) * 50 || 50} metros`
  return `Em ${(Math.round(meters / 100) / 10).toLocaleString("pt-BR")} quilômetros`
}
