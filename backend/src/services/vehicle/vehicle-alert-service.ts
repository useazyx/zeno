import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { eventHub, type VehicleAlertPayload } from "../../realtime/event-hub.js";
import { haversineMeters } from "../../utils/geo.js";
import { recordOccurrenceEvents } from "../occurrence/occurrence-events.js";
import { POSITION_MAX_POINTS } from "./vehicle-position-policy.js";

interface ActiveAlert {
  occurrence_id: string
  payload: VehicleAlertPayload
}

export class VehicleAlertService {
  private active = new Map<string, ActiveAlert>()
  private running = false

  async execute() {
    if (this.running) return
    this.running = true
    try {
      const now = new Date()
      const windowStart = new Date(now.getTime() - env.VEHICLE_STOP_WINDOW_MINUTES * 60_000)
      const desired = new Map<string, ActiveAlert>()
      const dispatches = await prisma.dispatch.findMany({
        where: { status: "A_CAMINHO" },
        select: {
          id: true, vehicle_id: true, occurrence_id: true, dispatched_at: true,
          vehicle: { select: { prefix: true, last_position_at: true, current_latitude: true, current_longitude: true } },
          occurrence: { select: { latitude: true, longitude: true } }
        }
      })
      for (const dispatch of dispatches) {
        const vehicle = dispatch.vehicle
        const lastReport = vehicle.last_position_at ?? dispatch.dispatched_at
        const current = vehicle.current_latitude !== null && vehicle.current_longitude !== null
          ? { latitude: Number(vehicle.current_latitude), longitude: Number(vehicle.current_longitude) }
          : null
        let kind: VehicleAlertPayload["kind"] | undefined
        let since = lastReport
        if (now.getTime() - lastReport.getTime() > env.VEHICLE_SIGNAL_TIMEOUT_SECONDS * 1000) {
          kind = "sem_sinal"
        } else if (current && dispatch.dispatched_at <= windowStart && haversineMeters(current, {
          latitude: Number(dispatch.occurrence.latitude), longitude: Number(dispatch.occurrence.longitude)
        }) > env.VEHICLE_DESTINATION_RADIUS_METERS) {
          const [anchor, recent] = await Promise.all([
            prisma.vehiclePosition.findFirst({
              where: { vehicle_id: dispatch.vehicle_id, dispatch_id: dispatch.id, recorded_at: { lte: windowStart } },
              orderBy: [{ recorded_at: "desc" }, { id: "desc" }]
            }),
            prisma.vehiclePosition.findMany({
              where: { vehicle_id: dispatch.vehicle_id, dispatch_id: dispatch.id, recorded_at: { gte: windowStart, lte: now } },
              orderBy: [{ recorded_at: "desc" }, { id: "desc" }], take: POSITION_MAX_POINTS + 1
            })
          ])
          // Sem uma janela completa não há evidência para chamar a viatura de
          // parada. Afastar-se e retornar também conta como movimento.
          if (anchor && recent.length > 0 && recent.length <= POSITION_MAX_POINTS) {
            const origin = { latitude: Number(anchor.latitude), longitude: Number(anchor.longitude) }
            const moved = [current, ...recent.map((point) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude) }))]
              .some((point) => haversineMeters(origin, point) >= env.VEHICLE_STOP_DISTANCE_METERS)
            if (!moved) { kind = "parada"; since = windowStart }
          }
        }
        if (kind) {
          const key = `${dispatch.id}:${kind}`
          desired.set(key, {
            occurrence_id: dispatch.occurrence_id,
            payload: {
              vehicle_id: dispatch.vehicle_id, prefix: vehicle.prefix, dispatch_id: dispatch.id, kind,
              since: this.active.get(key)?.payload.since ?? since.toISOString(),
              ...(current && { latitude: String(vehicle.current_latitude), longitude: String(vehicle.current_longitude) })
            }
          })
        }
      }
      // Primeiro encerra o alerta anterior para evitar dois estados simultâneos.
      for (const [key, alert] of this.active) {
        if (!desired.has(key)) await this.publishChange(alert, true)
      }
      for (const [key, alert] of desired) {
        if (!this.active.has(key)) await this.publishChange(alert, false)
      }
      this.active = desired
    } finally {
      this.running = false
    }
  }

  private async publishChange(alert: ActiveAlert, cleared: boolean) {
    eventHub.publish({ type: cleared ? "vehicle.alert_cleared" : "vehicle.alert", payload: alert.payload })
    const description = alert.payload.kind === "sem_sinal" ? "sem sinal de posição" : "parada longe do destino"
    await recordOccurrenceEvents([{
      occurrence_id: alert.occurrence_id, dispatch_id: alert.payload.dispatch_id, type: "NOTA",
      message: cleared
        ? `${alert.payload.prefix}: alerta de viatura ${description} encerrado.`
        : `${alert.payload.prefix}: viatura ${description}.`,
      from_value: cleared ? alert.payload.kind : null,
      to_value: cleared ? null : alert.payload.kind
    }])
  }
}
