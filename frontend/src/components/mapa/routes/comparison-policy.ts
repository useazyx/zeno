import type { RouteMetrics } from './utils'

export function routesAreIdentical(ai: RouteMetrics, standard: RouteMetrics, sharedRatio?: number): boolean {
  if (ai.coords.length < 2 || standard.coords.length < 2) return false
  const sameGeometry = ai.coords.length === standard.coords.length && ai.coords.every((point, index) =>
    Math.abs(point[0] - standard.coords[index][0]) < 1e-7 && Math.abs(point[1] - standard.coords[index][1]) < 1e-7)
  return sameGeometry || (sharedRatio !== undefined && sharedRatio >= 0.999 && Math.abs(ai.totalSeconds - standard.totalSeconds) <= 1)
}

export interface ExclusiveStreet {
  street: string | null
  seconds: number
  start: number
  end: number
}

function edgeKey(route: RouteMetrics, index: number): string {
  return `${route.coords[index].map((n) => n.toFixed(6)).join(',')}>${route.coords[index + 1].map((n) => n.toFixed(6)).join(',')}`
}

function exclusiveStreets(route: RouteMetrics, other: RouteMetrics): ExclusiveStreet[] {
  const shared = new Set(other.coords.slice(0, -1).map((_, index) => edgeKey(other, index)))
  return route.segments.flatMap((segment) => {
    let exclusiveMeters = 0
    for (let index = segment.start; index < segment.end; index++) {
      if (!shared.has(edgeKey(route, index))) exclusiveMeters += route.cumulative[index + 1] - route.cumulative[index]
    }
    const meters = route.cumulative[segment.end] - route.cumulative[segment.start]
    return exclusiveMeters > 0 && meters > 0
      ? [{ street: segment.street, seconds: segment.time_seconds * exclusiveMeters / meters, start: segment.start, end: segment.end }]
      : []
  })
}

export function comparisonResult(ai: RouteMetrics, standard: RouteMetrics, sharedRatio?: number) {
  const identical = routesAreIdentical(ai, standard, sharedRatio)
  const aiExclusive = identical ? [] : exclusiveStreets(ai, standard)
  const standardExclusive = identical ? [] : exclusiveStreets(standard, ai)
  const savedSeconds = identical ? 0 : standard.totalSeconds - ai.totalSeconds
  const time = (seconds: number) => `${Math.floor(Math.round(Math.abs(seconds)) / 60)}:${String(Math.round(Math.abs(seconds)) % 60).padStart(2, '0')}`
  let summary = identical ? 'Mesma rota, mesmo tempo.' : Math.abs(savedSeconds) < 1 ? 'As rotas chegaram no mesmo tempo estimado.'
    : `A ${savedSeconds > 0 ? 'IA' : 'rota padrão'} chegou ${time(savedSeconds)} antes.`
  if (!identical && aiExclusive.length && standardExclusive.length) {
    const sum = (streets: ExclusiveStreet[]) => streets.reduce((total, street) => total + street.seconds, 0)
    const names = [...new Set(standardExclusive.map((segment) => segment.street).filter(Boolean))].slice(0, 2)
    summary += ` Trechos exclusivos: ${time(sum(aiExclusive))} pela IA e ${time(sum(standardExclusive))} pelo padrão${names.length ? ` (${names.join(', ')})` : ''}.`
  }
  return { identical, savedSeconds, aiExclusive, standardExclusive, summary }
}

/** One simulation clock preserves the relative arrival times of every route. */
export function comparisonProgress(elapsedMs: number, durationMs: number, seconds: number[], routes?: RouteMetrics[]): number[] {
  const valid = seconds.map((value, index) => routes?.[index]?.totalSeconds ?? (Number.isFinite(value) && value > 0 ? value : 1))
  const simulated = Math.max(0, elapsedMs) / Math.max(1, durationMs) * Math.max(...valid, 1)
  return valid.map((value, index) => routes?.[index]
    ? (routes[index].totalMeters > 0 ? routes[index].distanceAtSeconds(simulated) / routes[index].totalMeters : 1)
    : Math.min(1, simulated / value))
}

/** Gaps compare the seconds needed to reach the leader's current route progress. */
export function comparisonStandings(routes: RouteMetrics[], seconds: number) {
  const rows = routes.map((route, index) => ({ index, progress: route.totalMeters > 0 ? route.distanceAtSeconds(seconds) / route.totalMeters : 1,
    remainingMeters: Math.max(0, route.totalMeters - route.distanceAtSeconds(seconds)),
    remainingSeconds: Math.max(0, route.totalSeconds - seconds), totalSeconds: route.totalSeconds }))
    .sort((a, b) => b.progress - a.progress || (a.progress >= 1 ? a.totalSeconds - b.totalSeconds : a.index - b.index))
  const leader = rows[0]
  let rank = 1
  return rows.map((row, order) => {
    if (order > 0 && (Math.abs(row.progress - rows[order - 1].progress) > 1e-7
      || (row.progress >= 1 && Math.abs(row.totalSeconds - rows[order - 1].totalSeconds) > 0.01))) rank = order + 1
    const gapSeconds = !leader ? 0 : leader.progress >= 1
      ? Math.max(0, row.totalSeconds - leader.totalSeconds)
      : Math.max(0, routes[row.index].secondsAtDistance(leader.progress * routes[row.index].totalMeters) - seconds)
    return { ...row, rank, gapSeconds }
  })
}

/** Different entry/exit thresholds prevent flicker near the split boundary. */
export function nextCameraLayout(split: boolean, fittedZoom: number): boolean {
  return split ? fittedZoom < 16.35 : fittedZoom < 15.65
}
