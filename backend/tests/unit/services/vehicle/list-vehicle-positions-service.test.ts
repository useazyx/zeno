jest.mock("../../../../src/config/prisma.js", () => ({ prisma: {
  vehicle: { findUnique: jest.fn() },
  vehiclePosition: { count: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  $queryRaw: jest.fn()
} }))

import { prisma } from "../../../../src/config/prisma.js"
import { ListVehiclePositionsService } from "../../../../src/services/vehicle/list-vehicle-positions-service.js"
import { CleanVehiclePositionsService } from "../../../../src/services/vehicle/clean-vehicle-positions-service.js"

describe("vehicle position history", () => {
  it("refuses an inverted or greater-than-24-hour window before reading the database", async () => {
    const service = new ListVehiclePositionsService()
    await expect(service.execute({ from: new Date("2026-10-01"), to: new Date("2026-10-03") })).rejects.toThrow("24")
    await expect(service.execute({ from: new Date("2026-10-03"), to: new Date("2026-10-01") })).rejects.toThrow()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("returns ordered decimal coordinates and bounded metadata grouped by vehicle", async () => {
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([
      { id: "p1", vehicle_id: "v1", latitude: "-23.01", longitude: "-45", heading: null, dispatch_id: "d1", recorded_at: new Date("2026-10-07T10:00:00Z"), total_count: 6000n },
      { id: "p2", vehicle_id: "v2", latitude: "-23.02", longitude: "-45", heading: 90, dispatch_id: null, recorded_at: new Date("2026-10-07T11:00:00Z"), total_count: 6000n }
    ])
    const result = await new ListVehiclePositionsService().execute({ from: new Date("2026-10-07T00:00:00Z"), to: new Date("2026-10-08T00:00:00Z") })
    expect(result).toMatchObject({ total: 6000, sampled: true, vehicles: [
      { vehicle_id: "v1", positions: [{ latitude: "-23.01", recorded_at: "2026-10-07T10:00:00.000Z" }] },
      { vehicle_id: "v2", positions: [{ heading: 90 }] }
    ] })
  })

  it("distinguishes an unknown vehicle from an empty history", async () => {
    ;(prisma.vehicle.findUnique as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "v1" })
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([])
    const service = new ListVehiclePositionsService()
    await expect(service.execute({ vehicle_id: "missing" })).rejects.toThrow("não encontrada")
    await expect(service.execute({ vehicle_id: "v1" })).resolves.toMatchObject({ total: 0, positions: [] })
  })

  it("deletes strictly older history, preserving the retention boundary", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-07T12:00:00Z"))
    try {
      await new CleanVehiclePositionsService().execute()
      expect(prisma.vehiclePosition.deleteMany).toHaveBeenCalledWith({ where: { recorded_at: { lt: new Date("2026-09-07T12:00:00Z") } } })
    } finally { jest.useRealTimers() }
  })
})
