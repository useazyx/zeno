import test from "node:test"
import assert from "node:assert/strict"
import * as THREE from "three"
import { DEFAULT_INSPECTION, VehicleViewerRuntime } from "../src/components/garagem/viewer-runtime.ts"
import { disposeVehicleModel } from "../src/components/mapa/map/vehicle-models.ts"

// Exercise scene changes without allocating a browser/WebGL context.
function sceneRuntime() {
  const runtime = Object.create(VehicleViewerRuntime.prototype) as VehicleViewerRuntime
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera()
  const controls = { target: new THREE.Vector3(), minDistance: 4, maxDistance: 50, update() {} }
  Object.assign(runtime, {
    scene, camera, controls, models: [], extent: 10, selected: null, annotations: null,
    settings: { ...DEFAULT_INSPECTION }, media: { matches: true },
    floor: { visible: true }, grid: { visible: true }, invalidate() {},
    callbacks: { onParts() {}, onPart() {} },
  })
  const dispose = () => scene.traverse((item) => {
    if (item.name.startsWith("zeno-vehicle-")) disposeVehicleModel(item)
    if (item instanceof THREE.LineSegments) { item.geometry.dispose(); (item.material as THREE.Material).dispose() }
  })
  return { runtime, camera, controls, scene, dispose }
}

test("editing appearance preserves the inspection viewpoint and equipment can be selected", () => {
  const { runtime, camera, scene, dispose } = sceneRuntime()
  runtime.setModels({ type: "ABT", prefix: "ABT-12" })
  runtime.setView("Trás", true)
  const position = camera.position.clone()
  runtime.setModels({ type: "ABT", prefix: "ABT-14" })
  assert.deepEqual(camera.position, position, "live edits must not reset the chosen view")
  runtime.selectPart("Mangote de sucção")
  assert.ok(scene.children.some((part) => part instanceof THREE.BoxHelper))
  dispose()
})

test("comparison reframes both vehicles without changing the viewing direction", () => {
  const { runtime, camera, controls, dispose } = sceneRuntime()
  runtime.setModels({ type: "MOB" })
  runtime.setView("Esquerda", true)
  const direction = camera.position.clone().sub(controls.target).normalize()
  runtime.setModels({ type: "MOB" }, { type: "AEM" })
  assert.ok(camera.position.clone().sub(controls.target).normalize().distanceTo(direction) < .00001)
  assert.ok(camera.position.distanceTo(controls.target) > 20)
  dispose()
})

test("picking a repeated part highlights the clicked side instead of its first namesake", () => {
  const { runtime, scene, dispose } = sceneRuntime()
  runtime.setModels({ type: "ABT" })
  const rightDoor = scene.getObjectByName("door.right")!.getObjectByName("Porta da cabine")!
  runtime.selectPart(rightDoor.name, rightDoor)
  const helper = scene.children.find((part) => part instanceof THREE.BoxHelper) as THREE.BoxHelper
  assert.ok(new THREE.Box3().setFromObject(helper).getCenter(new THREE.Vector3()).x > 0)
  dispose()
})
