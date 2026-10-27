import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as environment from '../src/components/mapa/map/environment'
import type { Map } from 'maplibre-gl'

test('playback keeps terrain suspended through environment transitions and restores it on exit', () => {
  const timers: (() => void)[] = []
  const original = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver, setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval }
  let terrain: unknown = null
  Object.assign(globalThis, {
    document: { hidden: false, documentElement: { dataset: {} }, addEventListener() {}, removeEventListener() {} },
    window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (fn: () => void) => { timers.push(fn); return 1 }, setInterval: () => 1,
  })
  const map = {
    setLight() {}, setSky() {}, getSource: () => ({}), getStyle: () => ({ layers: [] }),
    setTerrain(value: unknown) { terrain = value }, getCanvas: () => ({ style: {} }), once() {},
  } as unknown as Map
  try {
    environment.configureEnvironment(map, true)
    environment.setEnvironmentPlayback(map, true)
    assert.equal(terrain, null)
    timers.shift()?.()
    assert.equal(terrain, null, 'the pending 3D fade must not re-enable DEM during navigation')
    environment.configureEnvironment(map, true)
    assert.equal(terrain, null, 'reapplying the style must respect playback')
    environment.setEnvironmentPlayback(map, false)
    assert.deepEqual(terrain, { source: 'dem', exaggeration: 1.3 })
    environment.configureEnvironment(map, false)
    environment.setEnvironmentPlayback(map, false)
    assert.equal(terrain, null, '2D mode must stay flat after playback')
  } finally { Object.assign(globalThis, original) }
})
