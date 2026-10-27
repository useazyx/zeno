import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bufferedPosition, positionAge, shortestHeading } from '../src/components/mapa/map/vehicle-tracking'

test('buffer interpolates real reports and never extrapolates stale coordinates', () => {
  const reports = [{ at: 100000, longitude: 0, latitude: 0 }, { at: 110000, longitude: 1, latitude: 1 }]
  assert.deepEqual(bufferedPosition(reports, 115000), { longitude: .5, latitude: .5 })
  assert.deepEqual(bufferedPosition(reports, 200000), { longitude: 1, latitude: 1 })
  assert.deepEqual(bufferedPosition(reports, 100000), { longitude: 0, latitude: 0 })
})
test('missing timestamps are unknown, old reports are stale, bearing takes shortest turn', () => {
  assert.equal(positionAge(undefined, 200000).stale, true)
  assert.equal(positionAge(new Date(100000).toISOString(), 200000).stale, true)
  assert.equal(positionAge(new Date(195000).toISOString(), 200000).stale, false)
  assert.equal(shortestHeading(350, 10, .5), 360)
})
