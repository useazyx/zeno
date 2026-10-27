/**
 * The AI's route next to an outside engine's (OSRM) for the same trip.
 *
 * Time and distance as differences, plus how much of the AI's line runs on the
 * same streets. Two engines on the same OpenStreetMap data that agree on most
 * of the line and differ by a few percent in time are a sanity check on the
 * model; a large gap is worth a look. Relative imports only, so the node test
 * runner loads it directly.
 */

import { cumulative, locateOnRoute, pointAlong } from "./guidance"
import type { LatLon } from "./guidance"

/** Spacing of the points sampled along the AI's line. */
const SAMPLE_M = 20
/** A sample this close to the other line counts as the same street. */
const SAME_STREET_M = 25

/** Share (0 to 1) of line `a` that runs within a street's width of line `b`. */
export function sharedShare(a: LatLon[], b: LatLon[]): number {
  if (a.length < 2 || b.length < 2) return 0
  const alongA = cumulative(a)
  const alongB = cumulative(b)
  const total = alongA[alongA.length - 1]
  if (total <= 0) return 0

  const samples = Math.max(2, Math.ceil(total / SAMPLE_M) + 1)
  let shared = 0
  for (let index = 0; index < samples; index += 1) {
    const point = pointAlong(a, (total * index) / (samples - 1), alongA)
    if (locateOnRoute(b, point, alongB).offRouteM <= SAME_STREET_M) shared += 1
  }
  return shared / samples
}

export interface Benchmark {
  /** AI minus OSRM, in seconds: negative means the AI expects to arrive sooner. */
  timeDeltaS: number
  timeDeltaPct: number
  distanceDeltaM: number
  distanceDeltaPct: number
  sharedPct: number
}

export function benchmark(
  ai: { estimated_time_seconds: number, distance_meters: number, geometry: LatLon[] },
  reference: { duration_seconds: number, distance_meters: number, geometry: LatLon[] },
): Benchmark {
  const pct = (value: number, base: number) => (base > 0 ? (value / base) * 100 : 0)
  const timeDeltaS = ai.estimated_time_seconds - reference.duration_seconds
  const distanceDeltaM = ai.distance_meters - reference.distance_meters
  return {
    timeDeltaS,
    timeDeltaPct: pct(timeDeltaS, reference.duration_seconds),
    distanceDeltaM,
    distanceDeltaPct: pct(distanceDeltaM, reference.distance_meters),
    sharedPct: sharedShare(ai.geometry, reference.geometry) * 100,
  }
}
