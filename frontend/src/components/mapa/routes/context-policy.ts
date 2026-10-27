import type { LngLat } from './utils'

export function nearbyWaterSources<T extends { latitude: number | string; longitude: number | string }>(sources: T[], point: LngLat, radius = 400): (T & { distance: number })[] {
  return sources.flatMap((source) => {
    if (String(source.latitude).trim() === '' || String(source.longitude).trim() === '') return []
    const lat = Number(source.latitude), lon = Number(source.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return []
    const distance = Math.hypot((lon - point[0]) * Math.cos(point[1] * Math.PI / 180), lat - point[1]) * 111320
    return distance <= radius ? [{ ...source, distance }] : []
  }).sort((a, b) => a.distance - b.distance)
}
