import maplibregl from 'maplibre-gl'
import { COMPARISON_COLOR, CRITICAL_COLOR, ROUTE_COLOR, mapStyle } from '../constants/constants'
import { bearingBetween, type RouteMetrics } from '../routes/utils'
import { comparisonProgress, comparisonResult, comparisonStandings, nextCameraLayout, routesAreIdentical } from '../routes/comparison-policy'
import type { OccurrenceNature, RouteStep } from '../../../api/types'
import { ARRIVAL_DURATION_SECONDS } from './arrival-scenes'
import { setStationDeparture } from './scene-context'
import { setEnvironmentPlayback } from './environment'
import { readSimulationCamera, saveSimulationCamera, type SimulationCamera } from '../routes/navigation-policy'
import { setRouteProgress } from './route-effects'
import { addRouteLayers, set3DEnvironment, setBuildingLayersVisibility, setLayerVisibility } from './layers'
import {
  addComparisonAiVehicleLayer, addComparisonVehicleLayer, addCriticalVehicleLayer,
  moveComparisonAiVehicle, moveComparisonVehicle, moveCriticalVehicle,
  showComparisonAiVehicle, showComparisonVehicle, showCriticalVehicle,
  setArrivalFrame, setVehicleGhost,
} from './markers'

interface Participant { metrics: RouteMetrics; seconds: number; kind: 'ai' | 'standard' | 'critical'; sharedWithStandard?: number; steps?: RouteStep[] | null }
const clockLabel = (seconds: number) => `${Math.floor(Math.max(0, Math.ceil(seconds)) / 60)}:${String(Math.max(0, Math.ceil(seconds)) % 60).padStart(2, '0')}`
const styles = {
  ai: { label: 'IA', color: ROUTE_COLOR, add: addComparisonAiVehicleLayer, move: moveComparisonAiVehicle, show: showComparisonAiVehicle },
  standard: { label: 'Padrão', color: COMPARISON_COLOR, add: addComparisonVehicleLayer, move: moveComparisonVehicle, show: showComparisonVehicle },
  critical: { label: 'Modo crítico · sirene', color: CRITICAL_COLOR, add: addCriticalVehicleLayer, move: moveCriticalVehicle, show: showCriticalVehicle },
}

export function startComparisonPlayback(
  map: maplibregl.Map,
  wrap: HTMLElement,
  participants: Participant[],
  onFinish: () => void,
  arrival?: { nature: OccurrenceNature; enabled: boolean; stationId?: string | null },
): () => void {
  const ai = participants.find((participant) => participant.kind === 'ai')
  const standard = participants.find((participant) => participant.kind === 'standard')
  const identical = !!ai && !!standard && routesAreIdentical(ai.metrics, standard.metrics, ai.sharedWithStandard)
  const result = ai && standard ? comparisonResult(ai.metrics, standard.metrics, ai.sharedWithStandard) : null
  // Identical legacy routes may have independently rounded ETA/geometry. Use
  // one timeline and one centreline; lateral lanes distinguish the two trucks.
  if (identical && ai && standard) {
    const canonical = standard.metrics.timedBySegments ? standard.metrics : ai.metrics
    participants = participants.map((participant) => participant.kind === 'critical' ? participant
      : { ...participant, metrics: canonical, seconds: canonical.totalSeconds })
  }
  let frame = 0
  let stopped = false
  let elapsed = 0
  let previous: number | null = null
  let split = false
  let completed = false
  let firstFinishShown = false
  let finishHoldMs = 0
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  let reducedMotion = motionPreference.matches
  let cameraMode = readSimulationCamera()
  let paused = reducedMotion || cameraMode === 'orbit'
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  let speed = 1
  let lastLabelUpdate = -Infinity
  let lastLayoutChange = -Infinity
  let renderedFrames = 0
  let sampleStarted = performance.now()
  let slowSamples = 0
  let permitSplit = true
  const originalPixelRatio = map.getPixelRatio()
  setEnvironmentPlayback(map, true)
  // Avoid an initial high-resolution WebGL burst on integrated graphics.
  if (originalPixelRatio > 1.5) map.setPixelRatio(1.5)
  const duration = Math.max(45_000, Math.min(90_000, Math.max(...participants.map((p) => p.metrics.followDurationMs)) * 1.65))
  const bearings = participants.map((p) => bearingBetween(p.metrics.coords[0], p.metrics.coords[1]))
  const arrivalElapsed = participants.map(() => 0)
  const sceneVariant = { ai: 'comparisonAi', standard: 'comparison', critical: 'critical' } as const
  setVehicleGhost(map, false)
  const seconds = participants.map((p) => p.metrics.totalSeconds)
  const routeMetrics = participants.map((p) => p.metrics)
  const totalSeconds = Math.max(...seconds, 1)
  const firstArrivalMs = Math.min(...seconds) / totalSeconds * duration
  const arrivalOrder = [...participants].sort((a, b) => a.metrics.totalSeconds - b.metrics.totalSeconds)
  const firstGap = arrivalOrder.length > 1 ? arrivalOrder[1].metrics.totalSeconds - arrivalOrder[0].metrics.totalSeconds : 0
  const arrivalCopy = firstGap < 1 ? 'Chegada simultânea das primeiras viaturas' : `${styles[arrivalOrder[0].kind].label} no destino · ${clockLabel(firstGap)} antes da próxima`
  const auxiliaries: { map: maplibregl.Map; ready: boolean; element: HTMLElement }[] = []
  const auxiliaryRoot = document.createElement('div')
  auxiliaryRoot.className = 'comparison-panes'
  wrap.append(auxiliaryRoot)
  wrap.style.setProperty('--comparison-count', String(participants.length))

  const hud = document.createElement('div')
  hud.className = 'comparison-hud'
  hud.setAttribute('role', 'region')
  hud.setAttribute('aria-label', 'Simulação comparativa de deslocamento')
  const heading = document.createElement('div')
  heading.className = 'comparison-heading'
  const headingCopy = document.createElement('div')
  headingCopy.className = 'comparison-heading-copy'
  const kicker = document.createElement('span')
  kicker.className = 'comparison-kicker'
  kicker.textContent = 'SIMULAÇÃO DE DESLOCAMENTO'
  const status = document.createElement('span')
  status.className = 'comparison-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  headingCopy.append(kicker, status)
  const actions = document.createElement('div')
  actions.className = 'comparison-actions'
  const performanceLabel = document.createElement('small')
  performanceLabel.className = 'comparison-fps'
  performanceLabel.title = 'Quadros renderizados por segundo no mapa principal'
  const measureRender = () => { renderedFrames++ }
  map.on('render', measureRender)
  const pause = document.createElement('button')
  pause.type = 'button'
  const updateStatus = () => {
    const camera = reducedMotion ? 'Câmera estável' : split ? 'Câmeras individuais' : 'Câmera conjunta'
    status.textContent = completed ? 'Todas as viaturas no destino' : `${camera}${paused ? ' · Pausada' : ''}`
    pause.textContent = paused ? 'Continuar' : 'Pausar'
    pause.setAttribute('aria-label', paused ? 'Continuar simulação' : 'Pausar simulação')
    pause.setAttribute('aria-pressed', String(paused))
  }
  pause.onclick = () => {
    paused = !paused
    if (!paused && cameraMode === 'orbit') { cameraMode = 'chase'; camera.value = cameraMode; saveSimulationCamera(cameraMode) }
    updateStatus()
    syncPlayback()
  }
  const rate = document.createElement('button')
  rate.type = 'button'
  rate.textContent = '1×'
  rate.setAttribute('aria-label', 'Velocidade da simulação: 1 vez')
  rate.onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; rate.textContent = `${speed}×`; rate.setAttribute('aria-label', `Velocidade da simulação: ${speed} vezes`) }
  const stopButton = document.createElement('button')
  stopButton.type = 'button'
  stopButton.textContent = 'Encerrar'
  stopButton.setAttribute('aria-label', 'Encerrar simulação e liberar a câmera')
  const endPlayback = () => { cleanup(); onFinish() }
  stopButton.onclick = endPlayback
  const camera = document.createElement('select')
  camera.className = 'simulation-camera'
  camera.setAttribute('aria-label', 'Câmera da comparação')
  for (const [value, label] of [['chase', '1 · Perseguição'], ['top', '2 · De cima'], ['orbit', '3 · Órbita parada']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; camera.append(option)
  }
  camera.value = cameraMode
  const chooseCamera = (value: SimulationCamera) => {
    cameraMode = value; camera.value = value; saveSimulationCamera(value)
    if (value === 'orbit') paused = true
    seek(elapsed / duration * totalSeconds)
  }
  camera.onchange = () => chooseCamera(camera.value as SimulationCamera)
  actions.append(performanceLabel, camera, pause, rate, stopButton)
  heading.append(headingCopy, actions)
  hud.append(heading)
  const rows = document.createElement('div')
  rows.className = 'comparison-telemetry comparison-tower'
  rows.setAttribute('aria-label', 'Torre de tempos da comparação')
  const values = participants.map((participant, index) => {
    const style = styles[participant.kind]
    style.add(map, participant.metrics.coords[0])
    style.move(map, participant.metrics.coords[0], bearings[index])
    style.show(map, true)
    setRouteProgress(map, participant.kind, 0)
    const row = document.createElement('div')
    row.className = 'comparison-participant'
    row.style.setProperty('--route-color', style.color)
    const label = document.createElement('strong')
    label.textContent = style.label
    const rank = document.createElement('b')
    rank.className = 'comparison-rank'
    rank.textContent = '1'
    const value = document.createElement('span')
    const estimated = Math.max(0, Math.ceil(participant.metrics.totalSeconds))
    value.textContent = `Estimativa ${Math.floor(estimated / 60)}:${String(estimated % 60).padStart(2, '0')}`
    const progress = document.createElement('progress')
    progress.max = 1
    progress.value = 0
    progress.setAttribute('aria-label', `Percurso ${style.label}`)
    row.append(rank, label, value, progress)
    rows.append(row)
    return { row, rank, value, progress }
  })
  wrap.append(rows)
  const note = document.createElement('p')
  note.className = 'comparison-note'
  note.textContent = `${identical ? 'A IA e o padrão escolheram a mesma rota. ' : ''}Tempos estimados por trecho · Reprodução acelerada. Não representa posições em tempo real.`
  hud.append(note)
  const timeline = document.createElement('div')
  timeline.className = 'simulation-timeline'
  const clock = document.createElement('output')
  clock.textContent = `0:00 / ${clockLabel(totalSeconds)}`
  const scrubber = document.createElement('input')
  scrubber.type = 'range'
  scrubber.min = '0'
  scrubber.max = String(totalSeconds)
  scrubber.step = '0.1'
  scrubber.value = '0'
  scrubber.setAttribute('aria-label', 'Tempo da comparação')
  scrubber.oninput = () => seek(Number(scrubber.value))
  const milestones = document.createElement('div')
  milestones.className = 'simulation-milestones'
  const addMilestone = (label: string, seconds: number) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.title = `${clockLabel(seconds)} · ${label}`
    button.onclick = () => seek(seconds)
    milestones.append(button)
  }
  addMilestone('Saída', 0)
  for (const step of participants[0].steps ?? []) {
    if (step.type !== 'turn' && step.type !== 'roundabout') continue
    const meters = participants[0].metrics.cumulative[step.geometry_index]
    if (meters !== undefined) addMilestone(step.type === 'roundabout' ? 'Rotatória' : step.street ?? 'Conversão', participants[0].metrics.secondsAtDistance(meters))
  }
  addMilestone('Chegada', totalSeconds)
  timeline.append(clock, scrubber, milestones)
  hud.append(timeline)
  const finish = document.createElement('div')
  finish.className = 'simulation-finish'
  finish.hidden = true
  finish.setAttribute('role', 'status')
  const finishNumber = document.createElement('strong')
  const finishCopy = document.createElement('span')
  const replay = document.createElement('button')
  replay.type = 'button'
  replay.textContent = 'Rever'
  replay.onclick = () => { paused = reducedMotion; seek(0) }
  finish.append(finishNumber, finishCopy, replay)
  hud.append(finish)
  wrap.append(hud)
  const primaryLabel = document.createElement('div')
  primaryLabel.className = 'comparison-primary-label'
  primaryLabel.textContent = styles[participants[0].kind].label
  wrap.append(primaryLabel)

  const setupAuxiliaries = () => {
    if (auxiliaries.length) return
    participants.slice(1).forEach((participant) => {
      const pane = document.createElement('div')
      pane.className = 'comparison-pane'
      const canvas = document.createElement('div')
      canvas.className = 'comparison-pane-map'
      const label = document.createElement('span')
      label.className = 'comparison-pane-label'
      label.textContent = styles[participant.kind].label
      label.style.borderColor = styles[participant.kind].color
      const loading = document.createElement('span')
      loading.className = 'comparison-map-loading'
      loading.textContent = 'Carregando cartografia…'
      pane.append(canvas, label, loading)
      auxiliaryRoot.append(pane)
      const auxiliary = new maplibregl.Map({ container: canvas, style: mapStyle(),
        center: participant.metrics.coords[0], zoom: 16.8, pitch: 48,
        interactive: false, attributionControl: false, pixelRatio: 1 })
      const entry = { map: auxiliary, ready: false, element: pane }
      auxiliaries.push(entry)
      auxiliary.on('load', () => {
        if (stopped) return
        const coords = participant.metrics.coords
        addRouteLayers(auxiliary, participant.kind === 'ai' ? coords : [], participant.kind === 'standard' ? coords : [], participant.kind === 'critical' ? coords : [])
        setLayerVisibility(auxiliary, true)
        setEnvironmentPlayback(auxiliary, true)
        set3DEnvironment(auxiliary, true)
        setBuildingLayersVisibility(auxiliary, true)
        styles[participant.kind].add(auxiliary, coords[0])
        styles[participant.kind].show(auxiliary, true)
        entry.ready = true
        loading.remove()
      })
    })
  }

  let lastResizeSignature = ''
  const resize = new ResizeObserver(() => {
    const signature = `${wrap.clientWidth}:${wrap.clientHeight}:${hud.offsetHeight}`
    if (signature === lastResizeSignature) return
    lastResizeSignature = signature
    wrap.classList.toggle('map-comparison-split', split && !completed)
    wrap.style.setProperty('--comparison-hud-height', `${hud.offsetHeight}px`)
    map.resize()
    auxiliaries.forEach((entry) => entry.map.resize())
  })
  wrap.style.setProperty('--comparison-hud-height', `${hud.offsetHeight}px`)
  resize.observe(wrap)
  resize.observe(hud)
  const highlightExclusive = (visible: boolean) => {
    const id = 'comparison-exclusive'
    if (!map.getSource(id) && result && ai && standard) {
      const features = [
        ...result.aiExclusive.map((segment) => ({ segment, route: ai.metrics, color: ROUTE_COLOR })),
        ...result.standardExclusive.map((segment) => ({ segment, route: standard.metrics, color: COMPARISON_COLOR })),
      ].map(({ segment, route, color }): GeoJSON.Feature<GeoJSON.LineString> => ({ type: 'Feature', properties: { color },
        geometry: { type: 'LineString', coordinates: route.coords.slice(segment.start, segment.end + 1) } }))
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features } })
      map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': ['get', 'color'], 'line-width': 9, 'line-opacity': 0.85 } })
    }
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  }
  const loop = (timestamp: number, scrub = false) => {
    frame = 0
    if (stopped || (!scrub && (completed || paused) && (cameraMode !== 'orbit' || reducedMotion)) || document.hidden) return
    // Three simultaneous 3D canvases can stall weak GPUs. In split mode,
    // run the expensive map updates at 30 Hz without changing simulation time.
    if (!scrub && split && previous !== null && timestamp - previous < 33) {
      frame = requestAnimationFrame(loop)
      return
    }
    // React may replace the wrapper's class list when theater/fullscreen changes.
    wrap.classList.toggle('map-comparison-split', split)
    // The replay clock must run at wall time, not 100 ms per rendered frame.
    // The visual easing remains capped so delayed frames do not snap angles.
    const clockDt = previous === null ? 0 : Math.min(1500, Math.max(0, timestamp - previous))
    const dt = Math.min(100, clockDt)
    previous = timestamp
    if (!scrub && !paused && !completed) {
      if (finishHoldMs > 0) finishHoldMs = Math.max(0, finishHoldMs - clockDt)
      else elapsed = Math.min(duration, elapsed + clockDt * speed)
      if (!firstFinishShown && elapsed >= firstArrivalMs) {
        elapsed = firstArrivalMs
        firstFinishShown = true
        finishHoldMs = reducedMotion ? 0 : 500
        finish.hidden = false
        highlightExclusive(!identical)
        finishCopy.textContent = firstGap < 1 && identical ? 'Mesma rota, mesmo tempo' : arrivalCopy
      }
    }
    if (firstFinishShown && !completed) finishNumber.textContent = firstGap < 1 ? '=' : `${Math.round(firstGap * (1 - finishHoldMs / 500))} s`
    const simulatedSeconds = elapsed / duration * totalSeconds
    const progress = comparisonProgress(elapsed, duration, seconds, routeMetrics)
    const vehicles = participants.map((participant, index) => {
      const travelled = participant.metrics.totalMeters * progress[index]
      const position = participant.metrics.pointAtDist(travelled)
      const ahead = participant.metrics.pointAtDist(Math.min(travelled + 30, participant.metrics.totalMeters))
      const behind = participant.metrics.pointAtDist(Math.max(0, travelled - 12))
      const target = bearingBetween(behind, ahead)
      const delta = ((target - bearings[index] + 540) % 360) - 180
      bearings[index] += delta * (scrub ? 1 : 1 - Math.exp(-dt / 180))
      // Small lateral lanes keep all three readable on shared road sections.
      const offset = split ? 0 : (index - (participants.length - 1) / 2) * 9
      styles[participant.kind].move(map, position, bearings[index], offset)
      setRouteProgress(map, participant.kind, progress[index])
      if (arrival && progress[index] >= 1) {
        arrivalElapsed[index] = scrub || reducedMotion || !arrival.enabled ? ARRIVAL_DURATION_SECONDS : Math.min(ARRIVAL_DURATION_SECONDS, arrivalElapsed[index] + (!paused && finishHoldMs === 0 ? clockDt / 1000 : 0))
        setArrivalFrame(map, sceneVariant[participant.kind], arrival.nature, arrivalElapsed[index], arrival.enabled)
      } else if (arrival) {
        arrivalElapsed[index] = 0
        setArrivalFrame(map, sceneVariant[participant.kind], arrival.nature, null)
      }
      return { position, ahead, bearing: bearings[index] }
    })
    if (arrival) setStationDeparture(map, arrival.stationId, simulatedSeconds)
    const bounds = new maplibregl.LngLatBounds()
    vehicles.forEach((vehicle) => { bounds.extend(vehicle.position); bounds.extend(vehicle.ahead) })
    const width = map.getContainer().clientWidth
    const height = map.getContainer().clientHeight
    const padding = { top: Math.min(55, height * 0.12), bottom: Math.min(hud.offsetHeight + 30, height * 0.45), left: Math.min(70, width * 0.12), right: Math.min(70, width * 0.12) }
    const fitted = map.cameraForBounds(bounds, { padding, maxZoom: 17, bearing: 0 })
    const fittedZoom = (fitted?.zoom ?? 17) + (split ? Math.log2(wrap.clientWidth / Math.max(1, width)) : 0)
    const desiredSplit = permitSplit && cameraMode === 'chase' && !reducedMotion && nextCameraLayout(split, fittedZoom)
    let layoutChanged = false
    if (desiredSplit !== split && (timestamp - lastLayoutChange > 1800 || (desiredSplit && fittedZoom < 15))) {
      split = desiredSplit
      layoutChanged = true
      participants.forEach((participant, index) => styles[participant.kind].show(map, !split || index === 0))
      lastLayoutChange = timestamp
      wrap.classList.toggle('map-comparison-split', split)
      if (split) setupAuxiliaries()
      map.resize()
      auxiliaries.forEach((entry) => entry.map.resize())
      updateStatus()
    }
    const center = cameraMode === 'orbit' ? vehicles[0].position : split ? vehicles[0].ahead : fitted?.center ?? vehicles[0].position
    const zoom = split || cameraMode === 'orbit' ? 16.9 : Math.max(15.65, (fitted?.zoom ?? 16.9) - 0.25)
    // North remains fixed in the collective view; individual views follow the road.
    const targetBearing = cameraMode === 'orbit' ? map.getBearing() + dt * 0.006 : split ? vehicles[0].bearing : 0
    const current = map.getCenter()
    const targetCenter = maplibregl.LngLat.convert(center)
    const amount = layoutChanged ? 1 : 1 - Math.exp(-Math.max(dt, 16) / 150)
    if (!reducedMotion) map.jumpTo({ center: [current.lng + (targetCenter.lng - current.lng) * amount, current.lat + (targetCenter.lat - current.lat) * amount],
      zoom: map.getZoom() + (zoom - map.getZoom()) * amount, pitch: cameraMode === 'top' ? 0 : split || cameraMode === 'orbit' ? 48 : 25,
      bearing: map.getBearing() + (((targetBearing - map.getBearing() + 540) % 360) - 180) * amount })
    if (split) auxiliaries.forEach((entry, index) => {
      if (!entry.ready) return
      const vehicle = vehicles[index + 1]
      styles[participants[index + 1].kind].move(entry.map, vehicle.position, vehicle.bearing)
      setRouteProgress(entry.map, participants[index + 1].kind, progress[index + 1])
      if (arrival) setArrivalFrame(entry.map, sceneVariant[participants[index + 1].kind], arrival.nature, progress[index + 1] >= 1 ? arrivalElapsed[index + 1] : null, arrival.enabled)
      entry.map.jumpTo({ center: vehicle.ahead, bearing: vehicle.bearing, zoom: 16.9, pitch: 48 })
    })
    if (timestamp - lastLabelUpdate > 180) {
      lastLabelUpdate = timestamp
      clock.textContent = `${clockLabel(simulatedSeconds)} / ${clockLabel(totalSeconds)}`
      scrubber.value = String(simulatedSeconds)
      scrubber.setAttribute('aria-valuetext', `${clockLabel(simulatedSeconds)} de ${clockLabel(totalSeconds)}`)
      const before = values.map((value) => value.row.getBoundingClientRect().top)
      comparisonStandings(routeMetrics, simulatedSeconds).forEach((standing, order) => {
        const index = standing.index
        const row = values[index]
        row.row.style.order = String(order)
        row.rank.textContent = `${standing.rank}º`
        row.progress.value = progress[index]
        const gap = standing.gapSeconds < 0.5 ? (standing.rank === 1 ? 'Junto ao líder' : 'Mesmo tempo') : `+${clockLabel(standing.gapSeconds)}`
        row.value.textContent = progress[index] >= 1 ? `No destino · ${gap}` : `${Math.round(standing.remainingMeters)} m · ETA ${clockLabel(standing.remainingSeconds)} · ${gap}`
      })
      values.forEach((value, index) => {
        const delta = before[index] - value.row.getBoundingClientRect().top
        if (delta && !reducedMotion) value.row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' })
      })
    }
    if (timestamp - sampleStarted >= 1500) {
      const fps = Math.round(renderedFrames * 1000 / (timestamp - sampleStarted))
      performanceLabel.textContent = paused || document.hidden ? '' : `${fps} FPS`
      slowSamples = !paused && !document.hidden && fps < (split ? 26 : 45) ? slowSamples + 1 : 0
      if (slowSamples >= 2 && split && fps < 24) {
        // Two or three simultaneous WebGL maps can destroy performance on
        // integrated GPUs. Switch to one collective map for the rest of replay.
        permitSplit = false
        split = false
        wrap.classList.remove('map-comparison-split')
        participants.forEach((participant) => styles[participant.kind].show(map, true))
        auxiliaries.forEach((entry) => entry.map.remove())
        auxiliaries.length = 0
        auxiliaryRoot.replaceChildren()
        map.resize()
        updateStatus()
        slowSamples = 0
      }
      if (slowSamples >= 2 && map.getPixelRatio() > 1) {
        const ratio = Math.max(1, map.getPixelRatio() - 0.25)
        map.setPixelRatio(ratio)
        auxiliaries.forEach((entry) => entry.map.setPixelRatio(Math.min(1, ratio)))
        slowSamples = 0
      }
      renderedFrames = 0
      sampleStarted = timestamp
    }
    if (!completed && progress.every((value) => value >= 1) && (!arrival || arrivalElapsed.every(value => value >= ARRIVAL_DURATION_SECONDS))) {
      completed = true
      finish.hidden = false
      finishNumber.textContent = identical ? '=' : `${Math.round(Math.abs(result?.savedSeconds ?? 0))} s`
      finishCopy.textContent = result?.summary ?? 'Todas as viaturas no destino'
      highlightExclusive(!identical)
      if (result) note.textContent = result.summary
      values.forEach((row) => { row.progress.value = 1 })
      updateStatus()
      pause.disabled = true
      rate.disabled = true
      wrap.classList.remove('map-comparison-split')
      participants.forEach((participant) => styles[participant.kind].show(map, true))
      map.resize()
      auxiliaries.forEach((entry) => entry.map.remove())
      auxiliaries.length = 0
      auxiliaryRoot.replaceChildren()
      performanceLabel.textContent = ''
      map.setPixelRatio(originalPixelRatio)
      return
    }
    if ((!paused && !completed) || (cameraMode === 'orbit' && !reducedMotion)) frame = requestAnimationFrame(loop)
  }
  const seek = (seconds: number) => {
    cancelAnimationFrame(frame)
    elapsed = Math.min(duration, Math.max(0, seconds) / totalSeconds * duration)
    arrivalElapsed.fill(0)
    completed = false
    pause.disabled = false
    rate.disabled = false
    firstFinishShown = elapsed >= firstArrivalMs
    finishHoldMs = 0
    finish.hidden = !firstFinishShown
    if (firstFinishShown) finishCopy.textContent = arrivalCopy
    highlightExclusive(firstFinishShown && !identical)
    previous = null
    lastLabelUpdate = -Infinity
    updateStatus()
    loop(performance.now(), true)
  }
  const syncPlayback = () => {
    cancelAnimationFrame(frame)
    frame = 0
    previous = null
    renderedFrames = 0
    slowSamples = 0
    sampleStarted = performance.now()
    performanceLabel.textContent = ''
    if (!stopped && ((!completed && !paused) || (cameraMode === 'orbit' && !reducedMotion)) && !document.hidden) frame = requestAnimationFrame(loop)
  }
  const showStableOverview = () => {
    split = false
    wrap.classList.remove('map-comparison-split')
    participants.forEach((participant) => styles[participant.kind].show(map, true))
    map.resize()
    const bounds = new maplibregl.LngLatBounds()
    participants.forEach((participant) => participant.metrics.coords.forEach((point) => bounds.extend(point)))
    const height = map.getContainer().clientHeight
    const width = map.getContainer().clientWidth
    map.fitBounds(bounds, {
      padding: { top: 35, bottom: Math.min(hud.offsetHeight + 30, height * 0.45), left: Math.min(50, width * 0.12), right: Math.min(50, width * 0.12) },
      maxZoom: 16, pitch: 0, bearing: 0, duration: 0,
    })
  }
  const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches
    if (reducedMotion) {
      paused = true
      showStableOverview()
    }
    updateStatus()
    syncPlayback()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) {
      const selected = ({ '1': 'chase', '2': 'top', '3': 'orbit' } as const)[event.key as '1' | '2' | '3']
      if (selected) { event.preventDefault(); chooseCamera(selected); return }
    }
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    endPlayback()
  }
  wrap.addEventListener('keydown', onKeyDown)
  const onPresentationPause = (event: { paused?: boolean }) => {
    paused = Boolean(event.paused) || reducedMotion
    updateStatus()
    syncPlayback()
  }
  map.on('zeno:pause', onPresentationPause)
  document.addEventListener('visibilitychange', syncPlayback)
  motionPreference.addEventListener('change', onMotionPreferenceChange)
  map.stop()
  if (reducedMotion) showStableOverview()
  else map.jumpTo({ center: participants[0].metrics.coords[0], zoom: 16.9, pitch: 25, bearing: 0 })
  updateStatus()
  syncPlayback()
  const cleanup = () => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    map.off('render', measureRender)
    map.setPixelRatio(originalPixelRatio)
    setEnvironmentPlayback(map, false)
    document.removeEventListener('visibilitychange', syncPlayback)
    motionPreference.removeEventListener('change', onMotionPreferenceChange)
    wrap.removeEventListener('keydown', onKeyDown)
    map.off('zeno:pause', onPresentationPause)
    resize.disconnect()
    if (map.getLayer('comparison-exclusive')) map.removeLayer('comparison-exclusive')
    if (map.getSource('comparison-exclusive')) map.removeSource('comparison-exclusive')
    auxiliaries.forEach((entry) => entry.map.remove())
    auxiliaries.length = 0
    auxiliaryRoot.remove()
    const restoreFocus = hud.contains(document.activeElement)
    hud.remove()
    rows.remove()
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    primaryLabel.remove()
    participants.forEach((participant) => { styles[participant.kind].show(map, false); setRouteProgress(map, participant.kind, 0); if (arrival) setArrivalFrame(map, sceneVariant[participant.kind], arrival.nature, null) })
    if (arrival) setStationDeparture(map, arrival.stationId, 0)
    wrap.classList.remove('map-comparison-split')
    wrap.style.removeProperty('--comparison-count')
    wrap.style.removeProperty('--comparison-hud-height')
    map.resize()
  }
  return cleanup
}
