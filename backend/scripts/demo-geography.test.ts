import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addressRandom, sampleStreet } from './demo-geography.js'

test('the same address is reproducible and samples named road segments', () => {
  const first = sampleStreet(-23.0264, -45.5551, addressRandom('recurring-address'))
  const again = sampleStreet(-23.0264, -45.5551, addressRandom('recurring-address'))
  assert.deepEqual(first, again)
  assert(first.street.length > 2)
  assert(first.latitude < -22.9 && first.latitude > -23.2)
  assert(first.longitude > -45.8 && first.longitude < -45.3)
})

test('urban distribution extends beyond the old square and contains distinct street locations', () => {
  const points = Array.from({ length: 250 }, (_, index) => sampleStreet(-23.0264, -45.5551, addressRandom(`address-${index}`)))
  assert(new Set(points.map((point) => point.street)).size > 15)
  assert(points.filter((point) => Math.abs(point.latitude + 23.0264) > 0.0035 || Math.abs(point.longitude + 45.5551) > 0.0035).length > 100)
  assert.equal(new Set(points.map((point) => `${point.latitude}:${point.longitude}`)).size, points.length)
})
