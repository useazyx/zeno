import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coverageGaps, coverageBands, coverageStations, localStreetGraph, explorationFeatures, learningRates } from '../src/components/mapa/coverage-ai-policy.ts'

test('coverage growth requests real bands ending exactly at the selected target', () => {
  assert.deepEqual(coverageBands(15), [2, 4, 6, 8, 12, 15])
  assert.deepEqual(coverageBands(4), [2, 4, 8, 12])
  for (const target of [4, 6, 8, 10, 12, 15]) {
    const bands = coverageBands(target)
    assert.ok(bands.length <= 6, `target ${target} exceeds the coverage API band limit`)
    assert.ok(bands.includes(target))
    assert.ok([4, 8, 12].every(value => bands.includes(value)))
  }
})

test('draft stations remain visible against the baseline while a scenario is pending', () => {
  const existing = { id: 'base', acronym: 'BASE', name: 'Quartel', latitude: -23, longitude: -45, hypothetical: false, in_network: true }
  const extras = [{ label: 'NOVO-2', latitude: -23.01, longitude: -45.02 }]
  const pending = coverageStations([existing], extras)
  assert.equal(pending.length, 2)
  assert.deepEqual(pending[0], existing)
  assert.equal(pending[1].id, 'NOVO-2')
  assert.equal(pending[1].latitude, -23.01)
  assert.equal(pending[1].hypothetical, true)
  const moved = coverageStations([existing, pending[1]], [{ ...extras[0], latitude: -23.015 }])
  assert.equal(moved[1].latitude, -23.015)
  assert.equal(moved[1].id, pending[1].id)
  assert.deepEqual(coverageStations(moved, []), [existing])
})

test('gap sectors count only timed late demand, preserving unknown points separately', () => {
  const points = [481, 600, 480, null].map((time_seconds, index) => ({ id: String(index), latitude: -23.02, longitude: -45.55, time_seconds, priority: 'ALTA' as const, nature: 'INCENDIO' as const }))
  const gaps = coverageGaps(points, 8)
  assert.equal(gaps.features.length, 1)
  assert.equal(gaps.features[0].properties?.count, 2)
  assert.equal(gaps.features[0].geometry.coordinates[0].length, 5)
})

test('local graph is connected, bounded and preserves server costs without invented attention', () => {
  const features = Array.from({ length: 50 }, (_, i) => ({ type: 'Feature' as const, properties: { cost_seconds: i + 1 }, geometry: { type: 'LineString' as const, coordinates: [[-45.55 + i * .001, -23.02], [-45.55 + (i + 1) * .001, -23.02]] } }))
  const graph = localStreetGraph(features, 30)
  assert.ok(graph.nodes.length <= 30)
  assert.ok(graph.edges.length > 0)
  assert.equal(graph.edges[0].cost, features[graph.edges[0].index].properties.cost_seconds)
  assert.ok(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.from) && graph.nodes.some(node => node.id === edge.to)))
})

test('street graph preserves real street shape and never turns absent costs into zero', () => {
  const coordinates = [[-45.55, -23.02], [-45.551, -23.019], [-45.552, -23.02]]
  const graph = localStreetGraph([{ type: 'Feature', properties: { cost_seconds: null }, geometry: { type: 'LineString', coordinates } }])
  assert.equal(graph.edges[0].cost, null)
  assert.deepEqual(graph.edges[0].coordinates, coordinates)
  assert.deepEqual(graph.edges[0].attention, [null, null])
})

test('exploration reveals the supplied ordered nodes and converts latitude to GeoJSON order', () => {
  const trace: [number, number][] = [[-23, -45], [-23.01, -45.02], [-23.02, -45.03], [-23.03, -45.04]]
  assert.deepEqual(explorationFeatures(trace, .5).features.map(feature => feature.geometry.coordinates), [[-45, -23], [-45.02, -23.01]])
  assert.equal(explorationFeatures(trace, 0).features.length, 0)
  assert.equal(explorationFeatures(trace, 2).features.length, 4)
})

test('learning rate steps retain reported values and omit unavailable legacy measurements', () => {
  assert.deepEqual(learningRates([{ epoch: 50, learning_rate: .0003 }, { epoch: 100, learning_rate: .00015 }, { epoch: 150 }, { epoch: 200, learning_rate: null }]), [{ epoch: 50, rate: .0003 }, { epoch: 100, rate: .00015 }])
})
