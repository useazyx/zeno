import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import * as THREE from "three"

const compiled = ts.transpileModule(
  readFileSync(new URL("../src/components/mapa/map/markers.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

type Layer = { id: string; onAdd: (map: unknown, gl: object) => void; render: (gl: object, options: object) => void; onRemove: () => void }
type Markers = Record<string, (...args: unknown[]) => void>

function replayHarness() {
  let renderedCoords: number[] = []
  let projection: number[] = []
  let moving = false
  const layers = new Map<string, Layer>()
  const map = {
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: Layer) => { layers.set(layer.id, layer); layer.onAdd(map, {}) },
    getCanvas: () => ({}),
    queryTerrainElevation: () => null,
    triggerRepaint() {},
  }
  class Renderer {
    resetState() {}
    clearDepth() {}
    dispose() {}
    render(_scene: THREE.Scene, camera: THREE.Camera) { projection = [...camera.projectionMatrix.elements] }
  }
  const exports: Markers = {}
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "three") return { ...THREE, WebGLRenderer: Renderer }
      if (id === "maplibre-gl") return {
        MercatorCoordinate: { fromLngLat: (coords: number[]) => {
          renderedCoords = [...coords]
          return { x: 0, y: 0, z: 0, meterInMercatorCoordinateUnits: () => 1 }
        } },
      }
      if (id === "./environment") return { sunPosition: () => ({ night: false }) }
      return {
        createFireTruckModel: () => new THREE.Group(),
        disposeFireTruckModel() {},
        updateFireTruckSignals: (_root: THREE.Object3D, _time: number, active: boolean) => { moving = active },
      }
    },
    window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    performance: { now: () => 1000 },
  })
  return {
    exports, map,
    render() {
      for (const layer of layers.values()) layer.render({}, { defaultProjectionData: { mainMatrix: new THREE.Matrix4().elements } })
      return { coords: renderedCoords, projection, moving }
    },
    cleanup() { for (const layer of layers.values()) layer.onRemove() },
  }
}

for (const name of ["Arrow", "ComparisonAiVehicle", "ComparisonVehicle", "CriticalVehicle"]) {
  test(`${name} resets its rendered position and orientation before a paused replay`, () => {
    const harness = replayHarness()
    try {
      harness.exports[`add${name}Layer`](harness.map, [-45.55, -23.02])
      harness.exports[`show${name}`](harness.map, true)
      harness.exports[`move${name}`](harness.map, [-45.56, -23.03], 45, 9)
      assert.deepEqual(harness.render().coords, [-45.56, -23.03])

      harness.exports[`add${name}Layer`](harness.map, [-45.57, -23.04])
      const replay = harness.render()
      assert.deepEqual(replay.coords, [-45.57, -23.04])
      assert.equal(replay.projection[1], 0)
      assert.equal(replay.projection[4], 0)
      assert.equal(replay.projection[12], 0)
      assert.equal(replay.projection[13], 0)
      assert.equal(replay.moving, false)
    } finally {
      harness.cleanup()
    }
  })
}
