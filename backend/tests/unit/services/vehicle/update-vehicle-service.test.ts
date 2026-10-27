jest.mock("../../../../src/config/prisma.js", () => ({
  prisma: {
    vehicle: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    dispatch: { findFirst: jest.fn() },
    unit: { findUnique: jest.fn() },
    vehiclePosition: { findFirst: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn()
  }
}))

import { ConflictError, NotFoundError } from "../../../../src/errors/index.js"
import { prisma } from "../../../../src/config/prisma.js"
import { UpdateVehicleService } from "../../../../src/services/vehicle/update-vehicle-service.js"

const mockPrisma = prisma as unknown as {
  vehicle: { findUnique: jest.Mock, findUniqueOrThrow: jest.Mock, findFirst: jest.Mock, update: jest.Mock },
  dispatch: { findFirst: jest.Mock },
  unit: { findUnique: jest.Mock },
  vehiclePosition: { findFirst: jest.Mock, create: jest.Mock },
  $queryRaw: jest.Mock,
  $transaction: jest.Mock
}

describe("UpdateVehicleService", () => {
  const service = new UpdateVehicleService()

  beforeEach(() => {
    mockPrisma.$transaction.mockImplementation((action) => action(mockPrisma))
    mockPrisma.vehicle.findUniqueOrThrow.mockImplementation((args) => mockPrisma.vehicle.findUnique(args))
  })

  it("stores a position with the active dispatch and refreshes its reception time", async () => {
    const now = new Date("2026-10-07T12:00:00Z")
    jest.useFakeTimers().setSystemTime(now)
    try {
      mockPrisma.vehicle.findUnique.mockResolvedValue({ id: "v1", prefix: "ABT-1", type: "ABT", status: "EMPENHADA" })
      mockPrisma.dispatch.findFirst.mockResolvedValue({ id: "d1" })
      mockPrisma.vehicle.update.mockImplementation(({ data }) => ({ id: "v1", prefix: "ABT-1", ...data }))

      const updated = await service.execute({ id: "v1", current_latitude: -23, current_longitude: -45 })

      expect(updated).toEqual(expect.objectContaining({ last_position_at: now }))
      expect(mockPrisma.vehiclePosition.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        vehicle_id: "v1", dispatch_id: "d1", recorded_at: now
      }) })
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    } finally { jest.useRealTimers() }
  })

  it("does not store a nearby point within five seconds but keeps the signal fresh", async () => {
    const now = new Date("2026-10-07T12:00:00Z")
    jest.useFakeTimers().setSystemTime(now)
    try {
      mockPrisma.vehicle.findUnique.mockResolvedValue({ id: "v1", prefix: "ABT-1", type: "ABT", status: "EMPENHADA" })
      mockPrisma.vehiclePosition.findFirst.mockResolvedValue({ latitude: -23, longitude: -45, recorded_at: new Date(now.getTime() - 2000) })
      mockPrisma.vehicle.update.mockImplementation(({ data }) => ({ id: "v1", prefix: "ABT-1", ...data }))

      const updated = await service.execute({ id: "v1", current_latitude: -23.000001, current_longitude: -45 })

      expect(updated).toEqual(expect.objectContaining({ last_position_at: now }))
      expect(mockPrisma.vehiclePosition.create).not.toHaveBeenCalled()
    } finally { jest.useRealTimers() }
  })

  it.each([
    [1000, -23.002],
    [6000, -23],
  ])("keeps a point after %i ms at latitude %f when only one duplicate condition holds", async (age, latitude) => {
    const now = new Date("2026-10-07T12:00:00Z")
    jest.useFakeTimers().setSystemTime(now)
    try {
      mockPrisma.vehicle.findUnique.mockResolvedValue({ id: "v1", prefix: "ABT-1", type: "ABT", status: "DISPONIVEL" })
      mockPrisma.vehiclePosition.findFirst.mockResolvedValue({ latitude: -23, longitude: -45, recorded_at: new Date(now.getTime() - age) })
      mockPrisma.vehicle.update.mockImplementation(({ data }) => ({ id: "v1", prefix: "ABT-1", ...data }))
      await service.execute({ id: "v1", current_latitude: latitude, current_longitude: -45, heading: 180 })
      expect(mockPrisma.vehiclePosition.create).toHaveBeenCalledWith({ data: expect.objectContaining({ heading: 180, dispatch_id: null }) })
    } finally { jest.useRealTimers() }
  })

  it("throws NotFoundError when the vehicle does not exist", async () => {
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce(null)

    await expect(service.execute({ id: "missing" })).rejects.toThrow(NotFoundError)
  })

  it("throws ConflictError when the new prefix or plate belongs to another vehicle", async () => {
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce({ id: "v1", status: "DISPONIVEL" })
    mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ prefix: "TAKEN" })

    await expect(service.execute({ id: "v1", prefix: "TAKEN" })).rejects.toThrow(ConflictError)
  })

  it("throws ConflictError when moving an EMPENHADA vehicle away while a dispatch is still open", async () => {
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce({ id: "v1", status: "EMPENHADA" })
    mockPrisma.dispatch.findFirst.mockResolvedValueOnce({ id: "d1" })

    await expect(service.execute({ id: "v1", status: "MANUTENCAO" }))
      .rejects.toThrow("This vehicle is assigned to an open dispatch. Finish or cancel it first.")
  })

  it("allows moving an EMPENHADA vehicle to MANUTENCAO once no dispatch is open", async () => {
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce({ id: "v1", status: "EMPENHADA" })
    mockPrisma.dispatch.findFirst.mockResolvedValueOnce(null)
    mockPrisma.vehicle.update.mockResolvedValueOnce({ id: "v1", status: "MANUTENCAO" })

    await expect(service.execute({ id: "v1", status: "MANUTENCAO" })).resolves.toBeDefined()
  })

  it("does not check for open dispatches when the vehicle is not currently EMPENHADA", async () => {
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce({ id: "v1", status: "DISPONIVEL" })
    mockPrisma.vehicle.update.mockResolvedValueOnce({ id: "v1", status: "MANUTENCAO" })

    await service.execute({ id: "v1", status: "MANUTENCAO" })

    expect(mockPrisma.dispatch.findFirst).not.toHaveBeenCalled()
  })

  it("throws NotFoundError when transferring to a unit that does not exist", async () => {
    mockPrisma.vehicle.findUnique.mockResolvedValueOnce({ id: "v1", status: "DISPONIVEL" })
    mockPrisma.unit.findUnique.mockResolvedValueOnce(null)

    await expect(service.execute({ id: "v1", unit_id: "missing-unit" })).rejects.toThrow(NotFoundError)
  })
})
