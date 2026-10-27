export type PlotPoint = { x: number; y: number }

/** Monotone cubic interpolation: through every sample without invented peaks. */
export function curvePath(points: PlotPoint[]): string {
  if (!points.length) return ""
  const slopes = points.slice(1).map((p, i) => (p.y - points[i].y) / (p.x - points[i].x || 1))
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0] ?? 0
    if (i === points.length - 1) return slopes[i - 1]
    return slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 / (1 / slopes[i - 1] + 1 / slopes[i])
  })
  // Fritsch–Carlson slope limiter keeps each segment inside its sample range.
  slopes.forEach((slope, i) => {
    if (slope === 0) { tangents[i] = 0; tangents[i + 1] = 0; return }
    const a = tangents[i] / slope, b = tangents[i + 1] / slope
    const length = Math.hypot(a, b)
    if (length > 3) { tangents[i] = 3 / length * a * slope; tangents[i + 1] = 3 / length * b * slope }
  })
  const pair = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`
  return `M${pair(points[0].x, points[0].y)}` + points.slice(1).map((point, i) => {
    const previous = points[i], third = (point.x - previous.x) / 3
    return ` C${pair(previous.x + third, previous.y + tangents[i] * third)} ${pair(point.x - third, point.y - tangents[i + 1] * third)} ${pair(point.x, point.y)}`
  }).join("")
}
