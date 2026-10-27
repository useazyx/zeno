/** --preview by default; --apply backs up original coordinates before a transaction. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { prisma } from '../src/config/prisma.js'
import { sampleStreet, addressRandom } from './demo-geography.js'

type Location = { id: string; address: string; latitude: string; longitude: string; description: string }
async function updateLocations(locations: Location[]) {
  await prisma.$transaction(async (tx) => {
    for (let offset = 0; offset < locations.length; offset += 1000) {
      const rows = JSON.stringify(locations.slice(offset, offset + 1000))
      await tx.$executeRaw`
        UPDATE occurrence AS o SET address = p.address, latitude = p.latitude::numeric, longitude = p.longitude::numeric, description = p.description
        FROM jsonb_to_recordset(${rows}::jsonb) AS p(id text, address text, latitude text, longitude text, description text)
        WHERE o.id = p.id AND o.description LIKE '%Cenário sintético de demonstração%'
      `
    }
  }, { timeout: 120_000 })
}

async function main() {
  const restoreIndex = process.argv.indexOf('--restore')
  if (restoreIndex >= 0) {
    const file = process.argv[restoreIndex + 1]
    assert(file, 'Informe o backup .json.gz')
    const backup = JSON.parse(gunzipSync(readFileSync(resolve(file))).toString('utf8')) as { original: Location[] }
    assert(Array.isArray(backup.original), 'Backup inválido')
    await updateLocations(backup.original)
    console.log(JSON.stringify({ restored: backup.original.length }))
    return
  }
  const rows = await prisma.occurrence.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, address: true, latitude: true, longitude: true, description: true, status: true, opened_at: true,
      dispatches: { select: { used_route_id: true, routes: { select: { id: true } } } } },
  })
  const marker = '[Geografia OSM demonstrativa v1]'
  const synthetic = rows.filter((row) => row.description.includes('[Cenário sintético de demonstração]') && !row.description.includes(marker))
  // Preserve all live dispatch positions and saved-route destinations, including recurring addresses.
  const protectedAddresses = new Set(rows.filter((row) => !row.description.includes('[Cenário sintético de demonstração]')
    || !['ENCERRADA', 'CANCELADA'].includes(row.status)
    || row.dispatches.some((dispatch) => dispatch.used_route_id || dispatch.routes.length)).map((row) => row.address))
  const groups = new Map<string, { lat: number; lon: number; count: number }>()
  const districtOf = (address: string) => address.split(',').slice(-2, -1)[0]?.trim() ?? address
  for (const row of synthetic) {
    const key = districtOf(row.address)
    const group = groups.get(key) ?? { lat: 0, lon: 0, count: 0 }
    group.lat += Number(row.latitude); group.lon += Number(row.longitude); group.count++
    groups.set(key, group)
  }
  const original: Location[] = [], updated: Location[] = []
  const addressLocations = new Map<string, Omit<Location, 'id' | 'description'>>()
  const occupiedAddresses = new Set(protectedAddresses)
  for (const row of synthetic) {
    if (protectedAddresses.has(row.address)) continue
    let location = addressLocations.get(row.address)
    if (!location) {
      const group = groups.get(districtOf(row.address))!
      const point = sampleStreet(group.lat / group.count, group.lon / group.count, addressRandom(row.address))
      assert(Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
      const suffix = row.address.split(',').slice(2).join(',').trim()
      let number = Number.parseInt(row.address.split(',')[1], 10) || 20
      let address = `${point.street}, ${number}, ${suffix}`
      while (occupiedAddresses.has(address)) { number++; address = `${point.street}, ${number}, ${suffix}` }
      occupiedAddresses.add(address)
      location = { address,
        latitude: point.latitude.toFixed(7), longitude: point.longitude.toFixed(7) }
      addressLocations.set(row.address, location)
    }
    original.push({ id: row.id, address: row.address, latitude: String(row.latitude), longitude: String(row.longitude), description: row.description })
    updated.push({ id: row.id, ...location, description: `${row.description} ${marker}` })
  }
  const invariant = (items: typeof rows) => createHash('sha256').update(JSON.stringify(items.map((row) => ({
    id: row.id, status: row.status, opened: row.opened_at, dispatches: row.dispatches,
  })))).digest('hex')
  console.log(JSON.stringify({ total: rows.length, synthetic: synthetic.length, update: updated.length,
    protectedAddresses: protectedAddresses.size, uniqueLocations: addressLocations.size, mode: process.argv.includes('--apply') ? 'apply' : 'preview' }))
  if (!process.argv.includes('--apply')) return
  if (!updated.length) return
  const directory = resolve('.backups'); mkdirSync(directory, { recursive: true })
  const path = resolve(directory, `geography-${new Date().toISOString().replaceAll(':', '-')}.json.gz`)
  writeFileSync(path, gzipSync(JSON.stringify({ original, updated })))
  console.log(`Backup: ${path}`)
  const before = invariant(rows)
  await updateLocations(updated)
  const after = await prisma.occurrence.findMany({ orderBy: { id: 'asc' }, select: {
    id: true, address: true, latitude: true, longitude: true, description: true, status: true, opened_at: true,
    dispatches: { select: { used_route_id: true, routes: { select: { id: true } } } },
  } })
  assert.equal(invariant(after), before, 'Datas, estados ou vínculos alterados')
  const expected = new Map(updated.map((row) => [row.id, row]))
  const originals = new Map(rows.map((row) => [row.id, row]))
  let verified = 0
  for (const row of after) {
    const point = expected.get(row.id)
    if (!point) {
      const original = originals.get(row.id)!
      assert.equal(String(row.latitude), String(original.latitude))
      assert.equal(String(row.longitude), String(original.longitude))
      assert.equal(row.address, original.address)
      assert.equal(row.description, original.description)
      continue
    }
    assert.equal(Number(row.latitude), Number(point.latitude))
    assert.equal(Number(row.longitude), Number(point.longitude))
    assert.equal(row.address, point.address)
    assert.equal(row.description, point.description)
    verified++
  }
  assert.equal(verified, updated.length)
  console.log(JSON.stringify({ verified, invariant: 'dates, statuses, dispatches, used routes and route IDs preserved' }))
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
