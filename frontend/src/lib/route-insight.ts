/**
 * Summaries of a route for the explanation panel. Relative imports only, so the
 * node test runner can load it.
 */

import type { RoadClass, RouteSegment } from "../api/types"
import { speedBand } from "./route-language"
import type { SpeedBand } from "./route-language"

export function speedProfile(segments: RouteSegment[]): Record<SpeedBand, number> {
  const totals: Record<SpeedBand, number> = { fluid: 0, moderate: 0, slow: 0 }
  for (const segment of segments) totals[speedBand(segment)] += segment.length_meters
  return totals
}

/** What the panel needs from a route: a fresh preview or a stored one. */
export interface InsightRoute {
  composition?: Record<RoadClass, number>
  segments?: RouteSegment[] | null
  shared_with_shortest?: number
}

const ROAD_CLASS_OF: Record<string, RoadClass> = {
  motorway: "highway", motorway_link: "highway", trunk: "highway", trunk_link: "highway",
  primary: "primary", primary_link: "primary",
  secondary: "secondary", secondary_link: "secondary",
  tertiary: "tertiary", tertiary_link: "tertiary",
}

/** Stored routes keep their segments but not the summary; rebuild it. */
export function compositionOf(route: InsightRoute): Record<RoadClass, number> | null {
  if (route.composition) return route.composition
  if (!route.segments || route.segments.length === 0) return null
  const totals: Record<RoadClass, number> = { highway: 0, primary: 0, secondary: 0, tertiary: 0, local: 0 }
  for (const segment of route.segments) totals[ROAD_CLASS_OF[segment.highway] ?? "local"] += segment.length_meters
  return totals
}
