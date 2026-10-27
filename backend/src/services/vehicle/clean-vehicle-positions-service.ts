import { prisma } from "../../config/prisma.js";
import { POSITION_CLEANUP_INTERVAL_MS, POSITION_RETENTION_DAYS } from "./vehicle-position-policy.js";

export class CleanVehiclePositionsService {
  // A fronteira é estrita: o ponto que completa exatamente N dias permanece.
  async execute() {
    const cutoff = new Date(Date.now() - POSITION_RETENTION_DAYS * POSITION_CLEANUP_INTERVAL_MS)
    return prisma.vehiclePosition.deleteMany({ where: { recorded_at: { lt: cutoff } } })
  }
}
