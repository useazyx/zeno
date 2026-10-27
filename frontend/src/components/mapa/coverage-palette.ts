/** How a demand point is coloured against the target response time. */

import type { CoveragePoint } from "@/api/types"

export const POINT_COLOR = {
  covered: "#7DC4A1",
  late: "#E6BD70",
  outside: "#EF8C87",
  unknown: "#A5B6C5",
}

export function pointClass(point: Pick<CoveragePoint, "time_seconds">, targetMinutes: number, maxMinutes: number): keyof typeof POINT_COLOR {
  if (point.time_seconds === null) return "unknown"
  if (point.time_seconds <= targetMinutes * 60) return "covered"
  if (point.time_seconds <= maxMinutes * 60) return "late"
  return "outside"
}
