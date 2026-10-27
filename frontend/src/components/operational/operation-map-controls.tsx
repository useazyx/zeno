import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { ai, units, waterSources } from '@/api/endpoints'
import type { Dispatch } from '@/api/types'
import { useResource } from '@/hooks/use-resource'
import { useRealtime } from '@/hooks/use-realtime'
import type { IncidentMapMode, IncidentPoint } from '@/components/mapa/incident-map'
import type { LiveVehicle } from '@/components/mapa/map/vehicle-markers'
import type { MapStation } from '@/components/mapa/route-map'
import { set3DEnvironment } from '@/components/mapa/map/layers'
import { PRIORITY_COLOR } from '@/components/mapa/constants/incident-palette'
import { useVehicleAlerts } from './use-vehicle-alerts'
import { ageLabel } from './operation-state'
import { useOperationClock, useReducedOperationMotion } from './use-operation-clock'
import './operational.css'

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const DEFAULT = { incidents: true, vehicles: true, trails: true, hydrants: false, coverage: false, areas: false, terrain: false, arcs: true }
type Layers = typeof DEFAULT
const labels: Record<keyof Layers, string> = { incidents: 'Ocorrências', vehicles: 'Viaturas', trails: 'Rastros', hydrants: 'Hidrantes / água', coverage: 'Cobertura', areas: 'Áreas dos quartéis', terrain: 'Relevo', arcs: 'Despachos' }
function savedLayers(): Layers {
  try {
    const raw = JSON.parse(localStorage.getItem('zeno.operational.layers') ?? '{}') as Partial<Layers>
    return Object.fromEntries(Object.entries(DEFAULT).map(([key, value]) => [key, typeof raw[key as keyof Layers] === 'boolean' ? raw[key as keyof Layers] : value])) as Layers
  } catch { return DEFAULT }
}
function source(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
  const current = map.getSource(id) as maplibregl.GeoJSONSource | undefined
  if (current) current.setData(data)
  else map.addSource(id, { type: 'geojson', data })
}

export interface OperationMapControlsProps {
  map: maplibregl.Map | null
  incidents: IncidentPoint[]
  vehicles?: LiveVehicle[]
  dispatches?: Dispatch[]
  stations?: MapStation[]
  mode: IncidentMapMode
  onModeChange: (mode: IncidentMapMode) => void
  onHeatTime: (at: number | null) => void
  wallboard?: boolean
  replayTrails?: GeoJSON.FeatureCollection
  historical?: boolean
}

export function OperationMapControls({ map, incidents, vehicles = [], dispatches = [], stations = [], mode, onModeChange, onHeatTime, wallboard, replayTrails, historical }: OperationMapControlsProps) {
  const [layers, setLayers] = useState(savedLayers)
  const [hours, setHours] = useState(24)
  const [hour, setHour] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [idle, setIdle] = useState(false)
  const now = useOperationClock()
  const reduced = useReducedOperationMotion()
  const alerts = useVehicleAlerts()
  const hydration = useResource(() => waterSources.list(), [], { enabled: layers.hydrants })
  const territories = useResource(() => units.areas(), [], { enabled: layers.areas })
  const reach = useResource(() => ai.coverage(), [], { enabled: layers.coverage })
  const callbacks = useRef({ onHeatTime })
  useEffect(() => { callbacks.current = { onHeatTime } }, [onHeatTime])
  const [end] = useState(() => Math.floor(Date.now() / 3600000) * 3600000 + 3600000)

  useEffect(() => {
    const sync = () => document.documentElement.toggleAttribute('data-op-hidden', document.hidden)
    sync(); document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  useEffect(() => {
    callbacks.current.onHeatTime(mode === 'heat' && hour !== null ? end - (hours - hour - 1) * 3600000 : null)
    if (!playing || reduced || mode !== 'heat') return
    const timer = setInterval(() => { if (!document.hidden) setHour((value) => ((value ?? -1) + 1) % hours) }, 900)
    return () => clearInterval(timer)
  }, [hour, hours, playing, mode, reduced, end])

  useEffect(() => {
    if (!map) return
    const ids = ['op-water', 'op-areas', 'op-coverage', 'op-dispatch', 'op-history']
    ids.forEach((id) => source(map, id, EMPTY))
    map.addLayer({ id: 'op-water', type: 'circle', source: 'op-water', paint: { 'circle-radius': 4, 'circle-color': ['match', ['get', 'status'], 'OPERANTE', '#376e62', 'INOPERANTE', '#964c43', '#927133'], 'circle-stroke-width': 1, 'circle-stroke-color': '#dfe6e8', 'circle-opacity-transition': { duration: reduced ? 0 : 150 } } })
    map.addLayer({ id: 'op-areas-fill', type: 'fill', source: 'op-areas', paint: { 'fill-color': '#427e89', 'fill-opacity': .04, 'fill-opacity-transition': { duration: reduced ? 0 : 150 } } })
    map.addLayer({ id: 'op-areas-outline', type: 'line', source: 'op-areas', paint: { 'line-color': '#598896', 'line-width': 1, 'line-opacity': .7 } })
    map.addLayer({ id: 'op-areas-label', type: 'symbol', source: 'op-areas', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 }, paint: { 'text-color': '#50788b', 'text-halo-color': '#dce4e4', 'text-halo-width': 1 } })
    map.addLayer({ id: 'op-coverage', type: 'fill', source: 'op-coverage', paint: { 'fill-color': '#487864', 'fill-opacity': .08, 'fill-outline-color': '#568570', 'fill-opacity-transition': { duration: reduced ? 0 : 150 } } })
    map.addLayer({ id: 'op-dispatch', type: 'line', source: 'op-dispatch', paint: { 'line-color': '#44809d', 'line-width': 1.7, 'line-opacity': .7, 'line-dasharray': [2, 3] } })
    map.addLayer({ id: 'op-history', type: 'line', source: 'op-history', paint: { 'line-color': '#3f889a', 'line-width': 3, 'line-opacity': ['coalesce', ['get', 'opacity'], .5] } })
    const hover = (event: maplibregl.MapLayerMouseEvent) => {
      const label = event.features?.[0]?.properties?.unitLabel
      if (map.getLayer('op-areas-fill')) map.setPaintProperty('op-areas-fill', 'fill-opacity', label ? ['case', ['==', ['get', 'acronym'], label], .2, .025] : .04)
    }
    const leave = () => { if (map.getLayer('op-areas-fill')) map.setPaintProperty('op-areas-fill', 'fill-opacity', .04) }
    map.on('mousemove', 'incidents-point', hover); map.on('mouseleave', 'incidents-point', leave)
    return () => {
      map.off('mousemove', 'incidents-point', hover); map.off('mouseleave', 'incidents-point', leave)
      if (!map.getStyle()) return
      for (const id of ['op-water', 'op-areas-fill', 'op-areas-outline', 'op-areas-label', 'op-coverage', 'op-dispatch', 'op-history']) if (map.getLayer(id)) map.removeLayer(id)
      ids.forEach((id) => { if (map.getSource(id)) map.removeSource(id) })
    }
  }, [map, reduced])

  useEffect(() => {
    if (!map) return
    source(map, 'op-water', { type: 'FeatureCollection', features: (hydration.data ?? []).map((p) => ({ type: 'Feature', properties: { status: p.status }, geometry: { type: 'Point', coordinates: [Number(p.longitude), Number(p.latitude)] } })) })
    source(map, 'op-areas', { type: 'FeatureCollection', features: (territories.data?.areas ?? []).flatMap((p): GeoJSON.Feature<GeoJSON.MultiPolygon>[] => p.area ? [{ type: 'Feature', properties: { acronym: p.acronym, label: `${p.acronym} · área calculada` }, geometry: p.area }] : []) })
    const outer = reach.data?.isochrones.at(-1)
    source(map, 'op-coverage', { type: 'FeatureCollection', features: outer?.geometry ? [{ type: 'Feature', properties: {}, geometry: outer.geometry as GeoJSON.MultiPolygon }] : [] })
    source(map, 'op-history', replayTrails ?? EMPTY)
  }, [map, hydration.data, territories.data, reach.data, replayTrails, reduced])

  useEffect(() => {
    if (!map) return
    const features = dispatches.filter((d) => d.status === 'DESPACHADO' || d.status === 'A_CAMINHO').flatMap((dispatch): GeoJSON.Feature<GeoJSON.LineString>[] => {
      const incident = incidents.find((i) => i.id === dispatch.occurrence_id)
      const start = dispatch.routes?.[0]?.geometry[0]
      const station = stations.find((s) => s.acronym === incident?.unitLabel)
      if (!incident || (!start && !station)) return []
      const a = start ? [start[1], start[0]] : [station!.longitude, station!.latitude]
      const b = [incident.longitude, incident.latitude]
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const coordinates = Array.from({ length: 25 }, (_, i) => { const t = i / 24, arc = Math.sin(t * Math.PI) * .15; return [a[0] + dx * t - dy * arc, a[1] + dy * t + dx * arc] })
      return [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }]
    })
    source(map, 'op-dispatch', { type: 'FeatureCollection', features })
    if (reduced || !layers.arcs || !features.length) return
    let step = 0
    const pattern = [[0, 3, 2, 0], [.5, 3, 1.5, 0], [1, 3, 1, 0], [1.5, 3, .5, 0], [2, 3, 0, 0], [0, .5, 2, 2.5], [0, 1, 2, 2], [0, 1.5, 2, 1.5], [0, 2, 2, 1], [0, 2.5, 2, .5]]
    const timer = setInterval(() => { if (!document.hidden && map.getLayer('op-dispatch')) map.setPaintProperty('op-dispatch', 'line-dasharray', pattern[step++ % pattern.length]) }, 200)
    return () => clearInterval(timer)
  }, [map, incidents, dispatches, stations, reduced, layers.arcs])

  useEffect(() => {
    if (!map) return
    const saved = () => {
      for (const [id, enabled] of Object.entries({ 'op-water': layers.hydrants, 'op-coverage': layers.coverage, 'op-areas-fill': layers.areas, 'op-areas-outline': layers.areas, 'op-areas-label': layers.areas, 'op-dispatch': layers.arcs, 'op-history': layers.trails, 'vehicle-trails': layers.trails && layers.vehicles, 'vehicle-precision': layers.vehicles })) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', enabled ? 'visible' : 'none')
      map.getContainer().querySelectorAll<HTMLElement>('.map-vehicle-marker').forEach((node) => { node.style.visibility = layers.vehicles ? 'visible' : 'hidden' })
      const pointLayers = ['incidents-spatial-clusters', 'incidents-spatial-labels', 'incidents-point-halo', 'incidents-point']
      const heatLayers = ['incidents-heat-glow', 'incidents-heat', 'incidents-heat-hotspots', 'incidents-heat-hotspot-label']
      for (const id of [...pointLayers, ...heatLayers, 'incidents-unit', 'recurrences-halo', 'recurrences-circle', 'recurrences-label']) {
        if (!map.getLayer(id)) continue
        const active = pointLayers.includes(id) ? mode === 'points' : heatLayers.includes(id) ? mode === 'heat' && (hour === null || !id.includes('hotspot')) : id === 'incidents-unit' ? mode === 'coverage' : mode === 'recurrence'
        map.setLayoutProperty(id, 'visibility', layers.incidents && active ? 'visible' : 'none')
      }
    }
    saved()
    map.on('sourcedata', saved)
    try { localStorage.setItem('zeno.operational.layers', JSON.stringify(layers)) } catch { /* Storage optional. */ }
    return () => { map.off('sourcedata', saved) }
  }, [map, layers, mode, vehicles, hour, reduced])

  useEffect(() => { if (map) set3DEnvironment(map, layers.terrain) }, [map, layers.terrain])

  useEffect(() => {
    if (!map || historical || !alerts.length) return
    const markers = alerts.flatMap((alert) => {
      if (alert.latitude == null || alert.longitude == null) return []
      const element = document.createElement('div'); element.className = 'op-vehicle-alert'; element.textContent = '!'
      element.setAttribute('role', 'img'); element.setAttribute('aria-label', `${alert.prefix}: ${alert.kind === 'parada' ? 'parada inesperada' : 'sem sinal'} desde ${new Date(alert.since).toLocaleString('pt-BR')}`)
      element.title = element.getAttribute('aria-label')!
      return [new maplibregl.Marker({ element, offset: [18, -24] }).setLngLat([Number(alert.longitude), Number(alert.latitude)]).addTo(map)]
    })
    return () => markers.forEach((marker) => marker.remove())
  }, [map, alerts, historical])

  const arrivalRef = useRef<{ markers: maplibregl.Marker[]; timers: ReturnType<typeof setTimeout>[] }>({ markers: [], timers: [] })
  useRealtime((event) => {
    if (!map || historical || event.type !== 'occurrence.created' || document.hidden) return
    const longitude = Number(event.payload.longitude), latitude = Number(event.payload.latitude)
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return
    const element = document.createElement('div')
    const dot = document.createElement('div'); dot.className = 'op-incident-arrival'
    dot.style.setProperty('--op-priority', PRIORITY_COLOR[event.payload.priority as keyof typeof PRIORITY_COLOR] ?? '#9a423c')
    element.append(dot)
    const marker = new maplibregl.Marker({ element }).setLngLat([longitude, latitude]).addTo(map)
    arrivalRef.current.markers.push(marker)
    arrivalRef.current.timers.push(setTimeout(() => { marker.remove(); arrivalRef.current.markers = arrivalRef.current.markers.filter((m) => m !== marker) }, 6000))
    if (wallboard && !reduced) {
      const before = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
      map.easeTo({ center: [longitude, latitude], zoom: Math.max(13, before.zoom), duration: 750 })
      arrivalRef.current.timers.push(setTimeout(() => { if (!document.hidden) map.easeTo({ ...before, duration: 1000 }) }, 6500))
    }
  })
  useEffect(() => {
    const active = arrivalRef.current
    return () => { active.markers.forEach((marker) => marker.remove()); active.timers.forEach(clearTimeout); active.markers = []; active.timers = [] }
  }, [map])

  useEffect(() => {
    if (!map || !wallboard || incidents.length || historical || reduced) return
    let emptySince = Date.now()
    const pause = () => { emptySince = Date.now(); setIdle(false) }
    map.on('dragstart', pause); map.on('zoomstart', pause)
    const timer = setInterval(() => {
      if (document.hidden || Date.now() - emptySince < 180000) return
      setIdle(true)
      map.jumpTo({ bearing: map.getBearing() + .15 })
    }, 100)
    return () => { clearInterval(timer); map.off('dragstart', pause); map.off('zoomstart', pause); setIdle(false) }
  }, [map, wallboard, incidents.length, historical, reduced])

  const failures = [hydration.error && layers.hydrants && `Água: ${hydration.error}`, territories.error && layers.areas && `Áreas: ${territories.error}`, reach.error && layers.coverage && `Cobertura: ${reach.error}`].filter(Boolean)
  return <>
    <details className="op-map-layers"><summary>Camadas operacionais</summary>
      {(Object.keys(DEFAULT) as (keyof Layers)[]).map((key) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={(e) => setLayers((current) => ({ ...current, [key]: e.target.checked }))} />{labels[key]}<small>{key === 'incidents' ? incidents.length : key === 'vehicles' ? vehicles.length : key === 'hydrants' ? hydration.data?.length ?? '—' : key === 'areas' ? territories.data?.areas.filter((a) => a.area).length ?? '—' : key === 'arcs' ? dispatches.filter((d) => d.status === 'A_CAMINHO' || d.status === 'DESPACHADO').length : ''}</small></label>)}
      <label><input type="checkbox" checked={mode === 'heat'} onChange={(event) => onModeChange(event.target.checked ? 'heat' : 'points')} />Mapa de calor<small>{incidents.length}</small></label>
      {layers.areas && <p>Áreas calculadas pelo menor tempo de chegada. Não são limites oficiais.{territories.loading ? ' Calculando…' : ''}</p>}
      {layers.coverage && <p>{reach.loading ? 'Calculando cobertura…' : `Alcance calculado${reach.data ? ` · ${reach.data.minutes.at(-1)} min` : ''}`}</p>}
      {layers.arcs && dispatches.length > 0 && <p>Arcos ligam origem e chamado; não representam a rota percorrida.</p>}
      {failures.map((error) => <p key={String(error)} role="status">{error}</p>)}
    </details>
    {mode === 'heat' && <div className="op-map-clock"><button type="button" disabled={reduced} onClick={() => { setPlaying((p) => !p); if (hour === null) setHour(0) }}>{playing && !reduced ? 'Pausar' : 'Reproduzir'}</button><select aria-label="Janela temporal do mapa de calor" value={hours} onChange={(e) => { setHours(Number(e.target.value)); setHour(0) }}><option value={24}>24 horas</option><option value={168}>7 dias</option></select><input aria-label="Hora do mapa de calor" type="range" min={0} max={hours - 1} value={hour ?? hours - 1} onChange={(e) => { setPlaying(false); setHour(Number(e.target.value)) }} /><time>{hour === null ? 'Todo o recorte' : new Date(end - (hours - hour) * 3600000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><button type="button" onClick={() => { setPlaying(false); setHour(null) }}>Limpar</button><small>Somente ocorrências recebidas neste recorte{reduced ? ' · movimento reduzido: use o controle de hora' : ''}</small></div>}
    {idle && <p className="op-map-clock">Em espera · nenhuma ocorrência aberta</p>}
    {!historical && alerts.length > 0 && <aside className="op-alert-list" aria-label="Alertas de guarnição recebidos nesta sessão">{alerts.map((a) => <p key={`${a.vehicle_id}:${a.kind}`}><strong>{a.prefix}</strong> · {a.kind === 'parada' ? 'Parada inesperada' : 'Sem sinal'} · {ageLabel(a.since, now)}</p>)}</aside>}
  </>
}
