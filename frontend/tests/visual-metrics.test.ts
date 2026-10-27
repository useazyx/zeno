import assert from "node:assert/strict"
import { test } from "node:test"
import * as THREE from "../node_modules/three/build/three.module.js"
import { curvePath } from "../src/components/charts/curve.ts"
import { createFireTruckModel, disposeFireTruckModel } from "../src/components/mapa/map/firetruck-3d.ts"

test("smooth curves pass through samples and do not overshoot extrema", () => {
  const points = [{ x: 0, y: 100 }, { x: 10, y: 5 }, { x: 20, y: 4 }, { x: 30, y: 60 }, { x: 40, y: 60 }]
  const path = curvePath(points)
  const numbers = path.match(/-?\d+\.\d+/g)!.map(Number)
  for (let i = 0; i < points.length - 1; i++) {
    const [cx1, cy1, cx2, cy2, x, y] = numbers.slice(2 + i * 6, 8 + i * 6)
    assert.equal(x, points[i + 1].x)
    assert.equal(y, points[i + 1].y)
    assert.ok(cx1 >= points[i].x && cx2 <= x)
    for (let t = 0; t <= 1; t += .01) {
      const value = (1 - t) ** 3 * points[i].y + 3 * (1 - t) ** 2 * t * cy1 + 3 * (1 - t) * t * t * cy2 + t ** 3 * y
      assert.ok(value >= Math.min(y, points[i].y) - .01 && value <= Math.max(y, points[i].y) + .01)
    }
  }
  assert.equal(curvePath([]), "")
})

test("all three vehicle models retain finite geometry with batched draw calls", () => {
  for (const variant of ["ai", "distance", "normal"] as const) {
    const truck = createFireTruckModel(variant)
    assert.ok(truck.children.length > 0 && truck.children.length <= 20)
    const bounds = new THREE.Box3().setFromObject(truck)
    assert.ok(Number.isFinite(bounds.min.x) && bounds.max.z > 1 && bounds.max.y > bounds.min.y)
    disposeFireTruckModel(truck)
  }
})
