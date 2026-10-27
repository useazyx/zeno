import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bufferedPosition } from '../src/components/mapa/map/vehicle-tracking.ts'
import { dispatchEstimate, historicalPosition, historyTrails, orderedPositions } from '../src/components/operational/operation-state.ts'
import type { Dispatch, TimelineEntry, VehiclePosition } from '../src/api/types.ts'

const position = (seconds: number, longitude = -45.5): VehiclePosition => ({ id: String(seconds), vehicle_id: 'v', latitude: -23, longitude, recorded_at: new Date(seconds * 1000).toISOString(), dispatch_id: 'd', heading: null })

test('AVL holds the last known sample across a telemetry gap instead of inventing movement', () => {
  assert.deepEqual(bufferedPosition([{ at: 0, latitude: -23, longitude: -45.5 }, { at: 120000, latitude: -24, longitude: -46 }], 125000), { latitude: -23, longitude: -45.5 })
})

test('historical lookup never reveals a future position and trails preserve gaps', () => {
  const positions = orderedPositions([position(180), position(0), position(30)])
  assert.equal(historicalPosition(positions, -1), null)
  assert.equal(historicalPosition(positions, 20000)?.id, '0')
  assert.equal(historicalPosition(positions, 90000)?.id, '30')
  assert.equal(historyTrails([{ vehicle_id: 'v', positions }], 180000, 240000).features.length, 1)
})

test('ETA starts at the latest recorded departure for the selected dispatch', () => {
  const dispatch = { id: 'd', status: 'A_CAMINHO', used_route: { estimated_time_seconds: 120 } } as Dispatch
  const events = [{ type: 'DESPACHO_STATUS', dispatch_id: 'd', to_value: 'A_CAMINHO', at: new Date(0).toISOString() }, { type: 'DESPACHO_STATUS', dispatch_id: 'd', to_value: 'A_CAMINHO', at: new Date(60000).toISOString() }] as TimelineEntry[]
  assert.equal(dispatchEstimate(dispatch, events, 90000)?.remaining, 90)
  assert.equal(dispatchEstimate({ ...dispatch, status: 'NO_LOCAL' }, events, 90000), null)
})
