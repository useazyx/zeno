import type { Map as LibreMap, StyleSpecification } from 'maplibre-gl'
import { mapStyle } from '../constants/constants'

const TERRAIN_HEIGHT = 1.3
const TRANSITION_MS = 700
const FRAME_MS = 50
const states = new WeakMap<LibreMap, { visible: boolean; factor: number; timer: ReturnType<typeof setTimeout> | null }>()
const playback = new WeakSet<LibreMap>()

/** Keep DEM off for the entire replay, including pending style/terrain fades. */
export function setEnvironmentPlayback(map: LibreMap, active: boolean) {
  if (active) playback.add(map)
  else playback.delete(map)
  const state = states.get(map)
  if (map.getSource('dem')) map.setTerrain(!active && state?.visible ? { source: 'dem', exaggeration: TERRAIN_HEIGHT * state.factor } : null)
}

/** Solar position from Julian date; angles are degrees clockwise from true north. */
export function sunPosition(date: Date, latitude = -23.0264, longitude = -45.5551) {
  const rad = Math.PI / 180
  const days = date.getTime() / 86400000 - 10957.5
  const mean = (357.5291 + 0.98560028 * days) * rad
  const longitudeSun = mean + (1.9148 * Math.sin(mean) + 0.02 * Math.sin(2 * mean) + 0.0003 * Math.sin(3 * mean)) * rad + 102.9372 * rad + Math.PI
  const declination = Math.asin(Math.sin(longitudeSun) * Math.sin(23.4397 * rad))
  const rightAscension = Math.atan2(Math.sin(longitudeSun) * Math.cos(23.4397 * rad), Math.cos(longitudeSun))
  const hourAngle = (280.16 + 360.9856235 * days + longitude) * rad - rightAscension
  const elevation = Math.asin(Math.sin(latitude * rad) * Math.sin(declination) + Math.cos(latitude * rad) * Math.cos(declination) * Math.cos(hourAngle)) / rad
  const azimuth = (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(latitude * rad) - Math.tan(declination) * Math.cos(latitude * rad)) / rad + 180 + 360) % 360
  return { azimuth, elevation, night: elevation < -6 }
}

export function preserveOperationalStyle(previous: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  if (!previous) return next
  const baseIds = new Set(next.layers.map((layer) => layer.id))
  const layers = previous.layers.filter((layer) => !baseIds.has(layer.id))
  return { ...next, sources: { ...previous.sources, ...next.sources }, layers: [...next.layers, ...layers], terrain: previous.terrain, light: previous.light, sky: previous.sky }
}

function lighting(map: LibreMap, visible: boolean) {
  const light = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light'
  const solar = sunPosition(new Date())
  map.setLight({ anchor: 'map', color: solar.night ? '#B8CBDF' : '#F1E7D2', intensity: solar.night ? 0.22 : 0.48,
    position: [1.5, solar.azimuth, Math.max(5, Math.min(85, 90 - solar.elevation))] })
  map.setSky(visible ? { 'sky-color': light ? '#9AAFB9' : '#182B3A', 'horizon-color': light ? '#D4DCDA' : '#405565', 'fog-color': light ? '#CAD4D4' : '#263A48',
    'fog-ground-blend': 0.16, 'horizon-fog-blend': 0.36, 'sky-horizon-blend': 0.62, 'atmosphere-blend': 0.7 } : { 'atmosphere-blend': 0 })
}

function paintElevation(map: LibreMap, factor: number, visible: boolean) {
  if (map.getSource('dem')) map.setTerrain(visible && !playback.has(map) ? { source: 'dem', exaggeration: TERRAIN_HEIGHT * factor } : null)
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'fill-extrusion' || !layer.id.includes('building')) continue
    map.setPaintProperty(layer.id, 'fill-extrusion-height', ['*', factor, ['coalesce', ['get', 'render_height'], 3]])
  }
}

/** No additional RAF: short, capped paint updates only while terrain is changing. */
export function configureEnvironment(map: LibreMap, visible: boolean) {
  lighting(map, visible)
  if (typeof document === 'undefined') return
  let state = states.get(map)
  if (!state) {
    state = { visible: false, factor: 0, timer: null }
    states.set(map, state)
    let currentStyle = mapStyle()
    let removed = false
    let fadeTimer: ReturnType<typeof setTimeout> | undefined
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const canvas = map.getCanvas()
    const themeChanged = () => {
      const next = mapStyle()
      if (next === currentStyle || removed) return
      currentStyle = next
      canvas.style.transition = motion.matches ? '' : 'opacity 180ms ease'
      canvas.style.opacity = motion.matches ? '1' : '.85'
      map.setStyle(next, { transformStyle: preserveOperationalStyle })
      map.once('styledata', () => {
        if (removed) return
        lighting(map, state!.visible)
        paintElevation(map, state!.factor, state!.visible)
        for (const layer of map.getStyle().layers) {
          if (layer.type === 'fill-extrusion' && layer.id.includes('building')) map.setLayoutProperty(layer.id, 'visibility', state!.visible ? 'visible' : 'none')
        }
        clearTimeout(fadeTimer)
        fadeTimer = setTimeout(() => { canvas.style.opacity = '1' }, 100)
      })
    }
    const observer = new MutationObserver(themeChanged)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const freeze = () => {
      if (!document.hidden && !motion.matches) return
      if (state!.timer) clearTimeout(state!.timer)
      state!.timer = null
      state!.factor = state!.visible ? 1 : 0
      paintElevation(map, state!.factor, state!.visible)
    }
    document.addEventListener('visibilitychange', freeze)
    motion.addEventListener('change', freeze)
    const clock = setInterval(() => {
      if (document.hidden) return
      lighting(map, state!.visible)
      let fixed = false
      try { fixed = !!localStorage.getItem('zeno.theme') } catch { /* Storage optional. */ }
      if (!fixed) document.documentElement.dataset.theme = sunPosition(new Date()).night ? 'dark' : 'light'
    }, 60000)
    map.once('remove', () => {
      removed = true
      observer.disconnect()
      document.removeEventListener('visibilitychange', freeze)
      motion.removeEventListener('change', freeze)
      clearInterval(clock)
      clearTimeout(fadeTimer)
      if (state!.timer) clearTimeout(state!.timer)
      states.delete(map)
    })
  }
  const changed = state.visible !== visible
  state.visible = visible
  if (state.timer) clearTimeout(state.timer)
  state.timer = null
  const animate = changed && visible && !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!animate) {
    state.factor = visible ? 1 : 0
    paintElevation(map, state.factor, visible)
    return
  }
  const started = performance.now()
  const update = () => {
    state!.factor = Math.min(1, (performance.now() - started) / TRANSITION_MS)
    paintElevation(map, state!.factor, true)
    state!.timer = state!.factor < 1 ? setTimeout(update, FRAME_MS) : null
  }
  update()
}
