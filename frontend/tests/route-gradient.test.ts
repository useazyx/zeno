import assert from 'node:assert/strict'
import { test } from 'node:test'
import { routeGradient } from '../src/components/mapa/map/route-effects'

test('the complete route has a valid MapLibre step gradient without repeated style errors', () => {
  for (const progress of [0, 0.5, 1]) {
    const gradient = routeGradient('#28799c', progress, 1)
    assert.equal(gradient[0], 'step')
    assert.ok(gradient.length >= 5, 'a MapLibre step needs at least one stop')
  }
})
