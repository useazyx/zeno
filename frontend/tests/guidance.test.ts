import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  cumulative, distanceM, locateOnRoute, nextStep, pointAlong, spokenDistance,
} from '../src/lib/guidance.ts'
import type { LatLon } from '../src/lib/guidance.ts'

// An L-shaped route: ~222 m north, then ~205 m east.
const line: LatLon[] = [[-23.03, -45.56], [-23.029, -45.56], [-23.028, -45.56], [-23.028, -45.558]]
const along = cumulative(line)

test('distances along the route add up', () => {
  assert.ok(Math.abs(distanceM(line[0], line[1]) - 111.3) < 0.5)
  assert.equal(along.length, 4)
  assert.ok(Math.abs(along[3] - (222.6 + 204.9)) < 2)
})

test('a position is projected onto the nearest segment', () => {
  const beside: LatLon = [-23.0285, -45.5599]
  const located = locateOnRoute(line, beside, along)
  assert.equal(located.segment, 1)
  assert.ok(Math.abs(located.along - 166.9) < 1.5)
  assert.ok(located.offRouteM > 5 && located.offRouteM < 15)
})

test('the simulated vehicle walks the line and stops at the end', () => {
  assert.deepEqual(pointAlong(line, 0, along), line[0])
  const middle = pointAlong(line, along[1] / 2, along)
  assert.ok(Math.abs(middle[0] - -23.0295) < 1e-6)
  assert.deepEqual(pointAlong(line, 99_999, along), line[3])
})

test('the next manoeuvre is the first one still ahead', () => {
  const steps = [{ geometry_index: 0 }, { geometry_index: 2 }, { geometry_index: 3 }]
  assert.deepEqual(nextStep(steps, 10, along)?.index, 1)
  assert.ok(Math.abs((nextStep(steps, 10, along)?.inM ?? 0) - 212.6) < 1)
  assert.equal(nextStep(steps, along[2] + 5, along)?.index, 2)
  assert.equal(nextStep(steps, along[3], along), null)
})

test('distances are spoken the way a navigator says them', () => {
  assert.equal(spokenDistance(12), 'Agora')
  assert.equal(spokenDistance(240), 'Em 250 metros')
  assert.equal(spokenDistance(40), 'Em 50 metros')
  assert.equal(spokenDistance(1530), 'Em 1,5 quilômetros')
})
