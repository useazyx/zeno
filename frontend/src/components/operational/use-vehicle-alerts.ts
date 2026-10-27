import { useSyncExternalStore } from 'react'
import type { VehicleAlert } from '@/api/types'
import { useRealtime } from '@/hooks/use-realtime'

let alerts: VehicleAlert[] = []
const listeners = new Set<() => void>()
const subscribe = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify) } }

/** Only backend alerts enter this store; telemetry gaps never invent a crew emergency. */
export function useVehicleAlerts() {
  useRealtime((event) => {
    if (event.type === 'vehicle.alert_snapshot') {
      alerts = event.payload.alerts
    } else if (event.type === 'vehicle.alert') {
      const alert = event.payload
      if (alerts.some((a) => a.vehicle_id === alert.vehicle_id && a.dispatch_id === alert.dispatch_id && a.kind === alert.kind && a.since === alert.since)) return
      alerts = [...alerts.filter((a) => !(a.vehicle_id === alert.vehicle_id && a.dispatch_id === alert.dispatch_id && a.kind === alert.kind)), alert]
    } else if (event.type === 'vehicle.alert_cleared') {
      const next = alerts.filter((a) => !(a.vehicle_id === event.payload.vehicle_id && a.dispatch_id === event.payload.dispatch_id && (!event.payload.kind || a.kind === event.payload.kind)))
      if (next.length === alerts.length) return
      alerts = next
    } else return
    listeners.forEach((notify) => notify())
  })
  return useSyncExternalStore(subscribe, () => alerts)
}
