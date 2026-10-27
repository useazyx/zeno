import type { RouteStep } from '../../../api/types'
import { WAZE_PITCH, WAZE_ZOOM } from '../constants/constants'
import { bearingBetween, type RouteMetrics } from './utils'

export function navigationState(route: RouteMetrics, steps: RouteStep[], meters: number) {
  const next = steps.find((step) => (step.type === 'turn' || step.type === 'roundabout')
    && (route.cumulative[step.geometry_index] ?? -Infinity) >= meters - 25)
  const maneuver = next ? { step: next, meters: route.cumulative[next.geometry_index], distance: route.cumulative[next.geometry_index] - meters } : null
  const current = route.segments.find((segment) => route.cumulative[segment.end] > meters) ?? route.segments.at(-1)
  const limitKmh = current && current.limit_kmh > 0 ? current.limit_kmh : null
  const alerts: { text: string; distance: number }[] = []
  for (const segment of route.segments) {
    const distance = route.cumulative[segment.start] - meters
    if (distance <= 0 || distance > 400) continue
    if (segment.counterflow) alerts.push({ text: 'Trecho em contramão à frente · modo crítico', distance })
    else if (segment.shoulder) alerts.push({ text: 'Uso de acostamento à frente · modo crítico', distance })
    else if (limitKmh && segment.limit_kmh > 0 && segment.limit_kmh <= limitKmh - 10) alerts.push({ text: `Limite reduz para ${segment.limit_kmh} km/h`, distance })
  }
  for (let index = 1; index < route.coords.length - 1; index++) {
    const point = route.cumulative[index]
    const distance = point - meters
    if (distance <= 0 || distance > 250) continue
    const incoming = bearingBetween(route.pointAtDist(point - 20), route.coords[index])
    const outgoing = bearingBetween(route.coords[index], route.pointAtDist(point + 20))
    const turn = Math.abs(((outgoing - incoming + 540) % 360) - 180)
    if (turn >= 60) { alerts.push({ text: 'Curva fechada à frente', distance }); break }
  }
  const approach = maneuver ? Math.min(1, Math.max(0, 1 - Math.max(0, maneuver.distance) / 250)) : 0
  const exit = maneuver && maneuver.distance < 0 ? Math.max(0, 1 + maneuver.distance / 25) : 1
  const amount = approach * exit
  return { maneuver, zoom: WAZE_ZOOM - amount * (next?.type === 'roundabout' ? 1.3 : 0.8),
    pitch: WAZE_PITCH - amount * 25, limitKmh, emergency: !!(current?.counterflow || current?.shoulder),
    alert: alerts.sort((a, b) => a.distance - b.distance)[0] ?? null }
}

export type SimulationCamera = 'chase' | 'top' | 'orbit'

export function readSimulationCamera(): SimulationCamera {
  try {
    const camera = localStorage.getItem('zeno.simulation-camera')
    return camera === 'top' || camera === 'orbit' ? camera : 'chase'
  } catch { return 'chase' }
}

export function saveSimulationCamera(camera: SimulationCamera) {
  try { localStorage.setItem('zeno.simulation-camera', camera) } catch { /* Storage can be unavailable in private sessions. */ }
}
