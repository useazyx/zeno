import assert from "node:assert/strict"
import { test } from "node:test"
import * as THREE from "three"
import { createFireTruckModel, disposeFireTruckModel } from "../src/components/mapa/map/firetruck-3d.ts"

test("removing one vehicle releases its GPU resources without disposing another vehicle", () => {
  const first = createFireTruckModel("ai")
  const second = createFireTruckModel("ai")
  const resources = new Set<THREE.Material | THREE.BufferGeometry>()
  const disposed = new Set<THREE.Material | THREE.BufferGeometry>()
  let secondDisposals = 0

  first.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    resources.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material)
  })
  resources.forEach((resource) => resource.addEventListener("dispose", () => disposed.add(resource)))
  second.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.addEventListener("dispose", () => secondDisposals++)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.addEventListener("dispose", () => secondDisposals++)
    }
  })

  disposeFireTruckModel(first)
  assert.equal(disposed.size, resources.size, "geometries and materials must all be released")
  assert.equal(secondDisposals, 0, "a second map may still be rendering its own model")
  disposeFireTruckModel(second)
})
