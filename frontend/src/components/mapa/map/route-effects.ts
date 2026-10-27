import type { Map as LibreMap, ExpressionSpecification } from 'maplibre-gl'
import { COMPARISON_COLOR, CRITICAL_COLOR, ROUTE_COLOR } from '../constants/constants'

type Kind = 'ai' | 'standard' | 'critical'
const routes = {
  ai: { color: ROUTE_COLOR, layers: ['line-2d', 'line-3d', 'glow-2d', 'glow-3d', 'casing-3d'] },
  standard: { color: COMPARISON_COLOR, layers: ['comparison-2d', 'comparison-3d', 'comparison-glow-2d', 'comparison-glow-3d', 'comparison-casing-2d', 'comparison-casing-3d'] },
  critical: { color: CRITICAL_COLOR, layers: ['critical-2d', 'critical-3d', 'critical-glow-2d', 'critical-glow-3d', 'critical-casing-2d', 'critical-casing-3d'] },
}
const states = new WeakMap<LibreMap, { progress: Record<Kind, number>; draw: number; last: number; stop: () => void }>()

export function routeGradient(color: string, progress: number, reveal = 1, highlight?: number): ExpressionSpecification {
  const draw = Math.max(0.00001, Math.min(1, reveal))
  const passed = Math.max(0, Math.min(draw - 0.00001, progress))
  const expression: unknown[] = ['step', ['line-progress'], passed > 0 ? 'rgba(86,103,113,0.35)' : color]
  if (passed > 0) expression.push(passed, color)
  if (highlight !== undefined && highlight > passed + 0.001 && highlight + 0.035 < draw) expression.push(highlight, '#DAE6EA', highlight + 0.035, color)
  if (draw < 1) expression.push(draw, 'rgba(0,0,0,0)')
  // MapLibre requires at least one stop for a step expression. Without it,
  // every follow frame logged a style error for every route layer.
  if (expression.length === 3) expression.push(1, color)
  return expression as ExpressionSpecification
}

function paint(map: LibreMap, highlight?: number) {
  const state = states.get(map)
  if (!state) return
  for (const kind of Object.keys(routes) as Kind[]) {
    const route = routes[kind]
    const gradient = routeGradient(route.color, state.progress[kind], state.draw, highlight)
    for (const layer of route.layers) if (map.getLayer(layer)) map.setPaintProperty(layer, 'line-gradient', gradient)
  }
  for (const id of ['dash-2d', 'dash-3d']) if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', state.draw < 1 || state.progress.ai > 0 ? 0 : 0.25)
}

export function setRouteProgress(map: LibreMap, kind: Kind, fraction: number) {
  const state = states.get(map)
  if (!state) return
  state.progress[kind] = Math.max(0, Math.min(1, fraction))
  const now = performance.now()
  // A line-gradient update invalidates every route layer. Real-time movement
  // is handled by the vehicle shader; the route progress only needs ~3 Hz.
  if (now - state.last < 600 && fraction < 1) return
  state.last = now
  paint(map)
}

/** The map's playback owns its only RAF; these paint changes are capped at 20 Hz. */
export function drawRoute(map: LibreMap) {
  if (typeof document === 'undefined') return
  states.get(map)?.stop()
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const started = performance.now()
  const state = { progress: { ai: 0, standard: 0, critical: 0 }, draw: motion.matches ? 1 : 0, last: 0, stop: () => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', visibility)
    motion.removeEventListener('change', visibility)
    map.off('remove', state.stop)
  } }
  const tick = () => {
    if (stopped || document.hidden || motion.matches) return
    const elapsed = performance.now() - started
    state.draw = Math.min(1, elapsed / 900)
    const phase = (elapsed - 900) % 4800
    // Avoid decorative pulsing/redrawing of every route layer while driving.
    if (state.draw < 1 || state.progress.ai <= 0) paint(map, state.draw === 1 && phase < 700 ? phase / 700 : undefined)
    timer = setTimeout(tick, state.draw < 1 || phase < 700 ? 50 : Math.max(50, 4800 - phase))
  }
  const visibility = () => {
    clearTimeout(timer)
    state.draw = 1
    paint(map)
    if (!document.hidden && !motion.matches) tick()
  }
  states.set(map, state)
  document.addEventListener('visibilitychange', visibility)
  motion.addEventListener('change', visibility)
  map.once('remove', state.stop)
  if (motion.matches || document.hidden) { state.draw = 1; paint(map) } else tick()
}
