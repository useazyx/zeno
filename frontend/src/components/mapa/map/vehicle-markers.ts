import maplibregl from 'maplibre-gl'
import type { VehicleAppearance, VehicleType } from '@/api/types'
import { bufferedPosition, positionAge, shortestHeading, TRAIL_WINDOW_MS, type PositionReport } from './vehicle-tracking'
import { circlePolygon } from './overlays'

export interface LiveVehicle {
  id: string; prefix: string; status: string; latitude: number; longitude: number
  recorded_at?: string | null; heading?: number | null; accuracy_m?: number | null
  arrived_at?: string | null; type?: VehicleType; appearance?: VehicleAppearance | null
}
const STATUS_COLOR: Record<string, string> = { EMPENHADA: '#24668C', DISPONIVEL: '#2F6A52' }
interface Track { vehicle: LiveVehicle; reports: PositionReport[]; heading: number; status: string }
interface MarkerClock { at?: number }
const registries = new WeakMap<maplibregl.Map, { tracks: Map<string, Track>; wake: () => void; clock: MarkerClock }>()

function paint(element: HTMLElement, track: Track, now: number) {
  const vehicle = track.vehicle
  const age = positionAge(vehicle.recorded_at, now)
  element.classList.toggle('is-stale', age.stale)
  element.classList.toggle('is-on-scene', !!vehicle.arrived_at)
  element.style.setProperty('--vehicle-color', STATUS_COLOR[vehicle.status] ?? '#52616C')
  const state = [vehicle.arrived_at ? `no local · ${Math.max(0, Math.floor((now - Date.parse(vehicle.arrived_at)) / 60000))} min` : '', age.label].filter(Boolean).join(' · ')
  const text = `${vehicle.prefix}${state ? ` · ${state}` : ''}`
  if (element.textContent !== text) element.textContent = text
  element.setAttribute('aria-label', `Viatura ${text}`)
  element.title = `${text} · ${vehicle.status.toLocaleLowerCase('pt-BR')}`
  if (track.status !== vehicle.status) {
    element.classList.remove('status-changed')
    if (vehicle.status === 'EMPENHADA') {
      void element.offsetWidth
      element.classList.add('status-changed')
    }
    track.status = vehicle.status
  }
}

function registry(map: maplibregl.Map, markers: Map<string, maplibregl.Marker>) {
  const existing = registries.get(map)
  if (existing) return existing
  const tracks = new Map<string, Track>()
  const clock: MarkerClock = {}
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let frame = 0, timer: ReturnType<typeof setTimeout> | undefined, removed = false, lastTrail = 0
  const trail = () => {
    const now = clock.at ?? Date.now()
    const features: GeoJSON.Feature[] = []
    for (const track of tracks.values()) {
      track.reports = track.reports.filter((report, index, all) => report.at >= now - TRAIL_WINDOW_MS || index === all.length - 1)
      track.reports.slice(1).filter((report, index) => report.at - track.reports[index].at <= 60000).forEach((report) => {
        const index = track.reports.indexOf(report) - 1
        features.push({ type: 'Feature',
        properties: { color: STATUS_COLOR[track.vehicle.status] ?? '#52616C', opacity: Math.max(0.05, 0.65 * (1 - (now - report.at) / TRAIL_WINDOW_MS)) },
        geometry: { type: 'LineString', coordinates: [[track.reports[index].longitude, track.reports[index].latitude], [report.longitude, report.latitude]] } })
      })
      const precision = track.vehicle.accuracy_m
      if (precision && precision > 0) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon({ latitude: track.vehicle.latitude, longitude: track.vehicle.longitude, radius_m: precision })] } })
    }
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
    const source = map.getSource('vehicle-trails') as maplibregl.GeoJSONSource | undefined
    if (source) source.setData(data)
    else {
      map.addSource('vehicle-trails', { type: 'geojson', data })
      map.addLayer({ id: 'vehicle-trails', type: 'line', source: 'vehicle-trails', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'opacity'], 'line-width': 2 } })
      map.addLayer({ id: 'vehicle-precision', type: 'fill', source: 'vehicle-trails', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#629EBF', 'fill-opacity': 0.1, 'fill-outline-color': '#629EBF' } })
    }
  }
  const tick = () => {
    frame = 0
    if (removed || document.hidden) return
    const now = clock.at ?? Date.now()
    let moving = false
    for (const [id, track] of tracks) {
      const marker = markers.get(id)
      if (!marker) continue
      const at = motion.matches || clock.at !== undefined ? track.vehicle : bufferedPosition(track.reports, now) ?? track.vehicle
      marker.setLngLat([at.longitude, at.latitude])
      if (track.vehicle.heading != null && !positionAge(track.vehicle.recorded_at, now).stale) track.heading = shortestHeading(track.heading, track.vehicle.heading, motion.matches ? 1 : .12)
      marker.getElement().style.setProperty('--vehicle-heading', `${track.heading}deg`)
      paint(marker.getElement(), track, now)
      const last = track.reports.at(-1)
      moving ||= clock.at === undefined && !motion.matches && !!last && now < last.at + 15000
    }
    if (now - lastTrail >= 1000) { lastTrail = now; trail() }
    if (moving) frame = requestAnimationFrame(tick)
    else if (clock.at === undefined) timer = setTimeout(tick, 1000)
  }
  const wake = () => { cancelAnimationFrame(frame); clearTimeout(timer); tick() }
  document.addEventListener('visibilitychange', wake)
  motion.addEventListener('change', wake)
  map.once('remove', () => {
    removed = true
    cancelAnimationFrame(frame); clearTimeout(timer)
    document.removeEventListener('visibilitychange', wake)
    motion.removeEventListener('change', wake)
    tracks.clear(); registries.delete(map)
  })
  const result = { tracks, wake, clock }
  registries.set(map, result)
  return result
}

/** One marker per id, retained between reports; positions are replayed, never extrapolated. */
export function syncVehicleMarkers(map: maplibregl.Map, markers: Map<string, maplibregl.Marker>, vehicles: LiveVehicle[], historicalAt?: number) {
  const state = registry(map, markers)
  state.clock.at = historicalAt
  const seen = new Set<string>()
  for (const vehicle of vehicles) {
    if (!Number.isFinite(vehicle.latitude) || !Number.isFinite(vehicle.longitude)) continue
    seen.add(vehicle.id)
    const track = state.tracks.get(vehicle.id) ?? { vehicle, reports: [], heading: vehicle.heading ?? 0, status: vehicle.status }
    track.vehicle = vehicle
    const at = vehicle.recorded_at ? Date.parse(vehicle.recorded_at) : NaN
    if (historicalAt !== undefined) track.reports = []
    if (Number.isFinite(at) && (!track.reports.length || at > track.reports[track.reports.length - 1].at)) track.reports.push({ at, latitude: vehicle.latitude, longitude: vehicle.longitude, heading: vehicle.heading })
    state.tracks.set(vehicle.id, track)
    if (!markers.has(vehicle.id)) {
      const element = document.createElement('div')
      element.className = 'map-vehicle-marker'; element.setAttribute('role', 'img')
      markers.set(vehicle.id, new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, -4] }).setLngLat([vehicle.longitude, vehicle.latitude]).addTo(map))
    }
  }
  for (const [id, marker] of markers) if (!seen.has(id)) { marker.remove(); markers.delete(id); state.tracks.delete(id) }
  state.wake()
}
