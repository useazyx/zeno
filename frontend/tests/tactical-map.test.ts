import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'

for (const theme of ['dark', 'light']) {
  test(`tactical ${theme} style loads without paid credentials and validates with installed MapLibre`, () => {
    const source = readFileSync(new URL(`../public/map-styles/zeno-${theme}.json`, import.meta.url), 'utf8')
    const style = JSON.parse(source)
    assert.deepEqual(validateStyleMin(style).map((error) => error.message), [])
    assert.equal(style.sources.dem.encoding, 'terrarium')
    assert.ok(style.layers.some((layer: { type: string }) => layer.type === 'hillshade'))
    assert.ok(style.layers.some((layer: { id: string }) => layer.id === 'zeno-operational-poi'))
    assert.doesNotMatch(source, /access_token|api_key/)
  })
}
