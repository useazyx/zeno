import type { RouteFeature } from '../../../api/types'
import type { LngLat } from './utils'

/** Coordinates here are map coordinates (longitude, latitude), including the destination. */
export function destinationSide(coords: LngLat[], destination: LngLat): 'direita' | 'esquerda' | null {
  const end = coords.at(-1)
  if (!end) return null
  const previous = coords.slice(0, -1).reverse().find((p) => p[0] !== end[0] || p[1] !== end[1])
  if (!previous) return null
  const lonScale = Math.cos(end[1] * Math.PI / 180)
  const dx = (end[0] - previous[0]) * lonScale, dy = end[1] - previous[1]
  const cross = dx * (destination[1] - end[1]) - dy * (destination[0] - end[0]) * lonScale
  const offsetMeters = cross / Math.hypot(dx, dy) * 111320
  return Math.abs(offsetMeters) < 2 ? null : offsetMeters < 0 ? 'direita' : 'esquerda'
}

export function roadFeatureAlerts(features: Pick<RouteFeature, 'type' | 'geometry_index' | 'value'>[], cumulative: number[], travelled: number) {
  return features.flatMap((feature) => {
    const distance = (cumulative[feature.geometry_index] ?? -Infinity) - travelled
    if (distance <= 0 || distance > 400) return []
    const value = feature.value?.trim()
    const labels: Record<string, string> = {
      speed_bump: 'Lombada ou redutor de velocidade',
      max_weight: value ? `Limite de peso: ${value}${/^[\d.,]+$/.test(value) ? ' t' : ''}` : 'Restrição de peso sinalizada',
      max_height: value ? `Altura máxima: ${value}${/^[\d.,]+$/.test(value) ? ' m' : ''}` : 'Restrição de altura sinalizada',
      narrow: value ? `Via estreita: ${value}${/^[\d.,]+$/.test(value) ? ' m' : ''}` : 'Via estreita sinalizada',
      bridge: 'Ponte à frente',
    }
    return labels[feature.type] ? [{ text: labels[feature.type], distance }] : []
  }).sort((a, b) => a.distance - b.distance)
}

type ReasonSegment = { street: string | null; counterflow: boolean; shoulder: boolean }
export function alternativeReason(segments: ReasonSegment[], baseline: ReasonSegment[]) {
  if (segments.some((s) => s.counterflow)) return 'Usa contramão · modo crítico'
  if (segments.some((s) => s.shoulder)) return 'Usa acostamento · modo crítico'
  const names = new Set(segments.map((s) => s.street).filter(Boolean))
  const avoided = baseline.find((s) => s.street && !names.has(s.street))?.street
  if (avoided) return `Evita ${avoided}`
  return 'Percurso calculado'
}
