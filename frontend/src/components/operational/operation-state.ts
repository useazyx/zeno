import type { Dispatch, Occurrence, TimelineEntry, VehiclePosition } from '../../api/types'

export function occurrenceStages(occurrence: Occurrence, events: TimelineEntry[] = []) {
  const dispatches = (occurrence.dispatches ?? []).filter((item) => item.status !== 'CANCELADO')
  const first = (values: (string | null | undefined)[]) => values.filter((value): value is string => !!value && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
  const stamps = [occurrence.opened_at, first(dispatches.map((d) => d.dispatched_at)),
    first(events.filter((e) => e.type === 'DESPACHO_STATUS' && e.to_value === 'A_CAMINHO').map((e) => e.at)),
    first(dispatches.map((d) => d.arrived_at)), occurrence.closed_at ?? null]
  const current = occurrence.status === 'ENCERRADA' || occurrence.status === 'CANCELADA' ? 4
    : stamps[3] || occurrence.status === 'EM_ATENDIMENTO' ? 3
    : dispatches.some((d) => d.status === 'A_CAMINHO') || stamps[2] ? 2
    : dispatches.length || occurrence.status === 'DESPACHADA' ? 1 : 0
  return ['Aberta', 'Despachada', 'A caminho', 'No local', occurrence.status === 'CANCELADA' ? 'Cancelada' : 'Encerrada']
    .map((label, index) => ({ label, at: stamps[index], reached: index <= current, current: index === current }))
}

export function dispatchEstimate(dispatch: Dispatch | undefined, events: TimelineEntry[], now: number) {
  const route = dispatch?.used_route ?? dispatch?.routes?.find((r) => r.id === dispatch.used_route_id)
    ?? dispatch?.routes?.find((r) => r.algorithm === (dispatch.critical_mode ? 'CRITICAL' : 'NEURAL'))
  const departed = events.filter((e) => e.type === 'DESPACHO_STATUS' && e.dispatch_id === dispatch?.id && e.to_value === 'A_CAMINHO' && Number.isFinite(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.at
  if (!route || !departed || dispatch?.status !== 'A_CAMINHO') return null
  const elapsed = Math.max(0, (now - Date.parse(departed)) / 1000)
  return { remaining: route.estimated_time_seconds - elapsed, progress: Math.min(1, elapsed / Math.max(1, route.estimated_time_seconds)), departed }
}

/** GPS history is held at the last real report, never projected through missing samples. */
export function historicalPosition(positions: VehiclePosition[], at: number) {
  let low = 0, high = positions.length - 1, found = -1
  while (low <= high) {
    const middle = (low + high) >>> 1
    if (Date.parse(positions[middle].recorded_at) <= at) { found = middle; low = middle + 1 }
    else high = middle - 1
  }
  return found < 0 ? null : positions[found]
}

export function orderedPositions(positions: VehiclePosition[]) {
  return positions.filter((p) => Number.isFinite(Date.parse(p.recorded_at)) && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))
}

export function historyTrails(groups: { vehicle_id: string; positions: VehiclePosition[] }[], at: number, windowMs = 120_000): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: groups.flatMap((group) => {
    const points = group.positions.filter((p) => Date.parse(p.recorded_at) <= at && Date.parse(p.recorded_at) >= at - windowMs)
    return points.slice(1).flatMap((point, index): GeoJSON.Feature<GeoJSON.LineString>[] => {
      const previous = points[index]
      // A telemetry gap is a gap in the trail as well.
      if (Date.parse(point.recorded_at) - Date.parse(previous.recorded_at) > 60_000) return []
      return [{ type: 'Feature', properties: { opacity: Math.max(.08, .7 * (1 - (at - Date.parse(point.recorded_at)) / windowMs)) },
        geometry: { type: 'LineString', coordinates: [[Number(previous.longitude), Number(previous.latitude)], [Number(point.longitude), Number(point.latitude)]] } }]
    })
  }) }
}

export function ageLabel(since: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
  return !Number.isFinite(seconds) ? 'horário indisponível' : seconds < 60 ? `${seconds} s` : seconds < 3600 ? `${Math.floor(seconds / 60)} min` : `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min`
}
