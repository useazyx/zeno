import type { FastifyInstance } from "fastify";
import { CleanVehiclePositionsService } from "../services/vehicle/clean-vehicle-positions-service.js";
import { VehicleAlertService } from "../services/vehicle/vehicle-alert-service.js";
import { POSITION_CLEANUP_INTERVAL_MS, VEHICLE_ALERT_INTERVAL_MS } from "../services/vehicle/vehicle-position-policy.js";

export async function vehicleMonitoringPlugin(server: FastifyInstance) {
  const cleanup = new CleanVehiclePositionsService()
  const alerts = new VehicleAlertService()
  const runCleanup = () => cleanup.execute().catch((error) => server.log.error(error, "Falha na retenção de posições"))
  const runAlerts = () => alerts.execute().catch((error) => server.log.error(error, "Falha no monitoramento de viaturas"))
  const cleanupTimer = setInterval(runCleanup, POSITION_CLEANUP_INTERVAL_MS)
  const alertTimer = setInterval(runAlerts, VEHICLE_ALERT_INTERVAL_MS)
  cleanupTimer.unref()
  alertTimer.unref()
  server.addHook("onReady", async () => { await runCleanup(); await runAlerts() })
  server.addHook("onClose", async () => { clearInterval(cleanupTimer); clearInterval(alertTimer) })
}
