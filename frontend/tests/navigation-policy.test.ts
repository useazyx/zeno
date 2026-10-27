import assert from 'node:assert/strict'
import { test } from 'node:test'
import { measureRoute } from '../src/components/mapa/routes/utils.ts'
import { navigationState } from '../src/components/mapa/routes/navigation-policy.ts'
import { WAZE_ZOOM, WAZE_PITCH } from '../src/components/mapa/constants/constants.ts'
import type { RouteSegment, RouteStep } from '../src/api/types.ts'

const segment = (start: number, end: number, limit: number, emergency = false): RouteSegment => ({
  start, end, length_meters: 111, time_seconds: 20, speed_kmh: 20, limit_kmh: limit,
  street: 'Rua de teste', highway: 'residential', counterflow: emergency, shoulder: false,
})
const turn: RouteStep = { type: 'roundabout', modifier: null, street: null, highway: 'residential',
  distance_meters: 0, time_seconds: 0, location: [0, 0.002], geometry_index: 2 }

test('navigation opens the camera near a roundabout and restores it after the turn', () => {
  const route = measureRoute([[0, 0], [0.001, 0], [0.002, 0], [0.002, 0.001]])
  const near = navigationState(route, [turn], 100)
  assert.equal(near.maneuver?.step.type, 'roundabout')
  assert.ok(near.zoom < WAZE_ZOOM)
  assert.ok(near.pitch < WAZE_PITCH)
  const after = navigationState(route, [turn], 300)
  assert.equal(after.maneuver, null)
  assert.equal(after.zoom, WAZE_ZOOM)
})

test('navigation reports real speed limits and upcoming emergency access', () => {
  const route = measureRoute([[0, 0], [0.001, 0], [0.002, 0]], [segment(0, 1, 60), segment(1, 2, 30, true)])
  const state = navigationState(route, [], 50)
  assert.equal(state.limitKmh, 60)
  assert.match(state.alert?.text ?? '', /contramão/)
  assert.ok(Math.abs((state.alert?.distance ?? 0) - 61.1949) < 0.01)
  const end = navigationState(route, [], 150)
  assert.equal(end.limitKmh, 30)
  assert.equal(end.emergency, true)
})

test('navigation without segment metadata does not invent a posted speed limit', () => {
  assert.equal(navigationState(measureRoute([[0, 0], [0.001, 0]]), [], 10).limitKmh, null)
})
