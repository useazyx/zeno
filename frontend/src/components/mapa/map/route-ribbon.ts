import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl'
import type { LngLat } from '../routes/utils'
import { COMPARISON_COLOR, CRITICAL_COLOR, ROUTE_COLOR } from '../constants/constants'

export function ribbonFeatures(paths: LngLat[][]): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const colors = [ROUTE_COLOR, COMPARISON_COLOR, CRITICAL_COLOR]
  const shared = new Set(paths[1]?.slice(1).map((point, index) => `${paths[1][index]}>${point}`))
  return { type: 'FeatureCollection', features: paths.flatMap((path, kind) => path.slice(1).flatMap((end, index) => {
    const start = path[index]
    const lon = 111320 * Math.cos(start[1] * Math.PI / 180)
    const dx = (end[0] - start[0]) * lon, dy = (end[1] - start[1]) * 111320
    const meters = Math.hypot(dx, dy)
    if (meters < 0.01) return []
    const normal = [-dy / meters, dx / meters]
    const offset = kind === 0 ? 0 : kind === 1 ? -2.4 : 2.4
    const corner = (point: LngLat, side: number) => [point[0] + normal[0] * (offset + side) / lon, point[1] + normal[1] * (offset + side) / 111320]
    const ring = [corner(start, -0.9), corner(end, -0.9), corner(end, 0.9), corner(start, 0.9), corner(start, -0.9)]
    return [{ type: 'Feature' as const, properties: { color: colors[kind], height: shared.has(`${start}>${end}`) ? 1.1 : 1.8 }, geometry: { type: 'Polygon' as const, coordinates: [ring] } }]
  })) }
}

export function setRouteRibbons(map: LibreMap, paths: LngLat[][]) {
  const data = ribbonFeatures(paths)
  const source = map.getSource('zeno-route-ribbons')
  if (source?.type === 'geojson') (source as GeoJSONSource).setData(data)
  else map.addSource('zeno-route-ribbons', { type: 'geojson', data })
  if (!map.getLayer('zeno-route-ribbons')) map.addLayer({ id: 'zeno-route-ribbons', type: 'fill-extrusion', source: 'zeno-route-ribbons', layout: { visibility: 'none' },
    paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': 0.3, 'fill-extrusion-opacity': 0.4 } })
}
