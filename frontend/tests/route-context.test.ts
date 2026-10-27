import assert from 'node:assert/strict'
import { test } from 'node:test'
import { destinationSide, roadFeatureAlerts, alternativeReason } from '../src/components/mapa/routes/route-context'

test('arrival side follows the last non-degenerate road tangent and does not invent a side on the road', () => {
  const north: [number, number][] = [[0, 0], [0, 0.001], [0, 0.001]]
  assert.equal(destinationSide(north, [0.0001, 0.001]), 'direita')
  assert.equal(destinationSide(north, [-0.0001, 0.001]), 'esquerda')
  assert.equal(destinationSide(north, [0, 0.001]), null)
  assert.equal(destinationSide([], [0, 0]), null)
})

test('heavy-vehicle alerts only use real mapped features ahead within 400 metres', () => {
  const features = [
    { type: 'max_weight' as const, geometry_index: 2, location: [0, 0] as [number, number], value: '12' },
    { type: 'speed_bump' as const, geometry_index: 0, location: [0, 0] as [number, number], value: 'hump' },
  ]
  assert.deepEqual(roadFeatureAlerts(features, [0, 100, 250], 50), [{ text: 'Limite de peso: 12 t', distance: 200 }])
  assert.deepEqual(roadFeatureAlerts(features, [0, 100, 250], 300), [])
})

test('alternative explanations only claim differences present in the route segments', () => {
  assert.equal(alternativeReason([], []), 'Percurso calculado')
  const segment = { street: 'Av. Central', counterflow: true, shoulder: false }
  assert.equal(alternativeReason([segment], []), 'Usa contramão · modo crítico')
  assert.equal(alternativeReason([], [{ ...segment, counterflow: false }]), 'Evita Av. Central')
})


test('mapped context only includes valid water sources in the actual incident radius', async () => {
  const { nearbyWaterSources } = await import('../src/components/mapa/routes/context-policy.ts')
  const at: [number, number] = [-45.555, -23.026]
  const rows = [{id:'near',latitude:-23.026,longitude:-45.554}, {id:'far',latitude:-23.1,longitude:-45.6}, {id:'bad',latitude:'',longitude:'NaN'}]
  const actual = nearbyWaterSources(rows, at)
  assert.equal(actual.length, 1)
  assert.equal(actual[0].id, 'near')
  assert.ok(actual[0].distance > 90 && actual[0].distance < 120)
})
