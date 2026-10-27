import test from "node:test"
import assert from "node:assert/strict"
import * as THREE from "three"
import { createVehicleModel, disposeVehicleModel, updateVehicleModel, VEHICLE_MODEL_TYPES, vehicleModelDimensions } from "../src/components/mapa/map/vehicle-models.ts"

test("all eleven fleet types have bounded distinct geometry, including a two-wheel motorcycle", () => {
  assert.equal(VEHICLE_MODEL_TYPES.length, 11)
  for (const type of VEHICLE_MODEL_TYPES) {
    const model = createVehicleModel({ type })
    const wheels: THREE.Object3D[] = []
    model.traverse((part) => { if (part.name.startsWith("wheel.")) wheels.push(part) })
    assert.equal(wheels.length, type === "MOB" ? 2 : ["AT", "AEM", "APM"].includes(type) ? 6 : 4)
    const bounds = new THREE.Box3().setFromObject(model)
    assert.ok(bounds.getSize(new THREE.Vector3()).y >= vehicleModelDimensions(type).length)
    assert.ok(model.getObjectByName(type === "MOB" ? "Baú operacional" : "Cabine"))
    disposeVehicleModel(model)
  }
})

test("wheels rotate by travelled distance and braking lights react without changing position", () => {
  const model = createVehicleModel({ type: "ABT" })
  const wheel = model.getObjectByName("wheel.front.left")!
  updateVehicleModel(model, { seconds: 1, deltaSeconds: 1, distanceMeters: 1.06, speedMps: 3, braking: true, moving: true })
  assert.ok(Math.abs(wheel.rotation.x - 2) < 0.00001)
  const brake = model.getObjectByName("Luz de freio") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  assert.ok(brake.material.emissiveIntensity > 0.5)
  assert.equal(model.position.length(), 0)
  disposeVehicleModel(model)
})

test("animated doors, compartments and ladder retain pivots; reduced motion freezes signals", () => {
  const model = createVehicleModel({ type: "AEM" })
  updateVehicleModel(model, { seconds: 2, deltaSeconds: 1, doors: true, compartments: true, ladder: true, signals: true, reducedMotion: true })
  assert.ok(Math.abs(model.getObjectByName("door.left")!.rotation.z) > 0.5)
  assert.ok(model.getObjectByName("Escada mecânica")!.rotation.x > 0.2)
  const signal = model.getObjectByName("signal.0") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  const intensity = signal.material.emissiveIntensity
  updateVehicleModel(model, { seconds: 8, deltaSeconds: 1, signals: true, reducedMotion: true })
  assert.equal(signal.material.emissiveIntensity, intensity)
  disposeVehicleModel(model)
})

test("shared geometry survives one owner's disposal and is released after the last owner", () => {
  const first = createVehicleModel({ type: "UR" })
  const second = createVehicleModel({ type: "UR" })
  const firstCab = first.getObjectByName("Carroceria") as THREE.Mesh
  const secondCab = second.getObjectByName("Carroceria") as THREE.Mesh
  assert.equal(firstCab.geometry, secondCab.geometry)
  assert.notEqual(firstCab.material, secondCab.material)
  let releases = 0
  firstCab.geometry.addEventListener("dispose", () => { releases++ })
  disposeVehicleModel(first)
  assert.equal(releases, 0)
  disposeVehicleModel(second)
  assert.equal(releases, 1)
  disposeVehicleModel(second)
  assert.equal(releases, 1)
})

test("garage inspection preserves selectable equipment without changing the shared model bounds", () => {
  const mapModel = createVehicleModel({ type: "ABT" })
  const inspection = createVehicleModel({ type: "ABT", inspectable: true })
  assert.ok(inspection.getObjectByName("Mangote de sucção"), "the hose must remain independently selectable")
  assert.ok(inspection.getObjectByName("Retrovisor"), "the mirror must remain independently selectable")
  const inspectedBounds = new THREE.Box3().setFromObject(inspection), mapBounds = new THREE.Box3().setFromObject(mapModel)
  assert.ok(inspectedBounds.min.distanceTo(mapBounds.min) < .00001 && inspectedBounds.max.distanceTo(mapBounds.max) < .00001)
  disposeVehicleModel(inspection); disposeVehicleModel(mapModel)
})

test("opening a compartment retracts the shutter upwards while keeping its top fixed", () => {
  const model = createVehicleModel({ type: "ABT" })
  const shutter = model.getObjectByName("compartment.-1.0")!
  const closed = new THREE.Box3().setFromObject(shutter)
  updateVehicleModel(model, { seconds: 1, compartments: true, reducedMotion: true })
  const open = new THREE.Box3().setFromObject(shutter)
  assert.ok(Math.abs(open.max.z - closed.max.z) < .0001, "the shutter top must stay in place")
  assert.ok(open.min.z > closed.min.z + .3)
  updateVehicleModel(model, { seconds: 2, compartments: false, reducedMotion: true })
  assert.deepEqual(new THREE.Box3().setFromObject(shutter), closed)
  disposeVehicleModel(model)
})

test("arrival slows the alternating signal bar and reduced motion keeps it steady without reflection", () => {
  const model = createVehicleModel({ type: "ABT" })
  const signal = model.getObjectByName("signal.0") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  updateVehicleModel(model, { seconds: .5, moving: true, arrived: false })
  const responseIntensity = signal.material.emissiveIntensity
  updateVehicleModel(model, { seconds: .5, moving: false, arrived: true })
  assert.ok(signal.material.emissiveIntensity > responseIntensity + .2)
  updateVehicleModel(model, { seconds: .9, reducedMotion: true, moving: true })
  const steady = signal.material.emissiveIntensity
  updateVehicleModel(model, { seconds: 3.1, reducedMotion: true })
  assert.equal(signal.material.emissiveIntensity, steady)
  const reflection = model.getObjectByName("Reflexo do giroflex") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  assert.equal(reflection.material.opacity, 0)
  disposeVehicleModel(model)
})

test("acceleration and turning tilt the body within restrained limits and settle when stopped", () => {
  const model = createVehicleModel({ type: "ABT" })
  const body = model.getObjectByName("Conjunto da carroceria")!
  updateVehicleModel(model, { seconds: 0, deltaSeconds: .1, speedMps: 0, moving: false })
  updateVehicleModel(model, { seconds: .1, deltaSeconds: .1, speedMps: 1, moving: true, turnRate: 200 })
  assert.ok(body.rotation.x > 0 && body.rotation.x <= .012, "acceleration must produce a small rearward pitch")
  assert.ok(Math.abs(body.rotation.y) > 0 && Math.abs(body.rotation.y) <= Math.PI / 60)
  updateVehicleModel(model, { seconds: .2, deltaSeconds: 1, speedMps: 0, moving: false, reducedMotion: true })
  assert.equal(body.rotation.x, 0); assert.equal(body.rotation.y, 0)
  disposeVehicleModel(model)
})
