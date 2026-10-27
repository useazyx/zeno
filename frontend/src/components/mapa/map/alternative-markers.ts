import maplibregl from 'maplibre-gl'
import type { RouteMetrics } from '../routes/utils'
import { alternativeReason } from '../routes/route-context'
import { formatDistance, formatDuration } from '../../../lib/format'

export type RouteKind = 'ai' | 'standard' | 'critical'
export interface MapAlternative { kind: RouteKind; label: string; metrics: RouteMetrics }
export function addAlternativeMarkers(map: maplibregl.Map, alternatives: MapAlternative[], choose: (kind: RouteKind) => void) {
  const baseline = alternatives.find((entry) => entry.kind === 'standard')?.metrics
  const routeLayers: Record<RouteKind, string[]> = { ai: ['line-2d', 'line-3d'], standard: ['comparison-2d', 'comparison-3d'], critical: ['critical-2d', 'critical-3d'] }
  const emphasize = (kind: RouteKind | null) => {
    for (const entry of alternatives) for (const id of routeLayers[entry.kind]) if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', kind && kind !== entry.kind ? 0.22 : 1)
  }
  const markers = alternatives.filter((entry) => entry.metrics.coords.length > 1).map((entry, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `route-alternative route-alternative--${entry.kind}`
    const title = document.createElement('strong')
    title.textContent = `${entry.label} · ${formatDuration(entry.metrics.totalSeconds)} · ${formatDistance(entry.metrics.totalMeters)}`
    const reason = document.createElement('span')
    const difference = baseline ? Math.round(entry.metrics.totalSeconds - baseline.totalSeconds) : 0
    reason.textContent = `${difference === 0 ? 'Mesmo tempo previsto' : `${difference > 0 ? '+' : '−'}${formatDuration(Math.abs(difference))}`} · ${alternativeReason(entry.metrics.segments, baseline?.segments ?? [])}`
    button.append(title, reason)
    button.addEventListener('mouseenter', () => emphasize(entry.kind))
    button.addEventListener('mouseleave', () => emphasize(null))
    button.addEventListener('focus', () => emphasize(entry.kind))
    button.addEventListener('blur', () => emphasize(null))
    button.addEventListener('click', (event) => { event.stopPropagation(); choose(entry.kind) })
    return new maplibregl.Marker({ element: button, anchor: 'bottom', offset: [0, -index * 48] })
      .setLngLat(entry.metrics.pointAtDist(entry.metrics.totalMeters * 0.5)).addTo(map)
  })
  return () => { markers.forEach((marker) => marker.remove()); emphasize(null) }
}
