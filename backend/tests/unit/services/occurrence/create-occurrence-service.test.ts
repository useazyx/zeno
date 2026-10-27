jest.mock("../../../../src/config/prisma.js", () => ({
  prisma: {
      occurrenceEvent: { createMany: jest.fn() },
    unit: { findUnique: jest.fn() },
    occurrence: { count: jest.fn(), findUnique: jest.fn(), create: jest.fn() }
  }
}))

import { ConflictError, NotFoundError } from "../../../../src/errors/index.js"
import { prisma } from "../../../../src/config/prisma.js"
import { eventHub } from "../../../../src/realtime/event-hub.js"
import { CreateOccurrenceService } from "../../../../src/services/occurrence/create-occurrence-service.js"

const mockPrisma = prisma as unknown as {
  unit: { findUnique: jest.Mock },
  occurrence: { count: jest.Mock, findUnique: jest.Mock, create: jest.Mock }
}

const baseRequest = {
  nature: "INCENDIO_EDIFICACAO" as const,
  priority: "ALTA" as const,
  description: "Incêndio em prédio comercial",
  address: "Av. Central, 200",
  latitude: -23.0264,
  longitude: -45.5553,
  unit_id: "unit1"
}

describe("CreateOccurrenceService", () => {
  const service = new CreateOccurrenceService()
  const publishSpy = jest.spyOn(eventHub, "publish").mockImplementation(() => {})

  afterEach(() => publishSpy.mockClear())

  it("throws NotFoundError when the unit does not exist", async () => {
    mockPrisma.unit.findUnique.mockResolvedValueOnce(null)

    await expect(service.execute(baseRequest)).rejects.toThrow(NotFoundError)
  })

  it("throws ConflictError when the unit is inactive", async () => {
    mockPrisma.unit.findUnique.mockResolvedValueOnce({ id: "unit1", active: false })

    await expect(service.execute(baseRequest)).rejects.toThrow("Cannot open an occurrence for an inactive unit")
  })

  it("allocates the first protocol of the year when no occurrence exists yet", async () => {
    mockPrisma.unit.findUnique.mockResolvedValueOnce({ id: "unit1", active: true })
    mockPrisma.occurrence.count.mockResolvedValueOnce(0)
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce(null)

    const year = new Date().getFullYear()
    mockPrisma.occurrence.create.mockImplementationOnce(async ({ data }: any) => ({
      id: "occ1", ...data, latitude: { toString: () => String(data.latitude) }, longitude: { toString: () => String(data.longitude) }
    }))

    await service.execute(baseRequest)

    expect(mockPrisma.occurrence.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ protocol: `${year}-000001` }) })
    )
  })

  it("retries the protocol when the first candidate is already taken", async () => {
    mockPrisma.unit.findUnique.mockResolvedValueOnce({ id: "unit1", active: true })
    mockPrisma.occurrence.count.mockResolvedValue(5) // re-queried on every retry attempt
    mockPrisma.occurrence.findUnique
      .mockResolvedValueOnce({ id: "taken" }) // candidate #6 already exists
      .mockResolvedValueOnce(null) // candidate #7 is free

    mockPrisma.occurrence.create.mockImplementationOnce(async ({ data }: any) => ({
      id: "occ2", ...data, latitude: { toString: () => String(data.latitude) }, longitude: { toString: () => String(data.longitude) }
    }))

    const year = new Date().getFullYear()
    await service.execute(baseRequest)

    expect(mockPrisma.occurrence.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ protocol: `${year}-000007` }) })
    )
  })

  it("publishes an occurrence.created event after creating the record", async () => {
    mockPrisma.unit.findUnique.mockResolvedValueOnce({ id: "unit1", active: true })
    mockPrisma.occurrence.count.mockResolvedValueOnce(0)
    mockPrisma.occurrence.findUnique.mockResolvedValueOnce(null)
    mockPrisma.occurrence.create.mockResolvedValueOnce({
      id: "occ1", protocol: "2026-000001", nature: baseRequest.nature, priority: baseRequest.priority,
      address: baseRequest.address, latitude: { toString: () => "-23.0264" }, longitude: { toString: () => "-45.5553" },
      unit_id: "unit1"
    })

    await service.execute(baseRequest)

    expect(publishSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "occurrence.created" }))
  })
})
