import type { GeoJSONSource, Map as LibreMap, FillExtrusionLayerSpecification } from 'maplibre-gl'
import type { LngLat } from '../routes/utils'
import { circlePolygon } from './overlays'

function contains(ring: number[][], point: LngLat) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

export function setBuildingContext(map: LibreMap, destination: LngLat, color = '#C8766D') {
  const base = map.getStyle().layers.find((layer): layer is FillExtrusionLayerSpecification => layer.type === 'fill-extrusion' && layer.id === 'building-3d')
  if (!base) return
  const around: GeoJSON.Polygon = { type: 'Polygon', coordinates: [circlePolygon({ latitude: destination[1], longitude: destination[0], radius_m: 150 })] }
  if (!map.getLayer('zeno-building-context')) map.addLayer({ ...base, id: 'zeno-building-context', filter: ['within', around], paint: { ...base.paint, 'fill-extrusion-color': '#718694', 'fill-extrusion-opacity': 0.7 } })
  else map.setFilter('zeno-building-context', ['within', around])
  const buildings = map.querySourceFeatures(base.source, { sourceLayer: 'building' })
  const exact = buildings.find((feature) => feature.geometry.type === 'Polygon' && contains(feature.geometry.coordinates[0], destination) && !feature.geometry.coordinates.slice(1).some((hole) => contains(hole, destination)))
  const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: exact ? [{ type: 'Feature', geometry: exact.geometry, properties: exact.properties }] : [] }
  const source = map.getSource('zeno-building-incident')
  if (source?.type === 'geojson') (source as GeoJSONSource).setData(data)
  else map.addSource('zeno-building-incident', { type: 'geojson', data })
  if (!map.getLayer('zeno-building-incident')) map.addLayer({ id: 'zeno-building-incident', type: 'fill-extrusion', source: 'zeno-building-incident', paint: {
    'fill-extrusion-color': color, 'fill-extrusion-opacity': 0.8,
    'fill-extrusion-height': ['+', 0.3, ['coalesce', ['get', 'render_height'], 3]],
    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
  }, layout: { visibility: map.getPitch() > 0 ? 'visible' : 'none' } })
  else map.setPaintProperty('zeno-building-incident', 'fill-extrusion-color', color)
}

const lastOcclusion = new WeakMap<LibreMap, number>()
export function setBuildingOcclusion(map: LibreMap, vehicle: LngLat | null) {
  if (!map.getLayer('building-3d')) return
  const now = performance.now()
  // Filtering 3D building tiles is costly. Refresh at most once a second
  // while the truck is moving, rather than causing a tile restyle each frame.
  if (vehicle && now - (lastOcclusion.get(map) ?? -Infinity) < 950) return
  lastOcclusion.set(map, now)
  if (!vehicle) {
    map.setFilter('building-3d', null)
    if (map.getLayer('zeno-building-foreground')) map.setLayoutProperty('zeno-building-foreground', 'visibility', 'none')
    return
  }
  const canvas = map.getCanvas()
  const near = map.unproject([canvas.clientWidth / 2, canvas.clientHeight * 0.92])
  const width = 0.00025
  const corridor: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[
    [near.lng - width, near.lat], [vehicle[0] - width, vehicle[1] + width],
    [vehicle[0] + width, vehicle[1] + width], [near.lng + width, near.lat], [near.lng - width, near.lat],
  ]] }
  map.setFilter('building-3d', ['!', ['within', corridor]])
  if (!map.getLayer('zeno-building-foreground')) {
    const base = map.getStyle().layers.find((layer) => layer.id === 'building-3d') as FillExtrusionLayerSpecification
    map.addLayer({ ...base, id: 'zeno-building-foreground', filter: ['within', corridor], paint: { ...base.paint, 'fill-extrusion-opacity': 0.18 } })
  } else {
    map.setFilter('zeno-building-foreground', ['within', corridor])
    map.setLayoutProperty('zeno-building-foreground', 'visibility', 'visible')
  }
}
