import type { Map as LibreMap, GeoJSONSource } from 'maplibre-gl'
import { bearingBetween, type RouteMetrics } from '../routes/utils'
import type { RouteFeature } from '../../../api/types'

const ID = 'navigation-maneuver'
const cache = new WeakMap<LibreMap, string>()
const roadCache = new WeakMap<LibreMap, { features: string; street: string }>()

/** The arrow follows the route's actual centreline through the next manoeuvre. */
export function setNavigationManeuver(map: LibreMap, route: RouteMetrics, maneuverMeters: number | null, travelled: number) {
  const visible = maneuverMeters !== null && maneuverMeters - travelled <= 200 && maneuverMeters >= travelled - 15
  if (!map.getSource(ID)) {
    map.addSource(ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: `${ID}-case`, type: 'line', source: ID, filter: ['==', '$type', 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#25313C', 'line-width': 8 } })
    map.addLayer({ id: ID, type: 'line', source: ID, filter: ['==', '$type', 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#E4E9E9', 'line-width': 4 } })
    map.addLayer({ id: `${ID}-head`, type: 'symbol', source: ID, filter: ['==', '$type', 'Point'], layout: {
      'text-field': '▲', 'text-size': 20, 'text-rotate': ['get', 'bearing'], 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'map', 'text-allow-overlap': true,
    }, paint: { 'text-color': '#E4E9E9', 'text-halo-color': '#25313C', 'text-halo-width': 2 } })
  }
  for (const id of [ID, `${ID}-case`, `${ID}-head`]) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  if (!visible || maneuverMeters === null) return
  const key = `${maneuverMeters}:${route.totalMeters}`
  if (cache.get(map) !== key) {
    const coords = []
    for (let distance = Math.max(0, maneuverMeters - 30); distance < Math.min(route.totalMeters, maneuverMeters + 24); distance += 4) coords.push(route.pointAtDist(distance))
    coords.push(route.pointAtDist(Math.min(route.totalMeters, maneuverMeters + 24)))
    if (coords.length < 2) return
    ;(map.getSource(ID) as GeoJSONSource).setData({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
      { type: 'Feature', properties: { bearing: bearingBetween(coords[coords.length - 2], coords[coords.length - 1]) }, geometry: { type: 'Point', coordinates: coords[coords.length - 1] } },
    ] })
    cache.set(map, key)
  }
  const opacity = 0.35 + 0.65 * (1 - Math.min(200, Math.max(0, maneuverMeters - travelled)) / 200)
  map.setPaintProperty(ID, 'line-opacity', opacity)
  map.setPaintProperty(`${ID}-case`, 'line-opacity', opacity)
  map.setPaintProperty(`${ID}-head`, 'text-opacity', opacity)
}

export function clearNavigationManeuver(map: LibreMap) {
  for (const id of [ID, `${ID}-case`, `${ID}-head`]) if (map.getLayer(id)) map.removeLayer(id)
  if (map.getSource(ID)) map.removeSource(ID)
  cache.delete(map)
  roadCache.delete(map)
  for (const id of ['navigation-road-features', 'navigation-road-labels', 'navigation-street']) if (map.getLayer(id)) map.removeLayer(id)
  for (const id of ['navigation-road-features', 'navigation-street']) if (map.getSource(id)) map.removeSource(id)
}

export function setRoadContext(map: LibreMap, route: RouteMetrics, features: RouteFeature[], travelled: number, maneuverMeters: number | null) {
  const previous = roadCache.get(map)
  const nearby = features.filter((feature) => ['traffic_signals', 'crossing', 'stop'].includes(feature.type)
    && maneuverMeters !== null && Math.abs((route.cumulative[feature.geometry_index] ?? -Infinity) - maneuverMeters) <= 100
    && (route.cumulative[feature.geometry_index] ?? -Infinity) >= travelled - 20)
  const labels: Record<string, string> = { traffic_signals: 'Semáforo', crossing: 'Faixa de pedestres', stop: 'Pare' }
  const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: nearby.map((feature) => ({
    type: 'Feature', properties: { label: labels[feature.type] }, geometry: { type: 'Point', coordinates: [feature.location[1], feature.location[0]] },
  })) }
  const featuresKey = JSON.stringify(data)
  if (!map.getSource('navigation-road-features')) {
    map.addSource('navigation-road-features', { type: 'geojson', data })
    map.addLayer({ id: 'navigation-road-features', type: 'circle', source: 'navigation-road-features', paint: { 'circle-radius': 5, 'circle-color': '#CFB074', 'circle-stroke-color': '#27333C', 'circle-stroke-width': 2 } })
    map.addLayer({ id: 'navigation-road-labels', type: 'symbol', source: 'navigation-road-features', layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.2] }, paint: { 'text-color': '#E8E6DC', 'text-halo-color': '#25313C', 'text-halo-width': 2 } })
  } else if (previous?.features !== featuresKey) (map.getSource('navigation-road-features') as GeoJSONSource).setData(data)
  const current = route.segments.find((segment) => route.cumulative[segment.end] > travelled)
  // Move the street label in 50 m windows, not on every HUD readout.
  const labelDistance = Math.floor(travelled / 50) * 50
  const street: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: current?.street ? [{ type: 'Feature', properties: { street: current.street },
    geometry: { type: 'LineString', coordinates: [route.pointAtDist(labelDistance + 35), route.pointAtDist(Math.min(route.totalMeters, labelDistance + 100))] } }] : [] }
  const streetKey = JSON.stringify(street)
  if (!map.getSource('navigation-street')) {
    map.addSource('navigation-street', { type: 'geojson', data: street })
    map.addLayer({ id: 'navigation-street', type: 'symbol', source: 'navigation-street', layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'street'], 'text-size': 13, 'text-pitch-alignment': 'map' }, paint: { 'text-color': '#E6ECED', 'text-halo-color': '#25313C', 'text-halo-width': 2 } })
  } else if (previous?.street !== streetKey) (map.getSource('navigation-street') as GeoJSONSource).setData(street)
  roadCache.set(map, { features: featuresKey, street: streetKey })
}

export function terrainGradeAlert(map: LibreMap, route: RouteMetrics, travelled: number): { text: string; distance: number } | null {
  const terrain = map.getTerrain()
  if (!terrain || !map.isSourceLoaded(terrain.source)) return null
  const exaggeration = typeof terrain.exaggeration === 'number' && terrain.exaggeration > 0 ? terrain.exaggeration : 1
  for (let distance = 30; distance <= 300 && travelled + distance + 30 <= route.totalMeters; distance += 30) {
    const from = map.queryTerrainElevation(route.pointAtDist(travelled + distance))
    const to = map.queryTerrainElevation(route.pointAtDist(travelled + distance + 30))
    if (from === null || to === null) continue
    const grade = (to - from) / exaggeration / 30 * 100
    if (Math.abs(grade) >= 10) return { text: `${grade > 0 ? 'Subida' : 'Descida'} de ${Math.round(Math.abs(grade))}%`, distance }
  }
  return null
}
