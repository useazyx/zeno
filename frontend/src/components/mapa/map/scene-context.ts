import maplibregl from 'maplibre-gl'
import type { CustomLayerInterface, CustomRenderMethodInput, GeoJSONSource } from 'maplibre-gl'
import * as THREE from 'three'
import type { OccurrencePriority, WaterSource } from '../../../api/types'
import type { LngLat } from '../routes/utils'
import { circlePolygon } from './overlays'
import { nearbyWaterSources } from '../routes/context-policy'
import { PRIORITY_COLOR } from '../constants/incident-palette'
import { TAUBATE_LANDMARKS } from '../constants/landmarks'

interface Station { id: string; acronym: string; latitude: number; longitude: number }
export interface SceneContext { destination: LngLat | null; priority?: OccurrencePriority; stations: Station[]; selectedStationId?: string | null; water: WaterSource[]; isolation: boolean; active: boolean }
const contexts = new WeakMap<maplibregl.Map, ContextLayer>()
const SOURCE = 'zeno-scene-context'
const ID = 'zeno-context-objects'
const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] })

class ContextLayer implements CustomLayerInterface {
  readonly id = ID
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const
  private map!: maplibregl.Map
  private renderer!: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.Camera()
  private objects = new THREE.Group()
  private origin: LngLat = [-45.5551, -23.0264]
  private rings: THREE.Mesh[] = []
  private gates = new Map<string, THREE.Mesh>()
  private departure: { id: string; seconds: number } | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  private motion!: MediaQueryList
  private is3d = false
  private revision = ''
  private options: SceneContext = { destination: null, stations: [], water: [], isolation: false, active: false }
  private repaint = () => { if (!document.hidden) this.map.triggerRepaint() }
  private updateMode = () => { const next = this.map.getPitch() > 5; if (next !== this.is3d) { this.is3d = next; this.rebuild() } }
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl })
    this.renderer.autoClear = false
    this.scene.add(new THREE.HemisphereLight(0xe8eff3, 0x263743, 2), this.objects)
    const light = new THREE.DirectionalLight(0xf1e8d5, 2); light.position.set(-100, 100, 200); this.scene.add(light)
    this.is3d = map.getPitch() > 5
    map.on('pitchend', this.updateMode)
    map.on('idle', this.refreshTerrain)
    document.addEventListener('visibilitychange', this.repaint)
    this.motion.addEventListener('change', this.repaint)
    // No second RAF; idle incident rings repaint the map at only 10 Hz.
    this.timer = setInterval(() => {
      if (this.is3d && !document.hidden && !this.motion.matches && !this.options.active && ['ALTA', 'CRITICA'].includes(this.options.priority ?? '')) map.triggerRepaint()
    }, 100)
  }
  private refreshTerrain = () => {
    const key = `${this.map.getZoom() >= 15}:${this.map.queryTerrainElevation(this.origin) ?? 0}`
    if (key !== this.revision) { this.revision = key; this.rebuild() }
  }
  update(options: SceneContext) { this.options = options; this.rebuild() }
  depart(id: string | null | undefined, seconds: number) { this.departure = id ? { id, seconds } : null }
  private releaseObjects() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
    this.objects.traverse((object) => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach((mat) => materials.add(mat)) } })
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose())
    this.objects.clear(); this.rings = []; this.gates.clear()
  }
  private rebuild() {
    this.releaseObjects()
    this.origin = this.options.destination ?? [this.options.stations[0]?.longitude ?? -45.5551, this.options.stations[0]?.latitude ?? -23.0264]
    const originElevation = this.map.queryTerrainElevation(this.origin) ?? 0
    const place = (coords: LngLat) => new THREE.Vector3((coords[0] - this.origin[0]) * 111320 * Math.cos(this.origin[1] * Math.PI / 180), (coords[1] - this.origin[1]) * 111320, (this.map.queryTerrainElevation(coords) ?? originElevation) - originElevation)
    const data = empty()
    const point = (coords: LngLat, label: string, kind: string) => data.features.push({ type: 'Feature', properties: { label, kind }, geometry: { type: 'Point', coordinates: coords } })
    const stone = new THREE.MeshStandardMaterial({ color: 0x526570, roughness: .8 })
    const door = new THREE.MeshStandardMaterial({ color: 0x853e42, roughness: .7 })
    const box = new THREE.BoxGeometry(1, 1, 1)
    for (const station of this.options.stations) {
      const p = place([station.longitude, station.latitude])
      const body = new THREE.Mesh(box, stone); body.scale.set(17, 12, 6); body.position.copy(p).add(new THREE.Vector3(0, 0, 3)); this.objects.add(body)
      const gate = new THREE.Mesh(box, door); gate.scale.set(8, .25, 4.5); gate.position.copy(p).add(new THREE.Vector3(0, 6.15, 2.25)); gate.userData.baseZ = gate.position.z; this.objects.add(gate); this.gates.set(station.id, gate)
      point([station.longitude, station.latitude], station.acronym, 'station')
    }
    if (!this.options.stations.length) { box.dispose(); stone.dispose(); door.dispose() }
    if (this.options.destination) {
      const color = PRIORITY_COLOR[this.options.priority ?? 'MEDIA']
      const column = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 35, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .4, depthWrite: false }))
      column.position.z = 17.5; this.objects.add(column)
      for (let index = 0; index < 2; index++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(11, 12, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .45, side: THREE.DoubleSide, depthWrite: false }))
        ring.position.z = .2; this.rings.push(ring); this.objects.add(ring)
      }
      if (this.options.isolation) for (const radius of [100, 300, 500]) {
        const ring = circlePolygon({ latitude: this.origin[1], longitude: this.origin[0], radius_m: radius })
        data.features.push({ type: 'Feature', properties: { kind: 'isolation' }, geometry: { type: 'LineString', coordinates: ring } })
        point(ring[12], `${radius} m`, 'isolation')
      }
      const water = nearbyWaterSources(this.options.water, this.options.destination)
      if (water.length && this.map.getZoom() >= 15) {
        const positions = water.map((source) => place([Number(source.longitude), Number(source.latitude)]))
        const red = new THREE.MeshStandardMaterial({ color: 0xa83f3b }), gray = new THREE.Color(0x6c7479), operational = new THREE.Color(0xa83f3b)
        for (const [radius, height, elevation, rotation] of [[.4, 1.3, .75, Math.PI / 2], [.22, 1.4, 1, 0]]) {
          const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, radius, height, 8).rotateX(rotation), red, water.length)
          positions.forEach((position, index) => { mesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(position.x, position.y, position.z + elevation)); mesh.setColorAt(index, water[index].status === 'OPERANTE' ? operational : gray) }); mesh.instanceMatrix.needsUpdate = true; this.objects.add(mesh)
        }
        const closest = water[0]
        point([Number(closest.longitude), Number(closest.latitude)], `${closest.code} ? ${Math.round(closest.distance)} m em linha reta`, 'water')
        const halo = new THREE.Mesh(new THREE.RingGeometry(2, 2.5, 32), new THREE.MeshBasicMaterial({ color: 0x68b9e8, side: THREE.DoubleSide })); halo.position.copy(positions[0]); halo.position.z += .15; this.objects.add(halo)
      }
    }
    for (const landmark of TAUBATE_LANDMARKS) point([...landmark.point], `${landmark.symbol} ${landmark.name}`, 'landmark')
    const source = this.map.getSource(SOURCE) as GeoJSONSource | undefined
    if (source) source.setData(data)
    else {
      this.map.addSource(SOURCE, { type: 'geojson', data })
      this.map.addLayer({ id: SOURCE, type: 'symbol', source: SOURCE, filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, -1.3], 'text-allow-overlap': true }, paint: { 'text-color': '#dce4e5', 'text-halo-color': '#283b48', 'text-halo-width': 2 } })
      this.map.addLayer({ id: `${SOURCE}-perimeter`, type: 'line', source: SOURCE, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#bac8c9', 'line-width': 1.2, 'line-dasharray': [4, 3], 'line-opacity': .65 } })
    }
    this.map.setLayoutProperty(SOURCE, 'visibility', this.is3d ? 'visible' : 'none')
    this.map.setLayoutProperty(`${SOURCE}-perimeter`, 'visibility', this.options.isolation ? 'visible' : 'none')
    this.map.triggerRepaint()
  }
  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!this.is3d || document.hidden) return
    const time = performance.now() / 1000, reduced = this.motion.matches
    const animate = !reduced && ['ALTA', 'CRITICA'].includes(this.options.priority ?? '')
    this.rings.forEach((ring, index) => { const phase = animate ? (time / (this.options.priority === 'CRITICA' ? 2 : 3) + index / 2) % 1 : .25 + index * .35; ring.scale.setScalar(1 + phase * 2); (ring.material as THREE.MeshBasicMaterial).opacity = animate ? .4 * (1 - phase) : .3 })
    for (const [id, gate] of this.gates) gate.position.z = gate.userData.baseZ + (this.departure?.id === id ? 4 * Math.min(1, this.departure.seconds / .8) : 0)
    const origin = maplibregl.MercatorCoordinate.fromLngLat(this.origin, this.map.queryTerrainElevation(this.origin) ?? 0)
    const scale = origin.meterInMercatorCoordinateUnits()
    this.camera.projectionMatrix.fromArray(options.defaultProjectionData.mainMatrix).multiply(new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(scale, -scale, scale)))
    this.renderer.resetState(); this.renderer.render(this.scene, this.camera); this.renderer.resetState()
  }
  onRemove() { clearInterval(this.timer); document.removeEventListener('visibilitychange', this.repaint); this.motion.removeEventListener('change', this.repaint); this.map.off('pitchend', this.updateMode); this.map.off('idle', this.refreshTerrain); this.releaseObjects(); this.renderer.dispose(); this.scene.clear(); contexts.delete(this.map) }
}
export function setSceneContext(map: maplibregl.Map, options: SceneContext) {
  let layer = contexts.get(map)
  if (!layer) { layer = new ContextLayer(); contexts.set(map, layer); map.addLayer(layer) }
  layer.update(options)
}
export function setStationDeparture(map: maplibregl.Map, id: string | null | undefined, seconds: number) { contexts.get(map)?.depart(id, seconds) }
