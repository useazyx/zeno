import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

// Exercise the component's playback functions with a deterministic browser clock.
// MapLibre's WebGL camera is replaced at the boundary; playback code stays real.
const source = ts.createSourceFile("route-map.tsx", readFileSync(new URL("../src/components/mapa/route-map.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations: string[] = []
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ["cameraThen", "dampBearing"].includes(node.name?.text ?? "")) declarations.push(node.getText(source))
  if (ts.isVariableDeclaration(node) && ["startFollow", "stopFollow"].includes(node.name.getText(source))) declarations.push(`const ${node.getText(source)};`)
  ts.forEachChild(node, visit)
}
visit(source)
const compiled = ts.transpileModule(`${declarations.join("\n")}\nexports.start = startFollow; exports.stop = stopFollow;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function harness(reduced = false) {
  const frames = new Map<number, FrameRequestCallback>()
  const timers = new Map<number, () => void>()
  const cameraListeners = new Set<() => void>()
  const visibilityListeners = new Set<() => void>()
  const motionListeners = new Set<(event: { matches: boolean }) => void>()
  let nextId = 0
  let moving = false
  let distance = 0
  const ref = <T,>(current: T) => ({ current })
  const document = {
    hidden: false, activeElement: null,
    addEventListener: (_: string, fn: () => void) => visibilityListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => visibilityListeners.delete(fn),
  }
  const map = {
    stops: 0, jumps: 0, paddingChanges: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, lastJump: null as null | { center: [number, number]; pitch: number; padding: {bottom: number} },
    stop() { this.stops++; moving = false; for (const fn of [...cameraListeners]) fn() },
    getTerrain: () => null, setTerrain() {}, getSource: () => ({}),
    on: (_: string, fn: () => void) => cameraListeners.add(fn),
    off: (_: string, fn: () => void) => cameraListeners.delete(fn),
    flyTo(options: { duration: number }) { moving = options.duration > 0; if (!moving) this.stop() },
    setPadding(value: {top: number; bottom: number; left: number; right: number}) { this.padding = value; this.paddingChanges++ },
    jumpTo(options: {center: [number, number]; pitch: number}) { this.jumps++; this.lastJump = { ...options, padding: this.padding } }, getZoom: () => 14, getPitch: () => 52, getBearing: () => 0, getContainer: () => ({clientHeight: 650}), fire() {},
  }
  const followPausedRef = ref(false)
  const pauseFollow = ref<((paused: boolean) => void) | null>(null)
  const exports: { start?: (map: object) => void; stop?: () => void } = {}
  const context = {
    exports, document, performance: { now: () => 0 },
    window: {
      setTimeout: (fn: () => void) => { const id = ++nextId; timers.set(id, fn); return id },
      clearTimeout: (id: number) => timers.delete(id),
      matchMedia: () => ({ matches: reduced, addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => motionListeners.add(fn), removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) => motionListeners.delete(fn) }),
    },
    requestAnimationFrame: (fn: FrameRequestCallback) => { const id = ++nextId; frames.set(id, fn); return id },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    mapRef: ref(map), wrapRef: ref({ querySelector: () => ({offsetHeight: 230}), addEventListener() {}, removeEventListener() {} }), followTriggerRef: ref(null),
    cancelFollow: ref(null), followRAF: ref(null), followStart: ref(null),
    followBearing: ref(null), followCameraBearing: ref(null), followFrameTime: ref(null),
    followElapsed: ref(0), followPausedRef, pauseFollow,
    followProgressRef: ref({ value: 0 }), followDistanceRef: ref({ textContent: "" }),
    presentationStep: null, presentationPaused: ref(false),
    seekFollow: ref(null), refreshFollow: ref(null), followCameraRef: ref('top'), followSpeedRef: ref(1), ghostRef: ref(false), comparisonMetricsRef: ref({ coords: [] }),
    followSpeedReadoutRef: ref(null), followLimitRef: ref(null), followClockRef: ref(null), followSliderRef: ref(null), followAlertRef: ref(null),
    metricsRef: ref({ current: null, coords: [[0, 0], [1, 1]], totalMeters: 1000, totalSeconds: 100, followDurationMs: 10000, distanceAtSeconds: (seconds: number) => seconds * 10, speedAtSeconds: () => 36, pointAtDist: (meters: number) => [meters, meters] }),
    arrivalEnabled: false, occurrenceNature: "OUTROS", ARRIVAL_DURATION_SECONDS: 5.5, setArrivalFrame() {}, setArrivalActive() {}, skipArrival: ref(null), selectedStationId: null, setStationDeparture() {},
    routeSteps: [], routeFeatures: [], criticalMode: false, clockLabel: String, setEnvironmentPlayback() {},
    navigationState: () => ({ maneuver: null, zoom: 17, pitch: 52, alert: null }), terrainGradeAlert: () => null, roadFeatureAlerts: () => [],
    clearNavigationManeuver() {}, setNavigationManeuver() {}, setRoadContext() {}, setBuildingContext() {}, setBuildingOcclusion() {}, setBuildingLayersVisibility() {}, setRouteProgress() {},
    setVehicleGhost() {}, showComparisonVehicle() {}, addComparisonVehicleLayer() {}, moveComparisonVehicle() {},
    setFollowPaused() {}, setFollowCamera() {}, saveSimulationCamera() {}, setPlayback() {}, setCamMode() {}, stopComparisonSimulation() {},
    disableFreeCamera() {}, enableFreeCamera() {}, addArrowLayer() {}, showArrow() {}, fitDisplayedRoutes() {},
    moveArrow: (_: object, position: number[]) => { distance = position[0] },
    bearingBetween: () => 0, formatDistance: String, WAZE_ZOOM: 17, WAZE_PITCH: 60,
  }
  runInNewContext(compiled, context)
  exports.start!(map)
  return {
    map, frames, timers, motionListeners, visibilityListeners,
    finishCamera() { map.stop() },
    pause(value: boolean) {
      if (pauseFollow.current) pauseFollow.current(value)
      else { followPausedRef.current = value; if (value) map.stop() }
    },
    hide(value: boolean) { document.hidden = value; for (const fn of visibilityListeners) fn() },
    reduce() { for (const fn of motionListeners) fn({ matches: true }) },
    tick(time: number) { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(time) },
    stop() { exports.stop!() }, get moving() { return moving }, get distance() { return distance },
  }
}

test("pausing follow cancels the frame loop and resumes without counting paused time", () => {
  const h = harness()
  h.finishCamera(); h.tick(0); h.tick(100)
  const distance = h.distance
  h.pause(true)
  assert.equal(h.frames.size, 0)
  h.tick(9000)
  assert.equal(h.distance, distance)
  h.pause(false)
  assert.equal(h.frames.size, 1)
  h.tick(10000)
  assert.equal(h.distance, distance)
  h.tick(10100)
  assert.ok(h.distance > distance)
  h.stop()
})

test("hidden follow suspends work and a visible tab never resumes an explicit pause", () => {
  const h = harness()
  h.finishCamera(); h.tick(0)
  h.hide(true)
  assert.equal(h.frames.size, 0)
  h.hide(false)
  assert.equal(h.frames.size, 1)
  h.pause(true); h.hide(true); h.hide(false)
  assert.equal(h.frames.size, 0)
  h.stop()
  assert.equal(h.visibilityListeners.size, 0)
})

test("reduced motion starts without a frame loop and pauses a running follow", () => {
  const reduced = harness(true)
  assert.equal(reduced.frames.size, 0)
  reduced.pause(false); reduced.tick(0)
  const jumps = reduced.map.jumps
  reduced.tick(100)
  assert.equal(reduced.map.jumps, jumps)
  reduced.stop()
  const running = harness()
  running.finishCamera(); running.tick(0); running.reduce()
  assert.equal(running.frames.size, 0)
  running.stop()
  assert.equal(running.motionListeners.size, 0)
})

test("ending follow during the camera entrance stops movement and releases callbacks", () => {
  const h = harness()
  assert.equal(h.moving, true)
  h.stop()
  assert.equal(h.moving, false)
  assert.equal(h.frames.size, 0)
  assert.equal(h.timers.size, 0)
  assert.equal(h.motionListeners.size, 0)
})


test("a new Waze drive overrides the old overhead view and keeps the truck above its controls", () => {
  const h = harness()
  h.finishCamera()
  h.tick(0)
  h.tick(100)
  const camera = h.map.lastJump
  assert.ok(camera, "the follow loop should update the map camera")
  assert.ok(camera.pitch > 20, "the navigation view must tilt toward the road")
  assert.ok(camera.padding.bottom >= 230, "the vehicle must stay above the bottom playback controls")
  const start = camera.center
  h.tick(200)
  assert.notDeepEqual(h.map.lastJump?.center, start, "the camera must track the travelling vehicle")
  const paddingChanges = h.map.paddingChanges
  h.tick(300)
  h.tick(400)
  assert.equal(h.map.paddingChanges, paddingChanges, "HUD padding is only recalculated on layout changes")
  h.stop()
})


test("choppy frame rendering keeps the simulated vehicle moving at wall-clock speed", () => {
  const h = harness()
  h.finishCamera()
  h.tick(0)
  const start = h.distance
  h.tick(1000)
  assert.ok(h.distance - start >= 90, "a one-second frame gap must not advance only 100 ms")
  h.stop()
})
