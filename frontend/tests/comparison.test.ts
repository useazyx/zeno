import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as policy from '../src/components/mapa/routes/comparison-policy.ts'
const { comparisonProgress, nextCameraLayout } = policy
import { measureRoute, type LngLat } from '../src/components/mapa/routes/utils.ts'
import type { RouteSegment } from '../src/api/types.ts'

function segment(start: number, end: number, seconds: number, street = 'Rua comum'): RouteSegment {
  return { start, end, time_seconds: seconds, street, length_meters: 100,
    speed_kmh: 36, limit_kmh: 50, highway: 'residential', counterflow: false, shoulder: false }
}

test('shared streets keep the same pace before routes diverge despite different route averages', () => {
  const ai: LngLat[] = [[0, 0], [0.001, 0], [0.002, 0]]
  const standard: LngLat[] = [[0, 0], [0.001, 0], [0.001, 0.003]]
  const metrics = [
    measureRoute(ai, [segment(0, 1, 20), segment(1, 2, 20)], 40),
    measureRoute(standard, [segment(0, 1, 20), segment(1, 2, 100)], 120),
  ]
  const first = comparisonProgress(5_000, 120_000, [40, 120], metrics)
  const next = comparisonProgress(10_000, 120_000, [40, 120], metrics)
  const firstMeters = first.map((value, index) => value * metrics[index].totalMeters)
  const nextMeters = next.map((value, index) => value * metrics[index].totalMeters)
  assert.ok(Math.abs(firstMeters[0] - firstMeters[1]) < 0.001)
  assert.ok(Math.abs((nextMeters[0] - firstMeters[0]) - (nextMeters[1] - firstMeters[1])) < 0.001)
  assert.ok(Math.abs(nextMeters[0] - 55.59746) < 0.01)
})

test('identical segment timelines ignore rounded whole-route estimates and arrive together', () => {
  const coords: LngLat[] = [[0, 0], [0.001, 0], [0.002, 0]]
  const segments = [segment(0, 1, 20), segment(1, 2, 80)]
  const metrics = [measureRoute(coords, segments, 99.9), measureRoute(coords, segments, 100.1)]
  for (const seconds of [0, 10, 20, 50, 99, 100]) {
    const progress = comparisonProgress(seconds * 1000, 100_000, [99.9, 100.1], metrics)
    assert.equal(progress[0], progress[1])
  }
  assert.deepEqual(comparisonProgress(100_000, 100_000, [99.9, 100.1], metrics), [1, 1])
})

test('routes without segments preserve constant-speed playback', () => {
  const metrics = measureRoute([[0, 0], [0.001, 0]], null, 100)
  assert.deepEqual(comparisonProgress(50_000, 100_000, [100], [metrics]), [0.5])
})

test('identical geometry is recognized even when legacy ETAs disagree', () => {
  const coords: LngLat[] = [[0, 0], [0.001, 0]]
  assert.equal(policy.routesAreIdentical(measureRoute(coords, null, 99), measureRoute(coords, null, 101)), true)
  assert.equal(policy.routesAreIdentical(measureRoute(coords), measureRoute([[0, 0], [0, 0.001]])), false)
})

test('arrival explanation counts exclusive streets without attributing shared streets to the advantage', () => {
  const ai = measureRoute([[0, 0], [0.001, 0], [0.002, 0], [0.003, 0]],
    [segment(0, 1, 10), segment(1, 2, 20, 'Av. Livre'), segment(2, 3, 10)], 40)
  const standard = measureRoute([[0, 0], [0.001, 0], [0.0015, 0.001], [0.002, 0], [0.003, 0]],
    [segment(0, 1, 10), segment(1, 3, 80, 'Rua Lenta'), segment(3, 4, 10)], 100)
  const result = policy.comparisonResult(ai, standard)
  assert.equal(result.savedSeconds, 60)
  assert.equal(result.aiExclusive[0].street, 'Av. Livre')
  assert.equal(result.standardExclusive[0].street, 'Rua Lenta')
  assert.equal(result.aiExclusive.length, 1)
  assert.equal(result.standardExclusive[0].seconds, 80)
  assert.equal(policy.comparisonResult(ai, ai).identical, true)
})

test('single-route timing slows on a slow street and handles invalid legacy segments without jumps', () => {
  const coords: LngLat[] = [[0, 0], [0.001, 0], [0.002, 0]]
  const route = measureRoute(coords, [segment(0, 1, 10), segment(1, 2, 90)], 100)
  assert.ok(Math.abs(route.distanceAtSeconds(10) - 111.1949) < 0.01)
  assert.ok(Math.abs(route.distanceAtSeconds(55) - 166.7924) < 0.01)
  assert.ok(route.speedAtSeconds(5) > route.speedAtSeconds(15) * 8.9)
  assert.equal(route.secondsAtDistance(route.totalMeters), 100)
  const invalid = measureRoute(coords, [segment(1, 2, 50)], 100)
  assert.equal(invalid.timedBySegments, false)
  assert.equal(invalid.distanceAtSeconds(50), invalid.totalMeters / 2)
})

test('time tower ranks distance progress and exposes the time needed to reach the leader', () => {
  const coords: LngLat[] = [[0, 0], [0.001, 0], [0.002, 0]]
  const routes = [measureRoute(coords, [segment(0, 1, 20), segment(1, 2, 80)]),
    measureRoute(coords, [segment(0, 1, 60), segment(1, 2, 40)])]
  const standings = policy.comparisonStandings(routes, 20)
  assert.equal(standings[0].rank, 1)
  assert.equal(standings[1].rank, 2)
  assert.ok(Math.abs(standings[1].gapSeconds - 40) < 0.001)
  assert.ok(Math.abs(standings[0].remainingMeters - 111.1949) < 0.01)
  assert.equal(standings[0].remainingSeconds, 80)
  assert.deepEqual(policy.comparisonStandings([routes[0], routes[0]], 25).map((row) => row.rank), [1, 1])
})

test('three vehicles share a clock and retain real arrival order', () => {
  assert.deepEqual(comparisonProgress(30_000, 60_000, [120, 240, 80]), [1, 0.5, 1])
  assert.deepEqual(comparisonProgress(60_000, 60_000, [120, 240, 80]), [1, 1, 1])
})

test('camera separates distant vehicles and uses hysteresis before reuniting', () => {
  assert.equal(nextCameraLayout(false, 14), true)
  assert.equal(nextCameraLayout(false, 16.5), false)
  assert.equal(nextCameraLayout(true, 15.9), true)
  assert.equal(nextCameraLayout(true, 16.6), false)
})

test('missing critical route still supports a pair and zero elapsed time', () => {
  assert.deepEqual(comparisonProgress(0, 60_000, [100, 200]), [0, 0])
  assert.deepEqual(comparisonProgress(15_000, 60_000, [100, 200]), [0.5, 0.25])
})
