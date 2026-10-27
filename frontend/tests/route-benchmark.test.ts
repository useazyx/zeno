import assert from 'node:assert/strict'
import { test } from 'node:test'

import { benchmark, sharedShare } from '../src/lib/route-benchmark.ts'
import type { LatLon } from '../src/lib/guidance.ts'

// ~445 m straight north, and the same trip that turns east halfway.
const straight: LatLon[] = [[-23.03, -45.56], [-23.026, -45.56]]
const detour: LatLon[] = [[-23.03, -45.56], [-23.028, -45.56], [-23.028, -45.557], [-23.026, -45.557], [-23.026, -45.56]]

test('a line shares all of itself and none of a far-away line', () => {
  assert.equal(sharedShare(straight, straight), 1)
  assert.equal(sharedShare(straight, [[-23.1, -45.6], [-23.09, -45.6]]), 0)
})

test('a detour shares roughly the stretch before it turns', () => {
  const share = sharedShare(straight, detour)
  assert.ok(share > 0.45 && share < 0.65, `share ${share}`)
})

test('differences are the AI minus the outside engine', () => {
  const result = benchmark(
    { estimated_time_seconds: 90, distance_meters: 1100, geometry: straight },
    { duration_seconds: 100, distance_meters: 1000, geometry: straight },
  )
  assert.equal(result.timeDeltaS, -10)
  assert.equal(result.timeDeltaPct, -10)
  assert.equal(result.distanceDeltaM, 100)
  assert.equal(result.distanceDeltaPct, 10)
  assert.equal(result.sharedPct, 100)
})
