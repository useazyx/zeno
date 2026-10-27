/** Sample the existing OSM street network; never scatter inside rectangular boxes. */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

interface OsmElement { type: string; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string, string> }
interface Segment { a: [number, number]; b: [number, number]; length: number; street: string }
export interface DemoLocation { latitude: number; longitude: number; street: string }
const cache = resolve(import.meta.dirname, '../../machine/cache')
let segments: Segment[] | undefined
const distributions = new Map<string, { segments: Segment[]; cumulative: number[]; total: number }>()

function streets(): Segment[] {
  if (segments) return segments
  const result: Segment[] = []
  const seen = new Set<string>()
  for (const file of readdirSync(cache).filter((name) => name.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(resolve(cache, file), 'utf8')) as { elements?: OsmElement[] }
    if (!Array.isArray(data.elements)) continue
    const nodes = new Map(data.elements.filter((entry) => entry.type === 'node').map((entry) => [entry.id, entry]))
    for (const way of data.elements) {
      if (way.type !== 'way' || !way.nodes || !way.tags?.highway || !way.tags.name) continue
      if (['motorway', 'motorway_link', 'trunk', 'trunk_link', 'footway', 'path', 'steps', 'cycleway', 'construction'].includes(way.tags.highway)) continue
      if (['private', 'no'].includes(way.tags.access ?? '')) continue
      for (let index = 1; index < way.nodes.length; index++) {
        const a = nodes.get(way.nodes[index - 1]), b = nodes.get(way.nodes[index])
        if (a?.lat === undefined || a.lon === undefined || b?.lat === undefined || b.lon === undefined) continue
        const key = [a.id, b.id].sort((x, y) => x - y).join(':')
        if (seen.has(key)) continue
        seen.add(key)
        const length = Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 102_400)
        if (length < 2) continue
        result.push({ a: [a.lat, a.lon], b: [b.lat, b.lon], length, street: way.tags.name })
      }
    }
  }
  if (!result.length) throw new Error('Malha OSM local indisponível: nenhuma coordenada será inventada.')
  segments = result
  return result
}

export function sampleStreet(latitude: number, longitude: number, random: () => number): DemoLocation {
  const key = `${latitude.toFixed(4)}:${longitude.toFixed(4)}`
  let distribution = distributions.get(key)
  if (!distribution) {
    const nearby: Segment[] = [], cumulative: number[] = []
    let total = 0
    for (const segment of streets()) {
      const lat = (segment.a[0] + segment.b[0]) / 2
      const lon = (segment.a[1] + segment.b[1]) / 2
      const distance = Math.hypot((lat - latitude) * 111_320, (lon - longitude) * 102_400)
      // Smooth falloff, weighted by road length: continuous urban corridors.
      const weight = segment.length * Math.exp(-0.5 * (distance / 700) ** 2)
      if (weight < 0.01) continue
      total += weight
      nearby.push(segment)
      cumulative.push(total)
    }
    if (!nearby.length) throw new Error(`Nenhuma rua próxima de ${key}`)
    distribution = { segments: nearby, cumulative, total }
    distributions.set(key, distribution)
  }
  const target = random() * distribution.total
  let lo = 0, hi = distribution.cumulative.length - 1
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (distribution.cumulative[mid] < target) lo = mid + 1; else hi = mid }
  const segment = distribution.segments[lo]
  const fraction = 0.04 + random() * 0.92
  return {
    latitude: segment.a[0] + (segment.b[0] - segment.a[0]) * fraction,
    longitude: segment.a[1] + (segment.b[1] - segment.a[1]) * fraction,
    street: segment.street,
  }
}

export function addressRandom(address: string): () => number {
  let state = 2166136261
  for (const letter of address) state = Math.imul(state ^ letter.charCodeAt(0), 16777619) >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
