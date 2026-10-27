import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Map } from 'maplibre-gl'
import { setRoadContext, clearNavigationManeuver } from '../src/components/mapa/map/navigation-overlay'
import { measureRoute } from '../src/components/mapa/routes/utils'

test('unchanged road context does not resend GeoJSON on every navigation readout', () => {
  const sources = new globalThis.Map<string, { setData: (data: unknown) => void }>()
  const writes: string[] = []
  const map = {
    getSource: (id: string) => sources.get(id), addLayer() {}, getLayer: () => false,
    addSource(id: string) { sources.set(id, { setData() { writes.push(id) } }) },
    removeSource(id: string) { sources.delete(id) },
  } as unknown as Map
  const route = measureRoute([[0, 0], [0, .01]])
  route.segments = [{ start: 0, end: 1, street: 'Rua Central' }] as typeof route.segments
  setRoadContext(map, route, [], 0, null)
  setRoadContext(map, route, [], 1, null)
  setRoadContext(map, route, [], 2, null)
  assert.deepEqual(writes, [], 'stationary features and the same label window need no worker update')
  setRoadContext(map, route, [], 55, null)
  assert.deepEqual(writes, ['navigation-street'])
  clearNavigationManeuver(map)
  setRoadContext(map, route, [], 55, null)
  assert.ok(sources.has('navigation-street'), 'a second playback must recreate its sources')
})
