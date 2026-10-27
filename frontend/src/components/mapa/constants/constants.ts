export const ROUTE_COLOR = "#68B9E8"
export const COMPARISON_COLOR = "#E6BD70"
export const CRITICAL_COLOR = "#EF8C87"
export const ROUTE_ALT = 25
export const ORBIT_PERIOD = 7_000
export const FOLLOW_KMH = 200

export function mapStyle() {
  const light = typeof document !== "undefined" && document.documentElement.dataset.theme === "light"
  return `/map-styles/zeno-${light ? "light" : "dark"}.json`
}

export const WAZE_PITCH = 52
export const WAZE_ZOOM = 16.7
