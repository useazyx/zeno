import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl'
import type maplibregl from 'maplibre-gl'
import { addRouteLayers, set3DEnvironment, setBuildingLayersVisibility, setLayerVisibility } from '../src/components/mapa/map/layers'

function recordingMap() {
  const style: StyleSpecification = { version: 8, sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } }, layers: [
    { id: 'background', type: 'background', paint: {} },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13, maxzoom: 14 },
    { id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14 },
  ] }
  const layer = (id: string) => style.layers.find((entry) => entry.id === id)!
  const map = {
    getStyle: () => style,
    getLayer: layer,
    addSource: (id: string, source: StyleSpecification['sources'][string]) => { style.sources[id] = source },
    addLayer: (entry: LayerSpecification) => { style.layers.push(entry) },
    setLight: (light: StyleSpecification['light']) => { style.light = light },
    setSky: (sky: StyleSpecification['sky']) => { style.sky = sky },
    setLayerZoomRange: (id: string, min: number, max: number) => { layer(id).minzoom = min; layer(id).maxzoom = max },
    setPaintProperty: (id: string, key: string, value: unknown) => { Object.assign(layer(id), { paint: { ...layer(id).paint, [key]: value } }) },
    setLayoutProperty: (id: string, key: string, value: unknown) => { Object.assign(layer(id), { layout: { ...layer(id).layout, [key]: value } }) },
  }
  return { map: map as unknown as maplibregl.Map, style, layer }
}

test('all three route stacks and the 3D environment satisfy the installed MapLibre style specification', () => {
  const { map, style } = recordingMap()
  addRouteLayers(map, [[-45.55, -23.02], [-45.56, -23.03]], [[-45.55, -23.02], [-45.57, -23.03]], [[-45.55, -23.02], [-45.54, -23.03]])
  setLayerVisibility(map, true)
  setBuildingLayersVisibility(map, true)
  set3DEnvironment(map, true)
  assert.deepEqual(validateStyleMin(style).map((error) => error.message), [])
})

test('returning to 2D keeps building footprints at street zoom and hides only their volume', () => {
  const { map, layer } = recordingMap()
  setBuildingLayersVisibility(map, true)
  setBuildingLayersVisibility(map, false)
  assert.equal(layer('building').layout?.visibility, 'visible')
  assert.equal(layer('building').maxzoom, 24)
  assert.equal(layer('building-3d').layout?.visibility, 'none')
})
